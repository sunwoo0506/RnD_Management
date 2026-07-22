import packsData from './rulepacks/packs.json';
import nrd2026Packs from './rulepacks/nrd2026.json';
import tips2026Packs from './rulepacks/tips2026.json';
import prestartup2026Packs from './rulepacks/prestartup2026.json';
import didimdol2026Packs from './rulepacks/didimdol2026.json';
import type { BudgetCategoryId, BudgetItem, PackArticle, PackCategory, PackOverlay, PackRule, Participant, PaymentMethod, Project, RulePack } from './types';

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
// 번들에 들어 있는 팩. Supabase가 없거나 아직 응답하지 않았을 때 쓰는 기본값이며, 같은 id의
// 팩이 규정DB(Supabase)에서 오면 그쪽이 이긴다 — 규정이 개정돼도 재배포 없이 반영되도록.
export const PACKS: RulePack[] = [...(packsData as RulePack[]), ...(nrd2026Packs as RulePack[]), ...(tips2026Packs as RulePack[]), ...(prestartup2026Packs as RulePack[]), ...(didimdol2026Packs as RulePack[]), LEGACY_PACK];
// 규정 DB에서 만든 팩으로 대체된 예시 팩 — 기존 과제가 계속 열리도록 남기되 새 과제에서는 고를 수 없다.
const SUPERSEDED_PACK_IDS = ['legacy-rnd', 'prestartup'];

// Supabase 규정DB에서 내려받은 팩 (regulationDb.ts가 채운다). 같은 id의 번들 팩을 덮어쓴다.
let remotePacks: RulePack[] = [];
export const setRegulationPacks = (packs: RulePack[]) => { remotePacks = packs; };
export const regulationPacks = (): RulePack[] => remotePacks;

// 번들 + 원격을 합친 목록. 같은 id면 원격이 이긴다.
export const allPacks = (): RulePack[] => {
  const byId = new Map<string, RulePack>(PACKS.map((pack) => [pack.id, pack]));
  for (const pack of remotePacks) byId.set(pack.id, pack);
  return [...byId.values()];
};

// 새 과제 등록 화면에서 고를 수 있는 팩 — 근거가 검증된 규정DB 팩을 앞에 세운다.
export const selectablePacks = (): RulePack[] => {
  const packs = allPacks().filter((pack) => !SUPERSEDED_PACK_IDS.includes(pack.id));
  return packs.sort((a, b) => Number(isRegulationDbPack(b)) - Number(isRegulationDbPack(a)));
};

export const isRegulationDbPack = (pack: RulePack): boolean => pack.origin === 'regulation_db';

// ---- 과제가 쓰던 규정 팩이 사라졌는지 ----
// 규정이 개정되면 팩이 갈리거나(tips2026 → 일반/딥테크) 이름이 바뀐다. 그때 과제에 저장된
// packId 는 어디에도 없는 id 가 되고, packFor()는 적용 시점 스냅샷(customPack)으로 되돌아간다.
// 화면은 그대로 동작하지만 새로 생긴 한도·규칙이 반영되지 않으므로, 사용자에게 알려야 한다.
export const packIsMissing = (project: Project): boolean =>
  !allPacks().some((pack) => pack.id === project.packId);

// 사라진 팩을 대신할 후보를 찾는다.
//
// 1) id 접두사 — 같은 팩이 갈린 것이라면 id 를 공유한다 (tips2026 → tips2026-general 등).
// 2) 지침명 — 규정DB에서 사업을 골라 만든 과제는 packId 가 'registry:<uuid>' 라서 접두사가
//    통하지 않는다. 이때는 적용 시점 스냅샷의 지침명으로 같은 규정에서 나온 팩을 찾는다.
export const replacementPacksFor = (project: Project): RulePack[] => {
  const byPrefix = allPacks().filter((pack) => pack.id !== project.packId
    && (pack.id.startsWith(`${project.packId}-`) || project.packId.startsWith(`${pack.id}-`)));
  if (byPrefix.length) return byPrefix;
  const guideline = project.customPack?.guideline;
  if (!guideline) return [];
  return allPacks().filter((pack) => pack.guideline === guideline && pack.id !== project.packId);
};

export const getPack = (packId: string): RulePack =>
  remotePacks.find((pack) => pack.id === packId) ?? PACKS.find((pack) => pack.id === packId) ?? LEGACY_PACK;

// 최신 공고에서 확인해 승인한 변경사항을 기준 팩 위에 얹는다. 비목은 건드리지 않는다 —
// 같은 id의 규칙은 오버레이 것으로 대체하고, 대체된 기준 규칙은 목록에서 빼 중복 표시를 막는다.
export const applyOverlay = (base: RulePack, overlay: PackOverlay): RulePack => {
  const replaced = new Set([...overlay.rules.map((rule) => rule.id), ...(overlay.supersededRuleIds ?? [])]);
  return { ...base, rules: [...base.rules.filter((rule) => !replaced.has(rule.id)), ...overlay.rules] };
};

// 예산편성 화면이 쓰는 팩.
//
// 비목은 근거가 검증된 규정DB 팩에서만 온다. AI 추출 결과(customPack)는 그 위에 얹는
// 오버레이로만 반영되고 비목 구성을 바꾸지 못한다 — 화면에 뜬 비목이 언제나 어느 문서 몇 조에서
// 왔는지 되짚을 수 있어야 하기 때문이다.
// 예외는 대응하는 규정DB가 아직 없는 사업뿐이다. 이때는 추출 팩으로라도 편성할 수 있게 두되,
// isRegulationDbPack()이 false라 화면이 "미검증"으로 표시한다.
export const packFor = (project: Project): RulePack => {
  const registered = getPack(project.packId);
  const base = isRegulationDbPack(registered) ? registered : (project.customPack ?? registered);
  const overlay = project.packOverlay;
  // 기준 팩이 바뀐 뒤의 오버레이는 근거가 어긋날 수 있으므로 적용하지 않는다.
  return overlay && overlay.basePackId === base.id ? applyOverlay(base, overlay) : base;
};

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

