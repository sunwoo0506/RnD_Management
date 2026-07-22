-- 과제온 Supabase 스키마 (2/2) — 전체 스키마 한 파일
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (reset.sql 실행 직후)
--
-- 이 파일 하나가 setup/registry/documents/document_programs/document_reviewers/
-- program_registry_link/user_projects/extraction 8개 파일을 대체한다. 앞으로 스키마를 바꿀 때는
-- 새 파일을 덧붙이지 말고 이 파일을 고친 뒤 reset.sql → schema.sql 순서로 다시 적용한다.
--
-- 구조 요약
--   과제        user_projects                      (사용자 개인 데이터, RLS 로 본인 것만)
--   규정DB      regulation_packages → program_registry
--                                     (검증된 비목·상한·규칙. 예산편성 화면의 근거)
--   원본 문서   documents → document_versions → file_assets
--   신청 대기   document_submissions / program_registry_submissions
--   검토자      document_reviewers                 (쓰기는 registry-admin Edge Function 만)
--
-- 쓰기 권한 원칙: 공유 데이터(규정DB·문서고)에 대한 INSERT/UPDATE/DELETE 정책은 하나도 두지
-- 않는다. 클라이언트는 읽기와 "신청"만 할 수 있고, 실제 반영은 service role 을 쓰는
-- registry-admin Edge Function 안에서만 일어난다.

-- ===========================================================================
-- 1) 과제 데이터
-- ===========================================================================

-- 과제 1건 = 1행. Project JSON 을 통째로 저장한다 (last-write-wins).
create table public.user_projects (
  id uuid primary key,                                  -- Project.id (클라이언트 생성 UUID)
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index user_projects_user_idx on public.user_projects (user_id);
alter table public.user_projects enable row level security;

create policy "own projects" on public.user_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- 2) 규정DB — 예산편성 화면의 비목이 여기서 온다
-- ===========================================================================

