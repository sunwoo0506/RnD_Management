// Supabase 초기화 상태를 점검한다 — 스키마를 적용하기 전/후에 무엇이 빠졌는지 확인용.
//
//   node scripts/check-supabase.mjs
//
// 읽기만 하고 아무것도 바꾸지 않는다. SUPABASE_SERVICE_ROLE_KEY 가 있으면 버킷·관리자까지
// 확인하고, 없으면 익명 키로 볼 수 있는 것(테이블 존재 여부)만 확인한다.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const loadEnvLocal = () => {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
};
loadEnvLocal();

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey) {
  console.error('VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY 를 .env.local 에 설정하세요.');
  process.exit(1);
}
const key = serviceKey || anonKey;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

// schema.sql 이 만드는 테이블 — 이 목록과 실제를 대조한다.
const TABLES = [
  'user_projects', 'regulation_packages', 'program_registry', 'documents', 'document_versions',
  'file_assets', 'document_programs', 'document_submissions', 'program_registry_submissions',
  'document_reviewers', 'extraction_cache',
];
const BUCKETS = ['evidence', 'project-documents', 'regulation-db', 'public-regulations', 'registry_pending'];

const ok = (text) => `  [32mOK[0m   ${text}`;
const bad = (text) => `  [31m없음[0m ${text}`;

console.log(`\nSupabase 점검 — ${url.replace(/https:\/\/([^.]+)/, 'https://$1')}`);
console.log(`키: ${serviceKey ? 'service_role (전체 점검)' : 'anon (테이블만 점검)'}\n`);

// 읽기 정책을 일부러 두지 않은 테이블 — 익명 키로는 항상 빈 배열이라 "비어 있음"과 구분되지 않는다.
// (공유 데이터의 쓰기·조회는 service role 을 쓰는 Edge Function 안에서만 일어난다.)
const RLS_HIDDEN = new Set(['document_reviewers', 'document_submissions', 'program_registry_submissions', 'extraction_cache']);

console.log('[테이블]');
const missingTables = [];
for (const table of TABLES) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  if (res.status === 404) { missingTables.push(table); console.log(bad(table)); continue; }
  const rows = res.status === 200 ? await res.json() : null;
  const hidden = !serviceKey && RLS_HIDDEN.has(table);
  const note = res.status !== 200 ? `status ${res.status}`
    : hidden ? '있음 (내용은 RLS 로 가려짐 — 정상)'
    : Array.isArray(rows) && rows.length ? '데이터 있음' : '비어 있음';
  console.log(ok(`${table.padEnd(30)} ${note}`));
}

console.log('\n[스토리지 버킷]');
const missingBuckets = [];
if (serviceKey) {
  const res = await fetch(`${url}/storage/v1/bucket`, { headers });
  const list = res.ok ? await res.json() : [];
  const names = new Set(Array.isArray(list) ? list.map((bucket) => bucket.name) : []);
  for (const bucket of BUCKETS) {
    if (names.has(bucket)) console.log(ok(bucket));
    else { missingBuckets.push(bucket); console.log(bad(bucket)); }
  }
} else {
  console.log('  (service_role 키가 없어 건너뜀 — 버킷 목록은 익명 키로 볼 수 없다)');
}

console.log('\n[관리자]');
if (serviceKey) {
  const res = await fetch(`${url}/rest/v1/document_reviewers?select=user_id`, { headers });
  const rows = res.ok ? await res.json() : [];
  if (Array.isArray(rows) && rows.length) rows.forEach((row) => console.log(ok(`document_reviewers: ${row.user_id}`)));
  else console.log(bad('document_reviewers 가 비어 있다 — 문서·규정 승인을 아무도 할 수 없다'));
} else {
  console.log('  (service_role 키가 없어 건너뜀 — 익명 키로는 읽기 정책이 없어 확인할 수 없다)');
}

const problems = missingTables.length + missingBuckets.length;
console.log(`\n${problems === 0 ? '문제 없음.' : `빠진 것 ${problems}건.`}`);
if (missingTables.length) {
  console.log(`  누락 테이블: ${missingTables.join(', ')}`);
  console.log('  → supabase/reset.sql 실행 후 supabase/schema.sql 을 SQL Editor 에서 실행하세요.');
  console.log('     (테이블이 모두 비어 있다면 reset 으로 잃을 데이터가 없습니다.)');
}
if (missingBuckets.length) console.log(`  누락 버킷: ${missingBuckets.join(', ')} — schema.sql 의 storage 섹션이 적용되지 않았습니다.`);
