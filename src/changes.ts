import { redistributeMonthlyPlan, validateMonthlyRedistribution } from './spending';
import type { BudgetChange, BudgetItem, ChangeStatus, ChangeType, MonthlyPlanChangeMode, Project, ProjectDocumentLink, RulePack } from './types';

// ---- 예산 변경 신청 흐름 ----
// 변경은 저장하는 순간 끝나는 일이 아니다. 전문기관에 신청해서 승인을 받아야 효력이 생기고,
// 그 신청에는 "변경사항을 반영한 사업계획서"가 따라붙는다. 그래서 세 단계로 나눈다.
//   ① 변경 신청(예산은 그대로) → ② 승인 시 예산 반영
// 협약서·사업계획서는 이 화면에서 함께 보관하지만 등록은 선택이다 — 변경 기록만 남기려는
// 경우까지 막을 이유가 없다.
// 승인 전에 예산을 미리 바꿔두면 집행·잔액이 실제와 어긋나고, 반려됐을 때 되돌릴 근거가 없다.

// 협약 문서 — 변경 신청서에 협약 내용과 견준 근거를 적게 되므로 여기 함께 보관한다.
// 등록은 선택이다(사용자 결정). 문서가 없다고 변경 자체를 막으면, 기록만 남기려는 경우까지 가로막는다.
export const AGREEMENT_DOC_TYPES = ['AGREEMENT', 'PLAN'] as const;
export type AgreementDocType = (typeof AGREEMENT_DOC_TYPES)[number];
export const AGREEMENT_DOC_LABEL: Record<AgreementDocType, string> = {
  AGREEMENT: '협약서',
  PLAN: '사업계획서 (협약 당시)',
};

// 구버전 이력에는 status가 없다 — 그때는 저장 즉시 예산에 반영됐으므로 승인된 것으로 읽는다.
export const statusOf = (change: BudgetChange): ChangeStatus => change.status ?? 'approved';

// 통보·승인 구분. 미지정은 승인으로 본다 — 둘 중 엄격한 쪽이라 잘못 봐도 손해가 없다.
export const typeOf = (change: BudgetChange): ChangeType => change.changeType ?? 'approval';

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  notification: '통보 사항', approval: '승인 사항',
};

// 두 갈래가 실제로 무엇이 다른지 — 화면에서 고를 때 판단 근거가 된다.
export const CHANGE_TYPE_GUIDE: Record<ChangeType, { short: string; effect: string; examples: string }> = {
  notification: {
    short: '기관이 정하고 전문기관에 알립니다',
    effect: '통보 공문을 낸 뒤 집행할 수 있습니다. 별도 승인을 기다리지 않습니다.',
    examples: '대체로 직접비 비목 간 소액 조정이 여기에 해당합니다.',
  },
  approval: {
    short: '전문기관의 사전 승인을 받아야 합니다',
    effect: '승인 전에는 집행할 수 없습니다. 승인 공문을 받은 뒤 예산에 반영하세요.',
    examples: '총사업비·연구기간·연구책임자 변경, 간접비·위탁연구개발비가 걸린 조정 등이 여기에 해당하는 경우가 많습니다.',
  },
};

// 신청 단계에서 쓰는 말이 갈린다 — "승인 요청"과 "통보"는 하는 일이 다르다.
export const CHANGE_ACTION_LABEL: Record<ChangeType, { submit: string; settle: string; pending: string }> = {
  notification: { submit: '변경 통보하기', settle: '통보 완료 — 예산 반영', pending: '통보 준비 중인 변경' },
  approval: { submit: '변경 신청하기', settle: '승인 — 예산 반영', pending: '신청 중인 변경' },
};

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: '작성 중', submitted: '신청함', approved: '승인 — 예산 반영됨', rejected: '반려',
};

// 협약 문서가 등록돼 있는지. 과제 문서함(documents)에서 유형으로 가려낸다.
export const agreementDocsOf = (project: Project): ProjectDocumentLink[] =>
  (project.documents ?? []).filter((doc) => doc.applicationType === 'AGREEMENT');

