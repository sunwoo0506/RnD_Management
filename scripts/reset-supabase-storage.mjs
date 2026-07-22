// Storage 버킷의 파일을 비운다 — reset.sql 이 못 하는 일을 대신한다.
//
//   node scripts/reset-supabase-storage.mjs --dry-run   # 지울 목록만 출력
//   node scripts/reset-supabase-storage.mjs             # 실제 삭제
//   node scripts/reset-supabase-storage.mjs evidence    # 특정 버킷만
//
// ★ 되돌릴 수 없습니다. ★
//
// SQL 로 storage.objects 를 지우면 Supabase 가 막는다:
//   ERROR 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
// 그래서 reset.sql 에서 빼고 Storage API 를 쓰는 이 스크립트로 옮겼다.
// 버킷 자체는 지우지 않는다 — schema.sql 이 on conflict do nothing 으로 재사용한다.
//
// 필요한 환경변수 (.env.local 에서 자동으로 읽는다):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   대시보드 → Project Settings → API → service_role
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.filter((arg) => !arg.startsWith('--'));

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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('VITE_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local).');
  console.error('service_role 키는 RLS 를 무시하므로 커밋하거나 브라우저에 노출하지 마세요.');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const BUCKETS = ['evidence', 'project-documents', 'public-regulations', 'registry_pending', 'regulation-db', 'registry'];

// 버킷 안의 모든 파일 경로를 재귀로 모은다 (Storage list 는 한 폴더씩만 준다).
const listAll = async (bucket, prefix = '') => {
  const found = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // id 가 없으면 폴더다 (Supabase Storage 의 관례)
    if (entry.id) found.push(path);
    else found.push(...await listAll(bucket, path));
  }
  return found;
};

let total = 0;
for (const bucket of BUCKETS) {
  if (only.length && !only.includes(bucket)) continue;
  let paths;
  try {
    paths = await listAll(bucket);
  } catch (error) {
    // 없는 버킷은 건너뛴다 (폐기된 registry 등)
    console.log(`  건너뜀  ${bucket} — ${error.message}`);
    continue;
  }
  if (!paths.length) { console.log(`  비어 있음 ${bucket}`); continue; }
  total += paths.length;
  if (dryRun) {
    console.log(`  ${bucket}: ${paths.length}개`);
    for (const path of paths.slice(0, 5)) console.log(`      ${path}`);
    if (paths.length > 5) console.log(`      … 외 ${paths.length - 5}개`);
    continue;
  }
  // remove 는 한 번에 많은 경로를 받지만, 큰 버킷을 대비해 나눠 보낸다.
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) { console.error(`  실패  ${bucket}: ${error.message}`); break; }
  }
  console.log(`  삭제  ${bucket}: ${paths.length}개`);
}

console.log(dryRun
  ? `\n${total}개를 지울 예정입니다. --dry-run 을 빼면 실제로 삭제합니다.`
  : `\n${total}개를 삭제했습니다.`);
