import { describe, expect, it } from 'vitest';
import { capFor, categoryOf, documentsFor, getPack, globalRules, makeDraftBudgets, PACKS, rulesFor, transferLimitError, visibleCategories } from './rules';
import type { Project } from './types';

describe('규정 팩 로더', () => {
  it('예창패·R&D 영리·R&D 정부출연·레거시 4개 팩을 제공한다', () => {
    expect(PACKS.map((pack) => pack.id).sort()).toEqual(['legacy-rnd', 'prestartup', 'rnd-forprofit', 'rnd-govt']);
  });

  it('모든 팩의 비목·규칙에 출처(문서·조문 위치)가 있고 검증 전 상태다', () => {
    for (const pack of PACKS) {
      expect(pack.verified).toBe(false);
      expect(pack.guideline).toBeTruthy();
      for (const category of pack.categories) expect(category.source.doc).toBeTruthy();
      for (const rule of pack.rules) {
        expect(rule.source.ref).toBeTruthy();
        expect(rule.message).toBeTruthy();
      }
    }
  });

  it('팩별 초안 배분율 합계는 100이다', () => {
    for (const pack of PACKS) {
      const sum = pack.categories.filter((c) => c.allowed).reduce((total, c) => total + c.draftRate, 0);
      expect(sum, pack.id).toBe(100);
    }
  });

  it('예창패는 비목 9종·비율 제한 없음, 금지 경고가 있다', () => {
    const pack = getPack('prestartup');
    expect(pack.categories).toHaveLength(9);
    expect(pack.hasRatioLimits).toBe(false);
    expect(capFor(pack, makeDraftBudgets(pack, 100_000_000), 100_000_000, 'cat_personnel')).toBeNull();
    const warnings = pack.rules.filter((rule) => rule.kind === 'warning');
    expect(warnings.some((rule) => rule.message.includes('배우자'))).toBe(true);
    expect(warnings.some((rule) => rule.message.includes('소급'))).toBe(true);
  });

  it('없는 비목 ID는 스텁을 돌려줘 화면이 죽지 않는다', () => {
    const category = categoryOf(getPack('prestartup'), 'ghost-category');
    expect(category.name).toBe('ghost-category');
    expect(category.requiredDocs).toEqual([]);
  });
});

describe('상한 계산과 배분', () => {
  it('1억 원 초안 합계가 총 사업비와 일치한다 (전 팩)', () => {
    for (const pack of PACKS) {
      const draft = makeDraftBudgets(pack, 100_000_000);
      expect(draft.reduce((sum, item) => sum + item.amount, 0), pack.id).toBe(100_000_000);
    }
  });

  it('R&D 연구수당 상한은 인건비 기준 20%로 계산된다', () => {
    const pack = getPack('rnd-forprofit');
    const budgets = makeDraftBudgets(pack, 100_000_000); // 인건비 40,000,000
    const cap = capFor(pack, budgets, 100_000_000, 'allowance');
    expect(cap?.amount).toBe(8_000_000);
    expect(cap?.rule.source.ref).toContain('제26조');
  });

  it('레거시 팩의 인건비 상한은 총 사업비의 50%다', () => {
    const pack = getPack('legacy-rnd');
    const budgets = makeDraftBudgets(pack, 100_000_000);
    expect(capFor(pack, budgets, 100_000_000, 'personnel')?.amount).toBe(50_000_000);
  });

  it('받는 비목이 상한을 초과하는 이동은 오류를 반환하고, 상한 없는 팩은 통과한다', () => {
    const legacy = getPack('legacy-rnd');
    const budgets = makeDraftBudgets(legacy, 100_000_000); // 인건비 45,000,000 / 상한 50,000,000
    expect(transferLimitError(legacy, budgets, 100_000_000, 'personnel', 10_000_000)).toMatch(/허용 상한/);
    expect(transferLimitError(legacy, budgets, 100_000_000, 'personnel', 1_000_000)).toBeNull();
    const prestartup = getPack('prestartup');
    const preBudgets = makeDraftBudgets(prestartup, 100_000_000);
    expect(transferLimitError(prestartup, preBudgets, 100_000_000, 'cat_personnel', 50_000_000)).toBeNull();
  });
});

describe('증빙·표시 규칙', () => {
  it('카드 결제는 세금계산서·이체확인증 대신 카드 영수증을 요구한다', () => {
    const category = categoryOf(getPack('legacy-rnd'), 'materials');
    const cardDocs = documentsFor(category, 'card');
    expect(cardDocs).toContain('카드 영수증');
    expect(cardDocs.join()).not.toMatch(/세금계산서|계좌이체/);
    expect(documentsFor(category, 'transfer')).toContain('세금계산서');
  });

  it('비목별 경고 규칙을 조회할 수 있다 (예창패 인건비 → 친인척 금지)', () => {
    const warnings = rulesFor(getPack('prestartup'), 'cat_personnel', 'warning');
    expect(warnings.some((rule) => rule.message.includes('배우자'))).toBe(true);
  });

  it('편성 확정 시 금액 0원·집행 없음 비목은 숨긴다', () => {
    const pack = getPack('prestartup');
    const budgets = makeDraftBudgets(pack, 100_000_000).map((item) => item.categoryId === 'cat_travel' ? { ...item, amount: 0 } : item);
    const project = { budgetConfirmed: true, budgets, expenses: [] } as unknown as Project;
    const visible = visibleCategories(pack, project);
    expect(visible.some((category) => category.id === 'cat_travel')).toBe(false);
    expect(visible).toHaveLength(8);
  });
});