export const hasAgreementDoc = (project: Project, type: AgreementDocType): boolean =>
  agreementDocsOf(project).some((doc) => doc.documentType === type);

// 아직 안 올린 문서 — 신청을 막지는 않고, 무엇을 더 챙기면 좋은지 알려주는 용도다.
export const missingAgreementDocs = (project: Project): AgreementDocType[] =>
  AGREEMENT_DOC_TYPES.filter((type) => !hasAgreementDoc(project, type));

// ---- 공문 문서번호 ----
// 기관마다 채번 방식이 다르지만, 비워두면 사용자가 매번 손으로 적어야 한다.
// "{기업약칭}-{연도}-{그 해 일련번호}"로 만들어 두고 필요하면 공문에서 고쳐 쓴다.
// 번호는 신청 시점에 정해 이력에 남긴다 — 나중에 다시 뽑아도 같은 번호여야 한다.
const companyAbbrev = (name: string): string => {
  // "주식회사 테스트랩" → "테스트랩". 법인 형태 표기는 번호에서 군더더기다.
  const core = name.replace(/\((주|재|사|유|합)\)|주식회사|유한회사|재단법인|사단법인|\s/g, '').trim();
  return (core || name.trim() || '과제').slice(0, 6);
};

export const nextDocumentNo = (project: Project, now: string): string => {
  const year = new Date(now).getFullYear();
  // 그 해에 이미 번호를 받은 변경 건수 + 1
  const used = project.changes.filter((change) => change.documentNo?.includes(`-${year}-`)).length;
  return `${companyAbbrev(project.companyName)}-${year}-${String(used + 1).padStart(3, '0')}`;
};

// 변경 신청 — 예산은 건드리지 않고 "이렇게 바꾸겠다"는 계획만 기록한다.
// before/after는 신청 시점의 스냅샷이다. 승인될 때 after를 그대로 적용하지 않고 다시 계산하는데,
// 신청과 승인 사이에 다른 변경이 승인되면 그 사이 예산이 이미 움직였기 때문이다.
export const requestChange = (
  project: Project,
  input: { fromCategoryId: string; toCategoryId: string; amount: number; reasonKey: string; reason: string; changeType?: ChangeType; effectiveMonth?: string; monthlyPlanChangeMode?: MonthlyPlanChangeMode; usagePlan?: string; planFileId?: string; planFileName?: string },
  now: string,
): Project => {
  const before = project.budgets.map((item) => ({ ...item }));
  const after = applyTransfer(before, input.fromCategoryId, input.toCategoryId, input.amount);
  const change: BudgetChange = {
    id: crypto.randomUUID(),
    fromCategoryId: input.fromCategoryId, toCategoryId: input.toCategoryId, amount: input.amount,
    reasonKey: input.reasonKey, reason: input.reason,
    before, after,
    createdAt: now, changeType: input.changeType ?? 'approval', status: 'submitted', submittedAt: now,
    effectiveMonth: input.effectiveMonth,
    monthlyPlanChangeMode: input.monthlyPlanChangeMode ?? 'preserve',
    planFileId: input.planFileId, planFileName: input.planFileName,
    usagePlan: input.usagePlan,
    documentNo: nextDocumentNo(project, now),
  };
  return { ...project, changes: [change, ...project.changes] };
};

// 비목 금액이 움직이면 그 안의 세목과 현물도 같은 편성 안에서 유효해야 한다.
// 세목은 기존 비율로 조정하고 반올림 차이는 마지막 세목에 모아 합계가 비목 금액과 정확히 맞게 한다.
const resizeBudgetItem = (item: BudgetItem, amount: number): BudgetItem => {
  const nextAmount = Math.max(0, amount);
  const subItems = item.subItems?.length
    ? (() => {
        const basis = item.subItems.reduce((total, sub) => total + sub.amount, 0);
        if (basis <= 0) return item.subItems.map((sub, index) => ({ ...sub, amount: index === item.subItems!.length - 1 ? nextAmount : 0 }));
        let assigned = 0;
        return item.subItems.map((sub, index) => {
          const adjusted = index === item.subItems!.length - 1
            ? nextAmount - assigned
            : Math.round(nextAmount * sub.amount / basis);
          assigned += adjusted;
          return { ...sub, amount: adjusted };
        });
      })()
    : undefined;
  return {
    ...item,
    amount: nextAmount,
    ...(subItems ? { subItems } : {}),
    ...(item.inKindAmount != null ? { inKindAmount: Math.min(item.inKindAmount, nextAmount) || undefined } : {}),
  };
};

