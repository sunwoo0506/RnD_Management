import { describe, expect, it } from 'vitest';
import { anyTermMatches, highlightTermSets, markArticleParagraphs, quoteTerms, shortRef } from './App';

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

// 조문 원문은 조 전체가 실려 있어 다른 세목 내용까지 섞여 있다.
// 유의사항이 가리키는 문단을 짚어주지 못하면 사용자가 어디를 읽어야 할지 알 수 없다.
describe('근거 조문에서 해당 문단 짚기', () => {
  const article = [
    '제25조(연구활동비) ① 연구활동비는 다음 각 호의 용도로 사용한다.',
    '④ 해당 과제 참여연구자만 참석한 회의의 식비는 계상할 수 없다.',
    '⑥ 출장비는 다음 각 호에 따라 계상한다. 1. 공무원 출장비는 공무원 여비 규정에 따른다.',
    '⑭ 참여연구자의 종신 학회비는 계상할 수 없다.',
  ].join('\n');

  it('키워드가 가장 많이 겹치는 문단만 짚는다', () => {
    const { paragraphs, marked } = markArticleParagraphs(article, '공무원 출장비는 공무원 여비 규정에 따라 계상해야 합니다.');
    expect(paragraphs).toHaveLength(4);
    expect([...marked]).toEqual([2]);
  });

  it('다른 세목 문단은 짚지 않는다', () => {
    const { marked } = markArticleParagraphs(article, '참여연구자의 종신 학회비는 계상할 수 없습니다.');
    expect([...marked]).toEqual([3]);
  });

  it('겹치는 단어가 거의 없으면 아무 문단도 짚지 않는다', () => {
    // 엉뚱한 곳을 가리키느니 표시하지 않는 편이 낫다
    const { marked } = markArticleParagraphs(article, '클라우드컴퓨팅서비스 이용지원시스템 확인');
    expect(marked.size).toBe(0);
  });

  it('문단을 나눠도 원문 줄 수는 그대로 유지한다', () => {
    const { paragraphs } = markArticleParagraphs(article, '아무 문구');
    expect(paragraphs.join('\n')).toBe(article);
  });

  it('3개 넘게 겹치는 문단이 여럿이면 모두 짚는다', () => {
    const twice = `${article}\n⑮ 출장비는 공무원 여비 규정을 준용해 계상한다.`;
    const { marked } = markArticleParagraphs(twice, '공무원 출장비는 공무원 여비 규정에 따라 계상해야 합니다.');
    expect(marked.size).toBeGreaterThan(1);
  });
});

// 실제로 놓쳤던 건: 승인 제목 "청년인력 초과채용 시 현금 대체"에서 뽑히는 낱말이
// '청년인력'·'초과채용' 둘뿐이었고(현금·대체는 두 글자라 탈락), 조문은 "초과로 채용한"이라
// 통째로도 안 맞아 한 개만 걸렸다 — 3개 기준에 못 미쳐 아무 문단도 짚지 못했다.
describe('짧은 제목·풀어 쓴 조문에서도 문단을 짚는다', () => {
  const article = [
    '다) 인건비 현금·현물 계상',
    '영리기관의 참여연구자 인건비는 현물로 계상함을 원칙으로 한다.',
    '단, 정부지원연구개발비에 비례하여 의무채용한 청년인력 외에 청년인력을 초과로 채용한 과제의 경우 현금 부담금을 해당 인건비만큼 현물로 대체할 수 있으며(영리기관에 지원되는 정부지원연구개발비 총액 기준 5억원 이상 과제의 청년인력 의무채용 1인의 인건비는 제외), 요령 제3조제1항에서 정한 중소기업기술개발사업 공고 시 관련 내용을 명시해야 한다.',
    '라) 연구시설·장비비는 구입가의 20% 이내로 계상한다.',
  ].join('\n');

  it('두 글자 낱말(현금·대체)과 풀어 쓴 합성어(초과채용 → 초과로 채용한)를 모두 잡는다', () => {
    const { marked } = markArticleParagraphs(article, '청년인력 초과채용 시 현금 대체');
    expect([...marked]).toEqual([2]);
  });

  it('관계없는 문단은 여전히 짚지 않는다', () => {
    const { marked } = markArticleParagraphs(article, '청년인력 초과채용 시 현금 대체');
    expect(marked.has(3)).toBe(false);   // 연구시설·장비비 문단
    expect(marked.has(0)).toBe(false);   // 머리글
  });

  it('색칠은 뜻이 뚜렷한 세 글자 이상만 한다', () => {
    // 두 글자까지 칠하면 문단이 온통 노래진다 — 찾을 때만 쓰고 칠할 때는 쓰지 않는다
    const { terms } = markArticleParagraphs(article, '청년인력 초과채용 시 현금 대체');
    expect(terms).toContain('청년인력');
    expect(terms.every((term) => term.length >= 3)).toBe(true);
  });
});
