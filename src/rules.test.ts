import { describe, expect, it } from 'vitest';
import { applyOverlay, articlesForRef, baseStandardFor, basisFormula, budgetBases, capFor, evidenceGuide, categoryOf, fundingCapChecks, maxAmountWithinCap, subItemChoicesFor, fundingRateChecks, packIsMissing, parseEvidenceText, evidenceChecklistFor, primaryEvidence, spendingCautions, subItemStandardFor, warningsFor, withAlwaysRequired, replacementPacksFor, rescaleBudgets, selectablePacks, documentsFor, getPack, globalRules, isRegulationDbPack, laborCostFor, makeDraftBudgets, monthsBetween, packFor, PACKS, referenceStandardFor, rulesFor, transferLimitError, visibleCategories, crossPackEvidence } from './rules';
import type { Project, RulePack } from './types';

describe('규정 팩 로더', () => {
  it('규정 DB 팩(국가연구개발비·팁스·예비창업패키지)과 예시 팩을 함께 제공한다', () => {
    expect(PACKS.map((pack) => pack.id).sort()).toEqual(['didimdol-global2026', 'didimdol2026', 'legacy-rnd', 'nrd2026-forprofit', 'nrd2026-nonprofit', 'prestartup', 'prestartup2026', 'rnd-forprofit', 'rnd-govt', 'tips2026-deeptech', 'tips2026-general']);
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
    // 간접비 = 수정직접비(총 1억 - 간접비 1천만 - 위탁 1천만 - 국제공동 1천만)의 10%
    // 기준 문구가 빼라고 한 비목을 모두 뺀다 — 국제공동·부담비를 빼지 않으면 상한이 규정보다 높게 잡힌다.
    expect(capFor(pack, budgets, 100_000_000, 'INDIRECT')?.amount).toBe(7_000_000);
    // 위탁연구개발비 = 직접비(위탁·국제공동·부담비 제외)의 40%
    expect(capFor(pack, budgets, 100_000_000, 'DIRECT_SUBCONTRACT')?.amount).toBe(28_000_000);
    // 같은 "직접비"라도 무엇을 빼느냐에 따라 기준 금액이 다르다 — 이름에 그 차이가 남아야 한다.
    expect(capFor(pack, budgets, 100_000_000, 'DIRECT_SUBCONTRACT')?.basisLabel).toBe('직접비(위탁·국제공동·부담비 제외)');
    expect(capFor(pack, budgets, 100_000_000, 'INDIRECT')?.basisLabel).toBe('수정직접비(현물·위탁·국제공동·부담비 제외)');
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

  it('세부항목 기준 상한도 금액은 알려주되 비목 전체의 상한으로 강제하지 않는다', () => {
    // "외부 전문기술 활용비는 직접비의 40%" — 연구활동비 전체가 아니라 그 안의 세목에 걸리는 상한이다.
    const pack = getPack('tips2026-general');
    const budgets = makeDraftBudgets(pack, 70_000_000);
    const cap = capFor(pack, budgets, 70_000_000, 'DIRECT_ACTIVITY');
    expect(cap?.partial).toBe(true);
    expect(cap?.rule.item).toBe('외부 전문기술 활용비');
    expect(cap?.amount).toBeNull();                                  // 비목 전체를 묶지 않는다
    expect(cap?.referenceAmount).toBe(24_080_000);                   // 직접비 60,200,000 × 40%
    expect(cap?.basisAmount).toBe(60_200_000);
    // 그래서 편성 금액을 이 값 위로 올려도 막지 않는다 (막대바도 잔액까지 그대로 열린다)
    expect(maxAmountWithinCap(pack, budgets, 70_000_000, 'DIRECT_ACTIVITY', 40_000_000)).toBe(40_000_000);
    // 기준 금액이 어떻게 나왔는지도 함께 준다
    expect(basisFormula(cap!.basisParts)).toBe('총 사업비 70,000,000원 − 간접비 9,800,000원');
  });

  it('기준 금액을 한자리에 모아 보여준다 — 같은 "직접비"라도 빼는 것이 다르면 따로 세운다', () => {
    // 위탁 상한의 직접비와 간접비 상한의 직접비는 금액이 다른데, 이름만 "직접비"로 줄이면
    // 편성표에 같은 이름이 다른 금액으로 나란히 서서 무엇이 맞는지 알 수 없었다.
    const pack = getPack('tips2026-general');
    const budgets = makeDraftBudgets(pack, 70_000_000);
    const bases = budgetBases(pack, budgets, 70_000_000, 5_000_000);
    const byLabel = new Map(bases.map((basis) => [basis.label, basis]));
    expect(byLabel.get('직접비(현물·위탁 제외)')?.amount).toBe(45_400_000);   // 간접비 상한의 기준
    expect(byLabel.get('직접비(위탁 제외)')?.amount).toBe(50_400_000);        // 위탁 상한의 기준 (현물 포함)
    expect(byLabel.get('수정인건비 합계')?.amount).toBe(11_200_000);          // 연구수당 상한의 기준
    expect(byLabel.get('직접비(현물·위탁 제외)')?.categories).toEqual(['간접비']);
    // 구입가처럼 편성표 밖 기준은 금액을 낼 수 없어 여기 세우지 않는다
    expect(bases.some((basis) => /구입가/.test(basis.label))).toBe(false);
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

describe('집행 증빙 안내', () => {
  it('앱 예시 기본값과 규정DB 증빙을 섞지 않고 나눠서 준다', () => {
    const pack = getPack('nrd2026-forprofit');
    const guide = evidenceGuide(pack, categoryOf(pack, 'DIRECT_ACTIVITY'), 'card');
    // 앱이 넣어둔 예시 기본값 — 카드 결제라 영수증이 카드 영수증으로 바뀐다
    expect(guide.template).toEqual(['내부품의서', '결과보고서', '카드 영수증']);
    // 규정DB 증빙 규칙은 조건이 갈리는 것까지 그대로 (자동으로 합치면 서로 어긋난다)
    expect(guide.rules.map((rule) => rule.name)).toContain('10만원 초과 회의비 기본 증빙');
    expect(guide.rules.map((rule) => rule.name)).toContain('10만원 이하 회의비 간소화 증빙');
    expect(guide.guideline).toContain('국가연구개발사업 연구개발비 사용 기준');
  });

  it('팁스 지침의 비목별 증빙서류 표가 인정 항목마다 실린다', () => {
    const pack = getPack('tips2026-general');
    const activity = evidenceGuide(pack, categoryOf(pack, 'DIRECT_ACTIVITY'), 'card');
    expect(activity.items).toHaveLength(14);
    expect(activity.items.find((item) => item.name === '회의 다과·식비')?.evidence).toContain('10만원 이하');
    expect(activity.items.find((item) => item.name === '국내외 출장비')?.evidence).toContain('출장결과보고서');
    // 인건비·간접비까지 표가 덮는 세목은 모두 채워졌다
    expect(evidenceGuide(pack, categoryOf(pack, 'DIRECT_LABOR'), 'card').items).toHaveLength(4);
    expect(evidenceGuide(pack, categoryOf(pack, 'INDIRECT'), 'card').items).toHaveLength(10);
    // 인건비 증빙은 표가 나눈 대로 내부·외부로 갈려 있다 (참여연구자 급여 같은 '비용의 종류'에는
    // 표에 자기 줄이 없어서, 둘을 뭉뚱그려 달면 어느 세목을 골라도 남의 서류가 딸려온다)
    const labor = evidenceGuide(pack, categoryOf(pack, 'DIRECT_LABOR'), 'card');
    expect(labor.items.find((item) => item.name === '외부 인건비')?.evidence).toContain('외부참여연구자 소속 기관장 확인서');
    expect(labor.items.find((item) => item.name === '내부 인건비')?.evidence).not.toContain('외부참여연구자');
    // 증빙 표는 비목 정의와 다른 절에 있어 근거를 따로 단다
    const item = pack.categories.find((c) => c.id === 'DIRECT_LABOR')?.allowedItems?.find((entry) => entry.evidence);
    expect(item?.evidenceSource?.ref).toBe('지침 11.다.1) 비목별 증빙서류');
  });
});

describe('디딤돌 증빙 (상위 규정 상속)', () => {
  it('공고가 정하지 않은 증빙은 국가연구개발비 사용 기준에서 물려받는다', () => {
    // 디딤돌 관리지침은 "공통지침에 따라 운영함을 원칙"이라 증빙 표가 없다.
    const pack = getPack('didimdol2026');
    const guide = evidenceGuide(pack, categoryOf(pack, 'DIRECT_ACTIVITY'), 'card');
    expect(guide.base?.guideline).toContain('국가연구개발사업 연구개발비 사용 기준');
    expect(guide.base?.rules.map((rule) => rule.name)).toContain('10만원 초과 회의비 기본 증빙');
    expect(guide.base?.items.length).toBeGreaterThan(10);
    // 이 사업이 따로 정한 것은 그대로 남고, 상위 규정 쪽에서 중복되지 않는다
    const own = evidenceGuide(pack, categoryOf(pack, 'DIRECT_ACTIVITY'), 'card').rules.map((rule) => rule.name);
    expect(guide.base?.rules.every((rule) => !own.includes(rule.name))).toBe(true);
  });

  it('상위 규정을 밝히지 않은 팩은 자기 증빙만 쓴다', () => {
    const pack = getPack('prestartup2026');
    expect(evidenceGuide(pack, categoryOf(pack, 'PRE_FEE'), 'card').base).toBeUndefined();
  });
});

describe('증빙 기준 하나만 고르기', () => {
  it('이 사업 규정 > 상위 규정 > 앱 기본 예시 순으로 하나만 고른다', () => {
    // 1순위 — 팁스는 자기 지침에 증빙이 있으니 상위 규정도 앱 예시도 쓰지 않는다
    const tips = getPack('tips2026-general');
    const own = primaryEvidence(evidenceGuide(tips, categoryOf(tips, 'DIRECT_LABOR'), 'card'));
    expect(own.kind).toBe('pack');
    expect(own.guideline).toContain('팁스');
    expect(own.template).toEqual([]);

    // 2순위 — 예시 팩은 자기 증빙이 없어 공통 규정 기준을 따른다. 앱 기본 예시가 있어도 상위 규정이 이긴다.
    const legacy = getPack('legacy-rnd');
    const guide = evidenceGuide(legacy, categoryOf(legacy, 'meeting'), 'card');
    expect(guide.template).toContain('회의록');
    const inherited = primaryEvidence(guide);
    expect(inherited.kind).toBe('base');
    expect(inherited.guideline).toContain('국가연구개발사업 연구개발비 사용 기준');
    expect(inherited.template).toEqual([]);

    // 3순위 — 규정DB에 아무것도 없을 때만 앱 기본 예시를 쓴다
    const bare = primaryEvidence({ template: ['내부품의서', '카드 영수증'], rules: [], items: [] });
    expect(bare.kind).toBe('template');
    expect(bare.template).toEqual(['내부품의서', '카드 영수증']);
  });

  it('품의서·지출결의서는 어느 기준이든 항상 들어가고 겹치면 넣지 않는다', () => {
    expect(withAlwaysRequired(['국외출장계획서'])).toEqual(['품의서', '지출결의서', '국외출장계획서']);
    // '내부품의서'가 이미 품의서 역할을 하므로 '품의서'를 또 넣지 않는다
    expect(withAlwaysRequired(['내부품의서', '카드 영수증'])).toEqual(['지출결의서', '내부품의서', '카드 영수증']);
    expect(withAlwaysRequired(['지출결의서', '지출결의서'])).toEqual(['품의서', '지출결의서']);
  });
});

describe('세목별 증빙 체크리스트', () => {
  const listFor = (packId: string, categoryId: string, subItemName?: string) => {
    const pack = getPack(packId);
    const standard = subItemName ? subItemStandardFor(pack, subItemName) : null;
    const guide = standard ? evidenceGuide(standard.pack, standard.category, 'card') : evidenceGuide(pack, categoryOf(pack, categoryId), 'card');
    return evidenceChecklistFor(pack, categoryId, subItemName, standard?.category, primaryEvidence(guide).rules, standard?.pack ?? pack);
  };

  it('규정 문구를 조건별 묶음과 서류 단위로 쪼갠다', () => {
    const list = listFor('tips2026-general', 'DIRECT_ACTIVITY', '출장비');
    expect(list.groups.map((group) => group.condition))
      .toEqual(['항상 필요', '국내(여비기준 있음)', '국내(여비기준 없음)', '국외']);
    expect(list.groups[1].documents).toEqual(['내부여비규정', '출장신청서', '계좌이체증명', '출장지 카드매출전표']);
  });

  it('출장신청서가 있으면 품의서를 따로 요구하지 않는다', () => {
    const travel = listFor('tips2026-general', 'DIRECT_ACTIVITY', '출장비');
    expect(travel.documents).toContain('지출결의서');
    expect(travel.documents).not.toContain('품의서');
    // 승인 문서가 없는 인건비에는 그대로 들어간다
    expect(listFor('tips2026-general', 'DIRECT_LABOR', '내부 인건비 (기존)').documents).toContain('품의서');
  });

  it('모든 비목에 똑같이 붙은 규칙은 넣지 않는다', () => {
    // '연구장비 실물 사진'이 인건비 체크리스트에 딸려 나오던 문제
    const labor = listFor('tips2026-general', 'DIRECT_LABOR', '내부 인건비 (기존)');
    expect(labor.documents).not.toContain('연구장비 실물 사진');
    expect(labor.documents.join()).not.toContain('전자세금계산서');
    expect(labor.documents).toContain('급여명세서(월별)');
  });

  it('세목에 증빙이 없으면 비목 것으로 내려받는다 — 세목이 다 비어 있을 때만', () => {
    // 팁스 인건비 세목은 모두 비어 있어 비목 증빙이 곧 그 세목의 증빙이다
    expect(listFor('tips2026-general', 'DIRECT_LABOR', '내부 인건비 (기존)').documents.length).toBeGreaterThan(5);
  });

  it('형제 세목이 자기 증빙을 가진 비목은 비목 증빙을 내려받지 않는다', () => {
    // 연구활동비 증빙은 회의비·출장비 등으로 나뉘어 있다 — 클라우드 활용비를 골랐는데
    // 출장·회의 증빙까지 딸려오면 안 된다
    const cloud = listFor('nrd2026-forprofit', 'DIRECT_ACTIVITY', '클라우드컴퓨팅서비스 활용비');
    expect(cloud.documents.join()).not.toContain('출장');
    expect(cloud.documents.join()).not.toContain('회의');
    expect(cloud.groups.every((group) => group.condition === '항상 필요')).toBe(true);
    // 자기 증빙이 있는 세목은 그대로 나온다
    expect(listFor('nrd2026-forprofit', 'DIRECT_ACTIVITY', '회의비').documents.length).toBeGreaterThan(2);
  });

  it('같은 서류를 증빙 규칙과 항목별 증빙이 겹쳐 적어도 한 번만 담는다', () => {
    const meeting = listFor('tips2026-general', 'DIRECT_ACTIVITY', '회의비');
    expect(new Set(meeting.documents).size).toBe(meeting.documents.length);
  });
});

describe('증빙 문구 쪼개기', () => {
  it('조건이 앞에 붙은 문장을 조건과 서류로 나눈다', () => {
    expect(parseEvidenceText('내부여비규정, 출장신청서. 국외: 출장계획서, 계좌이체증명')).toEqual([
      { documents: ['내부여비규정', '출장신청서'] },
      { condition: '국외', documents: ['출장계획서', '계좌이체증명'] },
    ]);
  });

  it("'또는'을 조건으로 잘못 읽지 않는다", () => {
    const groups = parseEvidenceText('카드매출전표 또는 계좌이체증명, 거래명세서');
    expect(groups).toEqual([{ documents: ['카드매출전표 또는 계좌이체증명', '거래명세서'] }]);
  });

  it("'…로 대신할 수 있음' 같은 설명은 서류로 담지 않는다", () => {
    expect(parseEvidenceText('별도 증명자료로 대신할 수 있음')).toEqual([]);
  });

  it('빈 문구는 빈 배열이다', () => {
    expect(parseEvidenceText('')).toEqual([]);
  });
});

describe('계상 가능 세목의 설명', () => {
  it('세목이 자기 인정 항목을 갖고 있으면 설명으로 붙인다', () => {
    // 비목의 인정 항목(연구활동비 71건)은 세목별 항목을 평평하게 합친 것이라 그대로 나열하면 못 읽는다
    const pack = getPack('nrd2026-forprofit');
    const choices = subItemChoicesFor(pack, 'DIRECT_ACTIVITY');
    const meeting = choices.own.find((choice) => choice.name === '회의비')!;
    expect(meeting.items).toEqual(['회의장 임차료', '속기료', '통역료', '회의·세미나 개최비', '회의 식비']);
    const travel = choices.own.find((choice) => choice.name === '출장비')!;
    expect(travel.items).toContain('국내출장 교통비');
    expect(travel.items).toHaveLength(9);
  });

  it('세목별 항목을 모두 합치면 비목의 인정 항목 수와 같다', () => {
    // 둘이 같은 데이터임을 못박아 둔다 — 하나가 늘면 다른 하나도 늘어야 한다
    const pack = getPack('nrd2026-forprofit');
    const category = pack.categories.find((c) => c.id === 'DIRECT_ACTIVITY')!;
    const choices = subItemChoicesFor(pack, 'DIRECT_ACTIVITY');
    const total = choices.own.reduce((sum, choice) => sum + (choice.items?.length ?? 0), 0);
    expect(total).toBe(category.allowedItems!.length);
  });

  it('세목이 곧 인정 항목인 비목은 설명을 만들지 않는다', () => {
    // 인건비의 세목(참여연구자 급여 등)은 같은 이름의 비목이 따로 없다 — 자기 자신을 설명으로 물면 안 된다
    const pack = getPack('nrd2026-forprofit');
    const choices = subItemChoicesFor(pack, 'DIRECT_LABOR');
    expect(choices.own.every((choice) => !choice.items)).toBe(true);
    expect(choices.own.map((choice) => choice.name)).toContain('참여연구자 급여');
  });
});

describe('세목의 규정 기준 찾기', () => {
  it('세목 이름이 세부 비목에 있으면 그 기준을 준다', () => {
    const pack = getPack('nrd2026-forprofit');
    const meeting = subItemStandardFor(pack, '회의비')!;
    expect(meeting.category.id).toBe('ACTIVITY_MEETING');
    expect(meeting.category.evidenceRules?.map((rule) => rule.name)).toContain('10만원 초과 회의비 기본 증빙');

    const travel = subItemStandardFor(pack, '출장비')!;
    expect(travel.category.evidenceRules?.map((rule) => rule.name)).toContain('국외출장 집행 전 출장계획서 구비');
  });

  it('세목 이름이 인정 항목 수준이면 그것을 품은 세목을 찾는다', () => {
    // subItemOptions가 없는 팩은 allowedItems가 세목 후보가 된다 — '회의 식비'로 편성될 수 있다
    const pack = getPack('nrd2026-forprofit');
    expect(subItemStandardFor(pack, '회의 식비')?.category.name).toBe('회의비');
    expect(subItemStandardFor(pack, '국내출장 교통비')?.category.name).toBe('출장비');
  });

  it('상위 규정을 밝힌 팩은 상위 규정에서도 찾는다', () => {
    // 디딤돌은 basePackId가 국가연구개발비 팩이다
    const didimdol = getPack('didimdol2026');
    const found = subItemStandardFor(didimdol, '회의비')!;
    expect(found.category.name).toBe('회의비');
    expect(found.category.evidenceRules?.length).toBeGreaterThan(0);
  });

  it('이름이 너무 짧거나 어디에도 없으면 null이다', () => {
    const pack = getPack('nrd2026-forprofit');
    expect(subItemStandardFor(pack, 'ㅇ')).toBeNull();
    expect(subItemStandardFor(pack, '존재하지 않는 세목 이름')).toBeNull();
  });
});

describe('세목별 유의사항 거르기', () => {
  it('세목을 고르면 그 세목 유의사항만 남는다', () => {
    const pack = getPack('tips2026-general');
    const all = warningsFor(pack, 'DIRECT_ACTIVITY');
    expect(all.length).toBeGreaterThan(5);   // 연구활동비 전체 주의사항

    const travel = warningsFor(pack, 'DIRECT_ACTIVITY', '출장비', subItemStandardFor(pack, '출장비')?.category);
    expect(travel.map((rule) => rule.message).join()).toContain('출장비는');
    // 회의 다과·식비, 야근 식대 같은 다른 세목 규칙은 빠진다
    expect(travel.map((rule) => rule.message).join()).not.toContain('회의 다과');
    expect(travel.map((rule) => rule.message).join()).not.toContain('야근');
    expect(travel.length).toBeLessThan(all.length);
  });

  it('띄어쓰기가 달라도 같은 세목으로 본다', () => {
    // 규칙은 '연구실 운영비', 세부 비목은 '연구실운영비'로 적혀 있다
    const pack = getPack('tips2026-general');
    const lab = warningsFor(pack, 'DIRECT_ACTIVITY', '연구실운영비', subItemStandardFor(pack, '연구실운영비')?.category);
    expect(lab.map((rule) => rule.message).join()).toContain('소모성 비용');
  });

  it('세목이 한 단계 아래 이름으로 적힌 규칙도 그 세목에 붙인다', () => {
    // 규칙의 item이 인정 항목 수준일 수 있다 — 출장비의 인정 항목이면 출장비에 나와야 한다
    const pack = getPack('nrd2026-forprofit');
    const travel = warningsFor(pack, 'DIRECT_ACTIVITY', '출장비', subItemStandardFor(pack, '출장비')?.category);
    expect(travel.every((rule) => !rule.item || /출장/.test(rule.item))).toBe(true);
    expect(travel.length).toBeGreaterThan(0);
  });

  it('비목 전체에 걸리는 규칙(item 없음)은 어느 세목에서나 남는다', () => {
    const pack = getPack('nrd2026-forprofit');
    const noItem = rulesFor(pack, 'DIRECT_ACTIVITY', 'warning').filter((rule) => !rule.item);
    const travel = warningsFor(pack, 'DIRECT_ACTIVITY', '출장비', subItemStandardFor(pack, '출장비')?.category);
    for (const rule of noItem) expect(travel).toContain(rule);
  });

  it('세목을 고르지 않으면 비목의 유의사항을 모두 준다', () => {
    const pack = getPack('nrd2026-forprofit');
    expect(warningsFor(pack, 'DIRECT_ACTIVITY')).toEqual(rulesFor(pack, 'DIRECT_ACTIVITY', 'warning'));
  });
});

describe('집행 시 유의사항 (주의 + 사전승인 + 상위 규정)', () => {
  const textOf = (items: { title: string; detail?: string }[]) => items.map((item) => `${item.title} ${item.detail ?? ''}`).join('\n');

  it('공고가 정하지 않은 주의사항을 상위 규정에서 이어받는다', () => {
    // 디딤돌 연구활동비는 자기 주의사항이 몇 건뿐이고 나머지는 국가연구개발비 사용 기준을 따른다
    const cautions = spendingCautions(getPack('didimdol2026'), 'DIRECT_ACTIVITY');
    expect(cautions.items.length).toBeGreaterThan(0);
    expect(cautions.inheritedGuideline).toContain('국가연구개발사업 연구개발비 사용 기준');
    expect(cautions.inherited.length).toBeGreaterThan(10);
    expect(cautions.total).toBe(cautions.items.length + cautions.inherited.length);
  });

  it('사전승인 절차를 이 사업 것과 상위 규정 것 모두 준다', () => {
    const cautions = spendingCautions(getPack('didimdol2026'), 'DIRECT_ACTIVITY');
    expect(cautions.items.some((item) => item.kind === 'approval')).toBe(true);
    expect(cautions.inherited.some((item) => item.kind === 'approval')).toBe(true);
  });

  it('같은 조항이 승인과 주의 양쪽에 실려 있으면 한 건으로 합치고 설명을 붙인다', () => {
    // '연구실운영비 평가위원회 승인'(승인)과 '영리기관이 연구실운영비를…'(주의)은 근거가 같다
    const cautions = spendingCautions(getPack('didimdol2026'), 'DIRECT_ACTIVITY');
    const lab = cautions.items.filter((item) => /연구실운영비/.test(item.title) || /연구실운영비/.test(item.detail ?? ''));
    expect(lab).toHaveLength(1);
    expect(lab[0].kind).toBe('approval');
    expect(lab[0].status).toBe('전문기관 인정 필요');
    // "인정 필요"만으로는 무엇을 해야 하는지 알 수 없다 — 같은 조항의 설명을 함께 싣는다
    expect(lab[0].detail).toContain('평가위원회 승인');
  });

  it('근거를 순서만 바꿔 적은 같은 조항은 한 건으로 합친다', () => {
    // '붙임2-5 주요 연구개발비 산정기준·관리지침 바.2)' 와 '관리지침 바.2)·붙임2-5' 는 같은 조항이다
    const cautions = spendingCautions(getPack('didimdol2026'), 'DIRECT_ACTIVITY');
    const required = cautions.items.filter((item) => /200만원/.test(`${item.title}${item.detail ?? ''}`));
    expect(required).toHaveLength(1);
    // 합칠 때는 더 자세한 쪽을 남긴다 — 해약 가능성까지 적힌 문구
    expect(`${required[0].title}${required[0].detail ?? ''}`).toContain('해약');
  });

  it('근거조항이 다르면 내용이 비슷해도 남긴다', () => {
    // 관리지침 아.4)와 사.3) 다)는 각각 다른 의무다 — 비슷하다고 지우면 누락이 된다
    const cautions = spendingCautions(getPack('didimdol2026'), 'DIRECT_ACTIVITY');
    const refs = cautions.items.map((item) => item.ref.replace(/\s/g, ''));
    expect(refs.some((ref) => ref.includes('아.4)'))).toBe(true);
    expect(refs.some((ref) => ref.includes('사.3)다)'))).toBe(true);
  });

  it('한 화면에 같은 근거조항이 두 번 나오지 않는다', () => {
    for (const packId of ['didimdol2026', 'tips2026-general', 'nrd2026-forprofit']) {
      const pack = getPack(packId);
      for (const category of pack.categories.filter((c) => c.allowed)) {
        const cautions = spendingCautions(pack, category.id);
        const refs = [...cautions.items, ...cautions.inherited].map((item) => item.ref.replace(/\s/g, ''));
        expect(new Set(refs).size, `${packId}/${category.name}`).toBe(refs.length);
      }
    }
  });

  it('이 사업이 따로 정한 것은 상위 규정 쪽에서 빼 두 번 나오지 않는다', () => {
    const cautions = spendingCautions(getPack('didimdol2026'), 'DIRECT_LABOR');
    const own = new Set(cautions.items.map((item) => item.title));
    expect(cautions.inherited.every((item) => !own.has(item.title))).toBe(true);
  });

  it('세목을 고르면 다른 세목의 승인 항목은 빠진다', () => {
    // 승인 항목에는 세목이 적혀 있지 않아, 출장비를 골라도 회의비 승인이 그대로 따라 나왔다.
    // '외부인 참석 회의만 식비 계상'(지침 11.다.1) 연구활동비 마)②)은 같은 조항의 주의사항이 회의비다.
    const pack = getPack('tips2026-general');
    const travel = spendingCautions(pack, 'DIRECT_ACTIVITY', '출장비', subItemStandardFor(pack, '출장비')?.category);
    expect(travel.items.map((item) => item.title).join()).not.toContain('회의');
    const meeting = spendingCautions(pack, 'DIRECT_ACTIVITY', '회의비', subItemStandardFor(pack, '회의비')?.category);
    expect(meeting.items.some((item) => item.kind === 'approval' && item.title.includes('회의'))).toBe(true);
  });

  it('승인 이름에 세목 이름이 들어 있으면 그것으로 가른다', () => {
    // '연구실운영비 평가위원회 승인'은 같은 조항의 주의사항이 없어도 이름으로 세목을 알 수 있다
    const pack = getPack('didimdol2026');
    const lab = spendingCautions(pack, 'DIRECT_ACTIVITY', '연구실운영비', subItemStandardFor(pack, '연구실운영비')?.category);
    expect(lab.items.some((item) => item.title.includes('연구실운영비'))).toBe(true);
    const external = spendingCautions(pack, 'DIRECT_ACTIVITY', '외부 전문기술 활용비', subItemStandardFor(pack, '외부 전문기술 활용비')?.category);
    expect(external.items.some((item) => item.title.includes('연구실운영비'))).toBe(false);
  });

  it('세목을 고르지 않으면 비목의 승인 항목을 모두 준다', () => {
    const pack = getPack('tips2026-general');
    const all = spendingCautions(pack, 'DIRECT_ACTIVITY');
    expect(all.items.some((item) => item.kind === 'approval')).toBe(true);
  });

  it('세목을 고르면 상위 규정 주의사항도 그 세목 것만 남는다', () => {
    const pack = getPack('didimdol2026');
    const travel = spendingCautions(pack, 'DIRECT_ACTIVITY', '출장비', subItemStandardFor(pack, '출장비')?.category);
    expect(textOf(travel.inherited)).toContain('출장비');
    expect(textOf(travel.inherited)).not.toContain('종신 학회비');
  });

  it('상위 규정이 없는 팩은 자기 것만 준다', () => {
    const cautions = spendingCautions(getPack('nrd2026-forprofit'), 'DIRECT_ACTIVITY');
    expect(cautions.inherited).toEqual([]);
    expect(cautions.inheritedGuideline).toBeNull();
    expect(cautions.total).toBe(cautions.items.length);
  });
});

describe('예비창업패키지 증빙', () => {
  it('통합관리지침 제36조 표의 비목별 증빙이 인정 항목마다 실린다', () => {
    const pack = getPack('prestartup2026');
    const fee = evidenceGuide(pack, categoryOf(pack, 'PRE_FEE'), 'card');
    // 지급수수료는 표가 세부 항목별로 나눠 적었다 — 공통 증빙 + 항목별 증빙
    expect(fee.items.find((item) => item.name === '멘토링비')?.evidence).toContain('회차별 멘토링 보고서');
    expect(fee.items.find((item) => item.name === '기술이전비')?.evidence).toContain('기술이전 완료보고서');
    expect(fee.items.every((item) => item.evidence.includes('세금계산서'))).toBe(true);
    expect(evidenceGuide(pack, categoryOf(pack, 'PRE_LABOR'), 'card').items[0].evidence).toContain('4대사회보험가입확인서');
  });

  it('비목을 가리지 않는 증빙 규칙(ALL)은 모든 비목에 붙는다', () => {
    // 예전에는 어느 비목에도 못 붙어 화면에서 통째로 사라졌다 — 증빙 규칙이라 금지·주의에서도 빠진다.
    const pack = getPack('prestartup2026');
    for (const category of pack.categories.filter((c) => c.allowed)) {
      const names = evidenceGuide(pack, category, 'card').rules.map((rule) => rule.name);
      expect(names, category.name).toContain('2천만원 이상 거래 시 비교견적서');
    }
    const tips = getPack('tips2026-general');
    const names = evidenceGuide(tips, categoryOf(tips, 'DIRECT_LABOR'), 'card').rules.map((rule) => rule.name);
    expect(names).toContain('10만원 이상 집행 시 전자세금계산서·카드영수증 원칙');
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

  // 디딤돌 관리지침은 "정부지원연구개발비 최대 2억원 이내 (최대 年 1억원 이내)"로 총액과 연 한도를
  // 함께 정한다. 총액만 보면 1년짜리 과제에도 2억을 허용하게 된다.
  it('창업성장기술개발(디딤돌)은 연 1억 한도를 사업기간에 곱해 실제 한도를 정한다', () => {
    const pack = getPack('didimdol2026');
    const oneYear = fundingCapChecks(pack, projectWith(150_000_000, 'didimdol2026'));   // 2026-01-01 ~ 2026-12-31
    expect(oneYear).toHaveLength(1);
    expect(oneYear[0].years).toBe(1);
    expect(oneYear[0].cap).toBe(100_000_000);      // 연 1억 × 1년차
    expect(oneYear[0].totalCap).toBe(200_000_000); // 규정의 총액 한도는 그대로 들고 있는다
    expect(oneYear[0].perYear).toBe(100_000_000);
    expect(oneYear[0].annualBound).toBe(true);
    expect(oneYear[0].over).toBe(true);
    expect(oneYear[0].diff).toBe(50_000_000);

    // 지원기간 상한인 1년 6개월이면 2년차에 걸쳐 총액 2억을 다 쓸 수 있다
    const halfMore = fundingCapChecks(pack, { ...projectWith(200_000_000, 'didimdol2026'), endDate: '2027-06-30' });
    expect(halfMore[0].years).toBe(2);
    expect(halfMore[0].cap).toBe(200_000_000);
    expect(halfMore[0].annualBound).toBe(false);   // 이때는 총액이 먼저 걸린다
    expect(halfMore[0].over).toBe(false);
  });

  it('연차 수는 시작월과 관계없이 달력연도 경계로 계산한다', () => {
    const checks = fundingCapChecks(getPack('didimdol2026'), {
      ...projectWith(100_000_000, 'didimdol2026'),
      startDate: '2026-07-24',
      endDate: '2027-06-30',
    });
    expect(checks[0].years).toBe(2);
    expect(checks[0].perYear).toBe(100_000_000);
    expect(checks[0].cap).toBe(200_000_000);
  });

  it('기존 과제의 규정 사본도 문구에서 디딤돌 연 1억 한도를 복원한다', () => {
    const current = getPack('didimdol2026');
    const legacy = {
      ...current,
      rules: current.rules.map((rule) => {
        if (rule.fundingCap !== 200_000_000) return rule;
        const { fundingCapPerYear: _removed, ...withoutAnnualField } = rule;
        return withoutAnnualField;
      }),
    };
    const checks = fundingCapChecks(legacy, {
      ...projectWith(100_000_000, 'didimdol2026'),
      startDate: '2026-07-24',
      endDate: '2027-12-31',
    });
    expect(checks[0].perYear).toBe(100_000_000);
    expect(checks[0].years).toBe(2);
    expect(checks[0].cap).toBe(200_000_000);
  });

  it('연 한도가 없는 사업은 총액 한도를 그대로 쓴다', () => {
    // 사업기간을 짧게 잡아도 한도가 줄면 안 된다 (예비창업패키지는 연 한도가 없다)
    const checks = fundingCapChecks(getPack('prestartup2026'), { ...projectWith(20_000_000, 'prestartup2026'), endDate: '2026-03-31' });
    expect(checks[0].cap).toBe(20_000_000);
    expect(checks[0].perYear).toBeUndefined();
    expect(checks[0].annualBound).toBe(false);
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

  it('의도적으로 스냅샷을 쓰는 과제에는 개정 경고를 내지 않는다', () => {
    // 공유 DB에서 고른 팩 — id가 registry:<uuid>라 내장 목록에 없지만 사라진 게 아니다
    expect(packIsMissing(withPack('registry:3f2a…uuid'))).toBe(false);
    // AI 추출 팩을 기준으로 만든 과제 — customPack이 곧 기준이다
    const extractedBase = { ...withPack('custom-global'), customPack: { ...getPack('didimdol2026'), id: 'custom-global', origin: 'extracted' as const } };
    expect(packIsMissing(extractedBase)).toBe(false);
    // 스냅샷이 있어도 packId가 다른 내장 팩이면(진짜 개정) 여전히 알린다
    const legacyMissing = { ...withPack('tips2026'), customPack: { ...getPack('tips2026-general'), id: 'tips2026' } };
    expect(packIsMissing({ ...legacyMissing, customPack: undefined })).toBe(true);
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

describe('인건비 천원 미만 버림', () => {
  it('월 인건비는 천원 미만을 버리고, 합계는 버림한 월액 × 개월이다', () => {
    // 월급여 3,333,333 × 참여율 30% = 999,999.9 → 999,000원 (버림)
    const cost = laborCostFor(
      { id: '1', name: '박연구', projectRate: 30, externalRate: 0, monthlyPay: 3_333_333, laborFunding: 'cash' },
      { startDate: '2026-01-01', endDate: '2026-12-31', includeInsurance: false, includeSeverance: false },
    );
    expect(cost.monthly).toBe(999_000);
    expect(cost.monthly % 1000).toBe(0);
    expect(cost.total).toBe(999_000 * cost.months);
  });
});

describe('타 사업 증빙 추천', () => {
  it('공고에 증빙 규정이 없는 사업도 다른 사업의 같은 비목 증빙을 찾아준다', () => {
    // 디딤돌 공고에는 증빙 표가 없다 — 그렇다고 증빙이 필요 없는 게 아니라 안 적혔을 뿐이다.
    const found = crossPackEvidence(getPack('didimdol2026'), '인건비');
    const withDocs = found.filter((entry) => entry.documents.length > 0);
    expect(withDocs.length).toBeGreaterThan(0);
    // 어느 사업의 어느 비목 기준인지 반드시 함께 온다 — 밝히지 않으면 이 과제의 규정으로 오인된다
    expect(withDocs.every((entry) => entry.packName.length > 0 && !!entry.matchedName)).toBe(true);
  });

  it('자기 사업과 상위 규정은 추천에서 뺀다 — 이미 체크리스트에 반영돼 있다', () => {
    const pack = getPack('tips2026-general');
    const found = crossPackEvidence(pack, '인건비');
    expect(found.some((entry) => entry.packId === pack.id)).toBe(false);
    expect(found.some((entry) => entry.packId === pack.basePackId)).toBe(false);
  });

  it('추천 목록은 그 사업의 실제 체크리스트와 일치한다 — 앱 기본값·공통 규칙은 섞지 않는다', () => {
    // 추천이 그 사업 화면에서 보이는 것과 다르면 근거를 짚을 수 없다.
    // 다른 점은 둘뿐이어야 한다: ① 어느 체크리스트에나 붙는 '항상 필요'(품의서·지출결의서)는 빼고,
    // ② 서류명이 아닌 설명 문장은 넣지 않는다.
    for (const id of ['tips2026-general', 'prestartup2026']) {
      const source = getPack(id);
      const labor = source.categories.find((category) => category.name.includes('인건비'))!;
      const own = evidenceChecklistFor(source, labor.id, undefined, null, [], source);
      const always = new Set(['품의서', '지출결의서']);
      const isDocumentName = (text: string) => text.length <= 45 && !/(가능|대체|따른다|한다)$/.test(text);
      const expected = own.documents.filter((document) => !always.has(document) && isDocumentName(document));
      const recommended = crossPackEvidence(getPack('didimdol2026'), '인건비').find((entry) => entry.packId === id);
      expect(recommended?.documents.slice().sort()).toEqual(expected.slice().sort());
    }
  });

  it('앱이 준 집행 증빙 기본값(requiredDocs)은 추천에 넣지 않는다', () => {
    // requiredDocs는 규정 근거가 아니라 예시라, 섞으면 그 사업 규정처럼 읽힌다.
    const source = getPack('prestartup2026');
    const labor = source.categories.find((category) => category.name.includes('인건비'))!;
    const recommended = crossPackEvidence(getPack('didimdol2026'), '인건비').find((entry) => entry.packId === source.id);
    for (const document of labor.requiredDocs ?? []) expect(recommended?.documents).not.toContain(document);
  });

  it('서류 이름이 아닌 설명 문장은 걸러낸다', () => {
    const found = crossPackEvidence(getPack('didimdol2026'), '인건비');
    const all = found.flatMap((entry) => entry.documents);
    expect(all.every((document) => document.length <= 45)).toBe(true);
    expect(all.some((document) => /대체 가능$/.test(document))).toBe(false);
  });

  it('짝이 없는 사업도 목록에는 남긴다 — 고르는 것은 사용자다', () => {
    const found = crossPackEvidence(getPack('didimdol2026'), '존재하지않는비목명');
    expect(found.length).toBeGreaterThan(0);                       // 사업 목록 자체는 나온다
    expect(found.every((entry) => entry.documents.length === 0)).toBe(true);
    expect(found.every((entry) => entry.matchedName === null)).toBe(true);
  });

  it('증빙을 가진 사업이 목록 앞에 온다', () => {
    const found = crossPackEvidence(getPack('didimdol2026'), '인건비');
    const firstEmpty = found.findIndex((entry) => entry.documents.length === 0);
    const lastFilled = found.map((entry) => entry.documents.length > 0).lastIndexOf(true);
    if (firstEmpty !== -1) expect(lastFilled).toBeLessThan(firstEmpty);
  });
});
