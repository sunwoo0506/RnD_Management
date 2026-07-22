// 지침 추출 프레임워크가 만든 규정 DB 패키지(docs/extraction_DB/...)를 앱 표준 RulePack으로 변환한다.
// 사용법: node scripts/convert-regulation-db.mjs [패키지 폴더]
// 출력: src/rulepacks/nrd2026.json (영리기관·비영리기관 팩 2개)
//
// 매핑 원칙:
//  - legal_budget_tree의 2레벨 비목(+간접비)이 편성 비목이 된다. 연구활동비의 3레벨 세부 비목은
//    비목 설명(definition)에 나열하고, 화면의 "세목 나누기"로 나눠 편성한다.
//  - expense_limit_rules 중 "편성 단계에서 계산 가능한 기준(직접비·수정인건비·수정직접비)"만
//    ratio(상한) 규칙으로 만들고, 나머지(건별 한도·사전승인·자격·절차)는 warning(금지·주의)으로 만든다.
//  - 계산 불가 기준의 비율 규칙(구입가의 20% 등)은 ratio로 두되 금액 계산 없이 안내만 표시된다.
//  - 초안 배분율·증빙 목록은 원본에 없는 앱 편의 데이터(appDefault) — 전부 "예시 기준"이다.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = process.argv[2] ?? join(root, 'docs', 'extraction_DB', 'gwayeon_regulation_db_2026_38_final');

const readJson = (name) => JSON.parse(readFileSync(join(pkgDir, name), 'utf8'));
// 파일명은 MVP 규격(04_mvp_output_spec.md §4.1)을 우선하고 없으면 이전 이름으로 읽는다.
// 패키지마다 들어 있는 파일도 다르다 (TIPS 패키지에는 승인·증빙 테이블이 따로 없다) — 없으면 빈 배열.
const readFirst = (...names) => {
  for (const name of names) { try { return readJson(name); } catch { /* 다음 후보 */ } }
  return [];
};
// 비목 표는 category_code·level을 갖는 쪽을 쓴다 — 이전 NRD 패키지에도 expense_categories.json이
// 있지만 필드 구성이 다른(code/name) 별개 표라서 이름만 보고 고르면 안 된다.
const readTree = () => {
  for (const name of ['expense_categories.json', 'legal_budget_tree.json']) {
    try {
      const data = readJson(name);
      if (Array.isArray(data) && data.some((n) => n.category_code && n.level != null)) return data;
    } catch { /* 다음 후보 */ }
  }
  return [];
};
const tree = readTree();
const limitRules = readJson('expense_limit_rules.json');
const guides = readJson('budget_screen_guides.json');
const allowedItems = readJson('expense_allowed_items.json');
const manifest = readJson('manifest.json');
const articles = readFirst('source_text.json', 'regulation_articles.json');
const reviewIssues = readFirst('review_issues.json');

// MVP 규격은 적용조건·승인·증빙·금지를 regulation_rules 한 파일에 합쳤다(04_mvp_output_spec.md §4.1).
// 이전 패키지는 approval_rules·evidence_rules·expense_applicability_rules로 나뉘어 있어 그쪽을 먼저 본다.
const allRules = readFirst('regulation_rules.json');
const legacyApprovals = readFirst('approval_rules.json');
const legacyEvidence = readFirst('evidence_rules.json');
const legacyApplicability = readFirst('expense_applicability_rules.json');

const approvalRules = legacyApprovals.length ? legacyApprovals
  // approval_status는 "이 규칙이 사전승인·인정 절차"라는 표시다 (심사 유형은 LIMIT 등으로 따로 분류된다).
  : allRules.filter((r) => r.approval_status || r.rule_type === 'APPROVAL_REQUIRED' || r.rule_type === 'APPROVAL' || ['PRIOR_APPROVAL_REQUIRED', 'RECOGNITION_REQUIRED'].includes(r.result?.status))
    .map((r) => ({ approval_code: r.rule_code, track_scope: r.track_scope, category_code: r.expense_category_code, rule_name: r.rule_name, result_status: r.approval_status ?? r.result?.status ?? 'PRIOR_APPROVAL_REQUIRED', source_article: r.source_article, is_active: r.is_active }));
const evidenceRules = legacyEvidence.length ? legacyEvidence
  : allRules.filter((r) => (r.required_documents ?? []).length)
    .map((r) => ({ evidence_code: r.rule_code, track_scope: r.track_scope, category_code: r.expense_category_code, rule_name: r.rule_name, required_documents: r.required_documents, source_article: r.source_article, is_active: r.is_active }));
