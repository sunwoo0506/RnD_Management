import { describe, expect, it } from 'vitest';
import { annotateVerification, buildCustomPack, mergeExtractions, splitForExtraction, verifyQuote, type Extraction } from './llmExtract';
import { getPack } from './rules';

const source = `사업화 자금 집행 비목은 재료비, 외주용역비, 광고선전비로 한다.
대표자의 배우자 및 직계존비속이 소속 직원인 경우 인건비 지급이 불가하다.
협약 종료 후 잔여 사업비는 전액 국고 반납한다.`;

const extraction: Extraction = {
  programName: '테스트 창업 지원사업', year: 2026, programType: 'startup',
  categories: [
    { name: '재료비', definition: '시제품 재료 구입', allowed: true, limitPct: null, limitBasis: null, requiredDocs: ['세금계산서'], quote: '사업화 자금 집행 비목은 재료비, 외주용역비, 광고선전비로 한다.', ref: '공고 3쪽' },
    { name: '광고선전비', definition: null, allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: '사업화 자금 집행 비목은 재료비, 외주용역비, 광고선전비로 한다.', ref: '공고 3쪽' },
  ],
  rules: [
    { kind: 'warning', item: '인건비', message: '대표자 친인척 인건비 지급 불가', limitPct: null, basis: null, severity: 'high', quote: '대표자의 배우자 및 직계존비속이 소속 직원인 경우 인건비 지급이 불가하다.', ref: '공고 5쪽' },
    { kind: 'warning', item: null, message: '지어낸 규칙', limitPct: null, basis: null, severity: 'high', quote: '이 문장은 원문에 존재하지 않는다.', ref: '?' },
  ],
  allowedItems: [
    { categoryName: '재료비', name: '시제품 재료 구입비', description: '시제품 제작에 쓰는 재료·원료', status: 'ALLOWED', condition: null, restriction: null, quote: '사업화 자금 집행 비목은 재료비, 외주용역비, 광고선전비로 한다.', ref: '공고 3쪽' },
    { categoryName: '광고선전비', name: '홍보물 제작비', description: null, status: 'CONDITIONAL', condition: '협약기간 내 완료분만', restriction: null, quote: '이 문장도 원문에 없다.', ref: '?' },
  ],
  articles: [
    { ref: '공고 5쪽', title: '인건비', text: '대표자의 배우자 및 직계존비속이 소속 직원인 경우 인건비 지급이 불가하다.' },
  ],
  uncertain: [],
};

describe('인용 원문 대조 검증', () => {
  it('원문에 있는 인용은 통과, 없는 인용은 실패한다 (공백 차이 무시)', () => {
    expect(verifyQuote('대표자의 배우자 및  직계존비속이 소속직원인 경우 인건비 지급이 불가하다', source)).toBe(true);
    expect(verifyQuote('이 문장은 원문에 존재하지 않는다.', source)).toBe(false);
    expect(verifyQuote('짧음', source)).toBe(false);
  });

  it('annotateVerification이 규칙·비목에 verified 플래그를 붙인다', () => {
    const verified = annotateVerification(extraction, source);
    expect(verified.rules[0].verified).toBe(true);
    expect(verified.rules[1].verified).toBe(false);
    expect(verified.categories[0].verified).toBe(true);
  });
});

describe('커스텀 팩 구성', () => {
  it('문서 비목 구성 사용 시 추출 비목으로 팩을 만들고 초안 합계는 100이다', () => {
    const pack = buildCustomPack(null, extraction, [extraction.rules[0]], true);
    expect(pack.categories).toHaveLength(2);
    expect(pack.categories.reduce((sum, c) => sum + c.draftRate, 0)).toBe(100);
    expect(pack.categories[1].requiredDocs.length).toBeGreaterThan(0); // 증빙 없으면 기본값 부여
    expect(pack.verified).toBe(false);
    expect(pack.rules[0].source.matchLevel).toBe('notice');
  });

  it('기준 팩 오버레이 시 기준 비목을 유지하고 추출 규칙이 앞에 온다', () => {
    const base = getPack('prestartup');
    const pack = buildCustomPack(base, extraction, [extraction.rules[0]], false);
    expect(pack.categories).toHaveLength(base.categories.length);
    expect(pack.rules[0].id).toBe('ext_0');
    expect(pack.rules.length).toBe(base.rules.length + 1);
    expect(pack.rules[0].categoryIds).toContain('cat_personnel'); // '인건비' 이름 매칭
  });
});

