// 규정 문서에서 본문 텍스트를 뽑는다 (규정 DB 추출의 0단계).
// 사용법: node scripts/extract-hwp-text.mjs <파일> [출력.txt]
// 지원: HWP 5.0 · HWPX · DOCX · PDF
//
// 파싱 방식은 앱의 src/extract.ts와 같다. HWP는 OLE 복합문서에서 BodyText/Section{n}의
// PARA_TEXT(태그 67) 레코드만 모으고, HWPX·DOCX는 ZIP 안의 XML에서 텍스트 노드를 모은다.
// 한글의 "문단 번호" 기능으로 자동 매긴 조문 번호는 본문 텍스트가 아니라 문단 속성에 있어서
// HWP 경로에서는 나오지 않는다 (직접 입력한 번호만 남는다).

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { read, find } from 'cfb';
import { inflateRaw } from 'pako';
import { unzipSync, strFromU8 } from 'fflate';

const HWP_SIGNATURE = 'HWP Document File';
const TAG_PARA_TEXT = 67;
// 인라인·확장 컨트롤 문자는 자신 포함 8 WCHAR를 차지한다 (HWP 5.0 스펙)
const EXTENDED_OR_INLINE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

const decodeParagraphText = (bytes) => {
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
    i += 1;
  }
  return out;
};

const collectSectionText = (section) => {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const parts = [];
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
    if (tag === TAG_PARA_TEXT) parts.push(decodeParagraphText(section.subarray(pos, pos + size)));
    pos += size;
  }
  return parts.join('\n');
};

const extractHwp = (filePath) => {
  const container = read(new Uint8Array(readFileSync(filePath)), { type: 'buffer' });
  const headerEntry = find(container, 'FileHeader');
  const headerBytes = headerEntry?.content ? new Uint8Array(headerEntry.content) : null;
  if (!headerBytes || new TextDecoder('latin1').decode(headerBytes.subarray(0, HWP_SIGNATURE.length)) !== HWP_SIGNATURE) {
    throw new Error('HWP 5.0 형식이 아닙니다.');
  }
  const flags = new DataView(headerBytes.buffer, headerBytes.byteOffset).getUint32(36, true);
  if (flags & 0b10) throw new Error('암호화된 HWP입니다.');
  if (flags & 0b100) throw new Error('배포용(읽기 전용) HWP입니다.');
  const compressed = (flags & 0b1) !== 0;

  const sections = [];
  container.FullPaths.forEach((path, i) => {
    const match = /BodyText\/Section(\d+)$/.exec(path);
    const content = container.FileIndex[i]?.content;
    if (match && content) sections.push({ index: Number(match[1]), bytes: new Uint8Array(content) });
  });
  if (!sections.length) throw new Error('본문(BodyText) 스트림을 찾지 못했습니다.');
  sections.sort((a, b) => a.index - b.index);

  const texts = [];
  for (const section of sections) {
    const attempts = compressed ? ['inflate', 'raw'] : ['raw', 'inflate'];
    let done = false;
    for (const attempt of attempts) {
      try {
        const bytes = attempt === 'inflate' ? inflateRaw(section.bytes) : section.bytes;
        texts.push(collectSectionText(bytes));
        done = true;
        break;
      } catch { /* 다음 방식 시도 */ }
    }
    if (!done) throw new Error(`섹션 ${section.index} 파싱 실패`);
  }
  return { text: texts.join('\n'), sectionCount: sections.length };
};

// ---- HWPX / DOCX (ZIP + XML) ----
const XML_ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const decodeXmlText = (raw) => raw
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;|&gt;|&amp;|&quot;|&apos;/g, (entity) => XML_ENTITIES[entity]);

