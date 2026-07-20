// LLM 규정 추출 클라이언트 — Edge Function 호출, 인용 원문 대조 검증, 커스텀 팩 구성.
// 추출값은 절대 자동 확정하지 않는다: ①스키마상 인용 필수 → ②여기서 원문 대조 → ③사용자 승인 후 적용.
import { supabase } from './supabase';
import type { PackCategory, PackRule, RulePack } from './types';

export interface ExtractedCategory {
  name: string; definition: string | null; allowed: boolean;
  limitPct: number | null; limitBasis: string | null; requiredDocs: string[];
  quote: string; ref: string;
  verified?: boolean;
}
export interface ExtractedRule {
  kind: 'ratio' | 'warning' | 'funding' | 'info';
  item: string | null; message: string;
  limitPct: number | null; minAmount: number | null; basis: string | null; severity: 'high' | 'medium' | 'low' | null;
  quote: string; ref: string;
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

export const runExtraction = async (text: string, packId: string | null): Promise<{ extraction: Extraction; cached: boolean }> => {
  if (!supabase) throw new Error('클라우드(로그인) 연결이 필요합니다.');
  const { data, error } = await supabase.functions.invoke('extract-rules', { body: { text, packId } });
  if (error) throw new Error(await describeFunctionError(error));
  if (data?.error) throw new Error(data.error);
  if (!data?.extraction) throw new Error('추출 결과가 비어 있습니다.');
  return { extraction: data.extraction as Extraction, cached: !!data.cached };
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
): RulePack => {
  const docLabel = extraction.programName || '업로드 문서';
  const source = (ref: string) => ({ doc: docLabel, ref: ref || '업로드 문서', matchLevel: 'notice' });

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
      source: { ...source(category.ref), appDefault: !category.requiredDocs.length },
    }));
  } else {
    categories = base?.categories ?? [];
  }

  // 규칙을 비목에 연결한다. 1순위 item(추출 시 지정된 정확한 비목/세부항목명), 2순위 message 안의 비목 "전체 이름".
  // 예전에는 비목명 앞 2글자만 봤는데, "연구"처럼 R&D 비목명 대부분이 공유하는 접두어라 위탁연구개발비 규칙이
  // 연구수당·연구실운영비 등 전혀 다른 비목에도 잘못 연결됐다 — 부분 접두어 매칭은 절대 하지 않는다.
  const norm = (text: string) => text.replace(/\s/g, '');
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

  const extractedRules: PackRule[] = acceptedRules.map((rule, index) => ({
    id: `ext_${index}`,
    // minAmount가 있으면 %가 아니라 이 공고 특유의 정액 필수 계상 요구사항 — 별도 kind로 구분해 예산 편성 화면에서 최소 금액 미달을 표시한다.
    kind: rule.minAmount != null ? 'minimum' : rule.kind === 'funding' ? 'info' : rule.kind,
    item: rule.item ?? undefined,
    message: rule.kind === 'funding' ? `[재원] ${rule.message}` : rule.message,
    limitPct: rule.minAmount != null ? undefined : rule.limitPct ?? undefined,
    minAmount: rule.minAmount ?? undefined,
    basis: rule.basis ?? undefined,
    severity: rule.severity ?? undefined,
    quote: rule.quote,
    categoryIds: linkTo(rule.item, rule.message),
    source: source(rule.ref),
  }));

  // 상한 규칙이 문서 기준으로 새로 들어오면 기준 팩의 같은 비목 상한보다 우선하도록 앞에 둔다.
  const baseRules = useDocCategories ? [] : (base?.rules ?? []);
  return {
    id: `extracted-${Date.now()}`,
    name: extraction.programName ? `${extraction.programName}` : `${base?.name ?? '커스텀'} (공고 반영)`,
    orgType: base?.orgType ?? '',
    guideline: base ? `${base.guideline} + 업로드 공고 특약` : '업로드 문서 기준',
    agency: base?.agency ?? docLabel,
    hasRatioLimits: extractedRules.some((rule) => rule.kind === 'ratio') || (base?.hasRatioLimits ?? false),
    verified: false,
    referenceUrl: base?.referenceUrl,
    categories,
    rules: [...extractedRules, ...baseRules],
    applicationDocs: base?.applicationDocs ?? [],
  };
};