const applicabilityRules = legacyApplicability.length ? legacyApplicability
  : allRules.filter((r) => r.rule_type === 'APPLICABILITY')
    .map((r) => ({ applicability_code: r.rule_code, track_scope: r.track_scope, category_code: r.expense_category_code, institution_scope: r.institution_scope, condition_summary: r.result?.message, result: r.result?.status, source_article: r.source_article, is_active: r.is_active }));
// 금지·자격·기한 규칙은 편성 화면의 경고로 싣는다 (상한이 아니라 판정 규칙).
// 승인·증빙·적용조건으로 이미 실린 규칙은 빼서 같은 내용이 두 번 나오지 않게 한다.
const shownElsewhere = new Set([...approvalRules.map((r) => r.approval_code), ...evidenceRules.map((r) => r.evidence_code), ...applicabilityRules.map((r) => r.applicability_code)]);
const denyRules = allRules.filter((r) => ['DENY', 'DENY_WITH_EXCEPTIONS', 'ELIGIBILITY', 'REQUIRE', 'LIMIT', 'DEADLINE', 'PAYMENT_METHOD'].includes(r.rule_type) && !shownElsewhere.has(r.rule_code));

// ---- DB 코드 → 화면 문구 (규정 원문이 아니라 표시용 라벨이라 변환 시점에 한글로 굳힌다) ----
const SCOPE_KO = {
  ALL: '전체 기관', FOR_PROFIT: '영리기관', NON_PROFIT: '비영리기관', UNIVERSITY: '대학',
  ELIGIBLE_INSTITUTION: '고시에서 정한 기관', SME_OR_MID_SIZED: '중소·중견기업',
  GOV_FUNDED_OR_DIRECTLY_ESTABLISHED: '정부출연·직할기관',
};
const RESULT_KO = {
  CONDITIONAL_AVAILABLE: '조건부 사용 가능', RECOGNITION_REQUIRED: '전문기관 인정 필요',
  AVAILABLE_IF_CONDITIONS_MET: '요건 충족 시 사용 가능', PLAN_BASED: '연구개발계획 범위 내 사용',
  INSTITUTION_SPECIFIC: '해당 기관만 사용 가능', LIMIT_APPLIES: '한도 적용',
  INSTITUTION_RATE_APPLIES: '기관별 고시비율 적용', DATE_CONDITIONAL: '시행일 조건 있음',
  APPROVAL_REQUIRED: '사전승인 필요', NOT_AVAILABLE: '사용 불가',
};
const APPROVAL_KO = { PRIOR_APPROVAL_REQUIRED: '사전승인 필요', RECOGNITION_REQUIRED: '전문기관 인정 필요', APPROVAL_REQUIRED: '승인 필요' };

// 공고·지침 패키지는 그 사업이 "따로 정한 것"만 담고, 나머지는 상위 규정에 따른다고만 적어둔다
// (디딤돌: "그 밖의 사항은 국가연구개발사업 연구개발비 사용 기준에 따른다").
// manifest의 base_document_version이 그 관계를 들고 있어, 화면이 상위 규정 팩을 함께 불러
// 인정 항목·세목을 채울 수 있도록 basePackId로 옮긴다.
const BASE_PACK_BY_DOCUMENT = {
  NRD_COST_STANDARD_2026_38: { FOR_PROFIT: 'nrd2026-forprofit', NON_PROFIT: 'nrd2026-nonprofit' },
};
const DOC_KO = {
  RECEIPT: '영수증', INTERNAL_APPROVAL_OR_MEETING_MINUTES: '내부품의서 또는 회의록',
  SIMPLIFIED_MEETING_RECORD: '간소화 회의 기록', OVERSEAS_TRAVEL_PLAN: '국외출장계획서',
  OVERSEAS_TRAVEL_RESULT_REPORT: '국외출장 결과보고서', BANK_TRANSFER_EVIDENCE: '계좌이체 증명',
  TAX_INVOICE: '세금계산서', CARD_RECEIPT: '카드 영수증', CONTRACT: '계약서', QUOTATION: '견적서',
};

// 사업 안에 트랙이 나뉘는 경우(팁스 일반/딥테크처럼 지원 한도·기간이 다르다) 그 트랙 규칙만 싣는다.
// track_scope 가 없거나 'ALL' 이면 트랙 공통 규칙이다.
const trackApplies = (ruleTrack, track) => !ruleTrack || ruleTrack === 'ALL' || !track || ruleTrack === track;

// 이 팩(기관 유형)에 그 규칙·항목이 적용되는지. 상대 유형 전용만 걸러내고 나머지는 남겨 화면에서 조건으로 안내한다.
const scopeApplies = (itemScope, scope) => {
  if (!itemScope || itemScope === 'ALL') return true;
  const forProfitOnly = ['FOR_PROFIT', 'SME_OR_MID_SIZED'];
  const nonProfitOnly = ['NON_PROFIT', 'UNIVERSITY', 'ELIGIBLE_INSTITUTION', 'GOV_FUNDED_OR_DIRECTLY_ESTABLISHED'];
  if (scope === 'FOR_PROFIT') return !nonProfitOnly.includes(itemScope);
  if (scope === 'NON_PROFIT') return !forProfitOnly.includes(itemScope);
  return true;
};