// 텍스트 태그와 문단 끝을 한 번에 훑어 문단마다 줄바꿈을 넣는다.
// 표 안의 문단이 중첩돼 있어도 텍스트가 유실되지 않는다.
const collectXmlText = (xml, textTag, paraEndTag) => {
  const re = new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>|</${paraEndTag}>`, 'g');
  let out = '';
  let match = re.exec(xml);
  while (match) {
    out += match[1] !== undefined ? decodeXmlText(match[1]) : '\n';
    match = re.exec(xml);
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
};

const unzip = (filePath) => {
  try { return unzipSync(new Uint8Array(readFileSync(filePath))); }
  catch { throw new Error('압축을 풀지 못했습니다. 암호화(DRM) 문서라면 PDF로 변환해 주세요.'); }
};

const extractHwpx = (filePath) => {
  const entries = unzip(filePath);
  const sections = Object.keys(entries)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0));
  if (!sections.length) throw new Error('HWPX 본문(section*.xml)을 찾지 못했습니다.');
  const text = sections.map((name) => collectXmlText(strFromU8(entries[name]), 'hp:t', 'hp:p')).join('\n');
  if (text.replace(/\s/g, '').length < 20) throw new Error('HWPX에서 텍스트를 읽지 못했습니다.');
  return { text, sectionCount: sections.length };
};

const extractDocx = (filePath) => {
  const entries = unzip(filePath);
  const doc = entries['word/document.xml'];
  if (!doc) throw new Error('DOCX 본문(word/document.xml)을 찾지 못했습니다.');
  const text = collectXmlText(strFromU8(doc), 'w:t', 'w:p');
  if (text.replace(/\s/g, '').length < 20) throw new Error('DOCX에서 텍스트를 읽지 못했습니다.');
  return { text, sectionCount: 1 };
};

// ---- PDF ----
// 같은 줄(y좌표 ±3pt)에 있는 조각을 묶고 위→아래, 왼→오 순으로 이어 붙인다.
// 표는 열 구분 없이 한 줄로 이어지지만 규정 문장을 읽는 데는 충분하다.

// 한글에서 내보낸 PDF는 본문을 문장부호 없이 한 조각으로 그리고, 괄호·쉼표를 그 위에 덧그린다.
// 부호의 x를 본문 조각 안 글자 번호로 환산해 덮인 공백 자리를 되짚는다 —
// 이게 없으면 "세금계산서(신용카드 영수증), 견적서"가 "세금계산서 신용카드 영수증( ),  견적서"가 된다.
// 앱의 src/extract.ts 의 restoreOverlaidPunctuation 과 같은 규칙이다.
const PUNCTUATION_ONLY = /^[\s()[\]{}<>,.:;·․‧’‘'"~∼－-]+$/;

const restoreOverlaidPunctuation = (row) => {
  const byX = (a, b) => a.x - b.x;
  const runs = row.filter((item) => !PUNCTUATION_ONLY.test(item.str)).sort(byX);
  // 덧그린 부호는 본문 조각 '위에' 놓인다. 표의 '-' 칸처럼 제 자리를 가진 부호는 건드리지 않는다.
  const overlaid = new Set(row.filter((item) => PUNCTUATION_ONLY.test(item.str) && item.str.trim()
    && runs.some((run) => item.x >= run.x - 0.5 && item.x < run.x + run.width)));
  if (!overlaid.size) return row.filter((item) => item.str.trim()).sort(byX);

  const chars = runs.map((run) => [...run.str]);
  for (const mark of [...overlaid].sort(byX)) {
    const index = runs.findIndex((run) => mark.x >= run.x - 0.5 && mark.x < run.x + run.width);
    const at = Math.round((mark.x - runs[index].x) / runs[index].width * chars[index].length);
    let slot = -1;
    for (let step = 0; step <= 2 && slot < 0; step++) {
      if (chars[index][at + step] === ' ') slot = at + step;
      else if (chars[index][at - step] === ' ') slot = at - step;
    }
    if (slot >= 0) chars[index][slot] = mark.str;
    else chars[index].push(mark.str);
  }
  const standalone = row.filter((item) => !overlaid.has(item) && PUNCTUATION_ONLY.test(item.str) && item.str.trim());
  return [...runs.map((run, i) => ({ ...run, str: chars[i].join('') })), ...standalone].sort(byX);
};

// 조각을 이어 붙일 때 사이가 벌어진 곳에만 공백을 넣는다.
// 무조건 공백을 넣으면 한 낱말이 조각으로 갈린 자리에 "거래처 사 업자등록증"처럼 없는 공백이
// 생기고, 무조건 붙이면 낱말끼리 들러붙는다. 기준은 그 행의 평균 글자폭 1/4 —
// 열을 가르는 기준(평균 글자폭 3배)보다 훨씬 좁아서, 낱말 사이 공백만 가려낸다.
const joinRowText = (row) => {
  if (!row.length) return '';
  const averageCharWidth = row.reduce((sum, item) => sum + item.width / Math.max(item.str.length, 1), 0) / row.length;
  const gapThreshold = Math.max(averageCharWidth / 4, 1);
  let out = row[0].str;
  for (let i = 1; i < row.length; i++) {
    const gap = row[i].x - (row[i - 1].x + row[i - 1].width);
    out += (gap > gapThreshold ? ' ' : '') + row[i].str;
  }
  return out;
};

const extractPdf = async (filePath) => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(readFileSync(filePath)), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const items = content.items
      .filter((item) => 'str' in item && item.str.trim())
      .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width ?? 0 }));
    const rows = [];
    for (const item of [...items].sort((a, b) => b.y - a.y)) {
      const row = rows.find((r) => Math.abs(r[0].y - item.y) < 3);
      if (row) row.push(item); else rows.push([item]);
    }
    pages.push(rows.map((row) => joinRowText(restoreOverlaidPunctuation(row))).join('\n'));
  }
  const text = pages.join('\n');
  if (text.replace(/\s/g, '').length < 50) throw new Error('PDF에서 텍스트를 읽지 못했습니다 (스캔본이면 OCR이 필요합니다).');
  return { text, sectionCount: doc.numPages };
};

const extractDocument = async (filePath) => {
  const name = filePath.toLowerCase();
  if (name.endsWith('.hwpx')) return extractHwpx(filePath);
  if (name.endsWith('.docx')) return extractDocx(filePath);
  if (name.endsWith('.hwp')) return extractHwp(filePath);
  if (name.endsWith('.pdf')) return extractPdf(filePath);
  throw new Error('지원하지 않는 형식입니다 (HWP·HWPX·DOCX·PDF).');
};

const input = process.argv[2];
if (!input) { console.error('사용법: node scripts/extract-hwp-text.mjs <파일> [출력.txt]   (HWP·HWPX·DOCX·PDF)'); process.exit(1); }
const { text, sectionCount } = await extractDocument(input);
const output = process.argv[3];
if (output) {
  writeFileSync(output, text, 'utf8');
  console.log(`${basename(input)} → ${output}`);
} else {
  process.stdout.write(text);
}
console.error(`섹션 ${sectionCount}개 · ${text.length.toLocaleString()}자 · 줄 ${text.split('\n').length.toLocaleString()}`);