describe('인정 항목·조문 원문 추출', () => {
  it('인정 항목과 조문 원문에도 원문 대조 결과를 붙인다', () => {
    const verified = annotateVerification(extraction, source);
    expect(verified.allowedItems?.[0].verified).toBe(true);
    expect(verified.allowedItems?.[1].verified).toBe(false);   // 원문에 없는 인용
    expect(verified.articles?.[0].verified).toBe(true);
  });

  it('승인한 인정 항목만 해당 비목에 실린다', () => {
    const approved = [extraction.allowedItems![0]];
    const pack = buildCustomPack(null, extraction, [], true, approved);
    const material = pack.categories.find((c) => c.name === '재료비');
    const ad = pack.categories.find((c) => c.name === '광고선전비');
    expect(material?.allowedItems).toHaveLength(1);
    expect(material?.allowedItems?.[0].name).toBe('시제품 재료 구입비');
    expect(material?.allowedItems?.[0].source.ref).toBe('공고 3쪽');
    expect(ad?.allowedItems).toBeUndefined();   // 승인하지 않은 항목은 빠진다
  });

  it('조건부 항목의 조건·제한이 보존된다', () => {
    const pack = buildCustomPack(null, extraction, [], true, extraction.allowedItems);
    const item = pack.categories.find((c) => c.name === '광고선전비')?.allowedItems?.[0];
    expect(item?.status).toBe('CONDITIONAL');
    expect(item?.condition).toBe('협약기간 내 완료분만');
  });

  it('조문 원문이 팩에 실려 근거 링크가 원본 파일 없이도 열린다', () => {
    const pack = buildCustomPack(null, extraction, [extraction.rules[0]], true);
    expect(pack.articles).toHaveLength(1);
    expect(pack.articles?.[0].ref).toBe('공고 5쪽');
    expect(pack.articles?.[0].text).toContain('직계존비속');
    // 규칙의 근거(공고 5쪽)와 조문의 ref가 같아야 화면에서 연결된다
    expect(pack.rules[0].source.ref).toBe(pack.articles?.[0].ref);
  });
});

describe('긴 문서 분할 추출', () => {
  it('짧은 문서는 자르지 않는다', () => {
    expect(splitForExtraction('짧은 지침 본문')).toEqual(['짧은 지침 본문']);
  });

  it('긴 문서는 조문 경계에서 자른다 (조문이 두 조각에 걸쳐 쪼개지지 않게)', () => {
    // 조문 20개 × 약 1,000자 = 2만 자를 한도 6,000자로 자른다
    const body = Array.from({ length: 20 }, (_, i) => `제${i + 1}조(항목${i + 1}) ${'가'.repeat(1000)}`).join('\n');
    const chunks = splitForExtraction(body, 6_000);
    expect(chunks.length).toBeGreaterThan(1);
    // 첫 조각을 뺀 나머지는 조문 시작에서 열려야 한다
    for (const chunk of chunks.slice(1)) expect(chunk.trimStart()).toMatch(/^제\d+조/);
    // 잘라내도 모든 조문이 어딘가에는 남아 있어야 한다
    for (let i = 1; i <= 20; i++) expect(chunks.some((c) => c.includes(`제${i}조(항목${i})`))).toBe(true);
  });

  it('조각별 결과를 합치면서 겹친 항목을 한 번만 남긴다', () => {
    const base = { programType: 'rnd' as const, referencedRegulations: [], fundingSchedule: null, uncertain: [] };
    const part1: Extraction = {
      ...base, programName: '테스트 지침', year: 2026,
      categories: [{ name: '인건비', definition: null, allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: 'q1', ref: '제6조' }],
      allowedItems: [{ categoryName: '인건비', name: '참여연구자 급여', description: null, status: 'ALLOWED', condition: null, restriction: null, quote: 'q2', ref: '제6조' }],
      articles: [{ ref: '제6조', title: '인건비', text: '제6조 본문' }],
      rules: [{ kind: 'warning', item: '인건비', message: '중복 규칙', limitPct: null, minAmount: null, basis: null, severity: 'high', quote: 'q3', ref: '제6조' }],
    };
    const part2: Extraction = {
      ...base, programName: '', year: null,
      // 겹침 구간이라 인건비 비목·항목·조문·규칙이 다시 나온다
      categories: [
        { name: '인건비', definition: null, allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: 'q1', ref: '제6조' },
        { name: '연구수당', definition: null, allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: 'q4', ref: '제11조' },
      ],
      allowedItems: [{ categoryName: '인건비', name: '참여연구자 급여', description: null, status: 'ALLOWED', condition: null, restriction: null, quote: 'q2', ref: '제6조' }],
      articles: [{ ref: '제6조', title: '인건비', text: '제6조 본문' }, { ref: '제11조', title: '연구수당', text: '제11조 본문' }],
      rules: [{ kind: 'warning', item: '인건비', message: '중복 규칙', limitPct: null, minAmount: null, basis: null, severity: 'high', quote: 'q3', ref: '제6조' }],
    };
    const merged = mergeExtractions([part1, part2]);
    expect(merged.categories.map((c) => c.name)).toEqual(['인건비', '연구수당']);
    expect(merged.allowedItems).toHaveLength(1);
    expect(merged.articles?.map((a) => a.ref)).toEqual(['제6조', '제11조']);
    expect(merged.rules).toHaveLength(1);
    // 문서 메타는 값이 있는 앞 조각에서 가져온다
    expect(merged.programName).toBe('테스트 지침');
    expect(merged.year).toBe(2026);
  });
});

