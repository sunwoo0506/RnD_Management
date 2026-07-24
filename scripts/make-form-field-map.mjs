// 템플릿 항목 매핑표 생성 — {{치환자}}의 한글 항목명을 뽑아 문서로 만든다.
//
//   node scripts/make-form-field-map.mjs
//
// 결과: docs/템플릿_항목매핑.md
//
// 템플릿의 표는 "라벨 칸 → 값 칸" 순서라, 문단을 차례로 읽으면서 치환자 바로 앞의
// 글자를 그 치환자의 한글 항목명으로 삼는다. 표 헤더(품명·수량 등) 아래에 값이 오는
// 경우는 헤더를 앞 라벨로 이어 붙인다.
//
// 이 표가 있어야 앱에서 어느 데이터를 어느 칸에 넣을지 정할 수 있다.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

// 문단 단위로 글자를 뽑는다 (표 셀도 문단으로 들어 있다).
const paragraphs = (xml) =>
  [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((m) => m[0].replace(/<[^>]+>/g, '').trim())
    .filter((text) => text.length > 0);

const PLACEHOLDER = /\{\{([a-z0-9_]+)\}\}([^{]*)/g;

const dir = 'docs/템플릿';
const rows = [];
for (const file of readdirSync(dir).filter((name) => name.endsWith('.docx'))) {
  const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(`${dir}/${file}`)))['word/document.xml']);
  const texts = paragraphs(xml);
  let lastLabel = '';
  const seen = new Set();
  const items = [];
  for (const text of texts) {
    const found = [...text.matchAll(PLACEHOLDER)];
    if (found.length === 0) {
      // 치환자가 없는 문단만 라벨 후보다 (번호 셀 "1","2"는 라벨이 아니다)
      if (!/^\d+$/.test(text)) lastLabel = text;
      continue;
    }
    // 문장 속에 섞인 치환자는 바로 앞에 자기 라벨을 달고 있는 일이 많다 ("· 사업명: {{...}}").
    // 그런 경우 문단 전체를 라벨로 삼으면 이름이 문장이 되어 쓸모가 없다.
    for (const match of found) {
      const [, key, suffix] = match;
      if (seen.has(key)) continue;
      seen.add(key);
      // 같은 문단에서 치환자 앞부분을 본다. "· 사업명: {{...}}"처럼 콜론으로 끝나면 그것이 라벨이다.
      const before = text.slice(0, match.index);
      const inline = before.split('·').pop().split('•').pop().trim();
      const label = /[:：]\s*$/.test(inline)
        ? inline.replace(/[:：]\s*$/, '').trim()   // "· 사업명:" → "사업명"
        : lastLabel || '(라벨 없음)';
      items.push({ key, label: label || '(라벨 없음)', unit: suffix.trim().slice(0, 12) });
    }
  }
  rows.push({ file: file.replace(/\.docx$/, ''), items });
}

const lines = [
  '# 템플릿 항목 매핑표 (자동 생성)',
  '',
  '`docs/템플릿/*.docx` 의 치환자마다 **한글 항목명**을 뽑아둔 표입니다.',
  '앱에서 어느 데이터를 어느 칸에 넣을지 정할 때 이 표를 기준으로 합니다.',
  '',
  '- 다시 만들기: `node scripts/make-form-field-map.mjs`',
  '- 샘플 만들기: `node scripts/make-form-samples.mjs`',
  '- 한글명은 템플릿에서 치환자 **바로 앞에 오는 글자**를 따온 것이라, 표 헤더 아래 칸처럼',
  '  라벨이 멀리 떨어진 항목은 이름이 어색할 수 있습니다. 그 경우 이 파일에서 직접 고쳐주세요.',
  '',
  '**출처** 칸은 아직 비어 있습니다 — 앱의 어느 값을 넣을지 정하면서 채워갑니다.',
  '',
];
for (const { file, items } of rows) {
  lines.push(`## ${file}`, '', `치환자 ${items.length}개`, '', '| 한글 항목명 | 치환자 | 단위 | 출처 (앱 데이터) |', '|---|---|---|---|');
  for (const { key, label, unit } of items) lines.push(`| ${label} | \`{{${key}}}\` | ${unit || ''} | |`);
  lines.push('');
}
writeFileSync('docs/템플릿_항목매핑.md', lines.join('\n'));
console.log(`만듦: docs/템플릿_항목매핑.md (문서 ${rows.length}종, 치환자 ${rows.reduce((sum, r) => sum + r.items.length, 0)}개)`);
