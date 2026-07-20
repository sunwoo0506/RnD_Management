import { createClient } from '@supabase/supabase-js';

// .env.local에 키가 없으면 클라우드 기능을 끄고 로컬 저장(localStorage/IndexedDB)만 사용한다.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const isCloudEnabled = supabase !== null;