describe('절차성 상한·승인·증빙 구분', () => {
  const src = { programType: 'rnd' as const, referencedRegulations: [], fundingSchedule: null, uncertain: [], allowedItems: [], articles: [] };
  const cat = (name: string, parentName: string | null = null) =>
    ({ name, parentName, definition: null, allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: 'q', ref: '제8조' });

  it('APPROVAL_THRESHOLD는 편성 금액을 깎지 않고 주의사항으로 들어간다', () => {
    const extraction: Extraction = {
      ...src, programName: '테스트', year: 2026,
      categories: [cat('연구시설·장비비')],
      rules: [
        { kind: 'ratio', limitType: 'APPROVAL_THRESHOLD', approvalStatus: 'PRIOR_APPROVAL_REQUIRED', requiredDocuments: [],
          item: '연구시설·장비비', message: '3천만원 이상 장비는 사전승인이 필요하다', limitPct: null, minAmount: null, basis: null, severity: 'medium', quote: 'q', ref: '제8조' },
        { kind: 'ratio', limitType: 'PERCENT', approvalStatus: null, requiredDocuments: [],
          item: '연구시설·장비비', message: '구입가의 20% 이내', limitPct: 20, minAmount: null, basis: '구입가', severity: null, quote: 'q', ref: '제8조' },
      ],
    };
    const pack = buildCustomPack(null, extraction, extraction.rules, true);
    const approval = pack.rules.find((r) => r.message.includes('사전승인'));
    const percent = pack.rules.find((r) => r.message.includes('20%'));
    expect(approval?.kind).toBe('warning');      // 상한이 아니라 주의사항
    expect(approval?.limitPct).toBeUndefined();  // 금액을 깎는 데 쓰이지 않는다
    expect(percent?.kind).toBe('ratio');         // 진짜 비율 상한은 그대로
    expect(percent?.limitPct).toBe(20);
  });

  it('승인·증빙 규칙이 해당 비목의 절차 목록으로 들어간다', () => {
    const extraction: Extraction = {
      ...src, programName: '테스트', year: 2026,
      categories: [cat('연구시설·장비비')],
      rules: [
        { kind: 'ratio', limitType: 'APPROVAL_THRESHOLD', approvalStatus: 'PRIOR_APPROVAL_REQUIRED', requiredDocuments: [],
          item: '연구시설·장비비', message: '3천만원 이상 장비는 사전승인이 필요하다', limitPct: null, minAmount: null, basis: null, severity: 'medium', quote: 'q', ref: '제8조' },
        { kind: 'warning', limitType: null, approvalStatus: null, requiredDocuments: ['견적서', '검수조서'],
          item: '연구시설·장비비', message: '장비 구입 시 견적서와 검수조서를 갖춰야 한다', limitPct: null, minAmount: null, basis: null, severity: 'medium', quote: 'q', ref: '제8조' },
      ],
    };
    const pack = buildCustomPack(null, extraction, extraction.rules, true);
    const category = pack.categories[0];
    expect(category.approvals).toHaveLength(1);
    expect(category.approvals?.[0].status).toBe('사전승인 필요');
    expect(category.evidenceRules).toHaveLength(1);
    expect(category.evidenceRules?.[0].documents).toEqual(['견적서', '검수조서']);
  });

  it('하위 비목은 상위 비목의 계상 가능 세목이 된다', () => {
    const extraction: Extraction = {
      ...src, programName: '테스트', year: 2026,
      categories: [cat('연구활동비'), cat('회의비', '연구활동비'), cat('출장비', '연구활동비')],
      rules: [],
    };
    const pack = buildCustomPack(null, extraction, [], true);
    const parent = pack.categories.find((c) => c.name === '연구활동비');
    expect(parent?.subItemOptions).toEqual(['회의비', '출장비']);
  });
});
