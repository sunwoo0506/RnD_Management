// LLM 규정 추출 클라이언트 — Edge Function 호출, 인용 원문 대조 검증, 커스텀 팩 구성.
// 추출값은 절대 자동 확정하지 않는다: ①스키마상 인용 필수 → ②여기서 원문 대조 → ③사용자 승인 후 적용.
import { supabase } from './supabase';
import type { PackCategory, PackRule, RulePack } from './types';

export interface ExtractedCategory {
  name: string; parentName?: string | null; definition: string | null; allowed: boolean;
  limitPct: number | null; limitBasis: string | null; requiredDocs: string[];
  quote: string; ref: string;
  verified?: boolean;
}
// 상한의 종류 (04_mvp_output_spec.md §4.2의 7종).
// APPROVAL_THRESHOLD·RECOGNITION_LIMIT는 금액 상한이 아니라 절차 발동 기준이라 편성 금액을 깎지 않는다.
export type ExtractedLimitType = 'NONE' | 'FIXED_AMOUNT' | 'PERCENT' | 'FORMULA' | 'ANNUAL_AVERAGE' | 'APPROVAL_THRESHOLD' | 'RECOGNITION_LIMIT';
export const PROCEDURAL_LIMIT_TYPES: ExtractedLimitType[] = ['APPROVAL_THRESHOLD', 'RECOGNITION_LIMIT'];

export interface ExtractedRule {
  kind: 'ratio' | 'warning' | 'funding' | 'info';
  limitType?: ExtractedLimitType | null;
  approvalStatus?: 'PRIOR_APPROVAL_REQUIRED' | 'RECOGNITION_REQUIRED' | null;
  requiredDocuments?: string[];
  item: string | null; message: string;
  limitPct: number | null; minAmount: number | null; basis: string | null; severity: 'high' | 'medium' | 'low' | null;
  quote: string; ref: string;
  verified?: boolean;
}
// 비목 아래에서 실제로 쓸 수 있는 항목 — 기준 패널의 "인정 항목"이 된다.
export interface ExtractedAllowedItem {
  categoryName: string; name: string; description: string | null;
  status: 'ALLOWED' | 'CONDITIONAL' | 'NOT_ALLOWED';
  condition: string | null; restriction: string | null;
  quote: string; ref: string;
  verified?: boolean;
}
// 근거 조문의 원문 — 근거 링크를 눌렀을 때 원본 파일 없이도 조문을 바로 보여준다.
export interface ExtractedArticle {
  ref: string; title: string | null; text: string;
  verified?: boolean;
}
export interface ReferencedRegulation {
  name: string; quote: string; ref: string;
  verified?: boolean;
}
export interface FundingScheduleYear {
  label: string; subsidy: number | null; matchingCash: number | null; matchingInKind: number | null;
}
export interface FundingSchedule {
  unit: string | null; totalSubsidyMax: number | null; years: FundingScheduleYear[];
  quote: string; ref: string;
  verified?: boolean;
}
export interface Extraction {
  programName: string; year: number | null;
  programType: 'startup' | 'rnd' | 'other' | 'unknown';
  categories: ExtractedCategory[];
  allowedItems?: ExtractedAllowedItem[];
  articles?: ExtractedArticle[];
  rules: ExtractedRule[];
  referencedRegulations: ReferencedRegulation[];
  fundingSchedule: FundingSchedule | null;
  uncertain: string[];
}

// fundingSchedule의 unit(천원/원 등)에 맞춰 실제 원(KRW) 금액으로 환산한다. 알 수 없는 단위면 null.
export const fundingScheduleAmountWon = (schedule: FundingSchedule, value: number | null): number | null => {
  if (value == null) return null;
  const unit = (schedule.unit ?? '').replace(/\s/g, '');
  if (unit === '천원' || unit === '천 원') return value * 1000;
  if (unit === '원' || unit === '') return value;
  return null; // 만원 등 못 다루는 단위 — 임의 추정 대신 미확인 처리
};

