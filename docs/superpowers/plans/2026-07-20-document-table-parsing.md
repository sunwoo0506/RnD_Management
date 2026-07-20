# 문서 파싱 — 표 구조 보존 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HWP·HWPX·PDF 문서 추출(`src/extract.ts`)에서 표(테이블)의 행·열·병합 구조를 잃지 않고 마크다운 표로 보존한다.

**Architecture:** 셀 좌표+병합 정보로 격자를 조립하고 마크다운으로 렌더링하는 공용 유틸(`src/table.ts`)을 새로 만들고, HWPX·HWP 파서가 이를 공유한다. PDF는 좌표 클러스터링으로 표 영역을 자체 감지한 뒤 같은 렌더러를 쓴다. `extractDocumentText()`의 외부 시그니처는 변경하지 않는다.

**Tech Stack:** TypeScript, Vitest, 기존 의존성(`cfb`, `pako`, `fflate`, `pdfjs-dist`)만 사용 — 신규 의존성 없음.

**참고 스펙:** `docs/superpowers/specs/2026-07-20-document-table-parsing-design.md`

**중요 — HWP(바이너리) 관련 주의사항:** HWP5 바이너리 포맷은 공식 문서화가 불완전하다. 아래 Phase 3의 레코드 태그 번호(71/72/77 등)는 **HWP5 공개 스펙 문서 기반의 추정치**이며, 반드시 Task 10(실제 샘플 파일 검증)을 먼저 실행해 맞는지 확인한 뒤 Task 11부터 진행해야 한다. 추정이 틀렸다면 Task 10에서 나온 실제 값으로 Task 11의 상수만 교체하면 되고, 나머지 구조(재귀적 레코드 워커, 격자 조립)는 그대로 유효하다.

---

## Task 1: 공용 표 유틸리티 — 격자 조립

**Files:**
- Create: `src/table.ts`
- Test: `src/table.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/table.test.ts`:
```typescript
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/table.test.ts`
Expected: FAIL — `src/table.ts` 파일이 없어서 import 에러.

- [ ] **Step 3: 최소 구현 작성**

`src/table.ts`:
```typescript
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
export const buildGridFromCells = (cells: TableCell[]): string[][] => {
  if (!cells.length) return [];
  const maxRow = Math.max(...cells.map((c) => c.rowAddr + Math.max(c.rowSpan, 1) - 1));
  const maxCol = Math.max(...cells.map((c) => c.colAddr + Math.max(c.colSpan, 1) - 1));
  const grid: string[][] = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(''));
  for (const cell of cells) {
    const rowSpan = Math.max(cell.rowSpan, 1);
    const colSpan = Math.max(cell.colSpan, 1);
    for (let r = cell.rowAddr; r < cell.rowAddr + rowSpan && r <= maxRow; r++) {
      for (let c = cell.colAddr; c < cell.colAddr + colSpan && c <= maxCol; c++) {
        grid[r][c] = cell.text;
      }
    }
  }
  return grid;
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/table.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/table.ts src/table.test.ts
git commit -m "feat: 표 셀 좌표+병합 정보로 격자를 조립하는 buildGridFromCells 추가"
```

---

## Task 2: 공용 표 유틸리티 — 마크다운 렌더링

**Files:**
- Modify: `src/table.ts`
- Modify: `src/table.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/table.test.ts` 상단의 기존 import를 다음으로 교체 (Task 1에서 만든 `import { buildGridFromCells } from './table';`에 `renderMarkdownTable` 추가):
```typescript
import { buildGridFromCells, renderMarkdownTable } from './table';
```

파일 끝에 추가:
```typescript
describe('renderMarkdownTable', () => {
  it('격자를 마크다운 표로 렌더링하고 첫 행 아래 구분선을 넣는다', () => {
    const md = renderMarkdownTable([
      ['구분', '금액'],
      ['1차년도', '66,500'],
      ['2차년도', '133,500'],
    ]);
    expect(md).toBe(
      '| 구분 | 금액 |\n' +
      '| --- | --- |\n' +
      '| 1차년도 | 66,500 |\n' +
      '| 2차년도 | 133,500 |'
    );
  });

  it('셀 안의 파이프·줄바꿈은 이스케이프·공백으로 치환한다', () => {
    const md = renderMarkdownTable([['a|b', 'c\nd']]);
    expect(md).toBe('| a\\|b | c d |\n| --- | --- |');
  });

  it('빈 격자는 빈 문자열을 반환한다', () => {
    expect(renderMarkdownTable([])).toBe('');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/table.test.ts`
Expected: FAIL — `renderMarkdownTable`가 없어서 import 에러.

- [ ] **Step 3: 구현 추가**

`src/table.ts` 끝에 추가:
```typescript
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
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/table.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/table.ts src/table.test.ts
git commit -m "feat: 격자를 마크다운 표로 렌더링하는 renderMarkdownTable 추가"
```

---

## Task 3: HWPX — 셀 하나에서 좌표·병합·텍스트 읽기

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/extract.test.ts`

기존 `collectHwpxSectionText`(문단 텍스트만 훑는 평면 스캐너)는 그대로 두고, 표 전용 파싱을 별도 함수로 추가한다 — 표가 아닌 본문은 기존 함수로 계속 처리하기 위해서다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` 상단 import에 추가:
```typescript
import { collectHwpSectionText, collectHwpxSectionText, decodeHwpParagraphText, parseHwpxCell } from './extract';
```