// 패키지 manifest에 pack_meta가 있으면 그 정보(지침명·기관·팩 id/이름)로 팩을 만든다.
// 없으면 국가연구개발비 사용기준(초기 패키지) 기본값을 쓴다.
const meta = manifest.pack_meta ?? null;
const DOC = meta?.guideline ?? '국가연구개발사업 연구개발비 사용 기준 (과기정통부고시 제2026-38호)';
const AGENCY = meta?.agency ?? '과학기술정보통신부';
const REFERENCE_URL = meta?.reference_url ?? 'https://www.law.go.kr';
const OUTPUT_NAME = process.argv[3] ?? meta?.output ?? 'nrd2026.json';
const nodeByCode = new Map(tree.map((n) => [n.category_code, n]));
const guideByCode = new Map(guides.map((g) => [g.category_code, g]));

// 3레벨(연구활동비 세부)·간접비 하위·UI 전용 코드는 편성 비목으로 승격하지 않고 상위 비목에 귀속한다.
const toCategoryCode = (code) => {
  if (code.startsWith('ACTIVITY_')) return 'DIRECT_ACTIVITY';
  if (code.startsWith('INDIRECT')) return 'INDIRECT';
  if (code.startsWith('UI_')) return 'DIRECT_LABOR';
  return code;
};

// 편성 단계에서 금액 상한을 계산할 수 있는 기준 — capFor(rules.ts)가 해석하는 문구로 변환한다.
const COMPUTABLE_BASIS = {
  direct_cost: '직접비',
  direct_cost_incl_inkind: '직접비(현물 포함)',
  modified_labor_cost: '수정인건비 합계',
  adjusted_direct_for_subcontract: '직접비(위탁연구개발비·국제공동연구개발비·연구개발부담비 제외)',
  modified_direct_cost: '수정직접비(직접비 중 현물·위탁연구개발비·국제공동연구개발비·연구개발부담비 제외)',
};
// 재원 구성 비율(정부지원 75%, 기관부담 25%, 운영사 투자금 …)은 비목 상한이 아니다.
// 기준 금액이 이 목록에 있으면 편성표의 "허용 상한"이 아니라 과제 공통 참고 정보로 싣는다.
const FUNDING_BASIS = new Set([
  'total_rnd_cost', 'total_project_cost', 'org_funded_cost', 'gov_funded_cost', 'investor_fund', 'stage_funding',
]);

// 금액으로 정해진 한도를 화면의 어느 입력값과 대조할지. 여기 없는 기준(투자금·기관부담)은
// 사업비가 아니므로 대조하지 않고 안내 문구로만 둔다.
const FUNDING_CAP_TARGET = {
  gov_funded_cost: 'subsidy',      // 정부지원연구개발비 한도 → 지원금 입력값
  stage_funding: 'subsidy',        // 단계별 지원 자금 → 지원금 입력값
  total_project_cost: 'total',     // 총사업비 한도 → 총사업비
  total_rnd_cost: 'total',
};

// 재원 구성 비율(정부지원 75% 이내, 기관부담 현금 10% 이상 …)을 과제 설정의 입력값과 대조하려면
// "무엇에 대한 비율인지"를 알아야 한다. basis_code 만으로는 같은 total_rnd_cost 안에서
// 정부지원 상한과 기관부담 하한이 구분되지 않아, 규칙 이름의 주어로 갈라낸다.
// 판정을 여기 한 곳에 모아두고 결과를 팩에 명시적으로 실어, 화면은 문자열을 다시 해석하지 않는다.
// 판정은 규칙 이름(limit_name)만 본다. 요약문(ui_summary)까지 넣으면 "연구개발비(투자금 제외)의
// 75% 이내" 같은 괄호 부연 때문에 정부지원 규칙이 투자금 규칙으로 오판된다.
const fundingRoleOf = (rule) => {
  const name = rule.limit_name ?? '';
  // 운영사 투자금은 앱이 입력받지 않는 재원이라 대조하지 않는다 (안내 문구로만 남는다).
  if (/투자금/.test(name) || rule.basis_code === 'investor_fund') return null;
  if (/현금/.test(name)) return 'matching_cash_min';
  if (/정부지원/.test(name)) return 'subsidy_max';
  if (/기관부담|민간부담|기업부담/.test(name)) return 'matching_min';
  return null;
};

