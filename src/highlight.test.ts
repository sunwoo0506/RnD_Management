import { describe, expect, it } from 'vitest';
import { anyTermMatches, highlightTermSets, quoteTerms, shortRef } from './App';

// 근거 링크 → 원문 하이라이트: 규정 DB·AI 추출의 인용문(quote)으로 원본 문서에서 그 위치를 찾는다.
// HWP·PDF에서 뽑은 본문은 원문과 줄바꿈·구두점이 어긋나므로 그 차이를 흡수하는지가 핵심이다.
describe('근거 원문 하이라이트 검색어', () => {
  const quote = '정부지원연구개발비는 연구개발비(투자금은 제외한 사업비)의 75% 이내로 계상한다';
  const rule = { quote, message: '정부지원연구개발비는 75% 이내', item: '인건비', source: { ref: '지침 11.나.나)' } };

  it('줄바꿈·공백이 다르게 끼어 있어도 인용문을 찾는다', () => {
    // 추출된 본문은 원문과 줄이 갈리는 위치가 다르다
    const extracted = '제11조 사업비\n정부지원연구개발비는\n연구개발비(투자금은 제외한 사업비)의\n75% 이내로 계상한다\n다음 조항...';
    expect(anyTermMatches(extracted, highlightTermSets(rule).primary)).toBe(true);
  });

  it('가운뎃점·괄호·물결이 다른 코드로 쓰였어도 찾는다', () => {
    const variant = { ...rule, quote: '연구시설·장비비는 3천만원~1억원(부가세 포함) 구간에서 심의한다' };
    const extracted = '연구시설・장비비는 3천만원∼1억원（부가세 포함） 구간에서 심의한다';
    expect(anyTermMatches(extracted, highlightTermSets(variant).primary)).toBe(true);
  });

  it('인용문 앞부분이 문서와 어긋나도 뒤쪽 절로 위치를 찾는다', () => {
    // 문서에는 인용 앞머리가 다르게 적혀 있고 뒷 절만 그대로 있는 경우
    const extracted = '가. 사업비 계상 기준. 연구개발비(투자금은 제외한 사업비)의 75% 이내로 계상한다.';
    expect(anyTermMatches(extracted, highlightTermSets(rule).primary)).toBe(true);
  });

  it('전혀 다른 문서에서는 인용이 잡히지 않는다 (오탐 방지)', () => {
    expect(anyTermMatches('이 문서는 사업 신청 자격과 평가 절차만 다룬다.', highlightTermSets(rule).primary)).toBe(false);
  });

  it('짧은 인용은 검색어로 쓰지 않는다 — 흔한 표현이 문서 전체에 칠해지는 걸 막는다', () => {
    expect(quoteTerms('사업비 집행')).toEqual([]);
    expect(quoteTerms(undefined)).toEqual([]);
  });
});

describe('근거 위치(ref) 표시 축약', () => {
  it('조·항 번호가 있으면 번호만 남긴다', () => {
    expect(shortRef('붙임2-5 1. 세부 지원내용 - 주요 연구개발비 산정기준 제65조 제7항')).toBe('제65조 제7항');
    expect(shortRef('별지 서식 안내 - 지침 11.다.1) 인건비 관련 계상 기준 상세')).toBe('지침 11.다.1)');
  });

  it('짧은 근거는 그대로 두고, 번호가 없는 긴 근거만 잘라 표시한다', () => {
    expect(shortRef('제65조 제7항')).toBe('제65조 제7항');
    expect(shortRef('지침 11.다.1) 인건비')).toBe('지침 11.다.1) 인건비');
    expect(shortRef('사업 운영 방식과 세부 지원내용에 관한 종합 안내 문단')).toMatch(/…$/);
  });
});
