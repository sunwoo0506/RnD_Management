-- 과제온 공유 규정 문서고 — Document / DocumentVersion / FileAsset 3분리 모델
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (registry.sql 실행 이후)
--
-- 어제 작업한 "registry_review.sql"은 배포되지 않은 상태였고, 이 파일이 그 자리를 대신한다.
-- 로그인 계정에 관리자 권한을 붙이는 registry_admins 방식은 폐기하고, 공유 DB
-- (documents/document_versions/file_assets)에 대한 쓰기는 전부 registry-admin Edge Function
-- (service role, 비밀번호 인증)만 할 수 있다. 일반 사용자는 "신청"만 하고 대기 테이블
-- (document_submissions)에 쌓여 관리자 승인을 거쳐야 반영된다.
-- 같은 규정이 여러 사업에 적용돼도 파일은 한 번만 저장하고(문서/버전/파일 분리),
-- 개정되면 기존 버전을 지우지 않고 새 버전을 추가한다.

-- 0) 기존 "로그인 계정 관리자" 방식·구 문서 테이블 폐기
drop policy if exists "registry write" on public.program_registry;
drop policy if exists "registry docs write" on public.registry_documents;
drop policy if exists "registry files write" on storage.objects;
drop policy if exists "registry files delete" on storage.objects;
drop table if exists public.registry_admins;
drop table if exists public.registry_documents;

-- program_registry(규정 팩)는 이번 문서 스키마 변경과 무관 — 읽기만 허용, 쓰기는 서비스 롤만
drop policy if exists "registry read" on public.program_registry;
create policy "registry read" on public.program_registry
  for select to authenticated using (true);

-- 1) documents — 문서 자체의 정체성 (PUBLIC 범위만 지금 다룬다)
create table if not exists public.documents (
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
  visibility text not null default 'PUBLIC' check (visibility = 'PUBLIC'), -- ORGANIZATION/PROJECT는 이번 범위 밖
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_type_idx on public.documents (document_type);
create index if not exists documents_visibility_idx on public.documents (visibility);
alter table public.documents enable row level security;

drop policy if exists "documents read" on public.documents;
create policy "documents read" on public.documents
  for select to authenticated using (true);

-- 2) document_versions — 문서의 개정·시행 버전 (이전 버전은 삭제하지 않는다)
create table if not exists public.document_versions (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_versions_document_idx on public.document_versions (document_id);
create index if not exists document_versions_effective_idx on public.document_versions (effective_from);
alter table public.document_versions enable row level security;

drop policy if exists "document versions read" on public.document_versions;
create policy "document versions read" on public.document_versions
  for select to authenticated using (true);

-- 3) file_assets — 실제 저장 파일 (원본은 수정하지 않는다, AI 처리 결과는 별도 asset_type으로 분리)
create table if not exists public.file_assets (
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
create index if not exists file_assets_version_idx on public.file_assets (document_version_id);
create index if not exists file_assets_hash_idx on public.file_assets (file_hash);
alter table public.file_assets enable row level security;

drop policy if exists "file assets read" on public.file_assets;
create policy "file assets read" on public.file_assets
  for select to authenticated using (true);

-- 4) document_submissions — 대기 중인 문서·버전 신청 (registry_document_submissions 대체)
create table if not exists public.document_submissions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents (id), -- 값이 있으면 "기존 문서에 새 버전 추가" 신청
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

drop policy if exists "document submission insert own" on public.document_submissions;
create policy "document submission insert own" on public.document_submissions
  for insert to authenticated with check (auth.uid() = submitted_by);

drop policy if exists "document submission select own" on public.document_submissions;
create policy "document submission select own" on public.document_submissions
  for select to authenticated using (auth.uid() = submitted_by);

-- 5) program_registry_submissions — 규정 팩 공유 신청 (어제 그대로, 이번 변경과 무관)
create table if not exists public.program_registry_submissions (
  id uuid primary key default gen_random_uuid(),
  program_name text not null,
  year int,
  pack jsonb not null,
  origin text not null default 'pack',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.program_registry_submissions enable row level security;

drop policy if exists "pack submission insert own" on public.program_registry_submissions;
create policy "pack submission insert own" on public.program_registry_submissions
  for insert to authenticated with check (auth.uid() = submitted_by);

drop policy if exists "pack submission select own" on public.program_registry_submissions;
create policy "pack submission select own" on public.program_registry_submissions
  for select to authenticated using (auth.uid() = submitted_by);

-- 6) Storage 버킷
-- 6.1 공유 규정 원본 (승인된 파일만) — 경로: {document_id}/{version_id}/{file_id}/original.<ext>
insert into storage.buckets (id, name, public)
values ('public-regulations', 'public-regulations', false)
on conflict (id) do nothing;

drop policy if exists "registry files read" on storage.objects;
drop policy if exists "public regulations read" on storage.objects;
create policy "public regulations read" on storage.objects
  for select to authenticated using (bucket_id = 'public-regulations');

-- 6.2 대기 중인 신청 파일 — 본인 폴더에만 업로드 가능, 읽기/삭제는 서비스 롤(관리자 함수)만
insert into storage.buckets (id, name, public)
values ('registry_pending', 'registry_pending', false)
on conflict (id) do nothing;

drop policy if exists "registry pending insert own" on storage.objects;
create policy "registry pending insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'registry_pending' and auth.uid()::text = (storage.foldername(name))[1]);

-- 6.3 과제 전용 문서(협약서·사업계획서 등) — evidence 버킷과 동일한 본인 폴더 전용 패턴
insert into storage.buckets (id, name, public)
values ('project-documents', 'project-documents', false)
on conflict (id) do nothing;

drop policy if exists "project documents read own" on storage.objects;
create policy "project documents read own" on storage.objects
  for select using (bucket_id = 'project-documents' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "project documents insert own" on storage.objects;
create policy "project documents insert own" on storage.objects
  for insert with check (bucket_id = 'project-documents' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "project documents delete own" on storage.objects;
create policy "project documents delete own" on storage.objects
  for delete using (bucket_id = 'project-documents' and auth.uid()::text = (storage.foldername(name))[1]);