파일 끝에 추가:
```typescript
describe('HWPX 셀 파싱', () => {
  it('cellAddr·cellSpan 속성과 텍스트를 읽는다', () => {
    const cellXml = `<hp:tc name="A" header="0">
      <hp:cellAddr colAddr="1" rowAddr="0"/>
      <hp:cellSpan colSpan="3" rowSpan="1"/>
      <hp:subList><hp:p><hp:run><hp:t>기관부담연구개발비</hp:t></hp:run></hp:p></hp:subList>
    </hp:tc>`;
    expect(parseHwpxCell(cellXml)).toEqual({
      rowAddr: 0, colAddr: 1, rowSpan: 1, colSpan: 3, text: '기관부담연구개발비',
    });
  });

  it('cellAddr·cellSpan이 없으면 0행0열·병합없음으로 취급한다', () => {
    const cellXml = `<hp:tc><hp:subList><hp:p><hp:run><hp:t>단순셀</hp:t></hp:run></hp:p></hp:subList></hp:tc>`;
    expect(parseHwpxCell(cellXml)).toEqual({ rowAddr: 0, colAddr: 0, rowSpan: 1, colSpan: 1, text: '단순셀' });
  });

  it('셀 안에 문단이 여러 개면 공백으로 이어붙인다 (표 셀 안에 줄바꿈을 넣지 않음)', () => {
    const cellXml = `<hp:tc><hp:subList><hp:p><hp:run><hp:t>1줄</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>2줄</hp:t></hp:run></hp:p></hp:subList></hp:tc>`;
    expect(parseHwpxCell(cellXml).text).toBe('1줄 2줄');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "HWPX 셀 파싱"`
Expected: FAIL — `parseHwpxCell`가 export되어 있지 않음.

- [ ] **Step 3: 구현 추가**

`src/extract.ts`의 `collectHwpxSectionText` 함수 바로 다음에 추가 (import에 `TableCell`, `buildGridFromCells`, `renderMarkdownTable` 필요 — 아래 Step 3-1 참고):

Step 3-1. 파일 최상단 import 추가:
```typescript
import type { TableCell } from './table';
import { buildGridFromCells, renderMarkdownTable } from './table';
```

Step 3-2. `collectHwpxSectionText` 함수 정의 바로 아래에 추가:
```typescript
// 태그 안의 속성값 하나를 읽는다 (속성 순서에 의존하지 않음).
const xmlAttr = (tagXml: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tagXml)?.[1];

// hp:tc(셀) XML에서 좌표(cellAddr)·병합(cellSpan)·텍스트를 읽는다.
// cellAddr·cellSpan이 없으면(단순 표 등) 0행0열·병합없음으로 취급한다.
export const parseHwpxCell = (cellXml: string): TableCell => {
  const addrTag = /<hp:cellAddr\b[^/]*\/>/.exec(cellXml)?.[0] ?? '';
  const spanTag = /<hp:cellSpan\b[^/]*\/>/.exec(cellXml)?.[0] ?? '';
  const rowAddr = Number(xmlAttr(addrTag, 'rowAddr') ?? '0') || 0;
  const colAddr = Number(xmlAttr(addrTag, 'colAddr') ?? '0') || 0;
  const rowSpan = Number(xmlAttr(spanTag, 'rowSpan') ?? '1') || 1;
  const colSpan = Number(xmlAttr(spanTag, 'colSpan') ?? '1') || 1;
  const text = collectHwpxSectionText(cellXml).replace(/\n+/g, ' ').trim();
  return { rowAddr, colAddr, rowSpan, colSpan, text };
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts -t "HWPX 셀 파싱"`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(hwpx): 표 셀의 좌표·병합·텍스트를 읽는 parseHwpxCell 추가"
```

---

## Task 4: HWPX — 표 블록을 마크다운 표로 변환

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` import에 `collectHwpxTable` 추가, 파일 끝에 추가:
```typescript
describe('HWPX 표 블록 → 마크다운', () => {
  it('행·열을 순서대로 읽어 마크다운 표로 만든다', () => {
    const tblXml = `<hp:tbl rowCnt="2" colCnt="2">
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>금액</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>1차년도</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>66,500</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
    </hp:tbl>`;
    expect(collectHwpxTable(tblXml)).toBe(
      '| 구분 | 금액 |\n| --- | --- |\n| 1차년도 | 66,500 |'
    );
  });

  it('가로 병합 헤더가 있어도 값이 모든 열에 복제되어 나온다', () => {
    const tblXml = `<hp:tbl>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="3"/><hp:subList><hp:p><hp:run><hp:t>기관부담연구개발비</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>현금</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>현물</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="2"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>합계</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
    </hp:tbl>`;
    const md = collectHwpxTable(tblXml);
    expect(md).toContain('| 기관부담연구개발비 | 기관부담연구개발비 | 기관부담연구개발비 |');
    expect(md).toContain('| 현금 | 현물 | 합계 |');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "HWPX 표 블록"`
Expected: FAIL — `collectHwpxTable`가 없음.

- [ ] **Step 3: 구현 추가**