// 공고문에서 온 "OO비목에 반드시 N원 이상 계상" 같은 정액 필수 계상 요구사항.
export interface CategoryMin { amount: number; label: string; rule: PackRule }
export const minFor = (pack: RulePack, categoryId: BudgetCategoryId): CategoryMin | null => {
  const rule = rulesForWithNameFallback(pack, categoryId, 'minimum').find((r) => r.minAmount != null);
  if (!rule || rule.minAmount == null) return null;
  return { amount: rule.minAmount, label: `${rule.item ? `${rule.item}: ` : ''}${formatWon(rule.minAmount)} 이상 필수 계상`, rule };
};

// 초안 배분 후 필수 계상 항목이 있으면 최소 금액 이상이 되도록 끌어올린다 (전체 합계는 재조정하지 않음 — 편성 화면에서 확인 후 조정).
export const makeDraftBudgets = (pack: RulePack, total: number): BudgetItem[] =>
  pack.categories.filter((category) => category.allowed).map((category) => {
    const amount = Math.round(total * category.draftRate / 100);
    const min = minFor(pack, category.id);
    return { categoryId: category.id, amount: min && amount < min.amount ? min.amount : amount };
  });

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

// 이름 비교용 정규화 — 공백·중점·마침표 차이("연구시설·장비비" vs "연구시설.장비비")를 무시한다.
const normName = (text: string) => text.replace(/[\s·.,]/g, '');

// 비목에 연결(categoryIds)되지 못한 채 "과제 공통"으로 저장된 규칙을 비목 이름으로 재매칭한다.
// AI 추출 팩에서 규칙의 item·message가 저장 시점 이름 매칭에 실패하면 상한·필수계상이 통째로
// "제한 없음"이 되는 문제를, 이미 적용된 팩 데이터까지 포함해 화면 계산 시점에 복구한다.
const ruleMatchesCategory = (rule: PackRule, categoryName: string): boolean => {
  const nc = normName(categoryName);
  if (!nc) return false;
  if (rule.item) {
    const ni = normName(rule.item);
    return ni === nc || ni.includes(nc) || nc.includes(ni);
  }
  return normName(rule.message).includes(nc);
};

const rulesForWithNameFallback = (pack: RulePack, categoryId: BudgetCategoryId, kind: PackRule['kind']): PackRule[] => {
  const linked = rulesFor(pack, categoryId, kind);
  if (linked.length) return linked;
  const name = categoryOf(pack, categoryId).name;
  return globalRules(pack, kind).filter((rule) => ruleMatchesCategory(rule, name));
};

// ---- 꼭 계상해야 하는 것 ----
// "연구활동비 내 외부전문기술 활용비로 200만원을 필수 계상해야 한다" 같은 규칙은 금지·주의와
// 성격이 다르다. 편성 단계에서 빠뜨리면 나중에 협약 해약까지 갈 수 있는데, 기준 패널을 열어야
// 보이면 그대로 지나친다. 그래서 이것만 골라 편성표의 비목 아래에 세운다.
const MUST_ALLOCATE = /(필수|반드시|의무적으로)\s*계상/;
const NOT_ALLOCATE = /계상\s*(금지|불가|제외)|계상할\s*수\s*없/;

export const mandatoryNotesFor = (pack: RulePack, categoryId: BudgetCategoryId): PackRule[] => {
  const found = rulesForWithNameFallback(pack, categoryId, 'warning')
    .filter((rule) => MUST_ALLOCATE.test(`${rule.message} ${rule.trigger ?? ''}`) && !NOT_ALLOCATE.test(rule.message));
  // 같은 요구가 공고와 지침에 따로 실려 있으면(문구만 다른 같은 금액의 필수 계상) 한 번만 보여준다.
  const byAmount = new Map<string, PackRule>();
  for (const rule of found) {
    const key = (rule.message.match(/\d[\d,]*\s*(?:억|천만|백만|만)?\s*원/g) ?? [rule.id]).join('·');
    const kept = byAmount.get(key);
    // 같은 요구면 사정을 더 자세히 적은 쪽(문구가 긴 쪽)을 남긴다.
    if (!kept || kept.message.length < rule.message.length) byAmount.set(key, rule);
  }
  return [...byAmount.values()];
};

// ---- 상한 계산 ----
// ratio 규칙의 basis를 편성표에서 계산 가능한 경우에만 금액 상한으로 환산한다.
// (구입가·도입비 등 편성표 밖의 기준은 계산 불가 → 안내 텍스트로만 표시)
export interface CategoryCap {
  amount: number | null;     // 이 비목 전체에 걸리는 상한 금액 (계산 불가·세부항목 기준이면 null)
  label: string;             // "직접비의 40% 이내" 같은 기준 문구
  rule: PackRule;
  basisAmount: number | null; // 상한 계산에 쓴 기준 금액 — 편성 화면에서 계산식을 그대로 보여준다
  basisParts: BasisBreakdown['parts']; // 기준 금액이 어떻게 나왔는지 (총사업비 − 간접비 − …)
  basisLabel: string;        // 기준 이름 (총사업비, 직접비, 수정인건비 합계 …)
  limitPct: number;          // 적용 비율 %
  // amount가 null인 이유를 구분한다: partial이면 규칙 대상이 비목 전체가 아니라 그 안의 세부항목이고,
  // 아니면 기준(구입가 등)이 편성표 밖이라 계산할 수 없다는 뜻이다. 화면 안내 문구가 달라진다.
  partial: boolean;
  // 세부항목 기준(partial)이라 비목 전체에 강제할 수는 없지만 금액은 계산되는 경우.
  // "외부 전문기술 활용비는 직접비의 40%" 처럼, 얼마까지인지는 알려줘야 세목을 짤 수 있다.
  referenceAmount: number | null;
  // "구입가의 20% 이내에서 현물로 계상" 처럼 현물로 계상할 때만 걸리는 상한.
  // 현물이 0원이면 적용될 일이 아예 없으므로 안내 문구를 따로 써야 한다.
  inKindOnly: boolean;
}

// 현물 계상에만 걸리는 상한인지 — 규칙 문구에서 "현물(로) 계상"을 찾는다.
// "직접비(현물 부담액 제외)의 10%"처럼 현물을 기준에서 빼는 규칙과 헷갈리지 않게 붙어 있는 표현만 본다.
const inKindOnlyRule = (rule: PackRule): boolean =>
  /현물(으?로)?\s*계상/.test([rule.item, rule.message, rule.quote, rule.note, rule.condition].filter(Boolean).join(' '));