const LABEL_ONLY_BASIS = {
  equipment_purchase_price: '구입가',
  software_purchase_price: '구입가',
  actual_technology_introduction_cost: '실제 기술도입비',
  total_research_incentive: '전체 연구수당',
  project_indirect_cost: '해당 과제 간접비',
  stage_start_material_plus_activity: '단계 시작 시 연구재료비·연구활동비 합계',
};

const DOCS_BY_CODE = {
  DIRECT_LABOR: ['근로계약서', '급여대장', '계좌이체 확인증', '참여율 확인자료'],
  DIRECT_STUDENT_LABOR: ['근로(참여)계약서', '급여대장', '계좌이체 확인증', '학적 확인자료'],
  DIRECT_EQUIPMENT: ['견적서', '비교견적서', '세금계산서', '검수조서', '계좌이체 확인증'],
  DIRECT_MATERIAL: ['견적서', '세금계산서', '거래명세서', '검수조서', '계좌이체 확인증'],
  DIRECT_ACTIVITY: ['내부품의서', '영수증', '결과보고서'],
  DIRECT_INNOVATION: ['내부품의서', '영수증(건별 한도 확인)', '사용내역서'],
  DIRECT_INCENTIVE: ['지급기준표', '지급대장', '계좌이체 확인증'],
  DIRECT_SECURITY: ['지급기준표', '지급대장', '계좌이체 확인증'],
  DIRECT_SUBCONTRACT: ['위탁연구 협약서', '과업지시서', '세금계산서', '결과보고서'],
  DIRECT_INTERNATIONAL: ['공동연구 협약서', '과업지시서', '증빙 영수증', '결과보고서'],
  DIRECT_RND_CONTRIBUTION: ['산출 근거자료', '내부 결재 문서'],
  INDIRECT: ['간접비 산출내역서', '내부 결재 문서'],
};
const DEFAULT_DOCS = ['견적서 또는 계약서', '세금계산서 또는 카드 영수증', '계좌이체 확인증', '내부품의서'];

// 허용 항목은 조금 느슨하게 — 상대 유형 전용만 빼고 기관 한정 항목은 남겨 "기관 한정" 태그로 알린다.
const itemInScope = (itemScope, scope) => {
  if (!itemScope || itemScope === 'ALL') return true;
  if (scope === 'FOR_PROFIT') return itemScope !== 'NON_PROFIT';
  if (scope === 'NON_PROFIT') return itemScope !== 'FOR_PROFIT';
  return true;
};

// 비목별 적용 조건 (expense_applicability_rules) — 패키지에 따라 필드명이 다르다(condition_summary vs condition).
const applicabilityFor = (code, scope, track) => applicabilityRules
  .filter((r) => r.category_code === code && r.is_active !== false && trackApplies(r.track_scope, track))
  .map((r) => ({
    scopeKo: SCOPE_KO[r.institution_scope] ?? r.institution_scope,
    applies: scopeApplies(r.institution_scope, scope),
    rawResult: r.result,
    condition: r.condition_summary ?? r.condition ?? '',
    result: RESULT_KO[r.result] ?? r.result,
    source: { doc: DOC, ref: r.source_article ?? '적용 조건', matchLevel: 'guideline' },
  }));

// 사전승인·인정이 필요한 절차 (approval_rules)
const approvalsFor = (code, track) => {
  const codes = descendantCodes(code);
  return approvalRules
    .filter((r) => codes.has(r.category_code) && r.is_active !== false && trackApplies(r.track_scope, track))
    .map((r) => ({
      name: r.rule_name,
      status: APPROVAL_KO[r.result_status] ?? r.result_status,
      source: { doc: DOC, ref: r.source_article ?? '승인 규정', matchLevel: 'guideline' },
    }));
};

// 조건부로 추가 요구되는 증빙 (evidence_rules) — 비목 기본 증빙과 달리 금액·상황 조건이 붙는다.
// category_code가 'ALL'인 증빙 규칙(10만원 이상 집행 시 전자세금계산서, 2천만원 이상 거래 시
// 비교견적서 등)은 비목을 가리지 않는다. 예전에는 어느 비목에도 붙지 못해 화면에서 통째로
// 사라졌다 — 증빙 규칙으로 분류돼 금지·주의 목록에서도 빠지기 때문이다.
const evidenceFor = (code, track) => {
  const codes = descendantCodes(code);
  return evidenceRules
    .filter((r) => (codes.has(r.category_code) || r.category_code === 'ALL') && r.is_active !== false && (r.required_documents ?? []).length && trackApplies(r.track_scope, track))
    .map((r) => ({
      name: r.rule_name,
      documents: r.required_documents.map((d) => DOC_KO[d] ?? d),
      source: { doc: DOC, ref: r.source_article ?? '증빙 규정', matchLevel: 'guideline' },
    }));
};

