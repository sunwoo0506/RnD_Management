-- 과제온 공유 규정 레지스트리
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (setup.sql 실행 이후)
--
-- 사업별·연도별 규정 팩과 원본 문서(공고문·서류양식·사용지침·집행매뉴얼)를
-- 사용자 개인 데이터와 분리된 "공유 DB"에 저장합니다.
-- 읽기: 로그인 사용자 전원 / 쓰기: registry_admins에 등록된 관리자만.

-- 0) 관리자 목록
create table if not exists public.registry_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.registry_admins enable row level security;

drop policy if exists "admin self read" on public.registry_admins;
create policy "admin self read" on public.registry_admins
  for select using (auth.uid() = user_id);

-- 1) 규정 팩 저장소 (사업명 검색의 대상)
create table if not exists public.program_registry (
  id uuid primary key default gen_random_uuid(),
  program_name text not null,
  year int,
  pack jsonb not null,
  origin text not null default 'pack',        -- pack(내장 스냅샷) | extracted(LLM 추출) | manual
  verified boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists program_registry_name_idx on public.program_registry using gin (to_tsvector('simple', program_name));
alter table public.program_registry enable row level security;

drop policy if exists "registry read" on public.program_registry;
create policy "registry read" on public.program_registry
  for select to authenticated using (true);

drop policy if exists "registry write" on public.program_registry;
create policy "registry write" on public.program_registry
  for all to authenticated
  using (exists (select 1 from public.registry_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.registry_admins where user_id = auth.uid()));

-- 2) 원본 문서 메타 (파일 본체는 Storage 'registry' 버킷)
create table if not exists public.registry_documents (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid references public.program_registry (id) on delete set null,
  program_name text not null,
  year int,
  role text not null default 'notice',        -- notice(공고문) | form(서류양식) | guideline(사용지침) | manual(집행매뉴얼) | other
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.registry_documents enable row level security;

drop policy if exists "registry docs read" on public.registry_documents;
create policy "registry docs read" on public.registry_documents
  for select to authenticated using (true);

drop policy if exists "registry docs write" on public.registry_documents;
create policy "registry docs write" on public.registry_documents
  for all to authenticated
  using (exists (select 1 from public.registry_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.registry_admins where user_id = auth.uid()));

-- 3) 공유 문서 버킷: 읽기 전원 / 쓰기 관리자
insert into storage.buckets (id, name, public)
values ('registry', 'registry', false)
on conflict (id) do nothing;

drop policy if exists "registry files read" on storage.objects;
create policy "registry files read" on storage.objects
  for select to authenticated using (bucket_id = 'registry');

drop policy if exists "registry files write" on storage.objects;
create policy "registry files write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'registry' and exists (select 1 from public.registry_admins where user_id = auth.uid()));

drop policy if exists "registry files delete" on storage.objects;
create policy "registry files delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'registry' and exists (select 1 from public.registry_admins where user_id = auth.uid()));

-- 4) ★ 관리자 등록 (본인 이메일로 바꿔서 마지막에 실행) ★
-- insert into public.registry_admins (user_id)
-- select id from auth.users where email = 'your@email.com'
-- on conflict do nothing;