// 기준 이름은 괄호 앞까지만 남기되, 괄호 안의 "제외" 문구는 짧게 요약해 붙인다.
// 같은 "직접비"라도 무엇을 빼는지에 따라 금액이 달라서(위탁 상한의 직접비 ≠ 간접비 상한의 직접비),
// 괄호를 통째로 버리면 편성표에 이름은 같고 금액만 다른 기준이 나란히 서게 된다.
const EXCLUSION_LABELS: [RegExp, string][] = [
  [/현물/, '현물'], [/미지급인건비/, '미지급인건비'], [/위탁/, '위탁'],
  [/국제공동/, '국제공동'], [/부담비/, '부담비'], [/간접비/, '간접비'],
];
// 기준 문구의 괄호에서 "무엇을 빼는지"만 추린다.
//   "현물, 위탁연구개발비 제외"        → 쉼표로 나열된 것이 모두 제외 대상
//   "현물 포함, 위탁연구개발비 제외"    → 포함이라고 밝힌 조각만 빼고 나머지가 제외 대상
const exclusionText = (basis: string): string => {
  const inside = /[(（]([^)）]*)[)）]/.exec(basis)?.[1] ?? '';
  if (!/제외/.test(inside)) return '';
  if (!/포함/.test(inside)) return inside;
  return inside.split(/[,，]/).filter((part) => !/포함/.test(part)).join(' ');
};

const shortBasis = (basis: string): string => {
  const head = basis.split(/[(（]/)[0].trim() || basis;
  const excluded = exclusionText(basis);
  const terms = EXCLUSION_LABELS.filter(([re]) => re.test(excluded)).map(([, label]) => label);
  return terms.length ? `${head}(${terms.join('·')} 제외)` : head;
};

// 상한 기준 금액. "직접비"라고만 적힌 기준과 "직접비(위탁·국제공동 제외)"는 다른 금액이라,
// 기준 문구가 빼라고 밝힌 비목만 정확히 뺀다. 예전에는 어느 직접비 기준이든 위탁을 함께 뺐는데,
// 그러면 연구활동비 상한(직접비의 40%)이 규정보다 낮게 잡혔다.
// inKindWon: 민간부담금 중 현물 금액 — 현물은 편성표 비목이 아니라 재원 구성에서 온다.
// 기준 금액이 어떻게 나왔는지까지 돌려준다 — "왜 이 금액이 안 바뀌지"는 계산식을 봐야 풀린다
// (직접비 기준은 인건비를 아무리 옮겨도 안 움직이고, 간접비·위탁을 바꿔야 움직인다).
export interface BasisBreakdown { amount: number | null; parts: { label: string; amount: number; minus?: boolean }[] }

export const basisBreakdownOf = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, basis: string, inKindWon = 0): BasisBreakdown => {
  const amountOf = (id: string) => budgets.find((item) => item.categoryId === id)?.amount ?? 0;
  // 내장 팩은 고정 비목 ID(personnel 등)를 쓰지만 AI 추출 팩은 문서 비목명 기반 ID(doc_0_인건비 등)라
  // ID로 못 찾으면 비목 "이름"으로 찾는다 — 안 그러면 인건비 편성액이 0으로 잡혀 상한이 0원이 된다.
  // 해당 이름의 비목이 아예 없으면 0원으로 단정하지 않고 null(계산 불가 → 안내만)로 둔다.
  const sumByName = (re: RegExp): number | null => {
    const matched = pack.categories.filter((category) => re.test(category.name.replace(/\s/g, '')));
    return matched.length ? matched.reduce((sum, category) => sum + amountOf(category.id), 0) : null;
  };
  const resolve = (id: string, re: RegExp): number | null =>
    pack.categories.some((category) => category.id === id) ? amountOf(id) : sumByName(re);
  if (/총\s*사업비|총액/.test(basis)) return { amount: totalBudget, parts: [{ label: '총 사업비', amount: totalBudget }] };
  if (/직접비/.test(basis)) {
    // 직접비 = 총사업비 − 간접비. 여기서 기준이 "제외"라고 밝힌 비목을 더 뺀다.
    const parts: BasisBreakdown['parts'] = [{ label: '총 사업비', amount: totalBudget }];
    let amount = totalBudget;
    const subtract = (label: string, value: number | null) => {
      if (value === null) return;
      amount -= value;
      parts.push({ label, amount: value, minus: true });
    };
    subtract('간접비', resolve('indirect', /간접비/));
    const excluded = exclusionText(basis);
    if (/위탁|외주/.test(excluded)) subtract('위탁연구개발비', resolve('outsourcing', /위탁연구|외주/));
    if (/국제공동/.test(excluded)) subtract('국제공동연구개발비', sumByName(/국제공동/));
    if (/부담비/.test(excluded)) subtract('연구개발부담비', sumByName(/연구개발부담비/));
    // "직접비(현물 포함)"은 빼지 않는다 — 포함 표기가 있으면 제외 문구가 뒤따라도 현물은 그대로 둔다.
    if (/현물/.test(excluded) && !/현물\s*포함/.test(basis)) subtract('민간부담 현물', inKindWon);
    return { amount: Math.max(0, amount), parts };
  }
  if (/수정인건비|인건비/.test(basis)) {
    const labor = resolve('personnel', /인건비/);
    return { amount: labor, parts: labor === null ? [] : [{ label: '인건비 편성액', amount: labor }] };
  }
  return { amount: null, parts: [] };
};

export const basisAmountOf = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, basis: string, inKindWon = 0): number | null =>
  basisBreakdownOf(pack, budgets, totalBudget, basis, inKindWon).amount;

// "총 사업비 4억 − 간접비 2,340만 − 위탁연구개발비 0원" — 기준 금액이 무엇에 따라 움직이는지 그대로 보여준다.
export const basisFormula = (parts: BasisBreakdown['parts']): string =>
  parts.map((part, index) => `${index === 0 ? '' : part.minus ? '− ' : '+ '}${part.label} ${formatWon(part.amount)}`).join(' ');

