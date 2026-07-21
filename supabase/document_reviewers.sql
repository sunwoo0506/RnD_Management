-- 과제온 문서고 관리자 계정 — 고정 비밀번호 하나를 공유하는 대신, 전용 로그인 계정만
-- 등록해 승인 권한을 준다.
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (documents.sql 실행 이후)
--
-- 이 테이블은 RLS만 켜두고 정책은 하나도 두지 않는다 — 클라이언트(anon/authenticated)는
-- 아무도 읽고 쓸 수 없고, registry-admin Edge Function의 서비스 롤만 접근한다.
-- 예전 registry_admins와 다른 점: 그때는 클라이언트가 직접 보내는 DELETE 요청에 이 테이블을
-- RLS 정책 조건으로 걸어서 "권한 없으면 에러 없이 조용히 0건 처리"되는 문제가 있었다. 이번엔
-- 관리자 여부 확인 자체를 서버(Edge Function) 코드 안에서만 하므로 그 문제가 재발할 수 없다.
create table if not exists public.document_reviewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.document_reviewers enable row level security;

-- 승인 기록에 "누가 검토했는지" 남긴다.
alter table public.document_versions add column if not exists reviewed_by uuid references auth.users (id);
alter table public.program_registry add column if not exists reviewed_by uuid references auth.users (id);

-- ★ 관리자 계정 등록 (본인 계정 만든 뒤 마지막에 실행) ★
-- 1) Supabase 대시보드 → Authentication → Users → Add user 로 관리자 전용 이메일 계정을 만든다.
--    (일반 사용자가 쓰는 로그인 화면이 아니라 이 대시보드에서 직접 만드는 계정이다.)
-- 2) 방금 만든 계정의 User UID를 복사해 아래에 붙여넣고 이 줄만 실행한다.
insert into public.document_reviewers (user_id) values ('51ecc617-8cc8-4b28-a1b0-1022512fdf27');
