// 규정DB 패키지 폴더의 원본 문서(공고문·지침 HWP/HWPX/PDF)를 공유 문서고에 올린다.
//
//   node scripts/upload-source-documents.mjs                          # docs/extraction_DB 전체
//   node scripts/upload-source-documents.mjs docs/extraction_DB/<폴더>  # 하나만
//   node scripts/upload-source-documents.mjs --dry-run                # 올리지 않고 계획만 출력
//
// 규정DB(regulation-db 버킷 + program_registry)와는 별개 체계다. 이쪽은 사람이 근거를 눈으로
// 확인하는 원본 파일 저장소로, documents → document_versions → file_assets 3단이며 파일은
// public-regulations 버킷에 들어간다. 문서는 document_programs 로 사업(program_registry)에
// 연결돼, 앱의 "근거 원본 문서"에서 사업명으로 검색된다.
//
// 같은 파일을 다시 올려도 안전하다 — SHA-256 이 같으면 이미 등록된 것으로 보고 건너뛴다.
//
// 필요한 환경변수 (.env.local 에서 읽는다):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   공유 데이터에는 쓰기 정책이 없어 service role 이 필요하다
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));

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
  console.error('VITE_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local).');
  console.error('먼저 계획만 보려면 --dry-run 을 붙이세요.');
  process.exit(1);
}
const db = dryRun ? null : createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'public-regulations';

// 원본 문서로 올릴 확장자. 규정DB 산출물(JSON·xlsx·md)은 regulation-db 버킷 담당이라 제외한다.
const SOURCE_EXT = /\.(hwp|hwpx|pdf|docx?|txt)$/i;
const MIME = {
  '.hwp': 'application/x-hwp', '.hwpx': 'application/hwp+zip', '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
};

// 파일명으로 문서 유형을 고른다 (schema.sql 의 document_type 체크 목록).
// 순서가 중요하다 — 지침 본문이 "붙임1. …운영지침…본문"처럼 배포되는 경우가 많아,
// 붙임 여부를 먼저 보면 지침이 첨부로 분류된다. 문서의 성격을 나타내는 말을 먼저 본다.
const documentTypeOf = (name, manifest) => {
  if (/FAQ|질의응답|QnA/i.test(name)) return 'FAQ';
  if (/별지|서식/.test(name)) return 'PROGRAM_ATTACHMENT';
  if (/지침|운영요령|매뉴얼/.test(name)) return 'MINISTRY_GUIDELINE';
  if (/공고|모집|시행계획/.test(name)) return 'PROGRAM_NOTICE';
  if (/고시|기준/.test(name)) return 'ADMINISTRATIVE_RULE';
  if (/붙임|참고/.test(name)) return 'PROGRAM_ATTACHMENT';
  return manifest.document_type === 'GUIDELINE' ? 'MINISTRY_GUIDELINE' : 'OTHER';
};

const extractionRoot = join(root, 'docs', 'extraction_DB');
const packageDirs = targets.length
  ? targets.map((t) => (t.includes('/') || t.includes('\\') ? join(root, t) : join(extractionRoot, t)))
  : readdirSync(extractionRoot)
    .map((name) => join(extractionRoot, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'manifest.json')));

let failed = 0;
let uploaded = 0;
let skipped = 0;

for (const dir of packageDirs) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const files = readdirSync(dir).filter((name) => SOURCE_EXT.test(name));
  console.log(`\n■ ${manifest.package_name}`);
  if (!files.length) { console.log('  원본 문서 없음 (건너뜀)'); continue; }

  // 이 패키지가 만드는 팩들이 연결된 사업 행 — 문서를 여기에 잇는다.
  let programIds = [];
  if (!dryRun) {
    const packIds = (manifest.pack_meta?.scopes ?? []).map((s) => s.id);
    const { data, error } = await db.from('program_registry').select('id, pack_id').in('pack_id', packIds);
    if (error) { console.error(`  ✗ 사업 조회 실패: ${error.message}`); failed++; continue; }
    programIds = (data ?? []).map((row) => row.id);
    if (!programIds.length) {
      console.error('  ✗ 연결할 사업이 없습니다 — 먼저 upload-regulation-db.mjs 를 실행하세요.');
      failed++; continue;
    }
  }

  for (const name of files) {
    const body = readFileSync(join(dir, name));
    const hash = createHash('sha256').update(body).digest('hex');
    const type = documentTypeOf(name, manifest);
    const title = name.replace(/\.[^.]+$/, '').replace(/^붙임\d*\.?\s*\+?/, '').replace(/\+/g, ' ').trim();
    console.log(`  · ${type.padEnd(22)} ${title}`);
    if (dryRun) continue;

    // 같은 파일이 이미 있으면(해시 일치) 다시 올리지 않는다.
    const { data: dup } = await db.from('file_assets').select('id').eq('file_hash', hash).limit(1);
    if (dup?.length) { console.log('      이미 등록됨 (해시 일치) — 건너뜀'); skipped++; continue; }

    const { data: doc, error: docError } = await db.from('documents').insert({
      title,
      document_type: type,
      issuing_authority: manifest.issuer ?? null,
      document_number: manifest.notice_number ?? null,
      description: `${manifest.title} 원본 문서`,
    }).select('id').single();
    if (docError) { console.error(`      ✗ documents: ${docError.message}`); failed++; continue; }

    const { data: version, error: versionError } = await db.from('document_versions').insert({
      document_id: doc.id,
      version_label: manifest.revision_type ?? null,
      effective_from: manifest.effective_from ?? null,
      status: 'CURRENT',
    }).select('id').single();
    if (versionError) { console.error(`      ✗ document_versions: ${versionError.message}`); failed++; continue; }

    // 경로는 문서/버전/파일 계층 그대로 — 승인된 원본은 불변이라 이 경로가 그대로 스냅샷이 된다.
    const storagePath = `${doc.id}/${version.id}/original${extname(name).toLowerCase()}`;
    const { error: upError } = await db.storage.from(BUCKET)
      .upload(storagePath, body, { upsert: true, contentType: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream' });
    if (upError) { console.error(`      ✗ storage: ${upError.message}`); failed++; continue; }

    const { error: assetError } = await db.from('file_assets').insert({
      document_version_id: version.id,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      original_filename: name,
      mime_type: MIME[extname(name).toLowerCase()] ?? null,
      file_size: body.length,
      file_hash: hash,
      asset_type: 'ORIGINAL',
    });
    if (assetError) { console.error(`      ✗ file_assets: ${assetError.message}`); failed++; continue; }

    // 이 패키지의 모든 사업(트랙별로 갈린 경우 포함)에 같은 문서를 잇는다.
    const links = programIds.map((programId) => ({ document_id: doc.id, program_registry_id: programId }));
    const { error: linkError } = await db.from('document_programs').upsert(links, { onConflict: 'document_id,program_registry_id' });
    if (linkError) { console.error(`      ✗ document_programs: ${linkError.message}`); failed++; continue; }

    console.log(`      올림 (${(body.length / 1024).toFixed(0)}KB · 사업 ${programIds.length}개 연결)`);
    uploaded++;
  }
}

console.log(dryRun
  ? '\n[--dry-run] 아무것도 올리지 않았습니다.'
  : `\n올림 ${uploaded}건 · 건너뜀 ${skipped}건${failed ? ` · 실패 ${failed}건` : ''}`);
process.exit(failed ? 1 : 0);