export const capFor = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, categoryId: BudgetCategoryId, inKindWon = 0): CategoryCap | null => {
  // 하한(이상 지급) 규칙은 상한 검사 대상이 아니다 (예: 학생인건비 10% 이상 지급 관리).
  const ratio = rulesForWithNameFallback(pack, categoryId, 'ratio').find((rule) => rule.limitPct !== undefined && !/이상/.test(rule.basis ?? ''));
  if (!ratio || ratio.limitPct === undefined) return null;
  const basis = ratio.basis ?? '';
  const breakdown = basisBreakdownOf(pack, budgets, totalBudget, basis, inKindWon);
  const baseAmount = breakdown.amount;
  const category = categoryOf(pack, categoryId);
  // 규칙 대상이 비목 전체가 아니라 비목 안의 세부 항목(예: 간접비 중 능률성과급)이면 금액 상한으로 강제하지 않고 안내만 한다.
  // 이름 비교는 공백·중점·마침표 차이를 무시한다 ("연구시설·장비비" 규칙이 "연구시설.장비비" 비목의 세부 항목으로 오인되지 않게).
  const partial = !!ratio.item && normName(ratio.item) !== normName(category.name) && !normName(category.name).includes(normName(ratio.item));
  const prefix = partial ? `${ratio.item}: ` : '';
  const label = `${prefix}${ratio.basis ?? '기준'}의 ${ratio.limitPct}% 이내`;
  // 세부항목 기준이어도 금액은 계산해 알려준다 — 다만 비목 전체의 상한으로 강제하지는 않는다
  // (그러면 "외부 전문기술 활용비 40%"가 연구활동비 전체를 묶어버린다).
  const capAmount = baseAmount === null ? null : Math.round(baseAmount * ratio.limitPct / 100);
  return {
    amount: partial ? null : capAmount,
    referenceAmount: partial ? capAmount : null,
    label, rule: ratio,
    basisAmount: baseAmount,
    basisParts: breakdown.parts,
    basisLabel: `${prefix}${shortBasis(ratio.basis ?? '기준')}`,
    limitPct: ratio.limitPct,
    partial,
    inKindOnly: inKindOnlyRule(ratio),
  };
};

// ---- 상한 계산의 기준 금액 ----
// "수정인건비 합계의 20%", "직접비의 40%"처럼 상한은 늘 다른 금액을 기준으로 잡힌다.
// 그 기준 금액이 얼마인지는 비목마다 흩어져 있어서, 편성표 아래에 한 번에 모아 보여준다.
// 이름이 같아 보여도(직접비) 무엇을 빼는지에 따라 금액이 다르므로 기준 문구 그대로 구분한다.
export interface BudgetBasis {
  basis: string;      // 기준 문구 원문 ("직접비(현물 포함, 위탁연구개발비 제외)")
  label: string;      // 편성표에 쓰는 짧은 이름 ("직접비(위탁 제외)")
  amount: number;     // 계산된 기준 금액
  formula: string;    // 어떻게 나온 금액인지 ("총 사업비 4억 − 간접비 2,340만 …")
  categories: string[]; // 이 기준을 쓰는 상한의 이름 (비목명, 세부항목 기준이면 그 항목명)
}

export const budgetBases = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, inKindWon = 0): BudgetBasis[] => {
  const found = new Map<string, BudgetBasis>();
  for (const category of pack.categories.filter((c) => c.allowed)) {
    const cap = capFor(pack, budgets, totalBudget, category.id, inKindWon);
    // 금액으로 환산되지 않는 기준(구입가 등)은 편성표 밖 숫자라 여기 세울 수 없다.
    if (!cap || cap.basisAmount === null) continue;
    // 세부항목 기준이면 그 항목 이름을 쓴다 — "연구활동비 상한의 기준"이라고 하면 비목 전체에
    // 걸리는 상한으로 읽힌다.
    const user = cap.partial ? cap.rule.item ?? category.name : category.name;
    const entry = found.get(cap.rule.basis ?? '');
    if (entry) { if (!entry.categories.includes(user)) entry.categories.push(user); continue; }
    found.set(cap.rule.basis ?? '', {
      basis: cap.rule.basis ?? '',
      label: shortBasis(cap.rule.basis ?? '기준'),
      amount: cap.basisAmount,
      formula: basisFormula(cap.basisParts),
      categories: [user],
    });
  }
  return [...found.values()];
};

// 상한을 넘지 않고 이 비목에 넣을 수 있는 최대 금액 (ceiling = 잔액까지 다 쓸 때의 금액).
// 상한 기준이 이 비목 편성액에 따라 같이 움직이는 경우가 있어서 필요하다 —
// 간접비 상한은 "직접비의 10%"인데 직접비 = 총사업비 − 간접비 − 위탁이라, 화면에 보이는
// 상한 금액까지 슬라이더를 끌면 그 순간 기준이 줄어 곧바로 "상한 초과"가 된다.
export const maxAmountWithinCap = (
  pack: RulePack, budgets: BudgetItem[], totalBudget: number,
  categoryId: BudgetCategoryId, ceiling: number, inKindWon = 0,
): number => {
  if (ceiling <= 0) return 0;
  const capAt = (amount: number): number | null => {
    const exists = budgets.some((item) => item.categoryId === categoryId);
    const next = exists
      ? budgets.map((item) => item.categoryId === categoryId ? { ...item, amount } : item)
      : [...budgets, { categoryId, amount }];
    return capFor(pack, next, totalBudget, categoryId, inKindWon)?.amount ?? null;
  };
  const top = capAt(ceiling);
  // 상한이 없거나(계산 불가 포함) 잔액을 다 써도 상한 안이면 잔액까지 그대로 쓸 수 있다.
  if (top === null || ceiling <= top) return ceiling;
  // 편성액이 늘면 상한은 줄거나 그대로다 → cap(v) ≥ v 를 만족하는 최대 v를 이분 탐색한다.
  let low = 0, high = ceiling;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const cap = capAt(mid);
    if (cap === null || mid <= cap) low = mid; else high = mid;
  }
  return low;
};