// 비목 간 금액 이동을 적용한 새 편성 배열. 받는 비목이 아직 없으면 만들어 넣는다.
export const applyTransfer = (budgets: BudgetItem[], fromId: string, toId: string, amount: number): BudgetItem[] => {
  const next = budgets.map((item) => item.categoryId === fromId ? resizeBudgetItem(item, item.amount - amount) : item);
  const target = next.find((item) => item.categoryId === toId);
  if (target) return next.map((item) => item.categoryId === toId ? resizeBudgetItem(item, item.amount + amount) : item);
  return [...next, { categoryId: toId, amount }];
};

// 승인 — 이때 비로소 예산이 움직인다. 지금 예산에 이동을 적용하고, 그 결과를 이력에 남긴다.
// pack이 넘어오고 변경에 적용월이 있으면 월별 집행계획도 새 예산에 맞춰 재배분한다(적용월 이전 달은 유지).
export const approveChange = (project: Project, changeId: string, now: string, note?: string, pack?: RulePack): Project => {
  const change = project.changes.find((item) => item.id === changeId);
  if (!change || statusOf(change) !== 'submitted') return project;
  const before = project.budgets.map((item) => ({ ...item }));
  const budgets = applyTransfer(before, change.fromCategoryId, change.toCategoryId, change.amount);
  const next: Project = {
    ...project,
    budgets,
    // 승인 시점의 예산이 신청 때와 다를 수 있어(그 사이 다른 변경이 승인됨) 실제 적용된 값으로 갱신한다.
    changes: project.changes.map((item) => item.id !== changeId ? item
      : { ...item, status: 'approved', decidedAt: now, decisionNote: note, before, after: budgets.map((entry) => ({ ...entry })) }),
    // 변경관리에서 승인한 편성은 이미 검토를 거친 값이다. 기존 확정 상태를 유지해 집행·증빙에 즉시 반영한다.
    budgetConfirmed: true,
  };
  // 적용월 기준으로 보내는·받는 비목의 월별 계획을 새 예산에 맞춰 다시 나눈다.
  if (pack && change.effectiveMonth) {
    const mode = change.monthlyPlanChangeMode ?? 'preserve';
    const invalid = validateMonthlyRedistribution(pack, project, next, [change.fromCategoryId, change.toCategoryId], change.effectiveMonth, mode);
    if (invalid) return project;
    return redistributeMonthlyPlan(pack, project, next, [change.fromCategoryId, change.toCategoryId], change.effectiveMonth, mode);
  }
  return next;
};

// 반려 — 예산은 그대로 두고 회신 내용만 남긴다. 지운다면 왜 못 바꿨는지가 사라진다.
export const rejectChange = (project: Project, changeId: string, now: string, note: string): Project => {
  const change = project.changes.find((item) => item.id === changeId);
  if (!change || statusOf(change) !== 'submitted') return project;
  return {
    ...project,
    changes: project.changes.map((item) => item.id !== changeId ? item
      : { ...item, status: 'rejected', decidedAt: now, decisionNote: note }),
  };
};

// 신청했지만 아직 결과를 못 받은 변경 — 예산에는 안 잡혀 있으므로 화면에서 따로 알려야 한다.
export const pendingChanges = (project: Project): BudgetChange[] =>
  project.changes.filter((change) => statusOf(change) === 'submitted');

// 신청 중인 이동까지 반영하면 각 비목이 얼마가 되는지 — "승인되면 이렇게 된다"를 미리 보여준다.
export const projectedBudgets = (project: Project): BudgetItem[] =>
  pendingChanges(project).reduce(
    (budgets, change) => applyTransfer(budgets, change.fromCategoryId, change.toCategoryId, change.amount),
    project.budgets.map((item) => ({ ...item })),
  );
