// 표(테이블) 셀을 좌표+병합 정보로 격자에 배치하고 마크다운 표로 렌더링하는 공용 유틸.
// HWPX·HWP 파서가 공유한다 (PDF는 좌표 클러스터링을 쓰고 렌더링만 공유 — extract.ts 참고).

export interface TableCell {
  rowAddr: number;   // 0-based 시작 행
  colAddr: number;   // 0-based 시작 열
  rowSpan: number;   // 1 이상
  colSpan: number;   // 1 이상
  text: string;
}

// 셀 좌표+병합 정보로 완전한 2차원 격자를 만든다. 병합된 셀의 값은 덮는 모든 칸에 복제한다.
// 서로 다른 셀이 같은 좌표를 가리키면(격자 정합성 깨짐) 억지로 덮어쓰지 않고 에러를 던진다 —
// 호출부(collectHwpxSectionContent)의 표 단위 try/catch가 이를 받아 해당 표만 구조 없는 텍스트로 폴백한다.
export const buildGridFromCells = (cells: TableCell[]): string[][] => {
  if (!cells.length) return [];
  const maxRow = Math.max(...cells.map((c) => c.rowAddr + Math.max(c.rowSpan, 1) - 1));
  const maxCol = Math.max(...cells.map((c) => c.colAddr + Math.max(c.colSpan, 1) - 1));
  const grid: string[][] = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(''));
  const claimed = new Set<string>();
  for (const cell of cells) {
    const rowSpan = Math.max(cell.rowSpan, 1);
    const colSpan = Math.max(cell.colSpan, 1);
    for (let r = cell.rowAddr; r < cell.rowAddr + rowSpan && r <= maxRow; r++) {
      for (let c = cell.colAddr; c < cell.colAddr + colSpan && c <= maxCol; c++) {
        const key = `${r},${c}`;
        if (claimed.has(key)) throw new Error(`표 격자 좌표가 겹칩니다 (행 ${r}, 열 ${c}) — 셀 배치 정보가 올바르지 않습니다.`);
        claimed.add(key);
        grid[r][c] = cell.text;
      }
    }
  }
  return grid;
};

// 격자를 마크다운 표 문자열로 렌더링한다. 첫 행을 헤더로 취급해 구분선을 넣는다.
export const renderMarkdownTable = (rows: string[][]): string => {
  if (!rows.length) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  const escapeCell = (cell: string) => (cell ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  const toLine = (row: string[]) => `| ${Array.from({ length: colCount }, (_, i) => escapeCell(row[i] ?? '')).join(' | ')} |`;
  const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
  const [first, ...rest] = rows;
  return [toLine(first), separator, ...rest.map(toLine)].join('\n');
};
