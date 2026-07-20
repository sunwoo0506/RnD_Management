import packsData from './rulepacks/packs.json';
import type { BudgetCategoryId, BudgetItem, PackCategory, PackRule, PaymentMethod, Project, RulePack } from './types';

export const RULES_EFFECTIVE_DATE = '2026-07-19';

// ---- 레거시 팩: 동적 구조 도입 이전(중기부 R&D 예시 기준)에 만들어진 과제가 계속 동작하도록 유지 ----
const legacySource = { doc: '중기부 R&D 일반 기준 (예시 · 원문 검증 전)', ref: '구버전 예시 데이터', matchLevel: 'template', appDefault: true };
const legacyCat = (id: string, name: string, limit: number, draft: number, definition: string, docs: string[]): PackCategory =>
  ({ id, name, allowed: true, definition, draftRate: draft, requiredDocs: docs, source: legacySource });

const LEGACY_PACK: RulePack = {
  id: 'legacy-rnd', name: '중기부 R&D (구버전 예시)', orgType: '중소기업',
  guideline: '중기부 R&D 일반 기준 (예시 · 원문 검증 전)', agency: '중소벤처기업부',
  hasRatioLimits: true, verified: false, referenceUrl: 'https://www.smtech.go.kr',
  categories: [
    legacyCat('personnel', '인건비', 50, 45, '과제 참여 인력의 인건비. 참여율과 급여 지급 내역이 일치해야 합니다.', ['근로계약서', '급여대장', '계좌이체 확인증', '참여인력 현황표']),
    legacyCat('equipment', '연구시설·장비비', 30, 15, '연구 수행에 직접 필요한 장비. 3천만 원 이상은 별도 심의 여부 확인.', ['견적서', '비교견적서', '세금계산서', '검수조서', '계좌이체 확인증']),
    legacyCat('materials', '연구재료비', 40, 15, '과제와 직접 관련된 재료. 구매 수량과 연구계획의 연관성 설명 필요.', ['견적서', '세금계산서', '거래명세서', '검수조서', '계좌이체 확인증']),
    legacyCat('outsourcing', '외주용역비', 20, 10, '핵심 연구개발 업무의 전부를 위탁할 수 없습니다.', ['과업지시서', '용역계약서', '견적서', '세금계산서', '결과보고서']),
    legacyCat('activity', '연구활동비', 10, 5, '과제 수행과 직접 관련된 출장·교육 등의 활동 비용.', ['내부품의서', '출장보고서 또는 결과보고서', '영수증', '계좌이체 확인증']),
    legacyCat('meeting', '회의비', 10, 5, '과제 관련 외부 참석자가 포함된 회의. 주류 등 불인정 항목 제외.', ['내부품의서', '회의록', '참석자 명단', '카드 영수증']),
    legacyCat('indirect', '간접비', 10, 5, '고시된 간접비 기준과 협약 내용을 우선 확인하세요.', ['간접비 산출내역서', '내부 결재 문서']),
  ],
  rules: [
    { id: 'legacy_r_personnel', kind: 'ratio', item: '인건비', message: '인건비는 총 사업비의 50% 이내', limitPct: 50, basis: '총 사업비', categoryIds: ['personnel'], source: legacySource },
    { id: 'legacy_r_equipment', kind: 'ratio', item: '연구시설·장비비', message: '연구시설·장비비는 총 사업비의 30% 이내', limitPct: 30, basis: '총 사업비', categoryIds: ['equipment'], source: legacySource },
    { id: 'legacy_r_materials', kind: 'ratio', item: '연구재료비', message: '연구재료비는 총 사업비의 40% 이내', limitPct: 40, basis: '총 사업비', categoryIds: ['materials'], source: legacySource },
    { id: 'legacy_r_outsourcing', kind: 'ratio', item: '외주용역비', message: '외주용역비는 총 사업비의 20% 이내', limitPct: 20, basis: '총 사업비', categoryIds: ['outsourcing'], source: legacySource },
    { id: 'legacy_r_activity', kind: 'ratio', item: '연구활동비', message: '연구활동비는 총 사업비의 10% 이내', limitPct: 10, basis: '총 사업비', categoryIds: ['activity'], source: legacySource },
    { id: 'legacy_r_meeting', kind: 'ratio', item: '회의비', message: '회의비는 총 사업비의 10% 이내', limitPct: 10, basis: '총 사업비', categoryIds: ['meeting'], source: legacySource },
    { id: 'legacy_r_indirect', kind: 'ratio', item: '간접비', message: '간접비는 총 사업비의 10% 이내', limitPct: 10, basis: '총 사업비', categoryIds: ['indirect'], source: legacySource },
  ],
  applicationDocs: [],
};

