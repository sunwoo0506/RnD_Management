import type { BudgetChange, BudgetItem, ChangeStatus, Project, ProjectDocumentLink } from './types';

// ---- 예산 변경 신청 흐름 ----
// 변경은 저장하는 순간 끝나는 일이 아니다. 전문기관에 신청해서 승인을 받아야 효력이 생기고,
// 그 신청에는 "변경사항을 반영한 사업계획서"가 따라붙는다. 그래서 세 단계로 나눈다.
//   ① 협약 문서 등록 → ② 변경 신청(예산은 그대로) → ③ 승인 시 예산 반영
// 승인 전에 예산을 미리 바꿔두면 집행·잔액이 실제와 어긋나고, 반려됐을 때 되돌릴 근거가 없다.

// 신청의 근거가 되는 협약 문서 — 이것이 없으면 무엇을 어떻게 바꾸는지 견줄 기준이 없다.
export const AGREEMENT_DOC_TYPES = ['AGREEMENT', 'PLAN'] as const;
export type AgreementDocType = (typeof AGREEMENT_DOC_TYPES)[number];
export const AGREEMENT_DOC_LABEL: Record<AgreementDocType, string> = {
  AGREEMENT: '협약서',
  PLAN: '사업계획서 (협약 당시)',
};

// 구버전 이력에는 status가 없다 — 그때는 저장 즉시 예산에 반영됐으므로 승인된 것으로 읽는다.
export const statusOf = (change: BudgetChange): ChangeStatus => change.status ?? 'approved';

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: '작성 중', submitted: '신청함', approved: '승인 — 예산 반영됨', rejected: '반려',
};

// 협약 문서가 등록돼 있는지. 과제 문서함(documents)에서 유형으로 가려낸다.
export const agreementDocsOf = (project: Project): ProjectDocumentLink[] =>
  (project.documents ?? []).filter((doc) => doc.applicationType === 'AGREEMENT');

export const hasAgreementDoc = (project: Project, type: AgreementDocType): boolean =>
  agreementDocsOf(project).some((doc) => doc.documentType === type);

// 변경을 신청할 수 있는 상태인지. 없는 문서를 알려줘야 무엇을 준비해야 하는지 안다.
export const missingAgreementDocs = (project: Project): AgreementDocType[] =>
  AGREEMENT_DOC_TYPES.filter((type) => !hasAgreementDoc(project, type));

export const canRequestChange = (project: Project): boolean => missingAgreementDocs(project).length === 0;

// 변경 신청 — 예산은 건드리지 않고 "이렇게 바꾸겠다"는 계획만 기록한다.
// before/after는 신청 시점의 스냅샷이다. 승인될 때 after를 그대로 적용하지 않고 다시 계산하는데,
// 신청과 승인 사이에 다른 변경이 승인되면 그 사이 예산이 이미 움직였기 때문이다.
export const requestChange = (
  project: Project,
  input: { fromCategoryId: string; toCategoryId: string; amount: number; reasonKey: string; reason: string; planFileId?: string; planFileName?: string },
  now: string,
): Project => {
  const before = project.budgets.map((item) => ({ ...item }));
  const after = applyTransfer(before, input.fromCategoryId, input.toCategoryId, input.amount);
  const change: BudgetChange = {
    id: crypto.randomUUID(),
    fromCategoryId: input.fromCategoryId, toCategoryId: input.toCategoryId, amount: input.amount,
    reasonKey: input.reasonKey, reason: input.reason,
    before, after,
    createdAt: now, status: 'submitted', submittedAt: now,
    planFileId: input.planFileId, planFileName: input.planFileName,
  };
  return { ...project, changes: [change, ...project.changes] };
};

// 비목 간 금액 이동을 적용한 새 편성 배열. 받는 비목이 아직 없으면 만들어 넣는다.
export const applyTransfer = (budgets: BudgetItem[], fromId: string, toId: string, amount: number): BudgetItem[] => {
  const next = budgets.map((item) => item.categoryId === fromId ? { ...item, amount: item.amount - amount } : item);
  const target = next.find((item) => item.categoryId === toId);
  if (target) return next.map((item) => item.categoryId === toId ? { ...item, amount: item.amount + amount } : item);
  return [...next, { categoryId: toId, amount }];
};

// 승인 — 이때 비로소 예산이 움직인다. 지금 예산에 이동을 적용하고, 그 결과를 이력에 남긴다.
export const approveChange = (project: Project, changeId: string, now: string, note?: string): Project => {
  const change = project.changes.find((item) => item.id === changeId);
  if (!change || statusOf(change) !== 'submitted') return project;
  const before = project.budgets.map((item) => ({ ...item }));
  const budgets = applyTransfer(before, change.fromCategoryId, change.toCategoryId, change.amount);
  return {
    ...project,
    budgets,
    // 승인 시점의 예산이 신청 때와 다를 수 있어(그 사이 다른 변경이 승인됨) 실제 적용된 값으로 갱신한다.
    changes: project.changes.map((item) => item.id !== changeId ? item
      : { ...item, status: 'approved', decidedAt: now, decisionNote: note, before, after: budgets.map((entry) => ({ ...entry })) }),
    budgetConfirmed: false,   // 편성이 바뀌었으니 확정은 풀린다 — 다시 확인하고 확정해야 한다
  };
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