// 편성 비목에 귀속되는 허용 항목 — 자기 코드 + 모든 하위 코드(연구활동비 → ACTIVITY_*)의 항목을 모은다.
const descendantCodes = (code) => {
  const out = [code];
  for (let i = 0; i < out.length; i++) {
    for (const child of tree.filter((n) => n.parent_code === out[i])) out.push(child.category_code);
  }
  return new Set(out);
};

// "항목별 기준·주의사항"에 쓰는 허용 항목. 각 항목의 근거 조항(source_article)이 DB에 있어 그대로 옮긴다.
// condition/restriction/evidence 계열 필드는 패키지에 따라 없을 수 있어 있을 때만 싣는다.
const buildAllowedItems = (code, scope) => {
  const codes = descendantCodes(code);
  return allowedItems
    .filter((i) => codes.has(i.category_code) && i.is_active !== false && itemInScope(i.institution_scope, scope))
    .map((i) => ({
      name: i.item_name,
      ...(i.description ? { description: i.description } : {}),
      ...(i.availability_status && i.availability_status !== 'ALLOWED' ? { status: i.availability_status } : {}),
      ...(i.institution_scope && i.institution_scope !== 'ALL' ? { scope: i.institution_scope } : {}),
      ...(i.condition_summary ? { condition: i.condition_summary } : {}),
      ...(i.restriction_summary ? { restriction: i.restriction_summary } : {}),
      ...(i.requires_approval ? { requiresApproval: true } : {}),
      ...(i.evidence_summary ? { evidence: i.evidence_summary } : {}),
      // 증빙 요약이 비목 정의와 다른 절(팁스 지침 11.다.1) 증빙서류 표 등)에서 온 경우 그 위치를 따로 싣는다.
      ...(i.evidence_source_article ? { evidenceSource: { doc: DOC, ref: i.evidence_source_article, matchLevel: 'guideline' } } : {}),
      source: { doc: DOC, ref: i.source_article ?? '허용 항목 목록', matchLevel: 'guideline' },
    }));
};

const buildCategories = (scope, track) => {
  // 편성 비목 = DIRECT의 2레벨 자식 + 간접비(있는 사업만 — 창업지원사업처럼 간접비가 없는 체계도 있다)
  const codes = tree.filter((n) => n.parent_code === 'DIRECT' && n.level === 2).map((n) => n.category_code);
  if (nodeByCode.has('INDIRECT')) codes.push('INDIRECT');
  // 편성 대상 여부는 DB의 적용 조건(expense_applicability_rules)으로 판정한다.
  // 단, 적용 조건에는 두 종류가 섞여 있다:
  //  - 기관 자격 제한 (학생인건비=고시 기관만, 연구개발부담비=출연기관만) → 자격이 안 되면 편성 불가
  //  - 사용 조건 (영리기관 현금 인건비는 인정 필요 등) → 조건일 뿐 비목 자체는 쓸 수 있다
  // 앞의 것만 편성 가능 여부에 반영한다. 둘을 섞으면 "영리기관 인건비 조건" 때문에
  // 비영리 팩에서 인건비가 통째로 사라지는 식의 오판이 난다.
  const RESTRICTIVE = new Set(['INSTITUTION_SPECIFIC', 'CONDITIONAL_AVAILABLE', 'NOT_AVAILABLE']);
  const scopedAllowed = (rules) => {
    const gating = rules.filter((r) => RESTRICTIVE.has(r.rawResult));
    return !gating.length || gating.some((r) => r.applies);
  };
  const categories = codes.map((code) => {
    const node = nodeByCode.get(code);
    const guide = guideByCode.get(code);
    const applicability = applicabilityFor(code, scope, track);
    const approvals = approvalsFor(code, track);
    const evidence = evidenceFor(code, track);
    // 편성 화면의 "가능한 세목" 후보. 하위 비목이 있으면 그것이 곧 세목이고(연구활동비 → 출장비·회의비…),
    // 없으면 그 비목의 허용 항목을 세목 후보로 쓴다(인건비 → 참여연구자 급여·4대보험 기관부담금…).
    const children = tree.filter((n) => n.parent_code === code);
    const subItemOptions = children.length
      ? children.map((c) => c.category_name)
      : allowedItems.filter((i) => i.category_code === code).map((i) => i.item_name);
    return {
      id: code,
      name: node.category_name,
      allowed: scopedAllowed(applicability),
      // 설명은 규정 DB의 용도 요약만 담는다 — 세목 나열은 subItemOptions가 따로 들고 간다.
      definition: guide?.usage_summary || undefined,
      ...(subItemOptions.length ? { subItemOptions } : {}),
      // 기관 유형별 적용 조건 · 사전승인 절차 · 조건부 추가 증빙 (applicability/approval/evidence 테이블)
      ...(applicability.length ? { applicability: applicability.map(({ rawResult, ...rest }) => rest) } : {}),
      ...(approvals.length ? { approvals } : {}),
      ...(evidence.length ? { evidenceRules: evidence } : {}),
      // "항목별 기준·주의사항"에 근거 조항과 함께 나열되는 허용 항목 (expense_allowed_items)
      ...(() => { const items = buildAllowedItems(code, scope); return items.length ? { allowedItems: items } : {}; })(),
      // 편성 화면의 "허용 상한" 칸에 그대로 보여주는 DB 원문 요약 — 계산 가능한 ratio 규칙이
      // 없어도 비목별 한도 문구가 빠짐없이 표시되게 한다 (budget_screen_guides 출처).
      ...(guide?.limit_text ? { limitText: guide.limit_text } : {}),
      ...(guide?.limit_detail_text ? { limitDetailText: guide.limit_detail_text } : {}),
      // 상한 문구의 근거 조항 — 비목 정의(source)와 다를 수 있어 따로 싣는다.
      ...(guide?.source_articles?.length ? { limitSource: { doc: DOC, ref: guide.source_articles.join('·'), matchLevel: 'guideline' } } : {}),
      draftRate: 0,
      requiredDocs: DOCS_BY_CODE[code] ?? DEFAULT_DOCS,
      source: { doc: DOC, ref: guide?.source_articles?.join('·') ?? '비목 체계', matchLevel: 'guideline', appDefault: true },
    };
  });
  // 초안 배분율: 균등 분배(합계 100 보장) — 원본에 없는 앱 편의 데이터
  const active = categories.filter((c) => c.allowed);
  const even = Math.floor(100 / active.length);
  active.forEach((c, i) => { c.draftRate = i === 0 ? 100 - even * (active.length - 1) : even; });
  return categories;
};