// 편성 화면의 비목 상태: 상한 초과 여부 (상한 계산 가능할 때만)
export const isOverCap = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, categoryId: BudgetCategoryId): boolean => {
  const cap = capFor(pack, budgets, totalBudget, categoryId);
  if (!cap || cap.amount === null) return false;
  const amount = budgets.find((item) => item.categoryId === categoryId)?.amount ?? 0;
  return amount > cap.amount;
};

// 예산 변경 시 받는 비목이 상한을 넘는지 검사 (상한 규칙이 없는 팩·비목은 통과)
export const transferLimitError = (pack: RulePack, budgets: BudgetItem[], totalBudget: number, toId: BudgetCategoryId, amount: number, inKindWon = 0): string | null => {
  if (!totalBudget || amount <= 0) return null;
  const cap = capFor(pack, budgets, totalBudget, toId, inKindWon);
  if (!cap || cap.amount === null) return null;
  const current = budgets.find((item) => item.categoryId === toId)?.amount ?? 0;
  if (current + amount <= cap.amount) return null;
  const category = categoryOf(pack, toId);
  return `${category.name} 편성이 변경 후 ${formatWon(current + amount)}가 되어 허용 상한 ${formatWon(cap.amount)}(${cap.label})을 초과합니다. (근거: ${cap.rule.source.ref})`;
};

// ---- 규정 DB 기준 조회 (팩 종류와 무관) ----
// 공고문에서 AI로 추출한 팩이나 내장 예시 팩에는 규정 DB의 인정 항목·상한·근거 조문이 없다.
// 그래도 비목 이름은 규정 체계를 따르는 경우가 대부분이라(인건비, 외부 전문기술 활용비 …),
// 이름으로 규정 DB 팩의 기준을 찾아 "공통 규정 기준"으로 함께 보여준다.
// 국가연구개발사업 연구개발비 사용 기준은 국가 R&D 공통 기준이고, TIPS 지침도 이를 따르되
// 별도로 정한 것만 우선한다(지침 11.가) — 그래서 공고 기준을 대체하지 않고 참고로만 붙인다.
const REFERENCE_PACK_IDS = ['nrd2026-forprofit', 'tips2026-general'];

export interface ReferenceStandard { pack: RulePack; category: PackCategory }

// 이름 비교용 정규화 — 공백·중점·괄호 차이를 무시한다.
const normCategoryName = (text: string) => text.replace(/[\s·.,()（）]/g, '');

// 규정 DB 팩에서 이 이름에 해당하는 기준을 찾는다. 편성 비목과 참조 비목(세부 비목)을 모두 뒤지고,
// 이름이 구체적인 것(긴 것)을 먼저 맞춰 "학생인건비"가 "인건비"로 뭉뚱그려지지 않게 한다.
export const referenceStandardFor = (categoryName: string, currentPackId?: string): ReferenceStandard | null => {
  const target = normCategoryName(categoryName);
  if (target.length < 2) return null;
  let best: { entry: ReferenceStandard; score: number } | null = null;
  for (const packId of REFERENCE_PACK_IDS) {
    // 이미 그 규정 DB 팩을 쓰고 있으면 자기 자신을 참고로 붙일 필요가 없다.
    if (packId === currentPackId) continue;
    const pack = getPack(packId);
    if (pack.id !== packId) continue; // getPack은 못 찾으면 LEGACY_PACK을 준다
    for (const category of [...pack.categories, ...(pack.referenceCategories ?? [])]) {
      const name = normCategoryName(category.name);
      if (!name) continue;
      // 정확 일치 > 화면 비목이 규정 비목을 포함 > 규정 비목이 화면 비목을 포함
      const score = name === target ? 1000 + name.length
        : target.includes(name) ? 500 + name.length
        : name.includes(target) ? 100 + target.length
        : 0;
      if (score && (!best || score > best.score)) best = { entry: { pack, category }, score };
    }
  }
  return best?.entry ?? null;
};

// ---- 이 사업이 따르는 상위 규정 ----
// 공고·지침 규정DB는 그 사업이 "따로 정한 것"만 담는다. 디딤돌 공고의 인정 항목이 주요 비목
// 몇 개뿐인 것도 그래서다 — 나머지는 "국가연구개발사업 연구개발비 사용 기준에 따른다"고만 적혀 있다.
// 그 관계를 팩의 basePackId 로 들고 있어, 세목·인정 항목을 상위 규정 팩에서 마저 가져온다.
export const basePackFor = (pack: RulePack): RulePack | null => {
  if (!pack.basePackId || pack.basePackId === pack.id) return null;
  return allPacks().find((candidate) => candidate.id === pack.basePackId) ?? null;
};

// 팩(또는 상위 규정 팩)에서 이 비목에 해당하는 기준을 찾는다.
// 비목 코드는 규정DB끼리 맞춰져 있지만(DIRECT_ACTIVITY 등), 코드가 다른 팩도 있어 이름으로도 찾는다.
// 세부 비목(연구활동비 아래 회의비·출장비)은 referenceCategories 쪽에 있다.
const matchingCategory = (pack: RulePack, category: PackCategory): PackCategory | undefined =>
  pack.categories.find((c) => c.id === category.id)
  ?? [...pack.categories, ...(pack.referenceCategories ?? [])].find((c) => normCategoryName(c.name) === normCategoryName(category.name));

// 상위 규정 팩에서 이 비목의 기준(인정 항목 등)을 찾는다 — 공고가 정하지 않은 부분을 채우는 용도.
export const baseStandardFor = (pack: RulePack, categoryId: BudgetCategoryId): ReferenceStandard | null => {
  const base = basePackFor(pack);
  const category = pack.categories.find((c) => c.id === categoryId);
  if (!base || !category) return null;
  const matched = matchingCategory(base, category);
  return matched ? { pack: base, category: matched } : null;
};

// ---- 계상 가능 세목 후보 ----
// 편성표에서 "세목 나누기"를 할 때 고를 수 있는 항목. 직접 입력도 되지만, 규정에 있는 이름을
// 그대로 골라 쓰면 정산 때 비목-세목 대응을 다시 맞출 일이 없다.
export interface SubItemChoice { name: string; note?: string }
export interface SubItemChoices {
  own: SubItemChoice[];       // 이 사업 공고·지침이 직접 정한 세목
  base: SubItemChoice[];      // 상위 규정(국가연구개발사업 연구개발비 사용 기준 등)에서 온 세목
  basePack: RulePack | null;  // base가 어디서 왔는지 (화면에 출처를 밝힌다)
}

