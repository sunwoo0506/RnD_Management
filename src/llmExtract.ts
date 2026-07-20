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
  limitPct: number | null; basis: string | null; severity: 'high' | 'medium' | 'low' | null;
  quote: string; ref: string;
  verified?: boolean;
}
export interface Extraction {
  programName: string; year: number | null;
  programType: 'startup' | 'rnd' | 'other' | 'unknown';
  categories: ExtractedCategory[];
  rules: ExtractedRule[];
  uncertain: string[];
}

export const runExtraction = async (text: string, packId: string | null): Promise<{ extraction: Extraction; cached: boolean }> => {
  if (!supabase) throw new Error('클라우드(로그인) 연결이 필요합니다.');
  const { data, error } = await supabase.functions.invoke('extract-rules', { body: { text, packId } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.extraction) throw new Error('추출 결과가 비어 있습니다.');
  return { extraction: data.extraction as Extraction, cached: !!data.cached };
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

  // 규칙을 비목에 연결 (이름 포함 여부의 단순 매칭 — 못 찾으면 과제 공통 규칙)
  const linkTo = (text: string): string[] | undefined => {
    const ids = categories.filter((category) => text.includes(category.name) || (category.name.length >= 2 && text.includes(category.name.slice(0, 2)))).map((c) => c.id);
    return ids.length ? ids : undefined;
  };

  const extractedRules: PackRule[] = acceptedRules.map((rule, index) => ({
    id: `ext_${index}`,
    kind: rule.kind === 'funding' ? 'info' : rule.kind,
    item: rule.item ?? undefined,
    message: rule.kind === 'funding' ? `[재원] ${rule.message}` : rule.message,
    limitPct: rule.limitPct ?? undefined,
    basis: rule.basis ?? undefined,
    severity: rule.severity ?? undefined,
    quote: rule.quote,
    categoryIds: linkTo(`${rule.item ?? ''} ${rule.message}`),
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
