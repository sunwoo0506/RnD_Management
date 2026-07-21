// 최신 공고 추출 결과 ↔ 이미 있는 규정DB 팩 비교.
//
// 규정DB가 있는 사업이라도 최신 공고에서 기준이 바뀔 수 있다. 그래서 사용자가 올린 공고·사업계획서를
// 같은 추출 로직으로 돌린 뒤, 기존 규정DB와 무엇이 달라졌는지만 뽑아 보여준다.
//
// 판정을 네 가지로 나누는 이유: AI 추출은 누락이 흔해서 "규정DB에 있는데 추출에 없다"를 곧바로
// "삭제됐다"로 볼 수 없다. 그건 missing(확인 필요)일 뿐이고, 실제로 값이 맞부딪히는 changed 만
// 사용자에게 승인을 권한다.
import type { PackRule, RulePack } from './types';
import type { Extraction, ExtractedRule } from './llmExtract';

export type DiffStatus =
  | 'changed'    // 같은 비목의 같은 종류 기준인데 값이 다르다 — 개정 가능성이 가장 높다
  | 'added'      // 최신 문서에만 있다 — 이 사업 고유 규칙이거나 신설
  | 'missing'    // 규정DB에만 있다 — 삭제됐을 수도, 추출이 놓쳤을 수도 있다
  | 'unchanged'; // 값이 같다

export type DiffTarget = 'limit' | 'minimum' | 'category' | 'rule';

export interface PackDiff {
  status: DiffStatus;
  target: DiffTarget;
  label: string;              // 비목명 또는 규칙 요약
  before: string | null;      // 규정DB의 현재 값
  after: string | null;       // 최신 문서에서 확인된 값
  baseRuleId?: string;        // 이 변경으로 가려질 기준 팩 규칙
  extracted?: ExtractedRule;  // 승인하면 오버레이로 얹을 추출 규칙
  note?: string;
}

// 비목·항목 이름 비교용 정규화 — 공백·중점·괄호 차이를 무시한다.
const norm = (text: string) => text.replace(/[\s·.,()（）]/g, '');