// kind:'funding' 규칙 중 item이 'subsidy_rate'/'matching_cash_min'인 항목에서 지원비율·현금최소비율을 읽는다.
// 값을 찾으면 사용자가 그대로 쓰거나 고쳐서 적용할 수 있도록 제안값으로만 쓴다 — 절대 자동 확정하지 않는다.
export const suggestedFundingRates = (extraction: Extraction): { subsidyRate?: { pct: number; rule: ExtractedRule }; matchingCashRate?: { pct: number; rule: ExtractedRule } } => {
  const subsidyRule = extraction.rules.find((rule) => rule.kind === 'funding' && rule.item === 'subsidy_rate' && rule.limitPct != null);
  const cashRule = extraction.rules.find((rule) => rule.kind === 'funding' && rule.item === 'matching_cash_min' && rule.limitPct != null);
  return {
    ...(subsidyRule ? { subsidyRate: { pct: subsidyRule.limitPct!, rule: subsidyRule } } : {}),
    ...(cashRule ? { matchingCashRate: { pct: cashRule.limitPct!, rule: cashRule } } : {}),
  };
};

// ---- 긴 문서 분할 ----
// Edge Function은 한 번에 60,000자만 본다. 지침·고시는 그보다 훨씬 길어서(TIPS 본문 19.6만 자)
// 그냥 보내면 앞부분만 읽고 끝난다 — 정작 비목 기준은 문서 중반에 있다.
// 그래서 조문·장 경계에서 잘라 여러 번 호출하고 결과를 합친다.
const CHUNK_LIMIT = 45_000;   // Edge Function 상한(60,000)보다 낮게 잡아 경계 조정 여유를 둔다
const CHUNK_OVERLAP = 1_200;  // 경계에 걸친 조문이 양쪽에서 잘리지 않도록 조금 겹친다

// 자르기 좋은 위치 — 뒤쪽일수록 우선한다 (조문 시작 > 장/절 시작 > 빈 줄 > 줄바꿈).
const SPLIT_PATTERNS = [/\n(?=\s*제\s*\d+\s*조)/g, /\n(?=\s*제\s*\d+\s*[장절])/g, /\n(?=\s*\d+\.\s)/g, /\n\n/g];

export const splitForExtraction = (text: string, limit = CHUNK_LIMIT): string[] => {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= limit) { chunks.push(text.slice(start)); break; }
    const window = text.slice(start, start + limit);
    // 창 안에서 가장 뒤쪽 경계를 찾는다. 앞쪽 60% 이전에서만 잡히면 그 경계는 무시(조각이 너무 작아진다).
    let cut = -1;
    for (const pattern of SPLIT_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(window);
      let last = -1;
      while (match) { if (match.index > limit * 0.6) last = match.index; match = pattern.exec(window); }
      if (last > cut) cut = last;
      if (cut > 0) break;
    }
    const end = cut > 0 ? start + cut : start + limit;
    chunks.push(text.slice(start, end));
    start = Math.max(end - CHUNK_OVERLAP, end === start ? start + limit : end);
  }
  return chunks;
};

