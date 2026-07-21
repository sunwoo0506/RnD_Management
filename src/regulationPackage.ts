// 앱에서 추출한 결과를 규정DB 패키지로 만든다.
//
// docs/extraction_DB/<패키지>/ 에 사람이 만들어 넣은 것과 같은 구성이다 — manifest + 6개 JSON.
// 파일명·필드명을 MVP 산출물 규격(docs/gwayeon_guideline_extraction_framework/04_mvp_output_spec.md)에
// 그대로 맞췄기 때문에, 여기서 나온 패키지도 기존 것과 똑같이
//   scripts/make_regulation_review.py  (검토용 Review.xlsx)
//   scripts/convert-regulation-db.mjs  (규정 팩 변환)
//   scripts/upload-regulation-db.mjs   (Supabase 적재)
// 를 그대로 태울 수 있다. 사업마다 다른 형식을 만들면 그때부터 스크립트를 사업 수만큼 만들어야 한다.
//
// 이 패키지는 아직 검증 전이다. 관리자가 승인해야 origin='regulation_db'로 바뀌어 예산편성 화면의
// 비목이 될 수 있다 (schema.sql 참조).
import type { Extraction, ExtractedRule } from './llmExtract';
import { PROCEDURAL_LIMIT_TYPES } from './llmExtract';

export interface RegulationPackage {
  package_name: string;
  manifest: Record<string, unknown>;
  expense_categories: Record<string, unknown>[];
  budget_screen_guides: Record<string, unknown>[];
  expense_allowed_items: Record<string, unknown>[];
  expense_limit_rules: Record<string, unknown>[];
  regulation_rules: Record<string, unknown>[];
  source_text: Record<string, unknown>[];
}

// 이름이 표준 비목과 정확히 맞으면 국가연구개발사업 비목 코드를 쓴다 — 다른 패키지와 코드가
// 같아야 나중에 상위 규정의 기준을 이름이 아닌 코드로 이어붙일 수 있다.
// 맞지 않으면 CAT_n 으로 두고 이름만 남긴다. 억지로 끼워 맞추면 엉뚱한 기준이 붙는다.
const STANDARD_CODES: Record<string, string> = {
  인건비: 'DIRECT_LABOR',
  학생인건비: 'DIRECT_STUDENT_LABOR',
  '연구시설·장비비': 'DIRECT_EQUIPMENT',
  연구재료비: 'DIRECT_MATERIAL',
  연구활동비: 'DIRECT_ACTIVITY',
  연구수당: 'DIRECT_INCENTIVE',
  위탁연구개발비: 'DIRECT_SUBCONTRACT',
  간접비: 'INDIRECT',
  재료비: 'PRE_MATERIAL',
  외주용역비: 'PRE_OUTSOURCING',
  지급수수료: 'PRE_FEE',
  여비: 'PRE_TRAVEL',
  교육훈련비: 'PRE_TRAINING',
  광고선전비: 'PRE_MARKETING',
};

const norm = (text: string) => text.replace(/[\s·.,()（）]/g, '');
const normalizedStandards = new Map(Object.entries(STANDARD_CODES).map(([name, code]) => [norm(name), code]));

const codeFor = (name: string, index: number) => normalizedStandards.get(norm(name)) ?? `CAT_${String(index + 1).padStart(2, '0')}`;