const buildRules = (scope, track) => {
  const included = limitRules.filter((r) => ['ALL', 'ALL_OR_RULE_SPECIFIC', scope].includes(r.institution_scope) && trackApplies(r.track_scope, track));
  const idPrefix = meta ? (meta.scopes?.[0]?.id ?? 'pack') : 'nrd';
  const rules = included.map((r) => {
    const global = r.category_code === 'ALL';
    const categoryCode = toCategoryCode(r.category_code);
    const itemName = global ? undefined : nodeByCode.get(r.category_code)?.category_name
      ?? (r.category_code.startsWith('UI_') ? '인건비(현금 계상)' : nodeByCode.get(categoryCode)?.category_name);
    const base = {
      id: `${idPrefix}_${r.limit_code.toLowerCase()}`,
      ...(itemName ? { item: itemName } : {}),
      message: r.ui_summary,
      // 원문 인용(source_quote)이 있으면 미리보기 하이라이트 1순위 검색어로 쓰인다
      ...(r.source_quote ? { quote: r.source_quote } : {}),
      ...(global ? {} : { categoryIds: [categoryCode] }),
      source: { doc: DOC, ref: r.source_article, matchLevel: 'guideline' },
    };
    // 재원 구성 규칙(정부지원 비율 등)은 비목 상한이 아니라 과제 공통 참고 정보.
    // 다만 금액이 정해진 총액 한도(예비창업패키지 1단계 2천만원 등)는 사용자가 입력한 사업비와
    // 대조해야 하므로 fundingCap 으로 금액을 함께 싣는다 — 안내 문구로만 두면 잘못 입력해도 모른다.
    // 어느 금액과 견줄지는 기준(basis_code)에 따라 다르고, 투자금·기관부담처럼 사업비가 아닌
    // 기준은 대조 대상이 아니다 (TIPS 운영사 의무투자금 2억을 지원금 한도로 오인하면 안 된다).
    if (r.limit_type === 'FUNDING' || FUNDING_BASIS.has(r.basis_code)) {
      const target = FUNDING_CAP_TARGET[r.basis_code];
      const isAmountCap = target && r.limit_unit === 'KRW' && r.limit_value != null;
      // 비율로 정해진 재원 규정(정부지원 75% 이내 등)도 과제 설정의 입력값과 대조한다.
      const role = r.limit_unit === 'PERCENT' && r.limit_value != null ? fundingRoleOf(r) : null;
      return {
        ...base, kind: 'info',
        ...(isAmountCap ? { fundingCap: r.limit_value, fundingCapTarget: target, fundingCapBasis: r.basis_ko ?? '사업비' } : {}),
        ...(role ? { fundingRole: role, fundingPct: r.limit_value } : {}),
        _order: 3,
      };
    }
    const computable = COMPUTABLE_BASIS[r.basis_code];
    const isPct = (r.limit_type === 'PERCENT' || r.limit_type === 'FORMULA') && r.limit_value != null;
    if (isPct && computable) return { ...base, kind: 'ratio', limitPct: r.limit_value, basis: r.basis_ko ?? computable, _order: 0 };
    const labelBasis = r.basis_code === 'monthly_salary' ? null : (r.basis_ko ?? LABEL_ONLY_BASIS[r.basis_code]);
    if (isPct && labelBasis) return { ...base, kind: 'ratio', limitPct: r.limit_value, basis: labelBasis, _order: 1 };
    // 나머지(건별 한도·사전승인·자격·절차·월 계상률)는 편성 상한이 아니라 집행·관리 주의사항
    return { ...base, kind: 'warning', trigger: r.limit_name, severity: r.over_limit_action === 'NOT_ALLOWED' ? 'high' : 'medium', _order: 2 };
  });
  if (scope === 'NON_PROFIT') {
    const guide = guideByCode.get('INDIRECT');
    rules.push({
      id: 'nrd_indirect_nonprofit_rate', kind: 'info', item: '간접비',
      message: guide?.limit_detail_text ?? '비영리기관 간접비는 기관별 고시 간접비 비율을 적용합니다.',
      categoryIds: ['INDIRECT'], source: { doc: DOC, ref: guide?.source_articles?.join('·') ?? '제63조', matchLevel: 'guideline' }, _order: 3,
    });
  }
  // regulation_rules의 금지·자격·기한 규칙을 편성 화면 경고로 싣는다 (MVP 규격 패키지에만 있다).
  for (const rule of denyRules.filter((r) => trackApplies(r.track_scope, track))) {
    if (!scopeApplies(rule.institution_scope, scope)) continue;
    const categoryCode = toCategoryCode(rule.expense_category_code ?? 'ALL');
    const global = (rule.expense_category_code ?? 'ALL') === 'ALL';
    rules.push({
      id: `${idPrefix}_${rule.rule_code.toLowerCase().replace(/-/g, '_')}`,
      kind: 'warning',
      ...(global ? {} : { item: nodeByCode.get(rule.expense_category_code)?.category_name, categoryIds: [categoryCode] }),
      message: rule.result?.message ?? rule.rule_name,
      trigger: rule.rule_name,
      severity: rule.result?.status === 'NOT_ALLOWED' ? 'high' : 'medium',
      ...(rule.source_quote ? { quote: rule.source_quote } : {}),
      source: { doc: DOC, ref: rule.source_article, matchLevel: 'guideline' },
      _order: 2,
    });
  }
  // capFor는 비목의 첫 ratio 규칙을 상한으로 쓴다 — 금액 계산 가능한 규칙이 먼저 오도록 정렬한다.
  return rules.sort((a, b) => a._order - b._order).map(({ _order, ...rule }) => rule);
};

