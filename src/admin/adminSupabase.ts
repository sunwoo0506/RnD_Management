import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// 관리자 화면 전용 클라이언트 — 일반 사용자 로그인(src/supabase.ts)과 별도의 storageKey를 써서
// 세션을 완전히 분리한다. 같은 브라우저에서 일반 계정 탭과 관리자 계정 탭을 동시에 열어도
// 서로의 로그인 상태를 덮어쓰지 않는다.
export const adminSupabase = url && anonKey
  ? createClient(url, anonKey, { auth: { storageKey: 'gwajeon-admin-auth' } })
  : null;
