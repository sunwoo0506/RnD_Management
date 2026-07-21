-- 규정 팩 신청에 "이미 연결된 사업" 정보를 실어 보낸다
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (documents.sql 이후)
--
-- 지금까지 규정 팩을 공유 신청할 때 사용자가 사업명을 직접 타이핑해서 보냈는데, 같은 사업이라도
-- 표기가 조금만 달라지면(오타·띄어쓰기) program_registry에 중복 행이 생겼다. 과제가 이미
-- 사업명에 연결돼 있다면(공유 규정 팩을 쓰는 중이거나 "근거 원본 문서"에서 수동 연결했다면)
-- 그 연결 id를 신청에 그대로 실어 보내고, 관리자 승인 화면이 텍스트 비교 대신 이 id로 정확히
-- 매칭한다.
alter table public.program_registry_submissions
  add column if not exists program_registry_id uuid references public.program_registry (id);
