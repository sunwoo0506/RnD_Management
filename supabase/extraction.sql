-- 규정 추출 결과 캐시 (같은 문서를 다시 분석할 때 LLM 호출을 생략)
-- Supabase 대시보드 → SQL Editor 에서 실행하세요.

create table if not exists public.extraction_cache (
  hash text primary key,          -- 입력 텍스트+팩 ID의 SHA-256
  result jsonb not null,
  model text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.extraction_cache enable row level security;

-- 읽기: 로그인 사용자 전원 (같은 공고문이면 결과 공유 — 비용 절감)
drop policy if exists "extraction cache read" on public.extraction_cache;
create policy "extraction cache read" on public.extraction_cache
  for select to authenticated using (true);

-- 쓰기: Edge Function(service role)만 — 클라이언트 직접 쓰기 없음 (정책 미부여)