// 조문 원문(regulation_articles) — 근거 링크를 눌렀을 때 원본 파일 없이도 그 조문을 바로 보여준다.
// HWP에서 뽑은 본문은 자동 매긴 조문 번호가 빠져 원문 검색이 실패하는데, 이 표는 번호와 본문이 함께 있다.
// 패키지마다 필드가 다르다: 고시본은 source_article/article_title/original_text, 지침본은 location/text.
const buildArticles = () => articles
  .filter((a) => a.is_active !== false)
  .map((a) => ({
    key: a.article_key,
    ref: a.source_article ?? a.location,
    ...(a.article_title ? { title: a.article_title } : {}),
    text: a.original_text ?? a.text,
  }))
  .filter((a) => a.ref && a.text);

// 규정 DB를 만들 때 남긴 검토 이슈 — 사용자에게 "이 부분은 원문 확인이 필요하다"고 알린다.
const buildReviewIssues = () => reviewIssues
  .filter((i) => i.status !== 'RESOLVED' && i.description)
  .map((i) => ({
    code: i.issue_code,
    severity: (i.severity ?? 'INFO').toLowerCase() === 'warning' ? 'warning' : 'info',
    description: i.description,
    handling: i.system_handling ?? i.handling ?? '',
    ref: i.source_article ?? i.source ?? '',
  }));