// 패키지 폴더명 — 기존 것과 같은 규칙(gwayeon_<사업>_<연도>).
const packageNameFor = (programName: string, year: number | null) => {
  const slug = programName.replace(/[^가-힣A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'program';
  return `gwayeon_${slug}_${year ?? new Date().getFullYear()}`;
};

const today = () => new Date().toISOString().slice(0, 10);

// 추출 규칙이 금액 상한인지 — 승인 발동 기준은 금액을 깎지 않으므로 limit_rules 가 아니라
// regulation_rules 로 보낸다 (04_mvp_output_spec.md §4.2).
const isAmountLimit = (rule: ExtractedRule) =>
  (rule.limitPct != null || rule.minAmount != null)
  && !PROCEDURAL_LIMIT_TYPES.includes(rule.limitType ?? 'NONE');

const RULE_TYPE: Record<ExtractedRule['kind'], string> = {
  ratio: 'LIMIT', warning: 'DENY', info: 'INFORMATION', funding: 'FUNDING',
};

const RESULT_STATUS: Record<ExtractedRule['kind'], string> = {
  ratio: 'NOT_ALLOWED', warning: 'NOT_ALLOWED', info: 'INFORMATION_REQUIRED', funding: 'INFORMATION_REQUIRED',
};

export interface PackageMeta {
  programName?: string;
  year?: number | null;
  issuer?: string;
  noticeNumber?: string;
  sourceFiles?: string[];
  packId?: string;
}

export const buildRegulationPackage = (extraction: Extraction, meta: PackageMeta = {}): RegulationPackage => {
  const programName = (meta.programName ?? extraction.programName ?? '').trim() || '이름 미확인 사업';
  const year = meta.year ?? extraction.year ?? null;
  const packageName = packageNameFor(programName, year);
  const effectiveFrom = year ? `${year}-01-01` : today();
  const packId = meta.packId ?? `${packageName.replace(/^gwayeon_/, '')}`;

  // ---- 비목 ----
  const codeByName = new Map<string, string>();
  extraction.categories.forEach((category, index) => codeByName.set(norm(category.name), codeFor(category.name, index)));

  const expense_categories = extraction.categories.map((category, index) => {
    const code = codeByName.get(norm(category.name))!;
    const parentCode = category.parentName ? codeByName.get(norm(category.parentName)) : undefined;
    const childCount = extraction.categories.filter((other) => other.parentName && norm(other.parentName) === norm(category.name)).length;
    return {
      category_code: code,
      category_name: category.name,
      parent_code: parentCode ?? 'ALL',
      level: parentCode ? 2 : 1,
      is_leaf_category: childCount === 0,
      child_category_count: childCount,
      allowed_item_count: (extraction.allowedItems ?? []).filter((item) => norm(item.categoryName) === norm(category.name)).length,
      display_order: (index + 1) * 10,
      source_article: category.ref || '추출 문서',
      ...(category.allowed ? {} : { note: '계상 불가로 추출됨' }),
    };
  });

  // ---- 화면 가이드 ----
  const budget_screen_guides = extraction.categories.map((category, index) => {
    const code = codeByName.get(norm(category.name))!;
    const limitRule = extraction.rules.find((rule) => rule.item && norm(rule.item) === norm(category.name) && rule.limitPct != null);
    return {
      profile_code: `${code}_GUIDE`,
      category_code: code,
      display_name: category.name,
      usage_summary: category.definition ?? '',
      limit_text: limitRule ? `${limitRule.limitPct}% 이내${limitRule.basis ? ` (기준: ${limitRule.basis})` : ''}` : (category.limitPct != null ? `${category.limitPct}% 이내` : ''),
      limit_detail_text: '',
      source_articles: [category.ref || '추출 문서'],
      effective_from: effectiveFrom,
      display_order: (index + 1) * 10,
    };
  });

  // ---- 인정 항목 ----
  const expense_allowed_items = (extraction.allowedItems ?? []).map((item, index) => ({
    item_code: `ITEM_${String(index + 1).padStart(3, '0')}`,
    category_code: codeByName.get(norm(item.categoryName)) ?? 'ALL',
    item_name: item.name,
    description: item.description ?? '',
    institution_scope: 'ALL',
    availability_status: item.status,
    condition_summary: item.condition ?? '',
    restriction_summary: item.restriction ?? '',
    source_quote: item.quote,
    source_article: item.ref || '추출 문서',
    verified: item.verified ?? false,
  }));

  // ---- 상한 ----
  const expense_limit_rules = extraction.rules.filter(isAmountLimit).map((rule, index) => ({
    limit_code: `LIMIT_${String(index + 1).padStart(3, '0')}`,
    category_code: rule.item ? (codeByName.get(norm(rule.item)) ?? 'ALL') : 'ALL',
    limit_name: rule.item ? `${rule.item} 상한` : rule.message.slice(0, 40),
    limit_type: rule.limitType ?? (rule.minAmount != null ? 'FIXED_AMOUNT' : 'PERCENT'),
    limit_value: rule.minAmount ?? rule.limitPct,
    limit_unit: rule.minAmount != null ? 'KRW' : 'PERCENT',
    basis_code: rule.basis ? 'extracted_basis' : 'total_project_cost',
    basis_ko: rule.basis ?? '총 사업비',
    ui_summary: rule.message,
    source_quote: rule.quote,
    over_limit_action: 'NOT_ALLOWED',
    institution_scope: 'ALL',
    source_article: rule.ref || '추출 문서',
    effective_from: effectiveFrom,
    priority: 700,
    is_active: true,
    verified: rule.verified ?? false,
  }));

  // ---- 판정 규칙 ----
  const regulation_rules = extraction.rules.filter((rule) => !isAmountLimit(rule)).map((rule, index) => ({
    rule_code: `RULE_${String(index + 1).padStart(3, '0')}`,
    rule_name: rule.message.slice(0, 60),
    expense_category_code: rule.item ? (codeByName.get(norm(rule.item)) ?? 'ALL') : 'ALL',
    rule_type: rule.approvalStatus ? 'APPROVAL_REQUIRED' : RULE_TYPE[rule.kind],
    institution_scope: 'ALL',
    ...(rule.approvalStatus ? { approval_status: rule.approvalStatus } : {}),
    ...(rule.requiredDocuments?.length ? { required_documents: rule.requiredDocuments } : {}),
    result: {
      status: rule.approvalStatus ?? RESULT_STATUS[rule.kind],
      message: rule.message,
    },
    source_quote: rule.quote,
    source_article: rule.ref || '추출 문서',
    effective_from: effectiveFrom,
    is_active: true,
    verified: rule.verified ?? false,
  }));

  // ---- 조문 원문 ----
  const source_text = (extraction.articles ?? []).map((article, index) => ({
    article_key: `ART_${String(index + 1).padStart(3, '0')}`,
    source_article: article.ref,
    article_title: article.title ?? '',
    section: 'MAIN',
    original_text: article.text,
    effective_from: effectiveFrom,
    is_active: true,
    verified: article.verified ?? false,
  }));

  const manifest = {
    package_name: packageName,
    document_version: packageName.toUpperCase(),
    title: programName,
    notice_number: meta.noticeNumber ?? null,
    issuer: meta.issuer ?? null,
    document_type: 'PROGRAM_ANNOUNCEMENT',
    effective_from: effectiveFrom,
    special_effective_dates: [],
    base_document_version: null,
    generated_at: today(),
    generated_by: 'app-extraction',   // 사람이 만든 패키지와 구분한다
    source_files: meta.sourceFiles ?? [],
    extraction_scope: '앱에서 업로드한 문서의 AI 추출 결과',
    notes: '앱 내 AI 추출로 만든 패키지입니다. 근거 조문 대조를 거치지 않았으므로 관리자 검토 후에만 예산편성 화면의 비목으로 쓸 수 있습니다.',
    counts: {
      categories: expense_categories.length,
      budget_guides: budget_screen_guides.length,
      allowed_items: expense_allowed_items.length,
      limit_rules: expense_limit_rules.length,
      regulation_rules: regulation_rules.length,
      source_text: source_text.length,
    },
    // 변환 스크립트가 이 값으로 규정 팩을 만든다 — 기존 패키지와 같은 방식.
    pack_meta: {
      guideline: programName,
      agency: meta.issuer ?? '',
      reference_url: '',
      output: `${packId}.json`,
      program_name: programName,
      scopes: [{ scope: 'FOR_PROFIT', id: packId, name: programName, org_type: '' }],
    },
    // 추출값 중 원문 대조에 실패한 건수 — 검토자가 먼저 봐야 할 숫자다.
    validation: {
      unverified_rules: extraction.rules.filter((rule) => !rule.verified).length,
      unverified_items: (extraction.allowedItems ?? []).filter((item) => !item.verified).length,
      unverified_articles: (extraction.articles ?? []).filter((article) => !article.verified).length,
      uncertain: extraction.uncertain,
    },
  };

  return {
    package_name: packageName,
    manifest,
    expense_categories,
    budget_screen_guides,
    expense_allowed_items,
    expense_limit_rules,
    regulation_rules,
    source_text,
  };
};

// 패키지를 docs/extraction_DB/<폴더>/ 와 같은 파일 목록으로 편다 — ZIP 내려받기·업로드에 쓴다.
export const packageFiles = (pkg: RegulationPackage): { name: string; content: string }[] => [
  { name: 'manifest.json', content: JSON.stringify(pkg.manifest, null, 2) },
  { name: 'expense_categories.json', content: JSON.stringify(pkg.expense_categories, null, 1) },
  { name: 'budget_screen_guides.json', content: JSON.stringify(pkg.budget_screen_guides, null, 1) },
  { name: 'expense_allowed_items.json', content: JSON.stringify(pkg.expense_allowed_items, null, 1) },
  { name: 'expense_limit_rules.json', content: JSON.stringify(pkg.expense_limit_rules, null, 1) },
  { name: 'regulation_rules.json', content: JSON.stringify(pkg.regulation_rules, null, 1) },
  { name: 'source_text.json', content: JSON.stringify(pkg.source_text, null, 1) },
];