`src/extract.ts`의 `parseHwpxCell` 다음에 추가:
```typescript
// <hp:tbl> 블록 XML에서 hp:tr(행) → hp:tc(셀) 순으로 셀을 모아 격자를 만들고 마크다운으로 렌더링한다.
export const collectHwpxTable = (tblXml: string): string => {
  const cells: TableCell[] = [];
  const trRe = /<hp:tr\b[^>]*>([\s\S]*?)<\/hp:tr>/g;
  let trMatch = trRe.exec(tblXml);
  while (trMatch) {
    const tcRe = /<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g;
    let tcMatch = tcRe.exec(trMatch[1]);
    while (tcMatch) {
      cells.push(parseHwpxCell(tcMatch[0]));
      tcMatch = tcRe.exec(trMatch[1]);
    }
    trMatch = trRe.exec(tblXml);
  }
  return renderMarkdownTable(buildGridFromCells(cells));
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts -t "HWPX 표 블록"`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(hwpx): 표 블록을 격자로 조립해 마크다운으로 렌더링하는 collectHwpxTable 추가"
```

---

## Task 5: HWPX — 섹션 전체에서 표와 일반 본문을 순서대로 합치기

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` import에 `collectHwpxSectionContent` 추가, 파일 끝에 추가:
```typescript
describe('HWPX 섹션 — 표와 본문을 문서 순서대로', () => {
  it('표 앞뒤 일반 문단과 표를 순서대로 이어붙인다', () => {
    const xml = `<hs:sec xmlns:hp="x">
      <hp:p><hp:run><hp:t>아래 표를 참고하세요.</hp:t></hp:run></hp:p>
      <hp:tbl>
        <hp:tr><hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>
      </hp:tbl>
      <hp:p><hp:run><hp:t>표 끝.</hp:t></hp:run></hp:p>
    </hs:sec>`;
    const result = collectHwpxSectionContent(xml);
    const lines = result.split('\n');
    expect(lines[0]).toBe('아래 표를 참고하세요.');
    expect(result).toContain('| 구분 |');
    expect(result.trim().endsWith('표 끝.')).toBe(true);
  });

  it('표가 없는 섹션은 기존 collectHwpxSectionText와 동일하게 동작한다', () => {
    const xml = `<hp:p><hp:run><hp:t>표 없는 문서</hp:t></hp:run></hp:p>`;
    expect(collectHwpxSectionContent(xml)).toBe(collectHwpxSectionText(xml));
  });

  it('표 하나의 구조 파싱이 실패해도(닫는 태그 없음 등) 그 표만 구조 없이 폴백하고 문서 전체는 실패하지 않는다', () => {
    const xml = `<hp:p><hp:run><hp:t>앞 문단</hp:t></hp:run></hp:p><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>깨진표셀</hp:t></hp:run></hp:p></hp:subList>`;
    // 위 xml은 </hp:tc></hp:tr></hp:tbl>이 없어 표 블록 자체가 감지되지 않는 극단 케이스지만,
    // collectHwpxTable이 내부적으로 예외를 던지는 경우(예: 좌표 파싱 오류)를 흉내내기 위해
    // collectHwpxSectionContent는 항상 try/catch로 감싸 폴백하도록 구현한다.
    expect(() => collectHwpxSectionContent(xml)).not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "HWPX 섹션 — 표와 본문"`
Expected: FAIL — `collectHwpxSectionContent`가 없음.

- [ ] **Step 3: 구현 추가**

`src/extract.ts`의 `collectHwpxTable` 다음에 추가:
```typescript
// 섹션 XML을 위에서부터 훑으며 <hp:tbl> 블록은 마크다운 표로, 그 사이 일반 내용은
// 기존 문단 추출로 처리해 원래 문서 순서 그대로 이어붙인다.
// 표 하나의 구조 파싱이 실패해도(예: 예상 밖 셀 배치) 그 표만 구조 없는 텍스트로 폴백하고
// 문서 전체 추출은 계속 진행한다 — 표 단위 격리 안전장치.
export const collectHwpxSectionContent = (xml: string): string => {
  const tblRe = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match = tblRe.exec(xml);
  while (match) {
    const before = xml.slice(lastIndex, match.index);
    const beforeText = collectHwpxSectionText(before);
    if (beforeText.trim()) parts.push(beforeText);
    try {
      parts.push(collectHwpxTable(match[0]));
    } catch {
      const fallback = collectHwpxSectionText(match[0]);
      if (fallback.trim()) parts.push(fallback);
    }
    lastIndex = match.index + match[0].length;
    match = tblRe.exec(xml);
  }
  const rest = collectHwpxSectionText(xml.slice(lastIndex));
  if (rest.trim()) parts.push(rest);
  return parts.join('\n\n');
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts -t "HWPX 섹션 — 표와 본문"`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(hwpx): 표와 일반 본문을 문서 순서대로 합치는 collectHwpxSectionContent 추가"
```

---

## Task 6: HWPX — extractHwpx가 새 함수를 쓰도록 교체 + 기존 표 테스트 갱신

**Files:**
- Modify: `src/extract.ts:125-137` (`extractHwpx` 함수)
- Modify: `src/extract.test.ts:73-78` (기존 "표 등 중첩 구조" 테스트)

기존 `extract.test.ts`의 73~78행 테스트는 표를 "문단처럼 대충 모아지면 됨" 수준으로만 확인하던 테스트라, 이제 마크다운 표로 정확히 나오는지 확인하도록 바꾼다.

- [ ] **Step 1: 기존 테스트를 새 기대값으로 수정 (먼저 실패 확인용으로 수정)**

`src/extract.test.ts`의 아래 테스트를 찾아:
```typescript
  it('표 등 중첩 구조 안의 텍스트도 문단 단위로 수집한다', () => {
    const xml = `<hp:p a="1"><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>비목</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl><hp:run><hp:t>재료비</hp:t></hp:run></hp:p>`;
    const text = collectHwpxSectionText(xml);
    expect(text).toContain('비목');
    expect(text).toContain('재료비');
  });
```

다음으로 교체:
```typescript
  it('collectHwpxSectionText는 표 태그를 특수 취급하지 않고 안의 텍스트만 모은다 (구조 보존은 collectHwpxSectionContent 담당)', () => {
    const xml = `<hp:p a="1"><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>비목</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl><hp:run><hp:t>재료비</hp:t></hp:run></hp:p>`;
    const text = collectHwpxSectionText(xml);
    expect(text).toContain('비목');
    expect(text).toContain('재료비');
  });
```//(설명 갱신만, 동작은 그대로 — collectHwpxSectionText 자체는 안 바뀜을 명시)

- [ ] **Step 2: extractHwpx가 collectHwpxSectionContent를 쓰도록 수정**

`src/extract.ts`의 `extractHwpx` 함수(기존 125~137행)에서:
```typescript
  const text = sectionNames.map((name) => collectHwpxSectionText(strFromU8(entries[name]))).join('\n');
```
를 다음으로 교체:
```typescript
  const text = sectionNames.map((name) => collectHwpxSectionContent(strFromU8(entries[name]))).join('\n');
```

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx vitest run src/extract.test.ts`
Expected: PASS (모든 HWPX 관련 테스트 통과)

- [ ] **Step 4: 앱 전체 테스트로 회귀 확인**