// 조각별 추출 결과를 하나로 합친다. 겹친 구간 때문에 같은 항목이 두 번 나올 수 있어 키로 중복을 제거한다.
export const mergeExtractions = (parts: Extraction[]): Extraction => {
  if (parts.length === 1) return parts[0];
  const key = (text: string) => text.replace(/\s/g, '').slice(0, 60);
  const dedupe = <T>(items: T[], keyOf: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => { const k = keyOf(item); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const head = parts.find((part) => part.programName) ?? parts[0];
  return {
    // 문서 메타는 앞부분(표지·총칙)에 있으므로 값이 있는 첫 조각을 쓴다
    programName: head.programName,
    year: parts.find((part) => part.year != null)?.year ?? null,
    programType: head.programType,
    categories: dedupe(parts.flatMap((p) => p.categories), (c) => key(c.name)),
    allowedItems: dedupe(parts.flatMap((p) => p.allowedItems ?? []), (i) => `${key(i.categoryName)}|${key(i.name)}`),
    articles: dedupe(parts.flatMap((p) => p.articles ?? []), (a) => key(a.ref)),
    rules: dedupe(parts.flatMap((p) => p.rules), (r) => `${key(r.message)}|${key(r.ref)}`),
    referencedRegulations: dedupe(parts.flatMap((p) => p.referencedRegulations ?? []), (r) => key(r.name)),
    fundingSchedule: parts.find((part) => part.fundingSchedule)?.fundingSchedule ?? null,
    uncertain: [...new Set(parts.flatMap((p) => p.uncertain ?? []))],
  };
};

const callExtract = async (text: string, packId: string | null): Promise<{ extraction: Extraction; cached: boolean }> => {
  if (!supabase) throw new Error('클라우드(로그인) 연결이 필요합니다.');
  const { data, error } = await supabase.functions.invoke('extract-rules', { body: { text, packId } });
  if (error) throw new Error(await describeFunctionError(error));
  if (data?.error) throw new Error(data.error);
  if (!data?.extraction) throw new Error('추출 결과가 비어 있습니다.');
  return { extraction: data.extraction as Extraction, cached: !!data.cached };
};

// 문서가 길면 조각으로 나눠 순차 호출한다 (한 번에 보내면 Edge Function 실행 시간과 응답 길이를 넘긴다).
// onProgress로 진행 상황을 알려 사용자가 몇 분씩 기다리는 이유를 알 수 있게 한다.
export const runExtraction = async (
  text: string,
  packId: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<{ extraction: Extraction; cached: boolean; chunks: number }> => {
  const chunks = splitForExtraction(text);
  onProgress?.(0, chunks.length);
  const results: Extraction[] = [];
  let allCached = true;
  for (const [index, chunk] of chunks.entries()) {
    const { extraction, cached } = await callExtract(chunk, packId);
    results.push(extraction);
    allCached = allCached && cached;
    onProgress?.(index + 1, chunks.length);
  }
  return { extraction: mergeExtractions(results), cached: allCached, chunks: chunks.length };
};

// FunctionsHttpError는 message가 "Edge Function returned a non-2xx status code"로 고정돼 있어
// 실제 원인(함수가 응답한 JSON body)은 context(Response)를 직접 읽어야 나온다.
const describeFunctionError = async (error: { message: string; context?: unknown }): Promise<string> => {
  const context = error.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch { /* JSON이 아니면 아래 기본 메시지로 */ }
  }
  return error.message;
};

// 공백·중점 차이를 무시하고 인용문이 원문에 실제로 존재하는지 확인한다.
const normalize = (text: string) => text.replace(/[\s·ㆍ()（）,，.。'"'"]/g, '');
export const verifyQuote = (quote: string, source: string): boolean => {
  const q = normalize(quote);
  if (q.length < 6) return false;
  // 긴 인용은 앞 60자만 맞아도 인정 (추출 시 줄바꿈 경계가 어긋나는 경우 대비)
  return normalize(source).includes(q.length > 60 ? q.slice(0, 60) : q);
};

export const annotateVerification = (extraction: Extraction, sourceText: string): Extraction => ({
  ...extraction,
  categories: extraction.categories.map((category) => ({ ...category, verified: verifyQuote(category.quote, sourceText) })),
  allowedItems: (extraction.allowedItems ?? []).map((item) => ({ ...item, verified: verifyQuote(item.quote, sourceText) })),
  // 조문 원문은 인용이 아니라 본문 전체라 앞부분만 대조한다 (verifyQuote는 60자까지 본다).
  articles: (extraction.articles ?? []).map((article) => ({ ...article, verified: verifyQuote(article.text, sourceText) })),
  rules: extraction.rules.map((rule) => ({ ...rule, verified: verifyQuote(rule.quote, sourceText) })),
  referencedRegulations: (extraction.referencedRegulations ?? []).map((reg) => ({ ...reg, verified: verifyQuote(reg.quote, sourceText) })),
  fundingSchedule: extraction.fundingSchedule ? { ...extraction.fundingSchedule, verified: verifyQuote(extraction.fundingSchedule.quote, sourceText) } : null,
});

const slug = (name: string, index: number) => `doc_${index}_${name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12) || 'cat'}`;

const GENERIC_DOCS = ['견적서 또는 계약서', '세금계산서 또는 카드 영수증', '계좌이체 확인증', '내부품의서'];

// 승인된 추출 결과로 규정 팩을 만든다.
// useDocCategories=true면 문서의 비목 구성을 그대로 쓰고, 아니면 기준 팩 위에 규칙만 얹는다.
export const buildCustomPack = (
  base: RulePack | null,
  extraction: Extraction,
  acceptedRules: ExtractedRule[],
  useDocCategories: boolean,
  // 사용자가 승인한 인정 항목. 넘기지 않으면 추출된 항목을 모두 싣는다 (조문 원문도 마찬가지).
  acceptedItems: ExtractedAllowedItem[] = extraction.allowedItems ?? [],
): RulePack => {
  const docLabel = extraction.programName || '업로드 문서';
  const source = (ref: string) => ({ doc: docLabel, ref: ref || '업로드 문서', matchLevel: 'notice' });
  // 비목 이름 비교용 정규화 — 중점·마침표 표기 차이를 무시한다.
  const norm = (text: string) => text.replace(/[\s·.,]/g, '');

  let categories: PackCategory[];
  if (useDocCategories && extraction.categories.length) {
    const usable = extraction.categories;
    const even = Math.floor(100 / usable.length);
    categories = usable.map((category, index) => ({
      id: slug(category.name, index),
      name: category.name,
      allowed: category.allowed,
      definition: category.definition ?? undefined,
      draftRate: index === 0 ? 100 - even * (usable.length - 1) : even, // 합계 100 보장, 균등 초안
      requiredDocs: category.requiredDocs.length ? category.requiredDocs : GENERIC_DOCS,
      // 하위 비목이 있으면 편성표에서 "계상 가능 세목"으로 눌러 추가할 수 있게 한다
      ...(() => {
        const children = usable.filter((other) => other.parentName && norm(other.parentName) === norm(category.name)).map((other) => other.name);
        return children.length ? { subItemOptions: children } : {};
      })(),
      source: { ...source(category.ref), appDefault: !category.requiredDocs.length },
    }));
  } else {
    categories = base?.categories ?? [];
  }

  // 규칙을 비목에 연결한다. 1순위 item(추출 시 지정된 정확한 비목/세부항목명), 2순위 message 안의 비목 "전체 이름".
  // 예전에는 비목명 앞 2글자만 봤는데, "연구"처럼 R&D 비목명 대부분이 공유하는 접두어라 위탁연구개발비 규칙이
  // 연구수당·연구실운영비 등 전혀 다른 비목에도 잘못 연결됐다 — 부분 접두어 매칭은 절대 하지 않는다.
  // 중점·마침표도 무시한다 ("연구시설·장비비" vs "연구시설.장비비" 표기 차이로 연결이 끊기지 않게).
  const linkTo = (item: string | null | undefined, message: string): string[] | undefined => {
    if (item) {
      const ni = norm(item);
      const exact = categories.filter((category) => norm(category.name) === ni);
      if (exact.length) return exact.map((c) => c.id);
      const partial = categories.filter((category) => { const nc = norm(category.name); return nc.includes(ni) || ni.includes(nc); });
      if (partial.length) return partial.map((c) => c.id);
    }
    const nm = norm(message);
    const byMessage = categories.filter((category) => nm.includes(norm(category.name)));
    return byMessage.length ? byMessage.map((c) => c.id) : undefined;
  };

  // APPROVAL_THRESHOLD·RECOGNITION_LIMIT는 "이 금액을 넘으면 절차가 발동"하는 기준이지 편성 금액 상한이 아니다.
  // ratio로 두면 화면이 그 금액으로 편성액을 깎아버리므로 주의사항(warning)으로 내린다.
  const isProceduralLimit = (rule: ExtractedRule) => !!rule.limitType && PROCEDURAL_LIMIT_TYPES.includes(rule.limitType);

  const extractedRules: PackRule[] = acceptedRules.map((rule, index) => ({
    id: `ext_${index}`,
    // minAmount가 있으면 %가 아니라 이 공고 특유의 정액 필수 계상 요구사항 — 별도 kind로 구분해 예산 편성 화면에서 최소 금액 미달을 표시한다.
    kind: rule.minAmount != null ? 'minimum'
      : rule.kind === 'funding' ? 'info'
      : rule.kind === 'ratio' && isProceduralLimit(rule) ? 'warning'
      : rule.kind,
    item: rule.item ?? undefined,
    message: rule.kind === 'funding' ? `[재원] ${rule.message}` : rule.message,
    limitPct: rule.minAmount != null || isProceduralLimit(rule) ? undefined : rule.limitPct ?? undefined,
    minAmount: rule.minAmount ?? undefined,
    basis: rule.basis ?? undefined,
    severity: rule.severity ?? undefined,
    quote: rule.quote,
    categoryIds: linkTo(rule.item, rule.message),
    source: source(rule.ref),
  }));

  // 인정 항목을 비목에 붙인다 — 기준 패널의 "인정 항목" 목록이 된다.
  // 비목 이름으로 연결하며(categoryName), 규칙 연결과 같은 정규화를 쓴다.
  const withAllowedItems = categories.map((category) => {
    const items = acceptedItems
      .filter((item) => {
        const nc = norm(category.name);
        const ni = norm(item.categoryName);
        return ni === nc || nc.includes(ni) || ni.includes(nc);
      })
      .map((item) => ({
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        ...(item.status === 'CONDITIONAL' ? { status: 'CONDITIONAL' as const } : {}),
        ...(item.condition ? { condition: item.condition } : {}),
        ...(item.restriction ? { restriction: item.restriction } : {}),
        source: source(item.ref),
      }));
    // 승인·인정이 필요한 규칙과 증빙을 요구하는 규칙은 기준 패널의 "주의 · 절차"에 따로 모인다.
    const linked = (rule: ExtractedRule) => (linkTo(rule.item, rule.message) ?? []).includes(category.id);
    const approvals = acceptedRules
      .filter((rule) => rule.approvalStatus && linked(rule))
      .map((rule) => ({
        name: rule.item ? `${rule.item}: ${rule.message}` : rule.message,
        status: rule.approvalStatus === 'RECOGNITION_REQUIRED' ? '전문기관 인정 필요' : '사전승인 필요',
        source: source(rule.ref),
      }));
    const evidenceRules = acceptedRules
      .filter((rule) => (rule.requiredDocuments ?? []).length && linked(rule))
      .map((rule) => ({ name: rule.message, documents: rule.requiredDocuments!, source: source(rule.ref) }));
    return {
      ...category,
      ...(items.length ? { allowedItems: items } : {}),
      ...(approvals.length ? { approvals } : {}),
      ...(evidenceRules.length ? { evidenceRules } : {}),
    };
  });

  // 조문 원문 — 근거 링크를 눌렀을 때 원본 파일 없이도 그 조문이 열린다.
  const articles = (extraction.articles ?? [])
    .filter((article) => article.ref && article.text)
    .map((article, index) => ({
      key: `ext_art_${index}`,
      ref: article.ref,
      ...(article.title ? { title: article.title } : {}),
      text: article.text,
    }));

  // 상한 규칙이 문서 기준으로 새로 들어오면 기준 팩의 같은 비목 상한보다 우선하도록 앞에 둔다.
  const baseRules = useDocCategories ? [] : (base?.rules ?? []);
  return {
    id: `extracted-${Date.now()}`,
    name: extraction.programName ? `${extraction.programName}` : `${base?.name ?? '커스텀'} (공고 반영)`,
    orgType: base?.orgType ?? '',
    guideline: base ? `${base.guideline} + 업로드 공고 특약` : '업로드 문서 기준',
    agency: base?.agency ?? docLabel,
    // 근거 검토를 거치지 않은 추출 결과 — 대응하는 규정DB가 없는 사업에서만 비목의 출처가 된다.
    origin: 'extracted',
    hasRatioLimits: extractedRules.some((rule) => rule.kind === 'ratio') || (base?.hasRatioLimits ?? false),
    verified: false,
    referenceUrl: base?.referenceUrl,
    categories: withAllowedItems,
    rules: [...extractedRules, ...baseRules],
    applicationDocs: base?.applicationDocs ?? [],
    ...(articles.length ? { articles } : {}),
  };
};
