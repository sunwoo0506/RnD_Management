-- 과제온 Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.

-- 1) 과제 데이터 테이블: 사용자당 1건, Project JSON 통째 저장
create table if not exists public.projects (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "own project" on public.projects;
create policy "own project" on public.projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) 증빙 파일 버킷: 비공개, 경로 첫 폴더가 본인 user_id 인 파일만 접근 가능
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

drop policy if exists "evidence read own" on storage.objects;
create policy "evidence read own" on storage.objects
  for select using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "evidence insert own" on storage.objects;
create policy "evidence insert own" on storage.objects
  for insert with check (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "evidence update own" on storage.objects;
create policy "evidence update own" on storage.objects
  for update using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "evidence delete own" on storage.objects;
create policy "evidence delete own" on storage.objects
  for delete using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);