// 문장 비교용 — 조사·어미까지 맞추려 들면 오탐이 폭증하므로 기호와 공백만 정리한다.
const normMessage = (text: string) => text.replace(/[\s·.,()（）"'“”‘’]/g, '').toLowerCase();

// 규칙이 어느 비목 것인지 — item이 우선이고, 없으면 categoryIds로 비목명을 찾는다.
const ruleCategoryName = (pack: RulePack, rule: PackRule): string => {
  if (rule.item) return rule.item;
  const id = rule.categoryIds?.[0];
  if (!id) return '';
  const all = [...pack.categories, ...(pack.referenceCategories ?? [])];
  return all.find((category) => category.id === id)?.name ?? '';
};

const pctText = (pct: number, basis?: string | null) => `${pct}%${basis ? ` (기준: ${basis})` : ''}`;
const wonText = (won: number) => `${won.toLocaleString('ko-KR')}원`;

// 추출 규칙이 "금액 상한"인지 — 승인 절차 발동 기준(APPROVAL_THRESHOLD 등)은 상한이 아니라
// 비교 대상에서 뺀다. 이걸 상한으로 섞으면 편성 금액을 잘못 깎게 된다.
const isAmountLimit = (rule: ExtractedRule) =>
  rule.kind === 'ratio' && rule.limitPct != null
  && rule.limitType !== 'APPROVAL_THRESHOLD' && rule.limitType !== 'RECOGNITION_LIMIT';

export const diffExtraction = (base: RulePack, extraction: Extraction): PackDiff[] => {
  const diffs: PackDiff[] = [];

  // ---- 1) 비목별 상한 (%) ----
  const baseLimits = new Map<string, PackRule>();
  for (const rule of base.rules) {
    if (rule.kind !== 'ratio' || rule.limitPct == null) continue;
    const name = norm(ruleCategoryName(base, rule));
    if (name && !baseLimits.has(name)) baseLimits.set(name, rule);
  }

  const seenLimits = new Set<string>();
  for (const rule of extraction.rules) {
    if (!isAmountLimit(rule)) continue;
    const name = norm(rule.item ?? '');
    if (!name) continue;
    seenLimits.add(name);
    const current = baseLimits.get(name);
    if (!current) {
      diffs.push({
        status: 'added', target: 'limit', label: rule.item!,
        before: null, after: pctText(rule.limitPct!, rule.basis), extracted: rule,
        note: '규정DB에 없던 상한입니다.',
      });
    } else if (current.limitPct !== rule.limitPct) {
      diffs.push({
        status: 'changed', target: 'limit', label: rule.item!,
        before: pctText(current.limitPct!, current.basis), after: pctText(rule.limitPct!, rule.basis),
        baseRuleId: current.id, extracted: rule,
        note: '최신 문서의 상한이 규정DB와 다릅니다.',
      });
    } else {
      diffs.push({
        status: 'unchanged', target: 'limit', label: rule.item!,
        before: pctText(current.limitPct!, current.basis), after: pctText(rule.limitPct!, rule.basis),
        baseRuleId: current.id,
      });
    }
  }
  for (const [name, rule] of baseLimits) {
    if (seenLimits.has(name)) continue;
    diffs.push({
      status: 'missing', target: 'limit', label: ruleCategoryName(base, rule) || rule.message,
      before: pctText(rule.limitPct!, rule.basis), after: null, baseRuleId: rule.id,
      note: '최신 문서에서 확인되지 않았습니다 — 삭제됐는지 추출이 놓쳤는지 원문을 확인하세요.',
    });
  }

  // ---- 2) 정액 필수 계상 ----
  const baseMins = new Map<string, PackRule>();
  for (const rule of base.rules) {
    if (rule.minAmount == null) continue;
    const name = norm(ruleCategoryName(base, rule));
    if (name && !baseMins.has(name)) baseMins.set(name, rule);
  }
  const seenMins = new Set<string>();
  for (const rule of extraction.rules) {
    if (rule.minAmount == null) continue;
    const name = norm(rule.item ?? '');
    if (!name) continue;
    seenMins.add(name);
    const current = baseMins.get(name);
    if (!current) {
      diffs.push({
        status: 'added', target: 'minimum', label: rule.item!,
        before: null, after: wonText(rule.minAmount), extracted: rule,
        note: '규정DB에 없던 필수 계상 금액입니다.',
      });
    } else if (current.minAmount !== rule.minAmount) {
      diffs.push({
        status: 'changed', target: 'minimum', label: rule.item!,
        before: wonText(current.minAmount!), after: wonText(rule.minAmount),
        baseRuleId: current.id, extracted: rule,
        note: '필수 계상 금액이 규정DB와 다릅니다.',
      });
    } else {
      diffs.push({
        status: 'unchanged', target: 'minimum', label: rule.item!,
        before: wonText(current.minAmount!), after: wonText(rule.minAmount), baseRuleId: current.id,
      });
    }
  }
  for (const [name, rule] of baseMins) {
    if (seenMins.has(name)) continue;
    diffs.push({
      status: 'missing', target: 'minimum', label: ruleCategoryName(base, rule) || rule.message,
      before: wonText(rule.minAmount!), after: null, baseRuleId: rule.id,
      note: '최신 문서에서 확인되지 않았습니다 — 원문을 확인하세요.',
    });
  }

  // ---- 3) 비목 구성 ----
  // 비목은 오버레이로 바꾸지 않는다. 규정DB에 없는 비목이 최신 공고에 나왔다면 규정DB 자체를
  // 갱신해야 한다는 신호이므로, 승인 대상이 아니라 알림으로만 남긴다.
  const baseCategoryNames = new Set(
    [...base.categories, ...(base.referenceCategories ?? [])].map((category) => norm(category.name)),
  );
  for (const category of extraction.categories) {
    if (baseCategoryNames.has(norm(category.name))) continue;
    diffs.push({
      status: 'added', target: 'category', label: category.name,
      before: null, after: category.definition ?? '최신 문서에만 있는 비목',
      note: '규정DB에 없는 비목입니다 — 예산 화면의 비목은 바뀌지 않습니다. 규정DB 갱신을 신청하세요.',
    });
  }

  // ---- 4) 그 밖의 규칙 (금지·주의·절차) ----
  // 문장이 같은 규칙은 이미 규정DB에 있는 것으로 본다. 여기서 걸러지는 것만 "이 공고 고유"로
  // 남아 오버레이 승인 대상이 된다.
  const baseMessages = new Set(base.rules.map((rule) => normMessage(rule.message)));
  const baseQuotes = new Set(base.rules.map((rule) => normMessage(rule.quote ?? '')).filter(Boolean));
  for (const rule of extraction.rules) {
    if (isAmountLimit(rule) || rule.minAmount != null || rule.kind === 'funding') continue;
    const message = normMessage(rule.message);
    const quote = normMessage(rule.quote ?? '');
    const known = baseMessages.has(message) || (!!quote && baseQuotes.has(quote));
    diffs.push({
      status: known ? 'unchanged' : 'added', target: 'rule',
      label: rule.item ? `[${rule.item}] ${rule.message}` : rule.message,
      before: known ? '규정DB에 같은 내용 있음' : null,
      after: rule.message,
      ...(known ? {} : { extracted: rule }),
    });
  }

  const order: Record<DiffStatus, number> = { changed: 0, added: 1, missing: 2, unchanged: 3 };
  return diffs.sort((a, b) => order[a.status] - order[b.status]);
};

export interface DiffSummary { changed: number; added: number; missing: number; unchanged: number; total: number }

export const summarizeDiff = (diffs: PackDiff[]): DiffSummary => ({
  changed: diffs.filter((d) => d.status === 'changed').length,
  added: diffs.filter((d) => d.status === 'added').length,
  missing: diffs.filter((d) => d.status === 'missing').length,
  unchanged: diffs.filter((d) => d.status === 'unchanged').length,
  total: diffs.length,
});

// 사용자가 승인한 변경사항을 오버레이 규칙으로 바꾼다. 비목은 만들지 않는다.
export const overlayRulesFrom = (base: RulePack, approved: PackDiff[]): { rules: PackRule[]; supersededRuleIds: string[] } => {
  const rules: PackRule[] = [];
  const superseded: string[] = [];
  approved.forEach((diff, index) => {
    const extracted = diff.extracted;
    if (!extracted) return;
    if (diff.baseRuleId) superseded.push(diff.baseRuleId);
    const categoryIds = categoryIdsFor(base, extracted.item);
    rules.push({
      id: `overlay_${diff.target}_${index}_${Date.now().toString(36)}`,
      kind: extracted.minAmount != null ? 'minimum' : extracted.kind === 'ratio' ? 'ratio' : extracted.kind === 'info' ? 'info' : 'warning',
      ...(extracted.item ? { item: extracted.item } : {}),
      message: extracted.message,
      ...(extracted.limitPct != null ? { limitPct: extracted.limitPct } : {}),
      ...(extracted.minAmount != null ? { minAmount: extracted.minAmount } : {}),
      ...(extracted.basis ? { basis: extracted.basis } : {}),
      ...(extracted.severity ? { severity: extracted.severity } : {}),
      ...(extracted.quote ? { quote: extracted.quote } : {}),
      ...(categoryIds.length ? { categoryIds } : {}),
      source: { doc: '최신 공고 (사용자 확인)', ref: extracted.ref, matchLevel: 'notice' },
    });
  });
  return { rules, supersededRuleIds: [...new Set(superseded)] };
};

// 추출 비목명을 규정DB 비목 id로 옮긴다 — 오버레이 규칙이 올바른 비목에 붙게 한다.
const categoryIdsFor = (base: RulePack, itemName: string | null): string[] => {
  if (!itemName) return [];
  const target = norm(itemName);
  const match = base.categories.find((category) => norm(category.name) === target)
    ?? base.categories.find((category) => target.includes(norm(category.name)) || norm(category.name).includes(target));
  return match ? [match.id] : [];
};