const choicesOf = (category?: PackCategory): SubItemChoice[] => {
  if (!category) return [];
  const noteOf = (name: string) => {
    const item = category.allowedItems?.find((entry) => entry.name === name);
    return item?.condition ?? item?.description ?? item?.restriction;
  };
  if (category.subItemOptions?.length) return category.subItemOptions.map((name) => ({ name, note: noteOf(name) }));
  return (category.allowedItems ?? []).map((item) => ({ name: item.name, note: item.condition ?? item.description ?? item.restriction }));
};

export const subItemChoicesFor = (pack: RulePack, categoryId: BudgetCategoryId): SubItemChoices => {
  const category = pack.categories.find((c) => c.id === categoryId);
  if (!category) return { own: [], base: [], basePack: null };
  const own = choicesOf(category);
  // 상위 규정을 따른다고 규정DB가 밝힌 팩만 그 팩의 세목을 덧붙인다. 그런 선언이 없는 팩(예비창업패키지 등)은
  // 비목 체계 자체가 달라서 이름이 비슷하다고 국가 R&D 세목을 끌어오면 안 된다.
  // 공고에 기준이 아예 없는 비목은 예전처럼 이름으로 찾은 공통 규정 기준을 쓴다.
  const basePack = basePackFor(pack) ?? (own.length ? null : referenceStandardFor(category.name, pack.id)?.pack ?? null);
  if (!basePack) return { own, base: [], basePack: null };
  const taken = new Set(own.map((choice) => normCategoryName(choice.name)));
  const base = choicesOf(matchingCategory(basePack, category)).filter((choice) => !taken.has(normCategoryName(choice.name)));
  return { own, base, basePack: base.length ? basePack : null };
};

// ---- 조문 원문 찾기 ----
// 규칙의 근거(ref)로 규정 DB의 조문 원문을 찾는다. HWP에서 뽑은 본문은 자동 매긴 조문 번호가
// 빠져서 원본 문서 검색이 자주 실패하는데, 이 표에는 번호와 본문이 함께 있어 항상 정확히 열린다.
const normRef = (text: string) => text.replace(/[\s·.,()]/g, '');

// 화면에서 쓰는 조문 조회. 현재 팩에 조문 원문이 없으면(공고문 AI 추출 팩·내장 예시 팩)
// 규정 DB 팩에서 같은 조문을 찾는다 — 그 팩의 기준을 참고로 보여주고 있으므로 근거도 그쪽에 있다.
export const findArticles = (pack: RulePack, ref: string): { pack: RulePack; articles: PackArticle[] } | null => {
  const own = articlesForRef(pack, ref);
  if (own.length) return { pack, articles: own };
  for (const packId of REFERENCE_PACK_IDS) {
    if (packId === pack.id) continue;
    const referencePack = getPack(packId);
    if (referencePack.id !== packId) continue;
    const found = articlesForRef(referencePack, ref);
    if (found.length) return { pack: referencePack, articles: found };
  }
  return null;
};

export const articlesForRef = (pack: RulePack, ref: string): PackArticle[] => {
  const articles = pack.articles;
  if (!articles?.length || !ref) return [];
  const found: PackArticle[] = [];
  const add = (article?: PackArticle) => { if (article && !found.some((a) => a.key === article.key)) found.push(article); };
  // 근거가 "제27조제3항·제73조제1항제7호"처럼 여러 조문을 묶어 쓰므로 조문 번호를 모두 뽑아 각각 찾는다.
  for (const match of ref.matchAll(/제\s*\d+(?:의\s*\d+)?\s*조/g)) {
    const target = normRef(match[0]);
    add(articles.find((article) => normRef(article.ref) === target));
  }
  if (found.length) return found;
  // 조문 번호 체계가 아닌 지침류("지침 11.다.1) 인건비 가)")는 가장 길게 앞부분이 겹치는 조항을 쓴다.
  const target = normRef(ref);
  const prefixed = articles
    .filter((article) => target.startsWith(normRef(article.ref)) || normRef(article.ref).startsWith(target))
    .sort((a, b) => normRef(b.ref).length - normRef(a.ref).length);
  add(prefixed[0]);
  return found;
};

// ---- 공용 유틸 ----
export const formatWon = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

// ---- 재원 구성 (지원금 / 민간부담금 현금·현물) ----
// 정산 관행상 금액은 천 원 단위에서 올림 처리한다.
const ceilThousand = (value: number) => Math.ceil(value / 1000) * 1000;

// 공고문에 나온 지원금 실액과 지원비율(%)로 총사업비를 역산한다. 지원비율 100(자기부담 없음)이면 지원금=총사업비.
export const deriveTotalBudget = (subsidyAmount: number, subsidyRate: number): number =>
  subsidyRate > 0 && subsidyRate < 100 ? ceilThousand(subsidyAmount / (subsidyRate / 100)) : subsidyAmount;

// 민간부담금 중 현금은 "비율 이상" 최소 기준이므로 올림, 현물은 나머지(= 민간부담금 합계 - 현금)로 계산해 합계가 항상 일치하도록 한다.
const splitMatching = (matching: number, matchingCashRate: number) => {
  if (matching <= 0) return { matchingCash: 0, matchingInKind: 0 };
  const matchingCash = Math.min(ceilThousand(matching * matchingCashRate / 100), matching);
  return { matchingCash, matchingInKind: matching - matchingCash };
};

export interface FundingBreakdown {
  subsidy: number;          // 지원금(정부지원금)
  matching: number;         // 민간부담금 합계
  matchingCash: number;     // 민간부담금 — 현금 (matchingCashRateKnown=false면 미확정, 0)
  matchingInKind: number;   // 민간부담금 — 현물 (matchingCashRateKnown=false면 미확정, 0)
  matchingCashRate: number; // 적용된 현금 비율 %
  matchingCashRateKnown: boolean; // false면 현금 비율을 아직 확인하지 못해 현금·현물을 나누지 않은 상태
}