// ---- 팩 로더 ----
export const PACKS: RulePack[] = [...(packsData as RulePack[]), LEGACY_PACK];
// 새 과제 등록 화면에서 고를 수 있는 팩 (레거시 제외)
export const SELECTABLE_PACKS: RulePack[] = PACKS.filter((pack) => pack.id !== 'legacy-rnd');

export const getPack = (packId: string): RulePack => PACKS.find((pack) => pack.id === packId) ?? LEGACY_PACK;
// 레지스트리에서 불러온 팩 스냅샷(customPack)이 있으면 그것을, 없으면 내장 팩을 쓴다.
export const packFor = (project: Project): RulePack => project.customPack ?? getPack(project.packId);

// 저장 데이터에 남은 옛 비목 ID 등 팩에 없는 ID가 와도 화면이 죽지 않도록 스텁을 돌려준다.
export const categoryOf = (pack: RulePack, id: BudgetCategoryId): PackCategory =>
  pack.categories.find((category) => category.id === id)
  ?? { id, name: id, allowed: true, draftRate: 0, requiredDocs: [], source: { doc: '알 수 없음', ref: '', matchLevel: 'unknown' } };

// 편성 확정 후에는 금액 0원인 비목을 숨긴다 (사용자 결정). 집행 이력이 있는 비목은 항상 표시.
export const visibleCategories = (pack: RulePack, project: Project): PackCategory[] =>
  pack.categories.filter((category) => {
    if (!category.allowed) return false;
    if (!project.budgetConfirmed) return true;
    const amount = project.budgets.find((item) => item.categoryId === category.id)?.amount ?? 0;
    const used = project.expenses.some((expense) => expense.categoryId === category.id);
    return amount > 0 || used;
  });

export const makeDraftBudgets = (pack: RulePack, total: number): BudgetItem[] =>
  pack.categories.filter((category) => category.allowed).map((category) => ({
    categoryId: category.id,
    amount: Math.round(total * category.draftRate / 100),
  }));

// 카드 결제는 카드 영수증이 세금계산서·계좌이체 확인증 역할을 대신하므로 해당 서류를 요구하지 않는다.
export const documentsFor = (category: PackCategory, payment: PaymentMethod): string[] => {
  if (payment !== 'card') return category.requiredDocs;
  const kept = category.requiredDocs.filter((doc) => !/세금계산서|계좌이체|이체 ?확인증|영수증/.test(doc));
  return [...kept, '카드 영수증'];
};

// ---- 규칙 조회 ----
export const rulesFor = (pack: RulePack, categoryId: BudgetCategoryId, kind?: PackRule['kind']): PackRule[] =>
  pack.rules.filter((rule) => rule.categoryIds?.includes(categoryId) && (!kind || rule.kind === kind));

export const globalRules = (pack: RulePack, kind?: PackRule['kind']): PackRule[] =>
  pack.rules.filter((rule) => !rule.categoryIds?.length && (!kind || rule.kind === kind));

// ---- 상한 계산 ----
// ratio 규칙의 basis를 편성표에서 계산 가능한 경우에만 금액 상한으로 환산한다.
// (구입가·도입비 등 편성표 밖의 기준은 계산 불가 → 안내 텍스트로만 표시)
export interface CategoryCap { amount: number | null; label: string; rule: PackRule }

