import { describe, expect, it } from 'vitest';
import { classifyProgram, guessProgramName, guessYear } from './matching';

const prestartupNotice = `중소벤처기업부 공고 제2026-207호
2026년 예비창업패키지 예비창업자 모집공고
혁신적인 기술 창업 아이디어를 보유한 예비창업자의 원활한 창업사업화를 위하여
사업화 자금, 창업교육, 멘토링을 지원하는 예비창업패키지 참여자를 모집합니다.
지원내용: 사업화 자금(평균 0.4억원), 전담기관의 창업교육
근거: 중소기업창업 지원사업 통합관리지침`;

const govtRndNotice = `국가연구개발사업 연구개발비 사용 기준
제3절 정부출연기관의 연구개발비 계상기준
정부출연연구기관의 장은 학생인건비를 학생연구자의 인건비계상률에 따라 계상하여야 한다.
출연금으로 수행하는 기본사업의 연구개발비 사용용도는 별표 1과 같다.
참여연구자의 연구수당은 수정인건비의 20퍼센트 범위에서 계상한다.`;

const forprofitRndNotice = `중소기업 기술개발지원사업 공고
국가연구개발혁신법에 따라 영리기관(중소기업·중견기업)의 연구개발비 계상 기준을 안내합니다.
영리기관은 기업부담금을 현금 또는 현물로 부담하며, 참여연구자의 인건비계상률은 월 100%를 초과할 수 없습니다.
위탁연구개발비는 직접비의 40% 이내로 계상합니다.`;

describe('사업 유형 매칭 엔진', () => {
  it('예비창업패키지 공고를 prestartup으로 식별하고 근거를 남긴다', () => {
    const result = classifyProgram(prestartupNotice);
    expect(result.packId).toBe('prestartup');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((hit) => hit.keyword === '예비창업패키지')).toBe(true);
  });

  it('정부출연기관 지침을 rnd-govt로 식별한다', () => {
    const result = classifyProgram(govtRndNotice);
    expect(result.packId).toBe('rnd-govt');
    expect(result.hits.some((hit) => ['정부출연기관', '정부출연연구기관', '학생인건비'].includes(hit.keyword))).toBe(true);
  });

  it('영리기관 R&D 공고를 rnd-forprofit으로 식별한다', () => {
    expect(classifyProgram(forprofitRndNotice).packId).toBe('rnd-forprofit');
  });

  it('판단 근거가 부족한 텍스트는 null을 반환한다 (사용자 직접 선택 유도)', () => {
    expect(classifyProgram('안녕하세요. 일반적인 문서입니다.').packId).toBeNull();
  });

  it('사업명과 연도를 추정한다', () => {
    expect(guessProgramName(prestartupNotice)).toContain('예비창업패키지');
    expect(guessYear(prestartupNotice)).toBe(2026);
  });
});
