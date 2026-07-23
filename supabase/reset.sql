-- 과제온 Supabase 초기화 (1/2)
-- ★ 이 파일은 데이터를 지웁니다. 되돌릴 수 없습니다. ★
--
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 한 뒤, 이어서 schema.sql 을 실행하세요.
--
-- 지우는 것: 과제 데이터(user_projects·projects), 공유 문서고(문서·버전·파일·신청),
--           규정 팩 레지스트리, 추출 캐시, Storage 정책.
-- 남기는 것: auth.users (로그인 계정), Storage 버킷과 그 안의 파일.
--           관리자 계정도 그대로 남으므로 schema.sql 마지막의 document_reviewers 등록 UID를
--           다시 확인만 하면 됩니다.
--           버킷 안에 파일이 남아 있다면 테이블이 비워진 뒤 참조 없는 파일이 되므로,
--           node scripts/reset-supabase-storage.mjs 로 따로 지우세요.
--
-- 왜 통째로 다시 만드는가: 지금까지 setup/registry/documents/... 8개 파일을 순서대로 덧붙여 온
-- 결과, 이미 폐기된 테이블(registry_admins·registry_documents·projects)과 정책이 남은 채
-- 버킷(registry)만 떠 있는 상태가 됐다. 어느 프로젝트에 어디까지 적용됐는지 추적이 어려워
-- 초기화 후 schema.sql 한 파일로 일원화한다.

-- ---------------------------------------------------------------------------
-- 1) Storage 정책 정리
-- ---------------------------------------------------------------------------
-- ※ 파일(storage.objects)과 버킷(storage.buckets)은 여기서 지우지 않는다.
--    Supabase 가 storage 테이블 직접 삭제를 막는다:
--      ERROR 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
--    파일이 남아 있다면 SQL 이 아니라 Storage API 로 지워야 하므로 다음 스크립트를 쓴다.
--      node scripts/reset-supabase-storage.mjs --dry-run   (지울 목록만 확인)
--      node scripts/reset-supabase-storage.mjs             (실제 삭제)
--    버킷은 지우지 않고 그대로 재사용한다 — schema.sql 의 버킷 생성은 이미 있으면 건너뛴다.

-- 정책 이름은 지금까지 쓰인 것을 모두 나열한다 (정책 삭제는 SQL 로 가능하다).
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

-- ---------------------------------------------------------------------------
-- 2) 테이블 삭제 (참조 관계 역순 — cascade 로 정책·인덱스도 함께 사라진다)
-- ---------------------------------------------------------------------------
drop table if exists public.document_programs cascade;
drop table if exists public.file_assets cascade;
drop table if exists public.document_versions cascade;
drop table if exists public.document_submissions cascade;
drop table if exists public.documents cascade;

drop table if exists public.program_registry_submissions cascade;
drop table if exists public.registry_trash cascade;
drop table if exists public.program_registry cascade;
drop table if exists public.regulation_packages cascade;

drop table if exists public.document_reviewers cascade;
drop table if exists public.registry_admins cascade;      -- 폐기된 구 방식
drop table if exists public.registry_documents cascade;   -- 폐기된 구 테이블

drop table if exists public.extraction_cache cascade;
drop table if exists public.user_projects cascade;
drop table if exists public.user_researchers cascade;     -- 연구자 명부
drop table if exists public.projects cascade;             -- 구버전 단일 과제 테이블

-- 여기까지 실행됐다면 schema.sql 을 이어서 실행하세요.
