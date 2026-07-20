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
console.log(`섹션 개수: ${sections.length}`);

const decodeParaTextPreview = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = '';
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
    const code = view.getUint16(i, true);
    if (code >= 32) out += String.fromCharCode(code);
  }
  return out.slice(0, 40);
};

const tagCounts = {};

for (const section of sections) {
  let bytes = section.bytes;
  try { if (compressed) bytes = pako.inflateRaw(section.bytes); } catch { console.log(`섹션 ${section.index}: inflate 실패, 원본 그대로 시도`); }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  console.log(`\n--- Section ${section.index} (${bytes.byteLength} bytes) ---`);
  let lineCount = 0;
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
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    const preview = tag === 67 ? ` text="${decodeParaTextPreview(bytes.subarray(pos, pos + size))}"` : '';
    if (lineCount < 400) console.log(`tag=${tag} level=${level} size=${size}${preview}`);
    lineCount++;
    pos += size;
  }
  if (lineCount >= 400) console.log(`... (총 ${lineCount}개 레코드, 400개까지만 출력)`);
}

console.log('\n--- 태그별 등장 횟수 ---');
Object.entries(tagCounts).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([tag, count]) => console.log(`tag=${tag}: ${count}회`));
