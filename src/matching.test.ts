import { describe, expect, it } from 'vitest';
import { classifyProgram, guessProgramName, guessYear } from './matching';
import { selectablePacks } from './rules';

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
  it('예비창업패키지 공고를 prestartup2026으로 식별하고 근거를 남긴다', () => {
    const result = classifyProgram(prestartupNotice);
    expect(result.packId).toBe('prestartup2026');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((hit) => hit.keyword === '예비창업패키지')).toBe(true);
  });

  it('정부출연기관 지침을 nrd2026-nonprofit으로 식별한다', () => {
    const result = classifyProgram(govtRndNotice);
    expect(result.packId).toBe('nrd2026-nonprofit');
    expect(result.hits.some((hit) => ['정부출연기관', '정부출연연구기관', '학생인건비'].includes(hit.keyword))).toBe(true);
  });

  it('영리기관 R&D 공고를 nrd2026-forprofit으로 식별한다', () => {
    expect(classifyProgram(forprofitRndNotice).packId).toBe('nrd2026-forprofit');
  });

  it('팁스 운영지침을 tips2026으로 식별한다', () => {
    const tipsNotice = `팁스(TIPS) 총괄 운영지침
운영사가 추천한 기술창업기업의 연구개발과제를 지원한다.
정부지원연구개발비에 매칭되는 운영사의 의무투자금 기준은 2억원으로 한다.
창업기업은 팁스타운 등 지정 보육공간을 활용할 수 있다.`;
    expect(classifyProgram(tipsNotice).packId).toBe('tips2026-general');
  });

  it('창업성장기술개발(디딤돌) 공고를 didimdol2026으로 식별한다', () => {
    const didimdolNotice = `2026년도 창업성장기술개발사업(디딤돌) 시행계획 공고
도약(전략기술 R&D) 과제의 정부지원연구개발비는 최대 2억원 이내로 지원한다.
참여연구자의 연구수당은 수정인건비 합의 20% 이내에서 계상한다.`;
    expect(classifyProgram(didimdolNotice).packId).toBe('didimdol2026');
  });

  it('매칭이 지목하는 팩은 모두 지금 선택 가능한 팩이어야 한다', () => {
    // 폐기된 팩 id를 가리키면 사용자 화면의 선택 목록에 없어 아무것도 안 골라진 것처럼 보인다.
    const selectable = new Set(selectablePacks().map((pack) => pack.id));
    for (const notice of [prestartupNotice, govtRndNotice, forprofitRndNotice]) {
      const { packId } = classifyProgram(notice);
      expect(packId && selectable.has(packId), `${packId} 가 선택 목록에 없다`).toBe(true);
    }
  });

  it('판단 근거가 부족한 텍스트는 null을 반환한다 (사용자 직접 선택 유도)', () => {
    expect(classifyProgram('안녕하세요. 일반적인 문서입니다.').packId).toBeNull();
  });

  it('사업명과 연도를 추정한다', () => {
    expect(guessProgramName(prestartupNotice)).toContain('예비창업패키지');
    expect(guessYear(prestartupNotice)).toBe(2026);
  });
});
