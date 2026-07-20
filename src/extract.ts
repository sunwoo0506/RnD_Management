// 공고문·지침 문서에서 텍스트를 추출한다. PDF(pdfjs) · HWP 5.0(OLE 레코드 파싱) · 이미지(OCR) · 일반 텍스트 지원.
// 무거운 파서들은 전부 동적 import — 등록 위저드에서 파일을 올릴 때만 로드된다.

import type { TableCell } from './table';
import { buildGridFromCells, renderMarkdownTable } from './table';
// 타입 전용 import — pdfjs-dist 본체는 extractPdf 안에서 동적 import로만 로드된다 (번들에 영향 없음).
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export interface ExtractedDoc {
  text: string;
  method: 'pdf' | 'hwp' | 'hwpx' | 'image' | 'text';
}

// ---- HWP 5.0 ----
// 구조: OLE 복합 파일 → FileHeader(플래그: 압축/암호/배포용) + BodyText/Section{n} 스트림.
// 각 섹션은 레코드 나열이며 PARA_TEXT(태그 67) 레코드만 모으면 본문이 된다.
// 섹션마다 압축 여부가 다를 수 있어 압축 해제와 원본 파싱을 모두 시도한다.

const HWP_SIGNATURE = 'HWP Document File';
const TAG_PARA_TEXT = 67;

// 컨트롤 문자 분류 (HWP 5.0 스펙): inline/extended 컨트롤은 자신 포함 8 WCHAR를 차지한다.
const EXTENDED_OR_INLINE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

// PARA_TEXT 레코드 페이로드(UTF-16LE + 컨트롤)를 일반 텍스트로 디코딩한다.
export const decodeHwpParagraphText = (bytes: Uint8Array): string => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = '';
  let i = 0;
  const chars = Math.floor(bytes.byteLength / 2);
  while (i < chars) {
    const code = view.getUint16(i * 2, true);
    if (code >= 32) { out += String.fromCharCode(code); i += 1; continue; }
    if (code === 9) { out += '\t'; i += 8; continue; }
    if (EXTENDED_OR_INLINE.has(code)) { i += 8; continue; }
    if (code === 10 || code === 13) out += '\n';
    else if (code === 30 || code === 31) out += ' ';
    i += 1; // 그 외 char 컨트롤(0, 24~29)은 버린다
  }
  return out;
};

// 섹션 바이트에서 레코드를 걸어가며 PARA_TEXT만 모은다. 형식이 어긋나면 예외.
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

const extractHwp = async (file: File): Promise<string> => {
  const [{ read, find }, pako] = await Promise.all([import('cfb'), import('pako')]);
  const container = read(new Uint8Array(await file.arrayBuffer()), { type: 'buffer' });

  const headerEntry = find(container, 'FileHeader');
  const headerBytes = headerEntry?.content ? new Uint8Array(headerEntry.content as ArrayLike<number>) : null;
  if (!headerBytes || new TextDecoder('latin1').decode(headerBytes.subarray(0, HWP_SIGNATURE.length)) !== HWP_SIGNATURE) {
    throw new Error('HWP 5.0 형식이 아닙니다. 한글에서 "PDF로 저장" 후 업로드해주세요.');
  }
  const flags = new DataView(headerBytes.buffer, headerBytes.byteOffset).getUint32(36, true);
  if (flags & 0b10) throw new Error('암호화된 HWP는 읽을 수 없습니다. 암호를 해제하거나 PDF로 변환해주세요.');
  if (flags & 0b100) throw new Error('배포용(읽기 전용) HWP는 읽을 수 없습니다. PDF로 변환해주세요.');
  const compressed = (flags & 0b1) !== 0;

  // BodyText/Section{n}을 번호순으로 수집
  const sections: { index: number; bytes: Uint8Array }[] = [];
  container.FullPaths.forEach((path, i) => {
    const match = /BodyText\/Section(\d+)$/.exec(path);
    const content = container.FileIndex[i]?.content;
    if (match && content) sections.push({ index: Number(match[1]), bytes: new Uint8Array(content as ArrayLike<number>) });
  });
  if (!sections.length) throw new Error('본문(BodyText) 스트림을 찾지 못했습니다.');
  sections.sort((a, b) => a.index - b.index);

  const texts: string[] = [];
  for (const section of sections) {
    // 섹션별로 압축/비압축이 섞일 수 있어 순서를 바꿔가며 둘 다 시도한다.
    const attempts = compressed ? ['inflate', 'raw'] : ['raw', 'inflate'];
    let done = false;
    for (const attempt of attempts) {
      try {
        const bytes = attempt === 'inflate' ? pako.inflateRaw(section.bytes) : section.bytes;
        texts.push(collectHwpSectionText(bytes));
        done = true;
        break;
      } catch { /* 다음 방식 시도 */ }
    }
    if (!done) throw new Error(`섹션 ${section.index} 파싱에 실패했습니다. PDF로 변환해 업로드해주세요.`);
  }
  return texts.join('\n');
};

