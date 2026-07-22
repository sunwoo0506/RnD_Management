// 매칭 엔진: 업로드된 공고문·지침 텍스트에서 사업 유형(적용 규정 팩)을 식별한다.
// 키워드 가중치 스코어링 — 판정 근거(어떤 키워드가 몇 번, 어디서)를 함께 반환해 사용자가 확인·수정한다.

export interface MatchHit { keyword: string; count: number; snippet: string }
export interface MatchResult {
  packId: string | null;      // null이면 확신 부족 — 사용자가 직접 선택
  scores: Record<string, number>;
  hits: MatchHit[];           // 선택된 팩의 근거
}

// 팩별 키워드와 가중치. 값이 클수록 그 팩임을 강하게 시사한다.
// ★ 키는 반드시 지금 선택 가능한 팩 id 여야 한다. 폐기된 팩(SUPERSEDED_PACK_IDS)을 가리키면
//   매칭 결과가 선택 목록에 없는 팩을 지목해, 사용자 눈에는 아무것도 안 골라진 것처럼 보인다.
const KEYWORDS: Record<string, Record<string, number>> = {
  prestartup2026: {
    '예비창업패키지': 5, '예비창업자': 4, '창업사업화': 4, '초기창업패키지': 3, '창업지원사업': 3,
    '통합관리지침': 3, '사업화 자금': 3, '전담기관': 1, '주관기관': 1,
  },
  'tips2026-general': {
    '팁스': 5, 'TIPS': 5, '운영사': 4, '팁스타운': 4, '프리팁스': 4, '의무투자금': 3,
    '일반트랙': 5, '투자금': 2, '창업기업': 2, '기술창업기업': 3,
  },
  // 딥테크는 일반트랙 키워드를 대부분 공유하므로, 딥테크 고유어에 큰 가중치를 줘 갈라낸다.
  'tips2026-deeptech': {
    '딥테크': 8, '딥테크트랙': 8, '후속투자': 5, '팁스': 3, 'TIPS': 3, '운영사': 2, '창업기업': 1,
  },
  didimdol2026: {
    '디딤돌': 5, '창업성장기술개발': 5, '전략기술': 3, '도약': 2,
  },
  'nrd2026-forprofit': {
    '영리기관': 4, '기업부담금': 3, '중소기업': 1, '중견기업': 1, '현물': 1,
  },
  'nrd2026-nonprofit': {
    '정부출연기관': 5, '정부출연연구기관': 5, '출연연': 4, '학생인건비': 4, '학생연구자': 3,
    '비영리기관': 4, '기본사업': 2, '출연금': 2, '간접비고시비율': 3,
  },
};

// R&D 공통 키워드를 더할 팩 — "R&D인 것"까지는 판정하게 한다.
// 창업사업화(예비창업패키지)는 R&D가 아니므로 제외한다.
const RND_PACKS = new Set(['nrd2026-forprofit', 'nrd2026-nonprofit', 'tips2026-general', 'tips2026-deeptech', 'didimdol2026']);

// R&D 공통 키워드 — 영리/출연연 양쪽에 더해져 "R&D인 것"까지는 판정하게 한다.
const RND_COMMON: Record<string, number> = {
  '연구개발비': 3, '국가연구개발': 3, '연구개발혁신법': 3, '혁신법': 2, '연구책임자': 2,
  '참여연구자': 2, '연구수당': 2, '위탁연구개발': 2, '간접비': 1, '연구개발과제': 2, 'R&D': 1,
};

const MIN_SCORE = 5;   // 이 점수 미만이면 판정 보류
const MIN_MARGIN = 3;  // 1·2위 격차가 이보다 작으면 판정 보류

const findHits = (text: string, keywords: Record<string, number>): MatchHit[] => {
  const hits: MatchHit[] = [];
  for (const keyword of Object.keys(keywords)) {
    let count = 0;
    let first = -1;
    let index = text.indexOf(keyword);
    while (index !== -1) {
      if (first === -1) first = index;
      count += 1;
      index = text.indexOf(keyword, index + keyword.length);
    }
    if (count > 0) {
      const start = Math.max(0, first - 18);
      hits.push({ keyword, count, snippet: text.slice(start, first + keyword.length + 18).replace(/\s+/g, ' ').trim() });
    }
  }
  return hits;
};

export const classifyProgram = (text: string): MatchResult => {
  const scores: Record<string, number> = {};
  const hitsByPack: Record<string, MatchHit[]> = {};
  for (const [packId, keywords] of Object.entries(KEYWORDS)) {
    const merged = RND_PACKS.has(packId) ? { ...RND_COMMON, ...keywords } : keywords;
    const hits = findHits(text, merged);
    hitsByPack[packId] = hits;
    // 같은 키워드가 아무리 많이 나와도 가중치×3까지만 인정 — 반복 문서에 점수가 쏠리지 않게.
    scores[packId] = hits.reduce((sum, hit) => sum + Math.min(hit.count, 3) * (merged[hit.keyword] ?? 1), 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [firstId, firstScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  if (firstScore < MIN_SCORE || firstScore - second < MIN_MARGIN) return { packId: null, scores, hits: [] };
  // 근거는 가중치 높은 순으로 정렬해 상위만 보여준다.
  const merged = RND_PACKS.has(firstId) ? { ...RND_COMMON, ...KEYWORDS[firstId] } : KEYWORDS[firstId];
  const hits = hitsByPack[firstId].sort((a, b) => (merged[b.keyword] ?? 1) - (merged[a.keyword] ?? 1)).slice(0, 5);
  return { packId: firstId, scores, hits };
};

// 사업명 추정: 문서 앞부분에서 제목처럼 보이는 줄을 제안한다. 사용자가 수정 가능.
// "OO부 공고 제2026-207호" 같은 공고 번호 라인은 제목이 아니므로 제외한다.
export const guessProgramName = (text: string): string => {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line.length >= 4);
  const isNoticeNumberLine = (line: string) => /공고\s*제?\s*\d{4}\s*[-–]\s*\d+호?/.test(line);
  const noticeLine = lines.slice(0, 20).find((line) => /공고|모집|시행계획/.test(line) && line.length <= 80 && !isNoticeNumberLine(line));
  const candidate = noticeLine ?? lines.find((line) => !isNoticeNumberLine(line)) ?? '';
  return candidate.replace(/^(20\d{2}년도?\s*)/, '').slice(0, 60).trim();
};

// 연도 추정: 문서 앞부분의 20xx년(또는 20xx) 중 첫 값.
export const guessYear = (text: string): number | null => {
  const match = /20\d{2}(?=년|\s|\.|-)/.exec(text.slice(0, 2000));
  return match ? Number(match[0]) : null;
};
