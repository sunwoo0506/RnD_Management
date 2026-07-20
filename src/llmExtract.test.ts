import { describe, expect, it } from 'vitest';
import { annotateVerification, buildCustomPack, verifyQuote, type Extraction } from './llmExtract';
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