// 저장된 totalBudget·subsidyAmount로 지원금/민간부담금(현금·현물)을 계산한다.
// subsidyAmount가 없는 구버전 과제는 자기부담 없음(지원금 = 총사업비)으로 취급한다.
// 민간부담금이 있는데 현금 비율을 아직 모르면(matchingCashRate 미입력) 임의로 100%나 0%로 단정하지 않고 "확인 필요" 상태로 둔다.
export const fundingBreakdown = (project: Project): FundingBreakdown => {
  const subsidy = Math.min(project.subsidyAmount ?? project.totalBudget, project.totalBudget);
  const matching = Math.max(project.totalBudget - subsidy, 0);
  const matchingCashRateKnown = matching === 0 || project.matchingCashRate != null;
  const matchingCashRate = matchingCashRateKnown ? (project.matchingCashRate ?? 100) : 0;
  const { matchingCash, matchingInKind } = matchingCashRateKnown ? splitMatching(matching, matchingCashRate) : { matchingCash: 0, matchingInKind: 0 };
  return { subsidy, matching, matchingCash, matchingInKind, matchingCashRate, matchingCashRateKnown };
};

// ---- 사업비 한도 대조 ----
// 사업마다 지원금 총액이 정해져 있는 경우가 있다 (예비창업패키지 1단계 2천만원,
// 창업성장기술개발 도약 2억원 등). 규정 팩의 fundingCap 과 사용자가 입력한 금액을 견줘,
// 잘못 입력한 사업비를 편성 전에 잡아낸다. 안내 문구로만 두면 틀린 채로 편성이 끝난다.
export interface FundingCapCheck {
  cap: number;
  target: 'subsidy' | 'total';
  targetLabel: string;   // 무엇을 견줬는지 (지원금 / 총사업비)
  basis: string;         // 한도의 기준 이름
  entered: number;       // 사용자가 입력한 금액
  over: boolean;         // 한도를 넘었는지
  diff: number;          // 한도와의 차이 (초과면 양수, 미달이면 음수)
  rule: PackRule;
}

export const fundingCapChecks = (pack: RulePack, project: Project): FundingCapCheck[] =>
  pack.rules
    .filter((rule): rule is PackRule & { fundingCap: number } => rule.fundingCap != null)
    .map((rule) => {
      const target = rule.fundingCapTarget ?? 'subsidy';
      const entered = target === 'subsidy'
        ? (project.subsidyAmount ?? project.totalBudget)
        : project.totalBudget;
      return {
        cap: rule.fundingCap,
        target,
        targetLabel: target === 'subsidy' ? '지원금' : '총사업비',
        basis: rule.fundingCapBasis ?? '사업비',
        entered,
        over: entered > rule.fundingCap,
        diff: entered - rule.fundingCap,
        rule,
      };
    });

// ---- 재원 구성 비율 대조 ----
// 사업마다 정부지원 비율 상한(75% 이내)과 민간부담 현금 최소비율(10% 이상)이 정해져 있다.
// 금액 한도(fundingCap)가 없는 사업도 이 비율은 거의 항상 있으므로, 입력한 비율이 규정을
// 벗어나면 편성 전에 알려준다. 현금 비율을 아직 모르는 상태(미입력)는 위반이 아니라 "확인 필요"다.
export interface FundingRateCheck {
  role: 'subsidy_max' | 'matching_min' | 'matching_cash_min';
  label: string;      // 무엇에 대한 비율인지
  pct: number;        // 규정 비율
  entered: number | null; // 입력값 (모르면 null)
  ok: boolean;        // 규정을 지키는지 (모르면 false 가 아니라 unknown 으로 구분)
  unknown: boolean;   // 아직 입력하지 않아 판정할 수 없음
  rule: PackRule;
}

export const fundingRateChecks = (pack: RulePack, project: Project): FundingRateCheck[] => {
  const subsidyRate = project.subsidyRate ?? 100;
  const matchingRate = 100 - subsidyRate;
  return pack.rules
    .filter((rule): rule is PackRule & { fundingRole: NonNullable<PackRule['fundingRole']>; fundingPct: number } =>
      rule.fundingRole != null && rule.fundingPct != null)
    .map((rule) => {
      if (rule.fundingRole === 'subsidy_max') {
        return { role: rule.fundingRole, label: '정부지원 비율', pct: rule.fundingPct, entered: subsidyRate, ok: subsidyRate <= rule.fundingPct, unknown: false, rule };
      }
      if (rule.fundingRole === 'matching_min') {
        return { role: rule.fundingRole, label: '기관부담 비율', pct: rule.fundingPct, entered: matchingRate, ok: matchingRate >= rule.fundingPct, unknown: false, rule };
      }
      // 민간부담이 아예 없는 사업(전액 지원)이면 현금 비율 규정은 적용할 것이 없다.
      const cashKnown = project.matchingCashRate != null;
      const entered = project.matchingCashRate ?? null;
      return {
        role: rule.fundingRole, label: '민간부담 중 현금 비율', pct: rule.fundingPct, entered,
        ok: matchingRate === 0 || (cashKnown && (entered ?? 0) >= rule.fundingPct),
        unknown: matchingRate > 0 && !cashKnown,
        rule,
      };
    });
};