export const capFor = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, categoryId: BudgetCategoryId): CategoryCap | null => {
  // 하한(이상 지급) 규칙은 상한 검사 대상이 아니다 (예: 학생인건비 10% 이상 지급 관리).
  const ratio = rulesFor(pack, categoryId, 'ratio').find((rule) => rule.limitPct !== undefined && !/이상/.test(rule.basis ?? ''));
  if (!ratio || ratio.limitPct === undefined) return null;
  const basis = ratio.basis ?? '';
  const amountOf = (id: string) => budgets.find((item) => item.categoryId === id)?.amount ?? 0;
  let baseAmount: number | null = null;
  if (/총\s*사업비|총액/.test(basis)) baseAmount = totalBudget;
  else if (/직접비/.test(basis)) baseAmount = totalBudget - amountOf('indirect') - amountOf('outsourcing');
  else if (/수정인건비|인건비/.test(basis)) baseAmount = amountOf('personnel');
  const category = categoryOf(pack, categoryId);
  // 규칙 대상이 비목 전체가 아니라 비목 안의 세부 항목(예: 간접비 중 능률성과급)이면 금액 상한으로 강제하지 않고 안내만 한다.
  const partial = !!ratio.item && ratio.item !== category.name && !category.name.includes(ratio.item);
  const prefix = partial ? `${ratio.item}: ` : '';
  const label = `${prefix}${ratio.basis ?? '기준'}의 ${ratio.limitPct}% 이내`;
  return { amount: !partial && baseAmount !== null ? Math.round(baseAmount * ratio.limitPct / 100) : null, label, rule: ratio };
};

// 편성 화면의 비목 상태: 상한 초과 여부 (상한 계산 가능할 때만)
export const isOverCap = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, categoryId: BudgetCategoryId): boolean => {
  const cap = capFor(pack, budgets, totalBudget, categoryId);
  if (!cap || cap.amount === null) return false;
  const amount = budgets.find((item) => item.categoryId === categoryId)?.amount ?? 0;
  return amount > cap.amount;
};

// 예산 변경 시 받는 비목이 상한을 넘는지 검사 (상한 규칙이 없는 팩·비목은 통과)
export const transferLimitError = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, toId: BudgetCategoryId, amount: number): string | null => {
  if (!totalBudget || amount <= 0) return null;
  const cap = capFor(pack, budgets, totalBudget, toId);
  if (!cap || cap.amount === null) return null;
  const current = budgets.find((item) => item.categoryId === toId)?.amount ?? 0;
  if (current + amount <= cap.amount) return null;
  const category = categoryOf(pack, toId);
  return `${category.name} 편성이 변경 후 ${formatWon(current + amount)}가 되어 허용 상한 ${formatWon(cap.amount)}(${cap.label})을 초과합니다. (근거: ${cap.rule.source.ref})`;
};

// ---- 공용 유틸 ----
export const formatWon = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

export const REASON_TEMPLATES = [
  { key: 'outsource-inhouse', label: '외주 → 자체 수행 전환', text: '외부 용역으로 계획한 개발 범위를 내부 연구인력의 역량 확보에 따라 자체 수행으로 전환하고, 이에 필요한 인건비를 증액하고자 합니다.' },
  { key: 'price', label: '시장 단가 변동', text: '협약 이후 원자재 및 공급 단가가 변동되어 실제 구매 견적을 반영하고, 연구 목표 달성을 위해 비목 간 예산을 조정하고자 합니다.' },
  { key: 'quantity', label: '연구 물량 변경', text: '실험 결과에 따라 검증에 필요한 시제품 및 재료의 수량이 변경되어 연구재료비 예산을 조정하고자 합니다.' },
  { key: 'equipment', label: '장비 사양 변경', text: '연구 수행 과정에서 요구 성능이 구체화됨에 따라 장비 사양을 변경하고, 최종 견적에 맞춰 관련 예산을 조정하고자 합니다.' },
  { key: 'schedule', label: '연구 일정 조정', text: '과제 수행 일정 및 단계별 연구 범위가 조정되어 집행 시기와 비목별 소요 예산을 현실화하고자 합니다.' },
  { key: 'saving', label: '집행 잔액 재배분', text: '경쟁 견적 및 비용 절감을 통해 발생한 집행 잔액을 추가 검증 활동에 활용하여 연구 성과를 높이고자 합니다.' },
];