// ---- HWPX (신형식: ZIP + OWPML XML) ----
// Contents/section{n}.xml 안의 <hp:t> 요소가 본문 텍스트다. 문단(<hp:p>) 단위로 줄바꿈을 넣는다.

const XML_ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const decodeXmlText = (raw: string): string => raw
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;|&gt;|&amp;|&quot;|&apos;/g, (entity) => XML_ENTITIES[entity]);

// 섹션 XML을 한 번 순회하며 hp:t 텍스트를 모으고 문단 닫힘(</hp:p>)마다 줄바꿈을 넣는다.
// 표 안의 문단처럼 <hp:p>가 중첩되어도 텍스트가 유실되지 않는다.
export const collectHwpxSectionText = (xml: string): string => {
  const tokenRe = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<\/hp:p>/g;
  let out = '';
  let match = tokenRe.exec(xml);
  while (match) {
    if (match[1] !== undefined) out += decodeXmlText(match[1]);
    else out += '\n';
    match = tokenRe.exec(xml);
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
};

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

const extractHwpx = async (file: File): Promise<string> => {
  const { unzipSync, strFromU8 } = await import('fflate');
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(await file.arrayBuffer())); }
  catch { throw new Error('HWPX 압축을 풀지 못했습니다. 암호화(DRM) 문서라면 PDF로 변환해 업로드해주세요.'); }
  const sectionNames = Object.keys(entries)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0));
  if (!sectionNames.length) throw new Error('HWPX 본문(section*.xml)을 찾지 못했습니다. PDF로 변환해 업로드해주세요.');
  const text = sectionNames.map((name) => collectHwpxSectionContent(strFromU8(entries[name]))).join('\n');
  if (text.replace(/\s/g, '').length < 20) throw new Error('HWPX에서 텍스트를 읽지 못했습니다. PDF로 변환해 업로드해주세요.');
  return text;
};

// ---- PDF ----

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

// 한 페이지의 텍스트 조각들을 행/열로 재구성해, 표로 판단된 구간은 마크다운 표로,
// 나머지는 기존처럼 공백으로 이어붙인 한 줄로 렌더링한다.
// 참고: 표가 아닌 일반 텍스트도 이제 행 단위로 줄바꿈을 보존한다 (예전엔 페이지 전체가
// 공백으로 이어붙은 한 줄이었음) — AI 추출의 인용 대조(verifyQuote)는 공백을 모두 무시하고
// 비교하므로 이 변경에 영향받지 않는다.
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

const extractPdf = async (file: File): Promise<string> => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  const limit = Math.min(doc.numPages, 60);
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = content.items
      .filter((item): item is TextItem => 'str' in item && item.str.trim().length > 0)
      .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width }));
    pages.push(renderPdfPageText(items));
  }
  const text = pages.join('\n');
  if (text.replace(/\s/g, '').length < 50) {
    throw new Error('PDF에서 텍스트를 읽지 못했습니다. 스캔본이라면 각 페이지를 이미지로 저장해 업로드하거나, 텍스트 PDF로 변환해주세요.');
  }
  return text;
};

// ---- 진입점 ----
export const extractDocumentText = async (file: File): Promise<ExtractedDoc> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.hwpx')) return { text: await extractHwpx(file), method: 'hwpx' };
  if (name.endsWith('.hwp')) return { text: await extractHwp(file), method: 'hwp' };
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return { text: await extractPdf(file), method: 'pdf' };
  if (file.type.startsWith('image/')) {
    const { recognizeReceipt } = await import('./ocr');
    return { text: await recognizeReceipt(file), method: 'image' };
  }
  if (file.type.startsWith('text/') || /\.(txt|md)$/.test(name)) return { text: await file.text(), method: 'text' };
  throw new Error('지원하지 않는 형식입니다. PDF, HWP, 이미지, 텍스트 파일을 업로드해주세요.');
};
