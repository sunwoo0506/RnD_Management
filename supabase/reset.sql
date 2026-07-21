-- 과제온 Supabase 초기화 (1/2)
-- ★ 이 파일은 데이터를 지웁니다. 되돌릴 수 없습니다. ★
--
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 한 뒤, 이어서 schema.sql 을 실행하세요.
--
-- 지우는 것: 과제 데이터(user_projects·projects), 증빙 파일, 공유 문서고(문서·버전·파일·신청),
--           규정 팩 레지스트리, 추출 캐시, 그리고 모든 관련 Storage 파일.
-- 남기는 것: auth.users (로그인 계정). 관리자 계정도 그대로 남으므로 schema.sql 마지막의
--           document_reviewers 등록 UID를 다시 확인만 하면 됩니다.
--
-- 왜 통째로 다시 만드는가: 지금까지 setup/registry/documents/... 8개 파일을 순서대로 덧붙여 온
-- 결과, 이미 폐기된 테이블(registry_admins·registry_documents·projects)과 정책이 남은 채
-- 버킷(registry)만 떠 있는 상태가 됐다. 어느 프로젝트에 어디까지 적용됐는지 추적이 어려워
-- 초기화 후 schema.sql 한 파일로 일원화한다.

-- ---------------------------------------------------------------------------
-- 1) Storage 파일 삭제 (버킷보다 먼저 — 객체가 남아 있으면 버킷을 못 지운다)
-- ---------------------------------------------------------------------------
delete from storage.objects
where bucket_id in (
  'evidence', 'project-documents', 'public-regulations', 'registry_pending',
  'registry',        -- 폐기된 구 버킷
  'regulation-db'    -- schema.sql 에서 새로 만드는 버킷 (재실행 대비)
);

-- Storage 정책 정리 — 정책 이름은 지금까지 쓰인 것을 모두 나열한다.
drop policy if exists "evidence read own" on storage.objects;
drop policy if exists "evidence insert own" on storage.objects;
drop policy if exists "evidence update own" on storage.objects;
drop policy if exists "evidence delete own" on storage.objects;
drop policy if exists "project documents read own" on storage.objects;
drop policy if exists "project documents insert own" on storage.objects;
drop policy if exists "project documents delete own" on storage.objects;
drop policy if exists "public regulations read" on storage.objects;
drop policy if exists "registry files read" on storage.objects;
drop policy if exists "registry files write" on storage.objects;
drop policy if exists "registry files delete" on storage.objects;
drop policy if exists "registry pending insert own" on storage.objects;
drop policy if exists "regulation db read" on storage.objects;

delete from storage.buckets
where id in (
  'evidence', 'project-documents', 'public-regulations', 'registry_pending',
  'registry', 'regulation-db'
);

-- ---------------------------------------------------------------------------
-- 2) 테이블 삭제 (참조 관계 역순 — cascade 로 정책·인덱스도 함께 사라진다)
-- ---------------------------------------------------------------------------
drop table if exists public.document_programs cascade;
drop table if exists public.file_assets cascade;
drop table if exists public.document_versions cascade;
drop table if exists public.document_submissions cascade;
drop table if exists public.documents cascade;

drop table if exists public.program_registry_submissions cascade;
drop table if exists public.program_registry cascade;
drop table if exists public.regulation_packages cascade;

drop table if exists public.document_reviewers cascade;
drop table if exists public.registry_admins cascade;      -- 폐기된 구 방식
drop table if exists public.registry_documents cascade;   -- 폐기된 구 테이블

drop table if exists public.extraction_cache cascade;
drop table if exists public.user_projects cascade;
drop table if exists public.projects cascade;             -- 구버전 단일 과제 테이블

-- 여기까지 실행됐다면 schema.sql 을 이어서 실행하세요.
