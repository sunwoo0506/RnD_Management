// 규정DB 패키지를 Supabase에 올린다 — Storage(원본 그대로) + 테이블(앱이 읽는 변환 팩).
//
//   node scripts/upload-regulation-db.mjs                          # docs/extraction_DB 전체
//   node scripts/upload-regulation-db.mjs docs/extraction_DB/<폴더>  # 하나만
//   node scripts/upload-regulation-db.mjs --dry-run                # 올리지 않고 계획만 출력
//
// 필요한 환경변수 (.env.local 에 적어두면 자동으로 읽는다):
//   VITE_SUPABASE_URL           대시보드 → Project Settings → API → Project URL
//   SUPABASE_SERVICE_ROLE_KEY   같은 화면의 service_role 키
//
// service_role 키가 필요한 이유: 규정DB는 공유 데이터라 스키마에 쓰기 정책을 하나도 두지 않았다
// (schema.sql 참조). 익명 키로는 절대 쓸 수 없고, 그래야 앱에서 실수로 덮어쓸 일이 없다.
// 이 키는 RLS를 전부 무시하므로 절대 커밋하거나 브라우저에 노출하지 말 것.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));

// ---- 환경변수 ----
const loadEnvLocal = () => {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
};
loadEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!dryRun && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('환경변수가 없습니다.\n'
    + `  VITE_SUPABASE_URL          ${SUPABASE_URL ? 'OK' : '없음'}\n`
    + `  SUPABASE_SERVICE_ROLE_KEY  ${SERVICE_KEY ? 'OK' : '없음'}\n\n`
    + 'Supabase 대시보드 → Project Settings → API → service_role 키를 복사해\n'
    + '.env.local 에 SUPABASE_SERVICE_ROLE_KEY=... 로 추가하세요 (.env.local 은 커밋되지 않습니다).\n'
    + '먼저 계획만 보려면 --dry-run 을 붙이세요.');
  process.exit(1);
}

const db = dryRun ? null : createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'regulation-db';

// ---- 패키지 목록 ----
const extractionRoot = join(root, 'docs', 'extraction_DB');
const packageDirs = targets.length
  ? targets.map((t) => (t.startsWith('docs') || t.includes('/') || t.includes('\\') ? join(root, t) : join(extractionRoot, t)))
  : readdirSync(extractionRoot)
    .map((name) => join(extractionRoot, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'manifest.json')));

if (!packageDirs.length) {
  console.error('올릴 패키지가 없습니다. docs/extraction_DB/<폴더>/manifest.json 을 확인하세요.');
  process.exit(1);
}

// 패키지 폴더에서 함께 올릴 파일 — 원본 HWP/PDF 등은 용량이 크고 공유 문서고(public-regulations)
// 담당이라 여기서는 제외하고, 규정DB 산출물만 올린다.
const UPLOADABLE = /^(manifest\.json|expense_categories\.json|budget_screen_guides\.json|expense_allowed_items\.json|expense_limit_rules\.json|regulation_rules\.json|source_text\.json|review_issues\.json|Review\.xlsx|README\.md)$/;

