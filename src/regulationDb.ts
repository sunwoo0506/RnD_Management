// 규정DB 로더 — Supabase에 올려둔 검증 팩을 받아 앱에 등록한다.
//
// 예산편성 화면의 비목은 근거가 검증된 규정DB 팩에서만 온다(rules.ts의 packFor 참조).
// 그 팩의 출처가 여기다. 번들에도 같은 팩이 들어 있지만 그건 어디까지나 기본값이고,
// 같은 id의 팩이 서버에 있으면 그쪽이 이긴다 — 규정이 개정돼도 앱을 다시 배포하지 않고
// scripts/upload-regulation-db.mjs 만 돌리면 반영되도록.
//
// 읽기는 로그인 사용자만 가능하다(schema.sql의 RLS). 비로그인 상태에서는 조용히 번들 팩으로
// 동작하며, 화면에는 "규정DB 최신본 확인 전"으로 표시된다.
import { supabase } from './supabase';
import { setRegulationPacks } from './rules';
import type { RulePack } from './types';

const CACHE_KEY = 'gwajeon.regulation-packs.v1';

interface CachedPacks { fetchedAt: string; packs: RulePack[] }

const readCache = (): CachedPacks | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPacks;
    return Array.isArray(parsed?.packs) && parsed.packs.every((pack) => Array.isArray(pack?.categories)) ? parsed : null;
  } catch { return null; }
};

const writeCache = (packs: RulePack[]) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), packs })); }
  catch { /* 용량 초과 등 — 캐시는 없어도 동작한다 */ }
};

export const clearRegulationPackCache = () => {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* 무시 */ }
};

export interface RegulationPackStatus {
  packs: RulePack[];
  source: 'server' | 'cache' | 'bundle';
  fetchedAt: string | null;
  error: string | null;
}

// 서버에서 검증 팩을 받아온다. origin='regulation_db' 인 활성 행만 — 사용자가 공유 신청한
// 미검증 팩(origin='extracted')은 관리자가 승인해 regulation_db 로 바뀌기 전에는 오지 않는다.
export const fetchRegulationPacks = async (): Promise<RulePack[]> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data, error } = await supabase
    .from('program_registry')
    .select('pack_id, pack, program_name, year')
    .eq('origin', 'regulation_db')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => row.pack as RulePack)
    .filter((pack): pack is RulePack => !!pack && Array.isArray(pack.categories))
    // 서버 팩에 표시가 빠져 있어도 규정DB 유래임을 보장한다 (예전에 올린 행 대비).
    .map((pack) => ({ ...pack, origin: 'regulation_db' as const }));
};

// 앱 시작 시 한 번 호출한다. 캐시가 있으면 즉시 적용해 첫 화면이 번들 팩으로 잠깐 그려지는 일을
// 막고, 그 뒤 서버 응답으로 갱신한다.
export const initRegulationPacks = async (): Promise<RegulationPackStatus> => {
  const cached = readCache();
  if (cached) setRegulationPacks(cached.packs);

  if (!supabase) {
    return cached
      ? { packs: cached.packs, source: 'cache', fetchedAt: cached.fetchedAt, error: null }
      : { packs: [], source: 'bundle', fetchedAt: null, error: null };
  }

  try {
    const packs = await fetchRegulationPacks();
    // 로그인 전이면 RLS 때문에 0건이 온다 — 이때 캐시를 지우면 오히려 후퇴한다.
    if (!packs.length) {
      return cached
        ? { packs: cached.packs, source: 'cache', fetchedAt: cached.fetchedAt, error: null }
        : { packs: [], source: 'bundle', fetchedAt: null, error: null };
    }
    setRegulationPacks(packs);
    writeCache(packs);
    return { packs, source: 'server', fetchedAt: new Date().toISOString(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '규정DB를 불러오지 못했습니다.';
    return cached
      ? { packs: cached.packs, source: 'cache', fetchedAt: cached.fetchedAt, error: message }
      : { packs: [], source: 'bundle', fetchedAt: null, error: message };
  }
};
