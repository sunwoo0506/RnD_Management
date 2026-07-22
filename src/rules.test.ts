import { describe, expect, it } from 'vitest';
import { applyOverlay, articlesForRef, baseStandardFor, capFor, categoryOf, fundingCapChecks, maxAmountWithinCap, subItemChoicesFor, fundingRateChecks, packIsMissing, replacementPacksFor, rescaleBudgets, selectablePacks, documentsFor, getPack, globalRules, isRegulationDbPack, laborCostFor, makeDraftBudgets, monthsBetween, packFor, PACKS, referenceStandardFor, rulesFor, transferLimitError, visibleCategories } from './rules';
import type { Project, RulePack } from './types';

describe('규정 팩 로더', () => {
  it('규정 DB 팩(국가연구개발비·팁스·예비창업패키지)과 예시 팩을 함께 제공한다', () => {
    expect(PACKS.map((pack) => pack.id).sort()).toEqual(['didimdol2026', 'legacy-rnd', 'nrd2026-forprofit', 'nrd2026-nonprofit', 'prestartup', 'prestartup2026', 'rnd-forprofit', 'rnd-govt', 'tips2026-deeptech', 'tips2026-general']);
  });

  it('규정 DB로 대체된 예시 팩은 새 과제 선택 목록에서 빠진다', () => {
    const selectable = selectablePacks().map((pack) => pack.id);
    expect(selectable).not.toContain('prestartup');   // 2026 공고 기반 prestartup2026으로 대체
    expect(selectable).not.toContain('legacy-rnd');
    expect(selectable).toContain('prestartup2026');
  });

  it('모든 팩의 비목·규칙에 출처(문서·조문 위치)가 있다', () => {
    for (const pack of PACKS) {
      // 규정DB 패키지에서 온 팩만 검증됨으로 표시된다 — 예시 팩은 여전히 검증 전이다.
      expect(pack.verified, pack.id).toBe(isRegulationDbPack(pack));
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
    // 편성 화면이 "총 사업비 1억 × 50%" 계산식을 그대로 보여줄 수 있어야 한다
    const personnelCap = capFor(pack, budgets, 100_000_000, 'personnel');
    expect(personnelCap?.basisAmount).toBe(100_000_000);
    expect(personnelCap?.limitPct).toBe(50);
    expect(personnelCap?.basisLabel).toBe('총 사업비');
  });

  // AI 추출 팩은 비목 ID가 문서 이름 기반(doc_0_인건비 등)이라 고정 ID(personnel 등)로는 기준 금액을 못 찾는다.
  const extractedStylePack = (categories: RulePack['categories'], rules: RulePack['rules']): RulePack => ({
    id: 'extracted-test', name: '테스트 공고', orgType: '', guideline: '테스트 공고', agency: '테스트',
    hasRatioLimits: true, verified: false, categories, rules, applicationDocs: [],
  });
  const src = { doc: '테스트 공고', ref: '사업비 기준', matchLevel: 'notice' };
  const cat = (id: string, name: string, draftRate: number): RulePack['categories'][number] => ({ id, name, allowed: true, draftRate, requiredDocs: [], source: src });

  it('AI 추출 팩(문서 기반 비목 ID)에서도 수정인건비 기준 상한이 인건비 이름 매칭으로 계산된다', () => {
    const pack = extractedStylePack(
      [cat('doc_0_인건비', '인건비', 40), cat('doc_1_연구수당', '연구수당', 10), cat('doc_2_간접비', '간접비', 10), cat('doc_3_위탁연구개발비', '위탁연구개발비', 40)],
      [
        { id: 'r1', kind: 'ratio', item: '연구수당', message: '연구수당은 수정인건비 합계의 20% 이내', limitPct: 20, basis: '수정인건비 합계', categoryIds: ['doc_1_연구수당'], source: src },
        { id: 'r2', kind: 'ratio', item: '간접비', message: '간접비는 직접비의 10% 이내', limitPct: 10, basis: '직접비(현물, 위탁연구개발비 제외)', categoryIds: ['doc_2_간접비'], source: src },
      ],
    );
    const budgets = [
      { categoryId: 'doc_0_인건비', amount: 40_000_000 }, { categoryId: 'doc_1_연구수당', amount: 5_000_000 },
      { categoryId: 'doc_2_간접비', amount: 10_000_000 }, { categoryId: 'doc_3_위탁연구개발비', amount: 20_000_000 },
    ];
    // 연구수당 상한 = 인건비(이름 매칭) 40,000,000의 20%
    expect(capFor(pack, budgets, 100_000_000, 'doc_1_연구수당')?.amount).toBe(8_000_000);
    // 간접비 상한 = (총 1억 - 간접비 1천만 - 위탁 2천만)의 10% — 현물 미전달 시
    expect(capFor(pack, budgets, 100_000_000, 'doc_2_간접비')?.amount).toBe(7_000_000);
    // "현물 제외" 기준이라 민간부담 현물 10,000,000을 추가 차감
    expect(capFor(pack, budgets, 100_000_000, 'doc_2_간접비', 10_000_000)?.amount).toBe(6_000_000);
  });

  it('비목에 연결되지 못한 공통 규칙도 비목 이름으로 재매칭해 상한을 계산한다', () => {
    // categoryIds가 비어 "과제 공통"으로 저장된 추출 규칙 — 예전에는 전 비목이 "제한 없음"이 됐다.
    const pack = extractedStylePack(
      [cat('doc_0_인건비', '인건비', 50), cat('doc_1_연구수당', '연구수당', 25), cat('doc_2_연구시설장비비', '연구시설.장비비', 25)],
      [
        { id: 'g1', kind: 'ratio', item: '연구수당', message: '연구수당은 수정인건비의 20% 이내', limitPct: 20, basis: '수정인건비', source: src },
        { id: 'g2', kind: 'ratio', item: '연구시설·장비비', message: '연구시설·장비비는 총 사업비의 30% 이내', limitPct: 30, basis: '총 사업비', source: src },
      ],
    );
    const budgets = [
      { categoryId: 'doc_0_인건비', amount: 50_000_000 }, { categoryId: 'doc_1_연구수당', amount: 5_000_000 }, { categoryId: 'doc_2_연구시설장비비', amount: 25_000_000 },
    ];
    expect(capFor(pack, budgets, 100_000_000, 'doc_1_연구수당')?.amount).toBe(10_000_000);
    // 중점(·)과 마침표(.) 표기 차이도 이름 매칭을 막지 않는다
    expect(capFor(pack, budgets, 100_000_000, 'doc_2_연구시설장비비')?.amount).toBe(30_000_000);
  });

  it('기준이 되는 이름의 비목이 팩에 없으면 상한을 0원으로 단정하지 않고 계산 불가(null)로 둔다', () => {
    const pack = extractedStylePack(
      [cat('doc_0_연구수당', '연구수당', 100)],
      [{ id: 'r1', kind: 'ratio', item: '연구수당', message: '연구수당은 수정인건비 합계의 20% 이내', limitPct: 20, basis: '수정인건비 합계', categoryIds: ['doc_0_연구수당'], source: src }],
    );
    const cap = capFor(pack, [{ categoryId: 'doc_0_연구수당', amount: 10_000_000 }], 100_000_000, 'doc_0_연구수당');
    expect(cap?.amount).toBeNull();
    expect(cap?.label).toContain('20%');
  });

  it('규정 DB에서 변환한 국가연구개발비 2026 팩의 연구수당·간접비·위탁 상한이 계산된다', () => {
    const pack = getPack('nrd2026-forprofit');
    const budgets = makeDraftBudgets(pack, 100_000_000); // 사용 비목 10개 균등 → 각 10,000,000
    // 연구수당 = 수정인건비(인건비 편성액 근사) 10,000,000의 20%
    expect(capFor(pack, budgets, 100_000_000, 'DIRECT_INCENTIVE')?.amount).toBe(2_000_000);
    // 간접비 = 수정직접비(총 1억 - 간접비 1천만 - 위탁 1천만)의 10%
    expect(capFor(pack, budgets, 100_000_000, 'INDIRECT')?.amount).toBe(8_000_000);
    // 위탁연구개발비 = 직접비(위탁 제외 근사)의 40%
    expect(capFor(pack, budgets, 100_000_000, 'DIRECT_SUBCONTRACT')?.amount).toBe(32_000_000);
    // 영리기관 팩에서 학생인건비·연구개발부담비는 편성 대상이 아니다
    expect(pack.categories.find((c) => c.id === 'DIRECT_STUDENT_LABOR')?.allowed).toBe(false);
    expect(getPack('nrd2026-nonprofit').categories.find((c) => c.id === 'DIRECT_STUDENT_LABOR')?.allowed).toBe(true);
  });

  it('TIPS 지침 팩: 연구수당·간접비·위탁 상한이 계산되고 현물 포함 기준은 현물을 차감하지 않는다', () => {
    const pack = getPack('tips2026-general');
    expect(pack.categories.filter((c) => c.allowed)).toHaveLength(7); // 직접비 6 + 간접비
    const budgets = makeDraftBudgets(pack, 70_000_000); // 균등 배분: 인건비 16% (11.2M), 나머지 14% (9.8M)
    // 연구수당 = 수정인건비(인건비 편성액) 11,200,000의 20%
    expect(capFor(pack, budgets, 70_000_000, 'DIRECT_INCENTIVE')?.amount).toBe(2_240_000);
    // 간접비 = 직접비(총 7천만 - 간접비 980만 - 위탁 980만 - 현물 500만)의 10% — "현물 부담액 제외" 기준
    expect(capFor(pack, budgets, 70_000_000, 'INDIRECT', 5_000_000)?.amount).toBe(4_540_000);
    // 위탁 = 직접비(현물 포함, 위탁 제외)의 40% — "현물 포함" 기준이라 현물을 차감하지 않는다
    expect(capFor(pack, budgets, 70_000_000, 'DIRECT_SUBCONTRACT', 5_000_000)?.amount).toBe(20_160_000);
    // 원문 인용이 규칙에 실려 미리보기 하이라이트 1순위로 쓰인다
    const incentiveRule = capFor(pack, budgets, 70_000_000, 'DIRECT_INCENTIVE')?.rule;
    expect(incentiveRule?.quote).toContain('수정인건비');
  });

  it('연구시설·장비비의 구입가 20% 상한은 현물 계상에만 걸리는 상한으로 표시된다', () => {
    // "부가세를 제외한 구입가의 20% 이내에서 현물로 계상할 수 있다" — 현물이 없으면 적용 자체가 안 되는 상한
    const tips = getPack('tips2026-general');
    const equipment = capFor(tips, makeDraftBudgets(tips, 70_000_000), 70_000_000, 'DIRECT_EQUIPMENT');
    expect(equipment?.inKindOnly).toBe(true);
    expect(equipment?.amount).toBeNull(); // 구입가는 편성표 밖 기준이라 금액으로 못 바꾼다
    const nrd = getPack('nrd2026-forprofit');
    expect(capFor(nrd, makeDraftBudgets(nrd, 100_000_000), 100_000_000, 'DIRECT_EQUIPMENT')?.inKindOnly).toBe(true);
    // "직접비(현물 부담액 제외)의 10%"는 현물을 기준에서 빼는 것일 뿐 현물 전용 상한이 아니다
    expect(capFor(tips, makeDraftBudgets(tips, 70_000_000), 70_000_000, 'INDIRECT')?.inKindOnly).toBe(false);
  });

  it('상한 기준이 자기 편성액에 따라 줄어드는 비목은 상한을 실제로 넘지 않는 금액에서 멈춘다', () => {
    // 간접비 상한 = 직접비(총사업비 − 간접비 − 위탁)의 10%.
    // 지금 상한 금액(8,500,000)까지 올리면 기준이 줄어 그 순간 상한 초과가 된다.
    const pack = getPack('nrd2026-forprofit');
    const budgets = makeDraftBudgets(pack, 100_000_000).map((item) =>
      item.categoryId === 'INDIRECT' ? { ...item, amount: 5_000_000 } : item);
    const free = 100_000_000 - budgets.reduce((sum, item) => sum + item.amount, 0);
    const limit = maxAmountWithinCap(pack, budgets, 100_000_000, 'INDIRECT', 5_000_000 + free);
    const after = budgets.map((item) => item.categoryId === 'INDIRECT' ? { ...item, amount: limit } : item);
    expect(capFor(pack, after, 100_000_000, 'INDIRECT')!.amount!).toBeGreaterThanOrEqual(limit);
    expect(limit).toBeLessThan(capFor(pack, budgets, 100_000_000, 'INDIRECT')!.amount!);
    // 상한이 자기 편성액과 무관한 비목은 잔액까지 그대로 쓸 수 있다 (총 사업비의 50%)
    const legacy = getPack('legacy-rnd');
    const legacyBudgets = makeDraftBudgets(legacy, 100_000_000).map((item) =>
      item.categoryId === 'personnel' ? { ...item, amount: 0 } : item);
    expect(maxAmountWithinCap(legacy, legacyBudgets, 100_000_000, 'personnel', 45_000_000)).toBe(45_000_000);
    expect(maxAmountWithinCap(legacy, legacyBudgets, 100_000_000, 'personnel', 60_000_000)).toBe(50_000_000);
    // 상한이 없는 팩은 잔액을 그대로 돌려준다
    const prestartup = getPack('prestartup');
    expect(maxAmountWithinCap(prestartup, makeDraftBudgets(prestartup, 100_000_000), 100_000_000, 'cat_personnel', 80_000_000)).toBe(80_000_000);
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

describe('계상 가능 세목 후보', () => {
  it('디딤돌 팩은 공고가 정한 세목에 국가연구개발사업 연구개발비 사용 기준의 세목을 이어 붙인다', () => {
    // 디딤돌 공고·지침은 주요 비목만 적고 나머지는 "국가연구개발사업 연구개발비 사용 기준에 따른다"고만 한다.
    const pack = getPack('didimdol2026');
    expect(pack.basePackId).toBe('nrd2026-forprofit');
    const choices = subItemChoicesFor(pack, 'DIRECT_ACTIVITY');
    expect(choices.own.map((c) => c.name)).toEqual(['외부 전문기술 활용비', '연구실운영비']);
    expect(choices.basePack?.id).toBe('nrd2026-forprofit');
    expect(choices.base.map((c) => c.name)).toEqual(expect.arrayContaining(['회의비', '출장비', '소프트웨어 활용비', '지식재산 창출 활동비']));
    // 공고가 이미 정한 세목은 상위 규정 목록에서 빠져 두 번 나오지 않는다
    expect(choices.base.map((c) => c.name)).not.toContain('외부 전문기술 활용비');
    // 인정 항목도 상위 규정에서 마저 가져온다 (공고에는 연구활동비 인정 항목이 4개뿐)
    const base = baseStandardFor(pack, 'DIRECT_ACTIVITY');
    expect(base?.pack.id).toBe('nrd2026-forprofit');
    expect((base?.category.allowedItems ?? []).length).toBeGreaterThan(10);
  });

  it('상위 규정을 따른다고 밝히지 않은 팩은 다른 사업의 세목을 끌어오지 않는다', () => {
    // 예비창업패키지는 비목 체계 자체가 국가 R&D와 달라, 이름이 비슷하다고 세목을 섞으면 안 된다.
    const pack = getPack('prestartup2026');
    expect(pack.basePackId).toBeUndefined();
    const choices = subItemChoicesFor(pack, 'PRE_MATERIAL');
    expect(choices.own.length).toBeGreaterThan(0);
    expect(choices.base).toEqual([]);
    expect(baseStandardFor(pack, 'PRE_MATERIAL')).toBeNull();
  });
});

describe('사업비 한도 대조', () => {
  const projectWith = (subsidyAmount: number, packId: string): Project => ({
    id: 'p1', name: '한도 테스트', totalBudget: subsidyAmount, subsidyAmount,
    startDate: '2026-01-01', endDate: '2026-12-31', settlementDeadline: '2027-01-31',
    agency: '중소벤처기업부', companyName: '테스트랩', packId,
    members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [],
    createdAt: new Date().toISOString(),
  });

  it('예비창업패키지 1단계 2천만원 한도를 입력 지원금과 견준다', () => {
    const pack = getPack('prestartup2026');
    const over = fundingCapChecks(pack, projectWith(30_000_000, 'prestartup2026'));
    expect(over).toHaveLength(1);
    expect(over[0].cap).toBe(20_000_000);
    expect(over[0].over).toBe(true);
    expect(over[0].diff).toBe(10_000_000);
    expect(over[0].targetLabel).toBe('지원금');

    const exact = fundingCapChecks(pack, projectWith(20_000_000, 'prestartup2026'));
    expect(exact[0].over).toBe(false);
    expect(exact[0].diff).toBe(0);

    // 적게 입력한 것도 알려줘야 한다 (공고 금액을 잘못 옮겨적은 경우)
    const under = fundingCapChecks(pack, projectWith(5_000_000, 'prestartup2026'));
    expect(under[0].over).toBe(false);
    expect(under[0].diff).toBe(-15_000_000);
  });

  it('창업성장기술개발(디딤돌)은 정부지원 2억 한도를 쓴다', () => {
    const checks = fundingCapChecks(getPack('didimdol2026'), projectWith(250_000_000, 'didimdol2026'));
    expect(checks).toHaveLength(1);
    expect(checks[0].cap).toBe(200_000_000);
    expect(checks[0].over).toBe(true);
  });

  it('TIPS는 트랙별 지원 한도를 쓰고, 운영사 투자금은 한도로 쓰지 않는다', () => {
    // 운영사 의무투자금 2억은 지원금 한도가 아니다 — 이걸 대조하면 오경고가 난다.
    const general = fundingCapChecks(getPack('tips2026-general'), projectWith(1_000_000_000, 'tips2026-general'));
    expect(general).toHaveLength(1);
    expect(general[0].cap).toBe(800_000_000);   // 일반트랙 8억
    expect(general[0].over).toBe(true);

    const deeptech = fundingCapChecks(getPack('tips2026-deeptech'), projectWith(1_000_000_000, 'tips2026-deeptech'));
    expect(deeptech).toHaveLength(1);
    expect(deeptech[0].cap).toBe(1_500_000_000); // 딥테크트랙 15억
    expect(deeptech[0].over).toBe(false);
  });

  it('금액 한도가 없는 사업은 아무것도 반환하지 않는다', () => {
    expect(fundingCapChecks(getPack('nrd2026-forprofit'), projectWith(100_000_000, 'nrd2026-forprofit'))).toEqual([]);
    expect(fundingCapChecks(getPack('legacy-rnd'), projectWith(100_000_000, 'legacy-rnd'))).toEqual([]);
  });
});

describe('사라진 규정 팩 감지', () => {
  const withPack = (packId: string): Project => ({
    id: 'p1', name: '팩 이동 테스트', totalBudget: 100_000_000,
    startDate: '2026-01-01', endDate: '2026-12-31', settlementDeadline: '2027-01-31',
    agency: '중소벤처기업부', companyName: '테스트랩', packId,
    members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [],
    createdAt: new Date().toISOString(),
  });

  it('갈라져 사라진 팩을 쓰는 과제를 찾아낸다', () => {
    // tips2026 은 일반/딥테크로 갈리면서 사라졌다
    expect(packIsMissing(withPack('tips2026'))).toBe(true);
    expect(packIsMissing(withPack('tips2026-general'))).toBe(false);
    expect(packIsMissing(withPack('nrd2026-forprofit'))).toBe(false);
  });

  it('갈라진 팩의 후보를 id 접두사로 찾아 제안한다', () => {
    expect(replacementPacksFor(withPack('tips2026')).map((pack) => pack.id).sort())
      .toEqual(['tips2026-deeptech', 'tips2026-general']);
    expect(replacementPacksFor(withPack('nrd2026')).map((pack) => pack.id).sort())
      .toEqual(['nrd2026-forprofit', 'nrd2026-nonprofit']);
  });

  it("packId 가 'registry:<uuid>' 라 접두사가 통하지 않으면 스냅샷의 지침명으로 찾는다", () => {
    // 규정DB에서 사업을 골라 만든 과제는 packId 가 uuid 라 id 로는 후보를 찾을 수 없다.
    const project = withPack('registry:8f3c1d20-0000-4000-8000-000000000000');
    project.customPack = { ...getPack('tips2026-general'), id: 'tips2026', name: '팁스(TIPS) R&D (2026 운영지침)' };
    expect(replacementPacksFor(project).map((pack) => pack.id).sort())
      .toEqual(['tips2026-deeptech', 'tips2026-general']);
  });

  it('단서가 없으면 후보를 만들지 않는다 (엉뚱한 규정을 권하면 안 된다)', () => {
    expect(replacementPacksFor(withPack('알수없는사업2026'))).toEqual([]);
  });
});

describe('재원 구성 비율 대조', () => {
  const proj = (over: Partial<Project>): Project => ({
    id: 'p1', name: '비율 테스트', totalBudget: 100_000_000, subsidyAmount: 100_000_000,
    startDate: '2026-01-01', endDate: '2026-12-31', settlementDeadline: '2027-01-31',
    agency: '중소벤처기업부', companyName: '테스트랩', packId: 'tips2026-general',
    members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [],
    createdAt: new Date().toISOString(), ...over,
  });

  it('TIPS 정부지원 75% 상한을 넘으면 잡아낸다', () => {
    const checks = fundingRateChecks(getPack('tips2026-general'), proj({ subsidyRate: 90, matchingCashRate: 10 }));
    const subsidy = checks.find((c) => c.role === 'subsidy_max')!;
    expect(subsidy.pct).toBe(75);
    expect(subsidy.entered).toBe(90);
    expect(subsidy.ok).toBe(false);
    // 기관부담 25% 이상도 함께 깨진다 (90% 지원이면 기관부담은 10%)
    expect(checks.find((c) => c.role === 'matching_min')!.ok).toBe(false);
  });

  it('규정을 지키는 입력은 모두 통과한다', () => {
    const checks = fundingRateChecks(getPack('tips2026-general'), proj({ subsidyRate: 75, matchingCashRate: 10 }));
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('민간부담 현금 비율을 아직 모르면 위반이 아니라 "확인 필요"로 둔다', () => {
    const checks = fundingRateChecks(getPack('tips2026-general'), proj({ subsidyRate: 75 }));
    const cash = checks.find((c) => c.role === 'matching_cash_min')!;
    expect(cash.unknown).toBe(true);
    expect(cash.ok).toBe(false);
    expect(cash.entered).toBeNull();
  });

  it('전액 지원(민간부담 0)이면 현금 비율 규정은 적용할 것이 없다', () => {
    const checks = fundingRateChecks(getPack('tips2026-general'), proj({ subsidyRate: 100 }));
    const cash = checks.find((c) => c.role === 'matching_cash_min')!;
    expect(cash.ok).toBe(true);
    expect(cash.unknown).toBe(false);
  });

  it('운영사 투자금처럼 앱이 입력받지 않는 재원은 대조 대상이 아니다', () => {
    const roles = fundingRateChecks(getPack('tips2026-general'), proj({ subsidyRate: 75, matchingCashRate: 10 })).map((c) => c.role);
    expect(roles).toEqual(['subsidy_max', 'matching_cash_min', 'matching_min']);
  });
});

describe('총사업비 변경 시 비목 재배분', () => {
  it('비율을 유지하고 합계를 새 총액에 정확히 맞춘다', () => {
    const budgets = [
      { categoryId: 'a', amount: 50_000_000 },
      { categoryId: 'b', amount: 30_000_000 },
      { categoryId: 'c', amount: 20_000_000 },
    ];
    const scaled = rescaleBudgets(budgets, 100_000_000, 20_000_000);
    expect(scaled.reduce((sum, item) => sum + item.amount, 0)).toBe(20_000_000);
    expect(scaled[0].amount).toBe(10_000_000); // 50% 유지
    expect(scaled[1].amount).toBe(6_000_000);  // 30% 유지
  });

  it('반올림 오차는 가장 큰 비목이 흡수해 합계가 어긋나지 않는다', () => {
    const budgets = [
      { categoryId: 'a', amount: 3_333_333 },
      { categoryId: 'b', amount: 3_333_333 },
      { categoryId: 'c', amount: 3_333_334 },
    ];
    const scaled = rescaleBudgets(budgets, 10_000_000, 7_000_000);
    expect(scaled.reduce((sum, item) => sum + item.amount, 0)).toBe(7_000_000);
    expect(scaled.every((item) => item.amount >= 0)).toBe(true);
  });

  it('현물·세목도 함께 옮기고 세목 합계가 비목 금액과 맞는다', () => {
    const budgets = [{
      categoryId: 'a', amount: 10_000_000, inKindAmount: 4_000_000,
      subItems: [{ id: 's1', name: '기술도입비', amount: 6_000_000 }, { id: 's2', name: '자문료', amount: 4_000_000 }],
    }];
    const [scaled] = rescaleBudgets(budgets, 10_000_000, 5_000_000);
    expect(scaled.amount).toBe(5_000_000);
    expect(scaled.inKindAmount).toBe(2_000_000);
    expect(scaled.subItems!.reduce((sum, sub) => sum + sub.amount, 0)).toBe(5_000_000);
  });

  it('편성이 없거나 기준 총액이 0이면 그대로 둔다 (비율을 구할 수 없다)', () => {
    expect(rescaleBudgets([], 100, 50)).toEqual([]);
    const zero = [{ categoryId: 'a', amount: 0 }];
    expect(rescaleBudgets(zero, 100_000_000, 20_000_000)).toEqual(zero);
  });
});

describe('공통 규정 기준 매칭 (팩에 기준이 없을 때)', () => {
  it('공고문 추출 팩의 비목 이름으로 규정 DB의 기준을 찾는다', () => {
    // AI 추출 팩이 흔히 쓰는 이름들 — 규정 체계의 비목·세부 비목에 대응된다
    expect(referenceStandardFor('기존 인력 인건비')?.category.name).toBe('인건비');
    expect(referenceStandardFor('신규채용 인건비')?.category.name).toBe('인건비');
    expect(referenceStandardFor('외부 전문기술 활용비')?.category.name).toBe('외부 전문기술 활용비');
    expect(referenceStandardFor('연구실운영비')?.category.name).toBe('연구실운영비');
    expect(referenceStandardFor('간접비')?.category.name).toBe('간접비');
  });

  it('찾은 기준에는 인정 항목과 근거 조항이 들어 있다', () => {
    const found = referenceStandardFor('외부 전문기술 활용비');
    expect(found?.category.allowedItems?.length).toBeGreaterThan(0);
    expect(found?.category.allowedItems?.[0].source.ref).toBeTruthy();
  });

  it('더 구체적인 이름이 뭉뚱그려지지 않는다 — 학생인건비는 인건비로 매칭되지 않는다', () => {
    expect(referenceStandardFor('학생인건비')?.category.name).toBe('학생인건비');
  });

  it('이미 그 규정 DB 팩을 쓰는 과제에는 같은 기준을 참고로 덧붙이지 않는다', () => {
    expect(referenceStandardFor('인건비', 'nrd2026-forprofit')?.pack.id).not.toBe('nrd2026-forprofit');
  });

  it('규정 체계에 없는 비목은 매칭하지 않는다', () => {
    expect(referenceStandardFor('광고선전비')).toBeNull();
    expect(referenceStandardFor('임차료')).toBeNull();
  });
});

describe('근거 조문 원문 찾기', () => {
  it('조문 번호로 규정 DB의 원문을 찾는다 (원본 파일 없이도 근거를 열 수 있어야 한다)', () => {
    const pack = getPack('nrd2026-forprofit');
    expect(pack.articles?.length).toBeGreaterThan(0);
    const found = articlesForRef(pack, '제6조');
    expect(found).toHaveLength(1);
    expect(found[0].ref).toBe('제6조');
    expect(found[0].text).toContain('인건비');
  });

  it('근거가 여러 조문을 묶어 쓰면 각각을 모두 찾는다', () => {
    const pack = getPack('nrd2026-forprofit');
    const found = articlesForRef(pack, '제27조제3항·제73조제1항제7호');
    expect(found.map((a) => a.ref)).toEqual(['제27조', '제73조']);
  });

  it('조문 번호 체계가 아닌 지침은 앞부분이 겹치는 조항으로 찾는다', () => {
    const pack = getPack('tips2026-general');
    const found = articlesForRef(pack, '지침 11.다.1) 인건비 가)');
    expect(found).toHaveLength(1);
    expect(found[0].ref).toBe('지침 11.다.1) 인건비');
  });

  it('맞는 조문이 없으면 빈 배열 — 엉뚱한 조문을 열지 않는다', () => {
    expect(articlesForRef(getPack('nrd2026-forprofit'), '제9999조')).toEqual([]);
    expect(articlesForRef(getPack('legacy-rnd'), '제6조')).toEqual([]);
  });
});

describe('기관 유형별 비목 적용 (규정 DB 적용조건)', () => {
  it('영리기관 팩에서는 기관 자격이 안 되는 비목만 편성 대상에서 빠진다', () => {
    const forProfit = getPack('nrd2026-forprofit');
    const names = (pack: typeof forProfit) => pack.categories.filter((c) => c.allowed).map((c) => c.name);
    expect(names(forProfit)).not.toContain('학생인건비');      // 대학 등 고시 기관 한정
    expect(names(forProfit)).not.toContain('연구개발부담비');  // 정부출연·직할기관 한정
    expect(names(forProfit)).toContain('인건비');
  });

  it('비영리기관 팩은 기관 한정 비목까지 모두 편성할 수 있다', () => {
    const nonProfit = getPack('nrd2026-nonprofit');
    const allowed = nonProfit.categories.filter((c) => c.allowed).map((c) => c.name);
    expect(allowed).toContain('학생인건비');
    expect(allowed).toContain('연구개발부담비');
    // "영리기관 현금 인건비 인정 필요"는 사용 조건일 뿐이라 비영리 팩의 인건비를 막으면 안 된다
    expect(allowed).toContain('인건비');
  });
});

describe('인건비 계산', () => {
  it('참여 개월 수는 양 끝 달을 포함하고, 잘못된 기간은 0이다', () => {
    expect(monthsBetween('2026-01-01', '2026-12-31')).toBe(12);
    expect(monthsBetween('2026-03-15', '2026-03-20')).toBe(1);
    expect(monthsBetween('2026-06-01', '2026-01-01')).toBe(0);
    expect(monthsBetween(undefined, '2026-12-31')).toBe(0);
  });

  it('4대보험·퇴직금·참여율·기간을 반영해 사업기간 합계 인건비를 계산한다', () => {
    const cost = laborCostFor(
      { id: 'p1', name: '김연구', projectRate: 50, externalRate: 0, monthlyPay: 3_000_000, laborInKind: 5_000_000 },
      { startDate: '2026-01-01', endDate: '2026-12-31', insuranceRate: 11 },
    );
    expect(cost.insurance).toBe(330_000);          // 월급여의 11%
    expect(cost.severance).toBe(250_000);          // 월급여의 1/12
    expect(cost.monthly).toBe(1_790_000);          // (300만+33만+25만) × 50%
    expect(cost.months).toBe(12);
    expect(cost.total).toBe(21_480_000);
    expect(cost.inKind).toBe(5_000_000);
    expect(cost.cash).toBe(16_480_000);
  });

  it('월급여 미입력이면 0원, 현물 계상액은 합계를 넘지 않는다', () => {
    const opts = { startDate: '2026-01-01', endDate: '2026-12-31' };
    expect(laborCostFor({ id: 'p1', name: '김', projectRate: 100, externalRate: 0 }, opts).total).toBe(0);
    const capped = laborCostFor({ id: 'p2', name: '이', projectRate: 100, externalRate: 0, monthlyPay: 1_000_000, laborInKind: 999_999_999 }, opts);
    expect(capped.inKind).toBe(capped.total);
    expect(capped.cash).toBe(0);
  });

  it('퇴직금은 개인 설정이 과제 기본값보다 우선한다 (1년 미만 근무자 제외)', () => {
    const opts = { startDate: '2026-01-01', endDate: '2026-12-31', insuranceRate: 11, includeSeverance: true };
    const base = { id: 'p1', name: '김연구', projectRate: 100, externalRate: 0, monthlyPay: 3_000_000 };
    // 과제 기본값(포함)을 개인이 해제하면 퇴직금이 빠진다
    expect(laborCostFor({ ...base, includeSeverance: false }, opts).severance).toBe(0);
    expect(laborCostFor(base, opts).severance).toBe(250_000);
    // 반대로 과제 기본값이 해제여도 개인이 켜면 계상된다
    const offByDefault = { ...opts, includeSeverance: false };
    expect(laborCostFor(base, offByDefault).severance).toBe(0);
    expect(laborCostFor({ ...base, includeSeverance: true }, offByDefault).severance).toBe(250_000);
  });

  it('계상 구분: 현물(전액)은 합계가 모두 현물, 현금(전액)은 현물 입력이 있어도 0이다', () => {
    const opts = { startDate: '2026-01-01', endDate: '2026-12-31' };
    const inkind = laborCostFor({ id: 'p1', name: '홍길동', projectRate: 30, externalRate: 0, monthlyPay: 2_000_000, laborFunding: 'inkind' }, opts);
    expect(inkind.total).toBeGreaterThan(0);
    expect(inkind.inKind).toBe(inkind.total);
    expect(inkind.cash).toBe(0);
    const cash = laborCostFor({ id: 'p2', name: '김', projectRate: 100, externalRate: 0, monthlyPay: 2_000_000, laborFunding: 'cash', laborInKind: 5_000_000 }, opts);
    expect(cash.inKind).toBe(0);
    expect(cash.cash).toBe(cash.total);
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

describe('예산편성 비목의 출처', () => {
  const project = (overrides: Partial<Project>): Project => ({
    id: 'p1', name: '테스트', totalBudget: 100_000_000, startDate: '2026-01-01', endDate: '2026-12-31',
    settlementDeadline: '2027-01-31', agency: '', companyName: '', packId: 'didimdol2026',
    members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [],
    createdAt: '2026-01-01', ...overrides,
  });

  const extractedPack: RulePack = {
    id: 'extracted-1', name: '추출 팩', orgType: '', guideline: '업로드 문서 기준', agency: '',
    origin: 'extracted', hasRatioLimits: false, verified: false,
    categories: [{ id: 'x', name: '엉뚱한 비목', allowed: true, draftRate: 100, requiredDocs: [], source: { doc: 'd', ref: 'r', matchLevel: 'notice' } }],
    rules: [], applicationDocs: [],
  };

  it('규정DB 팩을 쓰는 과제는 AI 추출 팩이 있어도 규정DB 비목을 쓴다', () => {
    const pack = packFor(project({ packId: 'didimdol2026', customPack: extractedPack }));
    expect(pack.id).toBe('didimdol2026');
    expect(pack.categories.map((c) => c.name)).not.toContain('엉뚱한 비목');
  });

  it('대응하는 규정DB가 없는 사업은 추출 팩이 비목의 출처가 된다', () => {
    const pack = packFor(project({ packId: 'extracted-1', customPack: extractedPack }));
    expect(pack.id).toBe('extracted-1');
    expect(isRegulationDbPack(pack)).toBe(false);
  });

  it('오버레이는 같은 id의 규칙을 대체하고 비목은 그대로 둔다', () => {
    const base = getPack('didimdol2026');
    const target = base.rules.find((rule) => rule.kind === 'ratio')!;
    const merged = applyOverlay(base, {
      basePackId: base.id, appliedAt: '2026-07-22', sourceDocTitles: [],
      rules: [{ ...target, id: target.id, limitPct: 55, message: '최신 공고 기준 55%' }],
    });
    expect(merged.categories).toEqual(base.categories);
    expect(merged.rules.filter((rule) => rule.id === target.id)).toHaveLength(1);
    expect(merged.rules.find((rule) => rule.id === target.id)!.limitPct).toBe(55);
  });

  it('기준 팩이 바뀐 오버레이는 적용하지 않는다', () => {
    const overlayRule = { id: 'o1', kind: 'warning' as const, message: '다른 팩에서 만든 규칙', source: { doc: 'd', ref: 'r', matchLevel: 'notice' } };
    const applied = packFor(project({ packId: 'didimdol2026', packOverlay: { basePackId: 'tips2026', appliedAt: '2026-07-22', sourceDocTitles: [], rules: [overlayRule] } }));
    expect(applied.rules.some((rule) => rule.id === 'o1')).toBe(false);
  });

  it('규정DB 팩만 검증됨으로 표시된다', () => {
    expect(isRegulationDbPack(getPack('didimdol2026'))).toBe(true);
    expect(isRegulationDbPack(getPack('legacy-rnd'))).toBe(false);
  });
});