const MIME = { '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const mimeOf = (name) => MIME[/\.[a-z]+$/i.exec(name)?.[0].toLowerCase() ?? ''] ?? 'application/octet-stream';

const yearOf = (manifest) => {
  const from = manifest.effective_from ?? manifest.generated_at ?? '';
  const year = Number(from.slice(0, 4));
  return Number.isFinite(year) && year > 2000 ? year : null;
};

let failed = 0;

for (const dir of packageDirs) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) { console.error(`건너뜀 — manifest.json 없음: ${dir}`); failed++; continue; }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pkgName = manifest.package_name ?? basename(dir);
  const meta = manifest.pack_meta;

  console.log(`\n■ ${pkgName}`);
  console.log(`  ${manifest.title}`);

  if (!meta?.scopes?.length) {
    console.error('  ✗ manifest.pack_meta.scopes 가 없습니다 — 어떤 규정 팩을 만들지 알 수 없습니다.');
    failed++; continue;
  }

  // 변환된 팩 (scripts/convert-regulation-db.mjs 결과)
  const packPath = join(root, 'src', 'rulepacks', meta.output);
  if (!existsSync(packPath)) {
    console.error(`  ✗ 변환된 팩이 없습니다: src/rulepacks/${meta.output}`);
    console.error(`    먼저 실행하세요: node scripts/convert-regulation-db.mjs ${dir}`);
    failed++; continue;
  }
  const packs = JSON.parse(readFileSync(packPath, 'utf8'));

  // ---- 1) Storage 업로드 ----
  const files = readdirSync(dir).filter((name) => UPLOADABLE.test(name));
  console.log(`  파일 ${files.length}개 + 변환 팩 ${packs.length}개 → ${BUCKET}/${pkgName}/`);

  if (!dryRun) {
    for (const name of files) {
      const body = readFileSync(join(dir, name));
      const { error } = await db.storage.from(BUCKET).upload(`${pkgName}/${name}`, body, { upsert: true, contentType: mimeOf(name) });
      if (error) { console.error(`  ✗ ${name}: ${error.message}`); failed++; }
    }
    for (const pack of packs) {
      const body = Buffer.from(JSON.stringify(pack, null, 1), 'utf8');
      const { error } = await db.storage.from(BUCKET).upload(`${pkgName}/packs/${pack.id}.json`, body, { upsert: true, contentType: 'application/json' });
      if (error) { console.error(`  ✗ packs/${pack.id}.json: ${error.message}`); failed++; }
    }
  }

  // ---- 2) regulation_packages ----
  const row = {
    package_name: pkgName,
    document_version: manifest.document_version,
    title: manifest.title,
    notice_number: manifest.notice_number ?? null,
    issuer: manifest.issuer ?? null,
    document_type: manifest.document_type ?? null,
    revision_type: manifest.revision_type ?? null,
    effective_from: manifest.effective_from ?? null,
    base_document_version: manifest.base_document_version ?? null,
    extraction_scope: manifest.extraction_scope ?? null,
    notes: manifest.notes ?? null,
    source_files: manifest.source_files ?? [],
    source_file_sha256: manifest.source_file_sha256 ?? {},
    special_effective_dates: manifest.special_effective_dates ?? [],
    counts: manifest.counts ?? {},
    storage_prefix: pkgName,
    generated_at: manifest.generated_at ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  let packageId = null;
  if (!dryRun) {
    const { data, error } = await db.from('regulation_packages').upsert(row, { onConflict: 'package_name' }).select('id').single();
    if (error) { console.error(`  ✗ regulation_packages: ${error.message}`); failed++; continue; }
    packageId = data.id;
  }

  // ---- 3) program_registry (팩 하나당 1행) ----
  for (const pack of packs) {
    const scope = meta.scopes.find((s) => s.id === pack.id);
    const programName = scope?.program_name ?? meta.program_name ?? manifest.title;
    console.log(`  · ${pack.id.padEnd(20)} 비목 ${String(pack.categories.length).padStart(2)} · 규칙 ${String(pack.rules.length).padStart(3)} · 조문 ${String(pack.articles?.length ?? 0).padStart(3)}  ${programName}`);
    if (dryRun) continue;

    const { error } = await db.from('program_registry').upsert({
      pack_id: pack.id,
      regulation_package_id: packageId,
      program_name: programName,
      year: yearOf(manifest),
      pack,
      origin: 'regulation_db',
      verified: true,   // 규정DB 패키지 = 근거 조문까지 검토를 마친 것
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'pack_id' });
    if (error) { console.error(`  ✗ program_registry ${pack.id}: ${error.message}`); failed++; }
  }
}

console.log(dryRun ? '\n[--dry-run] 아무것도 올리지 않았습니다.' : failed ? `\n${failed}건 실패했습니다.` : '\n완료.');
process.exit(failed ? 1 : 0);