Run: `npx vitest run`
Expected: PASS (기존 59개 + 이번에 추가한 테스트 모두 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(hwpx): extractHwpx가 표 구조를 보존하는 collectHwpxSectionContent를 사용하도록 교체"
```

---

## Task 7: PDF — 텍스트 조각을 행으로 묶기

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/extract.test.ts`

**Files:** `PdfTextItem` 타입과 행 묶기 함수를 추가한다. pdfjs의 `TextItem`은 `{ str, transform: number[], width, height }` 형태이며 `transform[4]`가 x, `transform[5]`가 y다 (PDF 좌표계는 y가 위로 갈수록 커짐).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` import에 `groupPdfItemsIntoRows` 추가, 파일 끝에 추가:
```typescript
describe('PDF 텍스트 조각 → 행 묶기', () => {
  it('y좌표가 비슷한 조각을 같은 행으로 묶고, 행은 위에서 아래로 정렬한다', () => {
    const items = [
      { str: '금액', x: 100, y: 700, width: 20 },
      { str: '구분', x: 0, y: 700, width: 20 },
      { str: '1차년도', x: 0, y: 680, width: 30 },
    ];
    const rows = groupPdfItemsIntoRows(items);
    expect(rows.length).toBe(2);
    expect(rows[0].map((i) => i.str)).toEqual(['구분', '금액']);
    expect(rows[1].map((i) => i.str)).toEqual(['1차년도']);
  });

  it('y좌표 오차 3 이내는 같은 행으로 취급한다', () => {
    const items = [
      { str: 'a', x: 0, y: 700, width: 10 },
      { str: 'b', x: 20, y: 701.5, width: 10 },
    ];
    expect(groupPdfItemsIntoRows(items).length).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "PDF 텍스트 조각"`
Expected: FAIL — `groupPdfItemsIntoRows`가 없음.

- [ ] **Step 3: 구현 추가**

`src/extract.ts`의 `extractPdf` 함수 바로 앞에 추가:
```typescript
export interface PdfTextItem { str: string; x: number; y: number; width: number }

// y좌표가 비슷한(오차 3pt 이내) 텍스트 조각을 같은 행으로 묶고, 행은 위→아래, 행 안은 왼→오로 정렬한다.
export const groupPdfItemsIntoRows = (items: PdfTextItem[]): PdfTextItem[][] => {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) < 3);
    if (row) row.push(item); else rows.push([item]);
  }
  rows.forEach((row) => row.sort((a, b) => a.x - b.x));
  return rows;
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts -t "PDF 텍스트 조각"`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(pdf): 텍스트 조각을 y좌표 기준으로 행으로 묶는 groupPdfItemsIntoRows 추가"
```

---

## Task 8: PDF — 한 행 안에서 열 나누기 + 표 영역 감지

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` import에 `rowToColumns`, `detectPdfTableRuns` 추가, 파일 끝에 추가:
```typescript
describe('PDF 행 → 열 나누기', () => {
  it('조각 사이 간격이 넓으면 다른 열로 나눈다', () => {
    const row = [
      { str: '1차년도', x: 0, y: 0, width: 40 },
      { str: '66,500', x: 120, y: 0, width: 30 },
      { str: '2,250', x: 200, y: 0, width: 25 },
    ];
    expect(rowToColumns(row)).toEqual(['1차년도', '66,500', '2,250']);
  });

  it('간격이 좁으면 같은 열(한 단어)로 합친다', () => {
    const row = [
      { str: '정부', x: 0, y: 0, width: 20 },
      { str: '지원금', x: 20, y: 0, width: 30 },
    ];
    expect(rowToColumns(row)).toEqual(['정부지원금']);
  });
});

describe('PDF 표 영역 감지', () => {
  it('열 개수가 3개 이상이고 3행 이상 이어지면 표로 판단한다', () => {
    const rowsAsColumns = [
      ['구분', '금액', '비고'],
      ['1차년도', '66,500', ''],
      ['2차년도', '133,500', ''],
      ['합계', '200,000', ''],
    ];
    expect(detectPdfTableRuns(rowsAsColumns)).toEqual([{ start: 0, end: 3 }]);
  });

  it('열이 2개 이하로 흐르는 일반 문단은 표로 판단하지 않는다', () => {
    const rowsAsColumns = [['이 사업은 다음과 같이 지원합니다.'], ['자세한 내용은 붙임을 참고하세요.']];
    expect(detectPdfTableRuns(rowsAsColumns)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "PDF 행 → 열 나누기"`
Expected: FAIL — `rowToColumns`, `detectPdfTableRuns`가 없음.

- [ ] **Step 3: 구현 추가**

`src/extract.ts`의 `groupPdfItemsIntoRows` 다음에 추가:
```typescript
// 한 행 안에서 조각 사이 간격이 평균 글자폭의 3배(최소 8pt) 이상 벌어지면 다음 열로 넘어간다.
export const rowToColumns = (row: PdfTextItem[]): string[] => {
  if (!row.length) return [];
  const avgCharWidth = row.reduce((sum, i) => sum + i.width / Math.max(i.str.length, 1), 0) / row.length;
  const gapThreshold = Math.max(avgCharWidth * 3, 8);
  const columns: string[][] = [[row[0].str]];
  for (let i = 1; i < row.length; i++) {
    const gap = row[i].x - (row[i - 1].x + row[i - 1].width);
    if (gap > gapThreshold) columns.push([row[i].str]);
    else columns[columns.length - 1].push(row[i].str);
  }
  return columns.map((parts) => parts.join('').trim());
};

// 연속된 행에서 열 개수가 3개 이상이고(인접 행과 ±1 오차 허용) 3행 이상 이어지면 표 영역으로 판단한다.
export const detectPdfTableRuns = (rowColumns: string[][]): { start: number; end: number }[] => {
  const runs: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let i = 0; i < rowColumns.length; i++) {
    const colCount = rowColumns[i].length;
    const prevColCount = i > 0 ? rowColumns[i - 1].length : -1;
    const tableLike = colCount >= 3 && (runStart === -1 || Math.abs(colCount - prevColCount) <= 1);
    if (tableLike) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      if (i - runStart >= 3) runs.push({ start: runStart, end: i - 1 });
      runStart = -1;
    }
  }
  if (runStart !== -1 && rowColumns.length - runStart >= 3) runs.push({ start: runStart, end: rowColumns.length - 1 });
  return runs;
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts -t "PDF"`
Expected: PASS (모든 PDF 관련 테스트)

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(pdf): 행을 열로 나누고 연속된 표 영역을 감지하는 rowToColumns·detectPdfTableRuns 추가"
```

---

## Task 9: PDF — extractPdf가 표 영역을 마크다운으로, 나머지는 기존 방식으로 렌더링

**Files:**
- Modify: `src/extract.ts:139-156` (`extractPdf` 함수)
- Modify: `src/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` import에 `renderPdfPageText` 추가, 파일 끝에 추가:
```typescript
describe('PDF 페이지 렌더링 (표 + 일반 문단 혼합)', () => {
  it('표 영역은 마크다운 표로, 표 앞뒤 문단은 공백으로 이어붙인 기존 방식으로 낸다', () => {
    const items = [
      { str: '아래', x: 0, y: 800, width: 20 },
      { str: '표를', x: 25, y: 800, width: 20 },
      { str: '참고', x: 50, y: 800, width: 20 },

      { str: '구분', x: 0, y: 700, width: 20 },
      { str: '금액', x: 100, y: 700, width: 20 },
      { str: '비고', x: 200, y: 700, width: 20 },

      { str: '1차년도', x: 0, y: 680, width: 30 },
      { str: '66,500', x: 100, y: 680, width: 30 },
      { str: '-', x: 200, y: 680, width: 5 },

      { str: '2차년도', x: 0, y: 660, width: 30 },
      { str: '133,500', x: 100, y: 660, width: 30 },
      { str: '-', x: 200, y: 660, width: 5 },
    ];
    const text = renderPdfPageText(items);
    expect(text.split('\n')[0]).toBe('아래 표를 참고');
    expect(text).toContain('| 구분 | 금액 | 비고 |');
    expect(text).toContain('| 1차년도 | 66,500 | - |');
  });

  it('표가 없는 페이지는 기존처럼 공백으로 이어붙인 한 줄을 낸다', () => {
    const items = [
      { str: '일반', x: 0, y: 800, width: 20 },
      { str: '문서', x: 25, y: 800, width: 20 },
    ];
    expect(renderPdfPageText(items)).toBe('일반 문서');
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "PDF 페이지 렌더링"`
Expected: FAIL — `renderPdfPageText`가 없음.

- [ ] **Step 3: 구현 추가 및 extractPdf 교체**

`src/extract.ts`의 `detectPdfTableRuns` 다음, `extractPdf` 함수 앞에 추가:
```typescript
// 한 페이지의 텍스트 조각들을 행/열로 재구성해, 표로 판단된 구간은 마크다운 표로,
// 나머지는 기존처럼 공백으로 이어붙인 한 줄로 렌더링한다.
export const renderPdfPageText = (items: PdfTextItem[]): string => {
  if (!items.length) return '';
  const rows = groupPdfItemsIntoRows(items);
  const rowColumns = rows.map(rowToColumns);
  const runs = detectPdfTableRuns(rowColumns);
  const plainLine = (from: number, to: number) =>
    rows.slice(from, to).map((row) => row.map((i) => i.str).join(' ')).join('\n');

  const parts: string[] = [];
  let cursor = 0;
  for (const run of runs) {
    const before = plainLine(cursor, run.start);
    if (before.trim()) parts.push(before);
    parts.push(renderMarkdownTable(rowColumns.slice(run.start, run.end + 1)));
    cursor = run.end + 1;
  }
  const tail = plainLine(cursor, rows.length);
  if (tail.trim()) parts.push(tail);
  return parts.join('\n');
};
```

기존 `extractPdf` 함수(139~156행) 안의 페이지 루프를:
```typescript
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
```
아래로 교체:
```typescript
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = content.items
      .filter((item): item is { str: string; transform: number[]; width: number } => 'str' in item && item.str.trim().length > 0)
      .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width }));
    pages.push(renderPdfPageText(items));
  }
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 앱 전체 테스트로 회귀 확인**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(pdf): extractPdf가 표 영역을 마크다운 표로 렌더링하도록 교체"
```

---

## Task 10: HWP — 실제 샘플 파일로 표 레코드 구조 검증 (필수, 구현 전에 실행)

**Files:**
- Create: `scripts/inspect-hwp-table.mjs`

HWP5 바이너리의 표 관련 레코드 태그 번호·필드 배치는 공식 문서가 불완전해 확신할 수 없다. 아래 스크립트로 **표가 포함된 실제 HWP 샘플 파일**을 직접 열어 레코드를 전부 덤프하고, 표 컨트롤이 시작되는 지점(태그 번호)을 눈으로 확인한다.

- [ ] **Step 1: 검증 스크립트 작성**

`scripts/inspect-hwp-table.mjs`:
```javascript
// 실행: node scripts/inspect-hwp-table.mjs <표가-포함된-샘플.hwp>
// BodyText 섹션의 모든 레코드(태그·중첩레벨·크기)를 순서대로 출력한다.
// 표가 삽입된 자리 근처(표 앞뒤 문단 텍스트로 위치를 짐작)에서 태그 번호가 무엇인지 확인하는 용도.
import { readFileSync } from 'fs';
import { read, find } from 'cfb';
import pako from 'pako';

const [, , filePath] = process.argv;
if (!filePath) { console.error('사용법: node scripts/inspect-hwp-table.mjs <파일.hwp>'); process.exit(1); }

const container = read(readFileSync(filePath));
const headerEntry = find(container, 'FileHeader');
const headerBytes = new Uint8Array(headerEntry.content);
const flags = new DataView(headerBytes.buffer, headerBytes.byteOffset).getUint32(36, true);
const compressed = (flags & 0b1) !== 0;
console.log(`압축: ${compressed}`);

const sections = [];
container.FullPaths.forEach((path, i) => {
  const m = /BodyText\/Section(\d+)$/.exec(path);
  const content = container.FileIndex[i]?.content;
  if (m && content) sections.push({ index: Number(m[1]), bytes: new Uint8Array(content) });
});
sections.sort((a, b) => a.index - b.index);

const decodeParaTextPreview = (bytes) => {
  // decodeHwpParagraphText의 축약판 — 미리보기용으로 일반 글자만 뽑는다.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = '';
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
    const code = view.getUint16(i, true);
    if (code >= 32) out += String.fromCharCode(code);
  }
  return out.slice(0, 40);
};

for (const section of sections) {
  let bytes = section.bytes;
  try { if (compressed) bytes = pako.inflateRaw(section.bytes); } catch { console.log(`섹션 ${section.index}: inflate 실패, 원본 그대로 시도`); }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  console.log(`\n--- Section ${section.index} (${bytes.byteLength} bytes) ---`);
  while (pos + 4 <= bytes.byteLength) {
    const header = view.getUint32(pos, true);
    pos += 4;
    const tag = header & 0x3ff;
    const level = (header >> 10) & 0x3ff;
    let size = (header >> 20) & 0xfff;
    if (size === 0xfff) {
      if (pos + 4 > bytes.byteLength) { console.log('  ⚠ 크기 필드가 스트림 밖'); break; }
      size = view.getUint32(pos, true);
      pos += 4;
    }
    if (pos + size > bytes.byteLength) { console.log(`  ⚠ tag=${tag} 레코드가 스트림 밖을 가리킴 — 파싱 어긋남 (raw 모드로 재시도 필요할 수 있음)`); break; }
    const preview = tag === 67 ? ` text="${decodeParaTextPreview(bytes.subarray(pos, pos + size))}"` : '';
    console.log(`tag=${tag} level=${level} size=${size}${preview}`);
    pos += size;
  }
}
```

- [ ] **Step 2: 표가 포함된 실제 HWP 파일로 실행**

Run: `node scripts/inspect-hwp-table.mjs <표가-있는-실제-공고문.hwp>`

출력에서 다음을 확인하고 기록한다:
1. 표 앞뒤 문단(`tag=67`의 `text=` 미리보기로 위치 확인) 사이에 등장하는, PARA_TEXT(67)가 아닌 **새로운 태그 번호** — 이것이 표 컨트롤(CTRL_HEADER) 후보다. (HWP5 공개 스펙 기준 추정값: 71)
2. 그 태그 이후 `level`이 증가하는 구간 — 표 내부(셀들의 중첩 문단)로 추정되는 범위.
3. 표 시작 근처에서 행/열 개수나 셀 좌표로 보이는 작은 정수값이 반복되는 레코드 — 이것이 표(TABLE)/리스트헤더(LIST_HEADER) 레코드 후보다. (추정값: TABLE=77, LIST_HEADER=72)

- [ ] **Step 3: 발견한 실제 값을 기록**

이 파일 맨 위 "중요 — HWP 관련 주의사항"에 실제로 확인한 태그 번호를 적어 넣는다 (예: "확인됨: CTRL_HEADER=71, LIST_HEADER=72, TABLE=77" 또는 실제와 다르면 그 값으로). Task 11은 여기서 확인한 값을 사용한다.

- [ ] **Step 4: 커밋**

```bash
git add scripts/inspect-hwp-table.mjs docs/superpowers/plans/2026-07-20-document-table-parsing.md
git commit -m "chore(hwp): 표 레코드 구조 검증 스크립트 추가 및 실측 태그 번호 기록"
```

---

## Task 11: HWP — 표 컨트롤 감지 + 셀 레코드 읽기

**주의**: 이 태스크의 태그 상수(`CTRL_HEADER = 71`, `LIST_HEADER = 72`)는 Task 10에서 확인한 실제 값으로 바꿔야 할 수 있다. 아래 코드는 HWP5 공개 스펙 기준 추정값으로 작성했다.

**Files:**
- Modify: `src/extract.ts`
- Modify: `src/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts`의 `record`/`concat` 헬퍼를 재사용해 파일 끝에 추가 (import에 `collectHwpTable` 추가):
```typescript
describe('HWP 표 레코드 파싱', () => {
  // 표 컨트롤 헤더(71) → 셀 리스트헤더(72, 좌표+병합 포함) → 셀 안 PARA_TEXT(67, level 증가) 구조를 흉내낸다.
  const listHeaderPayload = (rowAddr, colAddr, rowSpan, colSpan) => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, colAddr, true);
    view.setUint16(2, rowAddr, true);
    view.setUint16(4, colSpan, true);
    view.setUint16(6, rowSpan, true);
    return bytes;
  };

  it('표 컨트롤 안 셀들의 좌표·병합·텍스트를 읽어 마크다운 표로 만든다', () => {
    const section = concat(
      record(67, paraBytes(codesOf('표 앞 문단'))),
      record(71, paraBytes(codesOf('tbl '))), // CTRL_HEADER, ctrl-id "tbl "
      record(72, listHeaderPayload(0, 0, 1, 1)), // 셀 (0,0)
      record(67, paraBytes(codesOf('구분'))),
      record(72, listHeaderPayload(0, 1, 1, 1)), // 셀 (0,1)
      record(67, paraBytes(codesOf('금액'))),
      record(67, paraBytes(codesOf('표 뒤 문단'))),
    );
    const result = collectHwpTable(section, 0);
    expect(result.markdown).toContain('| 구분 | 금액 |');
  });
});
```

**참고**: 이 테스트의 `listHeaderPayload` 바이트 배치(콜/로우 addr·span 필드 순서)는 Task 10 실측 결과에 맞춰 조정해야 한다 — 지금은 추정 배치로 작성했다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "HWP 표 레코드"`
Expected: FAIL — `collectHwpTable`이 없음.

- [ ] **Step 3: 구현 추가**

먼저 `src/extract.ts` 상단의 기존 `const TAG_PARA_TEXT = 67;` 바로 아래에 태그 상수를 추가한다 (Task 10 결과에 따라 값 조정):
```typescript
const TAG_CTRL_HEADER = 71; // Task 10에서 확인한 실제 값으로 교체
const TAG_LIST_HEADER = 72; // Task 10에서 확인한 실제 값으로 교체
const CTRL_ID_TABLE = 'tbl ';
```

그다음 `collectHwpSectionText` 함수 다음에 추가:
```typescript
// 표 컨트롤(TAG_CTRL_HEADER, ctrl-id "tbl ") 하나를 시작 위치(pos)부터 읽어,
// 이어지는 셀(TAG_LIST_HEADER: 좌표+병합) + 셀 문단(PARA_TEXT)을 모아 격자를 만들고 마크다운으로 렌더링한다.
// 다음 표 컨트롤이나 레벨이 원래 단계로 돌아오는 지점에서 멈춘다.
export const collectHwpTable = (section: Uint8Array, startPos: number): { markdown: string; nextPos: number } => {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  let pos = startPos;
  const cells: TableCell[] = [];
  let currentCell: TableCell | null = null;
  let currentCellText: string[] = [];

  const flushCell = () => {
    if (currentCell) { cells.push({ ...currentCell, text: currentCellText.join('\n') }); }
    currentCell = null;
    currentCellText = [];
  };

  while (pos + 4 <= section.byteLength) {
    const header = view.getUint32(pos, true);
    const tag = header & 0x3ff;
    let size = (header >> 20) & 0xfff;
    let bodyPos = pos + 4;
    if (size === 0xfff) { size = view.getUint32(bodyPos, true); bodyPos += 4; }
    if (bodyPos + size > section.byteLength) break;

    if (tag === TAG_LIST_HEADER) {
      flushCell();
      const body = section.subarray(bodyPos, bodyPos + size);
      const bodyView = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const colAddr = bodyView.getUint16(0, true);
      const rowAddr = bodyView.getUint16(2, true);
      const colSpan = bodyView.getUint16(4, true) || 1;
      const rowSpan = bodyView.getUint16(6, true) || 1;
      currentCell = { rowAddr, colAddr, rowSpan, colSpan, text: '' };
    } else if (tag === TAG_PARA_TEXT && currentCell) {
      currentCellText.push(decodeHwpParagraphText(section.subarray(bodyPos, bodyPos + size)));
    } else if (tag === TAG_CTRL_HEADER) {
      // 중첩 컨트롤(표 안 다른 컨트롤)은 지원 범위 밖 — 표를 종료하고 폴백한다.
      break;
    }
    pos = bodyPos + size;
  }
  flushCell();
  return { markdown: renderMarkdownTable(buildGridFromCells(cells)), nextPos: pos };
};
```

- [ ] **Step 4: 테스트 실행해 통과 확인 (Task 10 실측값에 맞춰 조정 후)**

Run: `npx vitest run src/extract.test.ts -t "HWP 표 레코드"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(hwp): 표 컨트롤·셀 레코드를 읽어 마크다운 표로 만드는 collectHwpTable 추가"
```

---

## Task 12: HWP — collectHwpSectionText가 표를 만나면 collectHwpTable로 위임 + 안전장치

**Files:**
- Modify: `src/extract.ts:39-58` (`collectHwpSectionText` 함수)
- Modify: `src/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/extract.test.ts` 파일 끝에 추가:
```typescript
describe('HWP 섹션 — 표와 본문을 문서 순서대로', () => {
  it('표 컨트롤을 만나면 마크다운 표로 바꾸고, 앞뒤 문단은 그대로 이어붙인다', () => {
    const listHeaderPayload = (rowAddr, colAddr, rowSpan, colSpan) => {
      const bytes = new Uint8Array(16);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, colAddr, true); view.setUint16(2, rowAddr, true);
      view.setUint16(4, colSpan, true); view.setUint16(6, rowSpan, true);
      return bytes;
    };
    const section = concat(
      record(67, paraBytes(codesOf('표 앞 문단'))),
      record(71, paraBytes(codesOf('tbl '))),
      record(72, listHeaderPayload(0, 0, 1, 1)),
      record(67, paraBytes(codesOf('구분'))),
      record(67, paraBytes(codesOf('표 뒤 문단'))),
    );
    const text = collectHwpSectionText(section);
    expect(text).toContain('표 앞 문단');
    expect(text).toContain('| 구분 |');
    expect(text).toContain('표 뒤 문단');
  });

  it('표가 없는 섹션은 기존과 동일하게 동작한다 (회귀 확인)', () => {
    const section = concat(record(67, paraBytes(codesOf('공고 본문'))));
    expect(collectHwpSectionText(section)).toBe('공고 본문');
  });

  it('표 파싱 중 예상 밖 구조가 나오면 그 표만 구조 없이 폴백하고 문서 전체는 실패하지 않는다', () => {
    // LIST_HEADER 페이로드가 너무 짧아 좌표를 읽을 수 없는 경우
    const section = concat(
      record(71, paraBytes(codesOf('tbl '))),
      record(72, new Uint8Array(2)), // 비정상적으로 짧은 페이로드
      record(67, paraBytes(codesOf('표 뒤 문단'))),
    );
    expect(() => collectHwpSectionText(section)).not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run src/extract.test.ts -t "HWP 섹션 — 표와 본문"`
Expected: FAIL (표가 마크다운으로 안 나옴 — 아직 기존 로직 그대로라 `<hp:tbl>` 관련 컨트롤을 그냥 건너뜀)

- [ ] **Step 3: collectHwpSectionText 수정**

`src/extract.ts`의 기존 `collectHwpSectionText`(39~58행)를:
```typescript
export const collectHwpSectionText = (section: Uint8Array): string => {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const parts: string[] = [];
  let pos = 0;
  while (pos + 4 <= section.byteLength) {
    const header = view.getUint32(pos, true);
    pos += 4;
    const tag = header & 0x3ff;
    let size = (header >> 20) & 0xfff;
    if (size === 0xfff) {
      if (pos + 4 > section.byteLength) throw new Error('레코드 크기 필드가 잘렸습니다');
      size = view.getUint32(pos, true);
      pos += 4;
    }
    if (pos + size > section.byteLength) throw new Error('레코드가 스트림 밖을 가리킵니다');
    if (tag === TAG_PARA_TEXT) parts.push(decodeHwpParagraphText(section.subarray(pos, pos + size)));
    pos += size;
  }
  return parts.join('\n');
};
```
아래로 교체:
```typescript
export const collectHwpSectionText = (section: Uint8Array): string => {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const parts: string[] = [];
  let pos = 0;
  while (pos + 4 <= section.byteLength) {
    const header = view.getUint32(pos, true);
    const tag = header & 0x3ff;
    let size = (header >> 20) & 0xfff;
    let bodyPos = pos + 4;
    if (size === 0xfff) {
      if (bodyPos + 4 > section.byteLength) throw new Error('레코드 크기 필드가 잘렸습니다');
      size = view.getUint32(bodyPos, true);
      bodyPos += 4;
    }
    if (bodyPos + size > section.byteLength) throw new Error('레코드가 스트림 밖을 가리킵니다');

    if (tag === TAG_CTRL_HEADER && isTableCtrl(section.subarray(bodyPos, bodyPos + size))) {
      try {
        const { markdown, nextPos } = collectHwpTable(section, pos);
        parts.push(markdown);
        pos = nextPos;
        continue;
      } catch {
        // 표 하나가 예상 밖 구조면 이 표만 구조 없이 건너뛰고 계속 진행한다 (문서 전체를 막지 않음).
      }
    }
    if (tag === TAG_PARA_TEXT) parts.push(decodeHwpParagraphText(section.subarray(bodyPos, bodyPos + size)));
    pos = bodyPos + size;
  }
  return parts.join('\n');
};
```

`collectHwpSectionText` 정의 바로 위에 컨트롤 ID 판별 헬퍼 추가:
```typescript
// CTRL_HEADER 레코드 본문 앞 4바이트가 컨트롤 ID(ASCII 4글자, 예: "tbl ")다.
const isTableCtrl = (ctrlHeaderBody: Uint8Array): boolean =>
  ctrlHeaderBody.byteLength >= 4 && new TextDecoder('latin1').decode(ctrlHeaderBody.subarray(0, 4)) === CTRL_ID_TABLE;
```

**참고**: `isTableCtrl`의 바이트 순서(정방향 vs 역순)는 Task 10 실측 결과에 따라 `.reverse()`가 필요할 수 있다 — 스크립트 출력에서 CTRL_HEADER 레코드 본문을 16진수로 확인해 맞춘다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run src/extract.test.ts`
Expected: PASS (모든 테스트, Task 10 실측값 반영 후)

- [ ] **Step 5: 앱 전체 테스트로 회귀 확인**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/extract.ts src/extract.test.ts
git commit -m "feat(hwp): collectHwpSectionText가 표 컨트롤을 감지해 마크다운 표로 바꾸도록 확장 (표 단위 폴백 포함)"
```

---

## Task 13: 전체 회귀 + 타입체크

**Files:** 없음 (검증만)

- [ ] **Step 1: 타입체크**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: 에러 없음

- [ ] **Step 2: 전체 테스트**

Run: `npx vitest run`
Expected: 모든 테스트 통과 (기존 59개 + 이번 태스크에서 추가한 테스트)

- [ ] **Step 3: 실제 샘플 문서로 수동 확인**

로컬 개발 서버(`npm run dev`)에서 과제 설정 → "공고문·지침 업로드" 패널에 병합 셀이 있는 실제 HWPX·PDF·HWP 공고문을 각각 업로드하고, "문서에서 규정 추출하기" 실행 전 단계에서 추출된 원문 텍스트(브라우저 개발자도구 콘솔에 `console.log`를 임시로 찍거나, `extractDocumentText` 결과를 그대로 화면에 노출하는 임시 코드로) 표가 마크다운 형태로 올바르게 나오는지 눈으로 확인한다.

- [ ] **Step 4: 최종 커밋 (필요시)**

```bash
git add -A
git commit -m "test: 표 구조 보존 기능 전체 회귀 확인"
```

---

## 스펙 커버리지 체크

- ✅ HWPX 표 구조 보존 (병합 포함) — Task 3~6
- ✅ PDF 좌표 기반 표 재구성 — Task 7~9
- ✅ HWP 표 구조 보존 (병합 포함, 검증 우선) — Task 10~12
- ✅ 공용 마크다운 렌더러 — Task 1~2
- ✅ 표 단위 격리(안전장치) — HWPX: Task 5(collectHwpxSectionContent의 try/catch), HWP: Task 12(collectHwpSectionText의 try/catch). PDF는 휴리스틱 감지 실패 시 자연스럽게 일반 텍스트로 처리되는 설계라 별도 try/catch 불필요.
- ✅ 인터페이스 불변 — Task 6, 9, 12에서 기존 `extractHwpx`/`extractPdf`/`collectHwpSectionText`의 시그니처 유지
- ✅ 회귀 테스트(표 없는 문서는 기존과 동일) — Task 5, 9, 12에 각각 포함
- ⚠️ 표 중첩, 다단 레이아웃 오탐 — 스펙에서 이미 "비목표"로 명시, 별도 태스크 없음 (의도됨)
