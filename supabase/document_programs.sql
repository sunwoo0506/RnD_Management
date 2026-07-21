-- 문서 ↔ 사업명(program_registry) 연결
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (documents.sql 실행 이후)
--
-- "근거 원본 문서" 패널이 지금까지 문서 제목과 사업명 텍스트가 겹치는지로 억지로 매칭하고
-- 있었는데, documents 테이블엔 애초에 사업명을 담는 필드가 없어서 문서명에 사업명을 안 넣으면
-- 못 찾았다. 문서명에 사업명을 끼워 넣는 규칙을 만들면 처음 이 작업을 시작한 이유(사업명
-- 오타·표기 차이로 중복 발생)를 그대로 재현하게 된다.
-- 대신 이미 오타·중복이 정리된 상태로 관리되는 program_registry(사업명 레지스트리)를 기준으로
-- 문서를 명시적으로 연결한다 — 텍스트 매칭이 아니라 이 관계 테이블로.
-- 같은 규정이 여러 사업에 적용될 수 있으므로 다대다(many-to-many)로 둔다.
create table if not exists public.document_programs (
  document_id uuid not null references public.documents (id) on delete cascade,
  program_registry_id uuid not null references public.program_registry (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, program_registry_id)
);
create index if not exists document_programs_program_idx on public.document_programs (program_registry_id);
alter table public.document_programs enable row level security;

drop policy if exists "document programs read" on public.document_programs;
create policy "document programs read" on public.document_programs
  for select to authenticated using (true);
-- 쓰기는 registry-admin Edge Function(service role)만 — 클라이언트 직접 쓰기 없음 (정책 미부여)