-- 규정DB 패키지 = docs/extraction_DB/<package_name>/ 한 폴더.
-- MVP 산출물 규격(04_mvp_output_spec.md)에 따라 만든 6개 JSON + manifest + Review.xlsx 묶음이며,
-- 원본 파일은 regulation-db 버킷에 그대로 올라간다(storage_prefix). 이 테이블은 그 묶음의 신원과
-- 출처(원본 파일명·해시·추출 범위)를 담아, 화면에 뜬 숫자가 어느 문서 몇 조에서 왔는지 되짚을 수
-- 있게 한다.
create table public.regulation_packages (
  id uuid primary key default gen_random_uuid(),
  package_name text not null unique,            -- gwayeon_startup_growth_2026_214
  document_version text not null,               -- STARTUP_GROWTH_DIDIMDOL_2026_214
  title text not null,
  notice_number text,
  issuer text,
  document_type text,
  revision_type text,
  effective_from date,
  base_document_version text,                   -- 상위 규정 패키지 (NRD_COST_STANDARD_2026_38 등)
  extraction_scope text,
  notes text,
  source_files jsonb not null default '[]'::jsonb,        -- 원본 파일명 + 뽑은 범위
  source_file_sha256 jsonb not null default '{}'::jsonb,  -- 원본 무결성 확인용
  special_effective_dates jsonb not null default '[]'::jsonb,
  counts jsonb not null default '{}'::jsonb,              -- 비목/상한/규칙 건수
  storage_prefix text not null,                 -- regulation-db 버킷 내 폴더 (= package_name)
  generated_at date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index regulation_packages_active_idx on public.regulation_packages (is_active);
alter table public.regulation_packages enable row level security;

create policy "regulation packages read" on public.regulation_packages
  for select to authenticated using (true);

-- 규정 팩 저장소. 패키지 하나가 기관 유형별로 여러 팩을 낼 수 있다(영리/비영리 등).
-- origin
--   regulation_db : 규정DB 패키지에서 변환된 검증 팩 — 예산편성 화면이 쓰는 것 (verified=true)
--   extracted     : 사용자가 앱에서 공고문을 AI 추출해 공유 신청한 것 (관리자 승인 전 verified=false)
--   pack / manual : 과거 내장 스냅샷·수기 등록
create table public.program_registry (
  id uuid primary key default gen_random_uuid(),
  pack_id text unique,                          -- RulePack.id (didimdol2026 등). 앱의 packId 와 같은 값
  regulation_package_id uuid references public.regulation_packages (id) on delete cascade,
  program_name text not null,
  year int,
  pack jsonb not null,                          -- RulePack 전체
  origin text not null default 'pack' check (origin in ('regulation_db', 'extracted', 'pack', 'manual')),
  verified boolean not null default false,      -- 근거 조문까지 검토 완료
  is_active boolean not null default true,
  created_by uuid references auth.users (id),
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index program_registry_name_idx on public.program_registry using gin (to_tsvector('simple', program_name));
create index program_registry_origin_idx on public.program_registry (origin, is_active);
alter table public.program_registry enable row level security;

create policy "registry read" on public.program_registry
  for select to authenticated using (true);

-- ===========================================================================
-- 3) 원본 문서고 — Document / DocumentVersion / FileAsset 3분리
-- ===========================================================================
-- 같은 규정이 여러 사업에 적용돼도 파일은 한 번만 저장하고, 개정되면 기존 버전을 지우지 않고
-- 새 버전을 추가한다.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type text not null check (document_type in (
    'LAW', 'ENFORCEMENT_DECREE', 'ADMINISTRATIVE_RULE', 'MINISTRY_GUIDELINE', 'AGENCY_GUIDELINE',
    'PROGRAM_NOTICE', 'PROGRAM_ATTACHMENT', 'AGREEMENT', 'BUSINESS_PLAN', 'OFFICIAL_LETTER',
    'FAQ', 'QNA_RESPONSE', 'INTERNAL_POLICY', 'OTHER'
  )),
  issuing_authority text,
  document_number text,
  legal_level int,
  visibility text not null default 'PUBLIC' check (visibility = 'PUBLIC'),
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_type_idx on public.documents (document_type);
alter table public.documents enable row level security;

create policy "documents read" on public.documents
  for select to authenticated using (true);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version_label text,
  revision_number text,
  announced_date date,
  effective_from date,
  effective_to date,
  status text not null default 'CURRENT' check (status in ('DRAFT', 'CURRENT', 'EXPIRED', 'REPEALED')),
  previous_version_id uuid references public.document_versions (id),
  source_url text,
  change_summary text,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index document_versions_document_idx on public.document_versions (document_id);
create index document_versions_effective_idx on public.document_versions (effective_from);
alter table public.document_versions enable row level security;

create policy "document versions read" on public.document_versions
  for select to authenticated using (true);

-- 원본은 수정하지 않는다. AI 처리 결과는 asset_type 으로 구분해 따로 쌓는다.
create table public.file_assets (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions (id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  stored_filename text,
  mime_type text,
  file_size bigint,
  file_hash text,
  asset_type text not null default 'ORIGINAL' check (asset_type in ('ORIGINAL', 'NORMALIZED', 'EXTRACTED_TEXT', 'ANALYSIS_JSON')),
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index file_assets_version_idx on public.file_assets (document_version_id);
create index file_assets_hash_idx on public.file_assets (file_hash);
alter table public.file_assets enable row level security;

create policy "file assets read" on public.file_assets
  for select to authenticated using (true);

-- 문서 ↔ 사업명 다대다 연결. 문서 제목과 사업명 텍스트를 비교하는 대신 이 관계로 정확히 잇는다.
create table public.document_programs (
  document_id uuid not null references public.documents (id) on delete cascade,
  program_registry_id uuid not null references public.program_registry (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, program_registry_id)
);
create index document_programs_program_idx on public.document_programs (program_registry_id);
alter table public.document_programs enable row level security;

create policy "document programs read" on public.document_programs
  for select to authenticated using (true);

-- ===========================================================================
-- 4) 신청 대기 — 사용자는 "신청"만, 반영은 관리자 승인 후
-- ===========================================================================

create table public.document_submissions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents (id),   -- 값이 있으면 "기존 문서에 새 버전 추가" 신청
  title text not null,
  document_type text not null check (document_type in (
    'LAW', 'ENFORCEMENT_DECREE', 'ADMINISTRATIVE_RULE', 'MINISTRY_GUIDELINE', 'AGENCY_GUIDELINE',
    'PROGRAM_NOTICE', 'PROGRAM_ATTACHMENT', 'AGREEMENT', 'BUSINESS_PLAN', 'OFFICIAL_LETTER',
    'FAQ', 'QNA_RESPONSE', 'INTERNAL_POLICY', 'OTHER'
  )),
  issuing_authority text,
  document_number text,
  legal_level int,
  version_label text,
  announced_date date,
  effective_from date,
  effective_to date,
  source_url text,
  file_name text not null,
  storage_path text not null,
  file_hash text,
  mime_type text,
  file_size bigint,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.document_submissions enable row level security;

create policy "document submission insert own" on public.document_submissions
  for insert to authenticated with check (auth.uid() = submitted_by);
create policy "document submission select own" on public.document_submissions
  for select to authenticated using (auth.uid() = submitted_by);

-- 규정 팩 공유 신청.
--   package    : 앱이 만든 규정DB 패키지 (manifest + 6개 JSON). docs/extraction_DB 의 폴더와 같은
--                구성이라, 승인되면 사람이 만든 패키지와 똑같은 경로를 거쳐 regulation_packages 와
--                regulation-db 버킷에 들어간다.
--   diff       : 이미 규정DB가 있는 사업일 때, 최신 공고와 무엇이 달라졌는지
--   base_pack_id: 그 비교의 기준이 된 규정DB 팩
create table public.program_registry_submissions (
  id uuid primary key default gen_random_uuid(),
  program_name text not null,
  year int,
  pack jsonb not null,
  package jsonb,                                -- 규정DB 패키지 (manifest + 6개 JSON)
  diff jsonb,                                   -- 기존 팩 대비 변경사항 (PackDiff[])
  base_pack_id text,                            -- 비교 기준이 된 규정DB 팩 (program_registry.pack_id)
  program_registry_id uuid references public.program_registry (id),
  origin text not null default 'extracted',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.program_registry_submissions enable row level security;

create policy "pack submission insert own" on public.program_registry_submissions
  for insert to authenticated with check (auth.uid() = submitted_by);
create policy "pack submission select own" on public.program_registry_submissions
  for select to authenticated using (auth.uid() = submitted_by);

-- ===========================================================================
-- 5) 검토자 — RLS 만 켜고 정책은 두지 않는다 (Edge Function 의 service role 전용)
-- ===========================================================================

create table public.document_reviewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.document_reviewers enable row level security;

-- ===========================================================================
-- 6) 추출 캐시 — 같은 문서를 다시 분석할 때 LLM 호출을 생략
-- ===========================================================================

create table public.extraction_cache (
  hash text primary key,                        -- 입력 텍스트 + 팩 ID 의 SHA-256
  result jsonb not null,
  model text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.extraction_cache enable row level security;

-- 읽기는 전원 (같은 공고문이면 결과를 공유해 비용을 아낀다). 쓰기는 Edge Function 만.
create policy "extraction cache read" on public.extraction_cache
  for select to authenticated using (true);

-- ===========================================================================
-- 7) Storage 버킷
-- ===========================================================================
-- reset.sql 은 버킷을 지우지 않는다 (Supabase 가 storage 테이블 직접 삭제를 막는다).
-- 그래서 여기 insert 는 모두 on conflict do nothing — 이미 있는 버킷은 그대로 두고
-- 정책만 다시 만든다. 버킷 안의 파일을 비우려면 scripts/reset-supabase-storage.mjs 를 쓴다.

-- 7.1 규정DB 패키지 원본 — 경로: {package_name}/{파일명}
--     manifest.json + 6개 JSON + Review.xlsx + README.md + packs/{pack_id}.json
insert into storage.buckets (id, name, public) values ('regulation-db', 'regulation-db', false) on conflict (id) do nothing;

create policy "regulation db read" on storage.objects
  for select to authenticated using (bucket_id = 'regulation-db');

-- 7.2 공유 규정 원본 문서 (승인된 파일만) — 경로: {document_id}/{version_id}/{file_id}/original.<ext>
insert into storage.buckets (id, name, public) values ('public-regulations', 'public-regulations', false) on conflict (id) do nothing;

create policy "public regulations read" on storage.objects
  for select to authenticated using (bucket_id = 'public-regulations');

-- 7.3 신청 대기 파일 — 본인 폴더에만 업로드. 읽기·삭제는 service role 만.
insert into storage.buckets (id, name, public) values ('registry_pending', 'registry_pending', false) on conflict (id) do nothing;

create policy "registry pending insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'registry_pending' and auth.uid()::text = (storage.foldername(name))[1]);

-- 7.4 증빙 파일 — 본인 폴더 전용
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;

create policy "evidence read own" on storage.objects
  for select using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "evidence insert own" on storage.objects
  for insert with check (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "evidence update own" on storage.objects
  for update using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "evidence delete own" on storage.objects
  for delete using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);

-- 7.5 과제 전용 문서 (협약서·사업계획서 등) — 본인 폴더 전용
insert into storage.buckets (id, name, public) values ('project-documents', 'project-documents', false) on conflict (id) do nothing;

create policy "project documents read own" on storage.objects
  for select using (bucket_id = 'project-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "project documents insert own" on storage.objects
  for insert with check (bucket_id = 'project-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "project documents delete own" on storage.objects
  for delete using (bucket_id = 'project-documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- ===========================================================================
-- 8) ★ 마지막 — 관리자 계정 등록 ★
-- ===========================================================================
-- Authentication → Users 에서 관리자 전용 계정의 User UID 를 복사해 아래 값을 확인하세요.
-- reset.sql 은 auth.users 를 지우지 않으므로 기존 UID 가 그대로 유효합니다.
insert into public.document_reviewers (user_id) values ('51ecc617-8cc8-4b28-a1b0-1022512fdf27')
  on conflict (user_id) do nothing;