// 총사업비가 바뀌었을 때 이미 편성한 비목 금액을 같은 비율로 옮긴다.
// 초안으로 되돌리지 않고 비율을 지키는 이유: 사용자가 직접 조정한 배분이 사라지면 안 된다.
// 반올림 오차는 가장 큰 비목이 흡수해 합계가 정확히 newTotal 이 되게 맞춘다.
export const rescaleBudgets = (budgets: BudgetItem[], oldTotal: number, newTotal: number): BudgetItem[] => {
  const current = budgets.reduce((sum, item) => sum + item.amount, 0);
  // 기준이 될 합계가 없으면(총액 0 또는 미편성) 비율을 구할 수 없어 그대로 둔다.
  if (current <= 0 || oldTotal <= 0 || newTotal < 0) return budgets;
  const ratio = newTotal / current;
  const scaled = budgets.map((item) => ({
    ...item,
    amount: Math.round(item.amount * ratio),
    ...(item.inKindAmount != null ? { inKindAmount: Math.round(item.inKindAmount * ratio) } : {}),
    ...(item.subItems ? { subItems: item.subItems.map((sub) => ({ ...sub, amount: Math.round(sub.amount * ratio) })) } : {}),
  }));
  const diff = newTotal - scaled.reduce((sum, item) => sum + item.amount, 0);
  if (diff === 0) return scaled;
  // 가장 큰 비목에 오차를 얹는다 (작은 비목에 얹으면 음수가 될 수 있다).
  let biggest = 0;
  scaled.forEach((item, index) => { if (item.amount > scaled[biggest].amount) biggest = index; });
  const target = scaled[biggest];
  const adjusted = Math.max(0, target.amount + diff);
  scaled[biggest] = {
    ...target,
    amount: adjusted,
    ...(target.inKindAmount != null ? { inKindAmount: Math.min(target.inKindAmount, adjusted) } : {}),
    // 세목이 있으면 비목 금액은 세목 합계로 유지돼야 하므로 마지막 세목에서 같이 맞춘다.
    ...(target.subItems?.length
      ? { subItems: target.subItems.map((sub, index) => index === target.subItems!.length - 1 ? { ...sub, amount: Math.max(0, sub.amount + diff) } : sub) }
      : {}),
  };
  return scaled;
};

// 과제 등록·설정 화면에서 저장 전 입력값으로 같은 계산을 미리보기할 때 쓴다.
export const previewFunding = (subsidyAmount: number, subsidyRate: number, matchingCashRate: number) => {
  const totalBudget = deriveTotalBudget(subsidyAmount, subsidyRate);
  const matching = Math.max(totalBudget - subsidyAmount, 0);
  const { matchingCash, matchingInKind } = splitMatching(matching, matchingCashRate);
  return { totalBudget, matching, matchingCash, matchingInKind };
};

// ---- 인건비 계산 (인력·담당자 화면) ----
// 4대보험 사업자 부담분 근사 요율 % — 국민연금 4.5 + 건강·장기요양 약 4 + 고용 약 1.15 + 산재 약 1.
// 업종·규모에 따라 다르므로 과제별로 수정할 수 있다 (project.insuranceRate).
export const DEFAULT_INSURANCE_RATE = 11;

// 참여기간 개월 수 — 양 끝 달을 모두 포함한다 (2026-01 ~ 2026-12 = 12개월).
export const monthsBetween = (start?: string, end?: string): number => {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
};

export interface LaborCost {
  pay: number;       // 월급여
  insurance: number; // 4대보험 사업자부담 (월)
  severance: number; // 퇴직급여충당금 (월, 월급여의 1/12)
  monthly: number;   // 월 인건비 = (월급여+4대보험+퇴직금) × 참여율
  months: number;    // 참여 개월 수
  total: number;     // 사업기간 합계 인건비
  cash: number;      // 합계 중 현금
  inKind: number;    // 합계 중 현물
}

// 퇴직급여충당금은 계속근로 1년 이상인 사람만 계상할 수 있어 인력마다 다르다.
// 개인 설정(participant.includeSeverance)이 있으면 그것을, 없으면 과제 기본값을 따른다.
export const severanceApplies = (participant: Participant, projectDefault?: boolean): boolean =>
  participant.includeSeverance ?? projectDefault ?? true;

export const laborCostFor = (
  participant: Participant,
  // includeInsurance: 4대보험 계상 여부(사업별로 다름, 전원 일괄). includeSeverance: 퇴직금 과제 기본값 — 개인 설정이 우선한다.
  opts: { startDate: string; endDate: string; insuranceRate?: number; includeInsurance?: boolean; includeSeverance?: boolean },
): LaborCost => {
  const pay = participant.monthlyPay ?? 0;
  const insurance = (opts.includeInsurance ?? true) ? Math.round(pay * (opts.insuranceRate ?? DEFAULT_INSURANCE_RATE) / 100) : 0;
  const severance = severanceApplies(participant, opts.includeSeverance) ? Math.round(pay / 12) : 0;
  const months = monthsBetween(participant.laborStart ?? opts.startDate, participant.laborEnd ?? opts.endDate);
  const monthly = Math.round((pay + insurance + severance) * participant.projectRate / 100);
  const total = monthly * months;
  // 계상 구분: 현물(전액)·현금(전액)은 합계를 그대로 따라가고, 혼합만 laborInKind 입력값을 쓴다.
  // laborFunding 미지정 구버전 데이터는 laborInKind 입력이 있으면 혼합, 없으면 현금으로 본다.
  const fundingKind = participant.laborFunding ?? (participant.laborInKind != null ? 'mixed' : 'cash');
  const inKind = fundingKind === 'inkind' ? total : fundingKind === 'cash' ? 0 : Math.min(participant.laborInKind ?? 0, total);
  return { pay, insurance, severance, monthly, months, total, cash: total - inKind, inKind };
};

export const REASON_TEMPLATES = [
  { key: 'outsource-inhouse', label: '외주 → 자체 수행 전환', text: '외부 용역으로 계획한 개발 범위를 내부 연구인력의 역량 확보에 따라 자체 수행으로 전환하고, 이에 필요한 인건비를 증액하고자 합니다.' },
  { key: 'price', label: '시장 단가 변동', text: '협약 이후 원자재 및 공급 단가가 변동되어 실제 구매 견적을 반영하고, 연구 목표 달성을 위해 비목 간 예산을 조정하고자 합니다.' },
  { key: 'quantity', label: '연구 물량 변경', text: '실험 결과에 따라 검증에 필요한 시제품 및 재료의 수량이 변경되어 연구재료비 예산을 조정하고자 합니다.' },
  { key: 'equipment', label: '장비 사양 변경', text: '연구 수행 과정에서 요구 성능이 구체화됨에 따라 장비 사양을 변경하고, 최종 견적에 맞춰 관련 예산을 조정하고자 합니다.' },
  { key: 'schedule', label: '연구 일정 조정', text: '과제 수행 일정 및 단계별 연구 범위가 조정되어 집행 시기와 비목별 소요 예산을 현실화하고자 합니다.' },
  { key: 'saving', label: '집행 잔액 재배분', text: '경쟁 견적 및 비용 절감을 통해 발생한 집행 잔액을 추가 검증 활동에 활용하여 연구 성과를 높이고자 합니다.' },
];
