import { saveAs } from 'file-saver';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { changeLetterValues, comparisonRows, letterFileName, type ComparisonRow, type LetterValues } from './officialLetter';
import type { BudgetChange, Project } from './types';

// ---- 공문 Word 생성 ----
// docx 라이브러리로 문서를 새로 그리지 않고, 사용자가 만든 표준시행문 템플릿(.docx)의
// {{치환자}}만 바꿔 넣는다. 결재란·접수란·괘선 같은 서식이 그대로 살아야 실제로 제출할 수 있다.
//
// .docx는 XML 몇 개를 담은 zip이라, 압축을 풀고 word/document.xml의 글자를 바꾼 뒤 다시 묶으면 된다.
// 치환자가 XML에서 쪼개져 있지 않은 것은 미리 확인했다 (scripts/make-form-samples.mjs).

const TEMPLATE_URL = '/templates/official-letter.docx';

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 여러 줄 값은 Word 문단 안 줄바꿈으로 바꾼다. 그냥 \n을 넣으면 한 줄로 붙는다.
const toXmlText = (text: string) =>
  escapeXml(text).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');

// 변경 전·후 대비를 실제 Word 표로 만든다. 텍스트로 넣으면 한 셀에 뭉쳐 보인다.
// 본문과 같은 서식(NanumGothic 10pt)을 써서 표가 문서에 자연스럽게 얹힌다.
const RUN = (text: string, bold = false) =>
  `<w:r><w:rPr><w:rFonts w:ascii="NanumGothic" w:hAnsi="NanumGothic" w:eastAsia="NanumGothic"/>${bold ? '<w:b/>' : '<w:b w:val="0"/>'}<w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const CELL = (text: string, { bold = false, right = false, shade = false } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="0"/>${shade ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : ''}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>`
  + `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${right ? 'right' : 'center'}"/></w:pPr>${RUN(text, bold)}</w:p></w:tc>`;
const comparisonTableXml = (rows: ComparisonRow[]): string => {
  const border = '<w:tblBorders>' + ['top', 'bottom', 'start', 'end', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="808080"/>`).join('') + '</w:tblBorders>';
  const head = `<w:tr>${CELL('비목', { bold: true, shade: true })}${CELL('변경 전', { bold: true, shade: true })}${CELL('변경 후', { bold: true, shade: true })}${CELL('증감', { bold: true, shade: true })}</w:tr>`;
  const body = rows.map((row) =>
    `<w:tr>${CELL(row.category, { bold: !!row.total })}${CELL(row.before, { right: true, bold: !!row.total })}${CELL(row.after, { right: true, bold: !!row.total })}${CELL(row.delta, { right: true, bold: !!row.total })}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="4600"/><w:jc w:val="center"/>${border}</w:tblPr>`
    + `<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="1600"/></w:tblGrid>${head}${body}</w:tbl>`
    // 표 바로 뒤에 빈 문단을 둔다 — Word는 표 다음에 문단이 없으면 파일을 깨진 것으로 본다.
    + '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
};

// "주요 내용: {{request_details}}"가 든 문단 뒤에 대비표를 끼운다.
const insertComparisonTable = (xml: string, rows: ComparisonRow[]): string => {
  const marker = xml.indexOf('{{request_details}}');
  if (marker === -1) return xml;
  const pEnd = xml.indexOf('</w:p>', marker);
  if (pEnd === -1) return xml;
  const cut = pEnd + '</w:p>'.length;
  return xml.slice(0, cut) + comparisonTableXml(rows) + xml.slice(cut);
};

const fillPlaceholders = (xml: string, values: LetterValues): string =>
  xml.replace(/\{\{([a-z0-9_]+)\}\}/g, (whole, key: string) =>
    // 값이 없는 치환자는 템플릿에만 있고 이 문서에는 안 쓰는 항목이다 — 빈칸으로 지운다.
    // 그대로 두면 "{{postal_code}}"가 문서에 찍혀 나간다.
    values[key] === undefined ? '' : toXmlText(values[key]));

// 직인 이미지를 "직인" 칸에 끼워 넣는다. Word에서 그림은 파일(word/media) + 관계(rels) +
// 본문의 drawing 태그, 이 셋이 모두 있어야 보인다. 하나라도 빠지면 문서가 열리지 않는다.
const SEAL_MM = 22;                       // 직인 지름 — 실제 도장과 비슷한 크기
const EMU_PER_MM = 36000;
const sealDrawingXml = (relId: string) => {
  const size = SEAL_MM * EMU_PER_MM;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>`
    + `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">`
    + `<wp:extent cx="${size}" cy="${size}"/><wp:docPr id="9001" name="직인"/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="9001" name="직인"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size}" cy="${size}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
};

// 아직 안 쓰는 rId를 고른다 — 이미 있는 번호를 다시 쓰면 원래 관계가 덮여 문서가 깨진다.
const freeRelId = (rels: string): string => {
  const used = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${Math.max(0, ...used) + 1}`;
};

const insertSeal = (files: Record<string, Uint8Array>, seal: { bytes: Uint8Array; ext: string }): void => {
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = strFromU8(files[relsPath]);
  const relId = freeRelId(rels);
  const mediaName = `seal.${seal.ext}`;

  files[`word/media/${mediaName}`] = seal.bytes;
  files[relsPath] = strToU8(rels.replace(
    '</Relationships>',
    `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`,
  ));

  // 이미지 확장자가 [Content_Types].xml에 없으면 Word가 파일을 못 읽는다.
  const typesPath = '[Content_Types].xml';
  const types = strFromU8(files[typesPath]);
  if (!types.includes(`Extension="${seal.ext}"`)) {
    files[typesPath] = strToU8(types.replace(
      '<Types',
      '<Types',
    ).replace('>', `><Default Extension="${seal.ext}" ContentType="image/${seal.ext === 'jpg' ? 'jpeg' : seal.ext}"/>`));
  }

  // 본문의 "직인" 글자가 든 문단을 그림으로 갈아끼운다.
  const docPath = 'word/document.xml';
  let xml = strFromU8(files[docPath]);
  const sealParagraph = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:t[^>]*>직인<\/w:t>[\s\S]*?<\/w:p>/;
  if (sealParagraph.test(xml)) xml = xml.replace(sealParagraph, sealDrawingXml(relId));
  files[docPath] = strToU8(xml);
};

// 저장해둔 직인 파일을 그림으로 넣을 수 있는 형태로 바꾼다.
export const sealImageFrom = async (file: Blob, fileName: string): Promise<{ bytes: Uint8Array; ext: string } | null> => {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), ext: ext === 'jpeg' ? 'jpg' : ext };
};

export const exportChangeLetter = async (
  project: Project,
  change: BudgetChange,
  seal?: { bytes: Uint8Array; ext: string } | null,
): Promise<void> => {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error('공문 서식을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const values = changeLetterValues(project, change, new Date().toISOString());
  // 표 삽입 → 그다음 치환. 순서가 바뀌면 마커({{request_details}})가 이미 지워져 표 자리를 못 찾는다.
  let xml = insertComparisonTable(strFromU8(files['word/document.xml']), comparisonRows(project, change));
  files['word/document.xml'] = strToU8(fillPlaceholders(xml, values));
  if (seal) insertSeal(files, seal);

  saveAs(new Blob([zipSync(files)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }), letterFileName(project, change));
};
