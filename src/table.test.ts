import { describe, expect, it } from 'vitest';
import { buildGridFromCells } from './table';

describe('buildGridFromCells', () => {
  it('병합 없는 2x2 셀을 그대로 격자로 만든다', () => {
    const grid = buildGridFromCells([
      { rowAddr: 0, colAddr: 0, rowSpan: 1, colSpan: 1, text: '구분' },
      { rowAddr: 0, colAddr: 1, rowSpan: 1, colSpan: 1, text: '금액' },
      { rowAddr: 1, colAddr: 0, rowSpan: 1, colSpan: 1, text: '1차년도' },
      { rowAddr: 1, colAddr: 1, rowSpan: 1, colSpan: 1, text: '66500' },
    ]);
    expect(grid).toEqual([
      ['구분', '금액'],
      ['1차년도', '66500'],
    ]);
  });

  it('가로로 병합된 셀 값은 덮는 모든 칸에 복제된다', () => {
    const grid = buildGridFromCells([
      { rowAddr: 0, colAddr: 0, rowSpan: 1, colSpan: 3, text: '기관부담연구개발비' },
      { rowAddr: 1, colAddr: 0, rowSpan: 1, colSpan: 1, text: '현금' },
      { rowAddr: 1, colAddr: 1, rowSpan: 1, colSpan: 1, text: '현물' },
      { rowAddr: 1, colAddr: 2, rowSpan: 1, colSpan: 1, text: '합계' },
    ]);
    expect(grid[0]).toEqual(['기관부담연구개발비', '기관부담연구개발비', '기관부담연구개발비']);
    expect(grid[1]).toEqual(['현금', '현물', '합계']);
  });

  it('세로로 병합된 셀 값도 덮는 모든 칸에 복제된다', () => {
    const grid = buildGridFromCells([
      { rowAddr: 0, colAddr: 0, rowSpan: 2, colSpan: 1, text: '구분' },
      { rowAddr: 0, colAddr: 1, rowSpan: 1, colSpan: 1, text: 'A' },
      { rowAddr: 1, colAddr: 1, rowSpan: 1, colSpan: 1, text: 'B' },
    ]);
    expect(grid[0][0]).toBe('구분');
    expect(grid[1][0]).toBe('구분');
  });

  it('빈 셀 목록은 빈 격자를 반환한다', () => {
    expect(buildGridFromCells([])).toEqual([]);
  });
});