// 편성 비목이 아닌 세부 비목(연구활동비 아래 출장비·회의비·외부 전문기술 활용비 …)도 기준은 있다.
// 공고문에서 AI로 추출한 팩은 이런 세부 항목을 그대로 비목으로 쓰는 경우가 많아서,
// 어떤 팩을 쓰든 비목 이름으로 규정 기준을 찾을 수 있도록 참조용 목록으로 함께 싣는다.
const buildReferenceCategories = (scope, track) => {
  const budgetCodes = new Set(tree.filter((n) => n.parent_code === 'DIRECT' && n.level === 2).map((n) => n.category_code).concat(['INDIRECT']));
  return tree
    .filter((n) => n.level >= 2 && !budgetCodes.has(n.category_code))
    .map((n) => {
      const code = n.category_code;
      const guide = guideByCode.get(code);
      const items = buildAllowedItems(code, scope);
      const approvals = approvalsFor(code, track);
      const evidence = evidenceFor(code, track);
      const applicability = applicabilityFor(code, scope, track).map(({ rawResult, ...rest }) => rest);
      return {
        id: code,
        name: n.category_name,
        allowed: true,
        draftRate: 0,
        requiredDocs: [],
        ...(guide?.usage_summary ? { definition: guide.usage_summary } : {}),
        ...(items.length ? { allowedItems: items } : {}),
        ...(applicability.length ? { applicability } : {}),
        ...(approvals.length ? { approvals } : {}),
        ...(evidence.length ? { evidenceRules: evidence } : {}),
        ...(guide?.limit_text ? { limitText: guide.limit_text } : {}),
        ...(guide?.limit_detail_text ? { limitDetailText: guide.limit_detail_text } : {}),
        ...(guide?.source_articles?.length ? { limitSource: { doc: DOC, ref: guide.source_articles.join('·'), matchLevel: 'guideline' } } : {}),
        source: { doc: DOC, ref: guide?.source_articles?.join('·') ?? '비목 체계', matchLevel: 'guideline' },
      };
    })
    // 기준이 하나도 없는 껍데기 노드는 싣지 않는다
    .filter((c) => c.definition || c.allowedItems || c.limitText || c.approvals || c.evidenceRules);
};

const buildPack = (scope, id, name, orgType, track) => {
  const packArticles = buildArticles();
  const issues = buildReviewIssues();
  const reference = buildReferenceCategories(scope, track);
  const rules = buildRules(scope, track);
  const basePackId = BASE_PACK_BY_DOCUMENT[manifest.base_document_version]?.[scope];
  return {
    id, name, orgType,
    ...(basePackId && basePackId !== id ? { basePackId } : {}),
    guideline: DOC,
    agency: AGENCY,
    // 규정DB 패키지에서 나온 팩임을 표시한다 — 예산편성 화면은 이 표시가 붙은 팩의 비목만 쓴다.
    origin: 'regulation_db',
    packageName: manifest.package_name,
    // 비목 상한이 하나도 없는 사업(예비창업패키지 등)은 상한 UI 대신 금지·주의 중심으로 표시된다
    hasRatioLimits: rules.some((r) => r.kind === 'ratio'),
    // 근거 조문까지 붙여 검토를 마친 패키지에서 왔다
    verified: true,
    // 규정 자체의 시행일과 이 팩을 만든 날. 화면이 "언제 기준인지"를 고정 문구가 아니라
    // 팩에서 읽어 보여준다 — 사업마다 시행일이 다른데 한 날짜로 뭉뚱그리면 틀린 안내가 된다.
    effectiveFrom: manifest.effective_from ?? null,
    generatedAt: manifest.generated_at ?? null,
    referenceUrl: REFERENCE_URL,
    categories: buildCategories(scope, track),
    rules,
    applicationDocs: [],
    ...(packArticles.length ? { articles: packArticles } : {}),
    ...(issues.length ? { reviewIssues: issues } : {}),
    ...(reference.length ? { referenceCategories: reference } : {}),
  };
};

const packs = meta
  ? meta.scopes.map((s) => buildPack(s.scope, s.id, s.name, s.org_type, s.track))
  : [
    buildPack('FOR_PROFIT', 'nrd2026-forprofit', 'R&D 사용기준 2026 (영리기관)', '영리기관'),
    buildPack('NON_PROFIT', 'nrd2026-nonprofit', 'R&D 사용기준 2026 (비영리기관)', '비영리기관'),
  ];

const outPath = join(root, 'src', 'rulepacks', OUTPUT_NAME);
writeFileSync(outPath, JSON.stringify(packs, null, 1), 'utf8');
for (const pack of packs) {
  const ratioCount = pack.rules.filter((r) => r.kind === 'ratio').length;
  const count = (key) => pack.categories.reduce((sum, c) => sum + (c[key]?.length ?? 0), 0);
  console.log(`${pack.id}: 비목 ${pack.categories.length}개(사용 ${pack.categories.filter((c) => c.allowed).length}) · 규칙 ${pack.rules.length}건(상한 ${ratioCount})`);
  console.log(`  인정항목 ${count('allowedItems')} · 적용조건 ${count('applicability')} · 사전승인 ${count('approvals')} · 조건부증빙 ${count('evidenceRules')} · 조문원문 ${pack.articles?.length ?? 0} · 검토이슈 ${pack.reviewIssues?.length ?? 0}`);
}
console.log(`문서 버전: ${manifest.document_version} → ${outPath}`);
