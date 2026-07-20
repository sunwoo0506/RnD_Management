// 공유 규정 레지스트리 클라이언트 — 사업명 검색, 규정 팩·원본 문서 저장.
// 읽기는 로그인 사용자 전원, 쓰기는 registry_admins에 등록된 관리자만 가능하다 (RLS).
import { supabase } from './supabase';
import type { RulePack } from './types';

export interface RegistryEntry {
  id: string;
  programName: string;
  year: number | null;
  verified: boolean;
  pack: RulePack;
}

export type RegistryDocRole = 'notice' | 'form' | 'guideline' | 'manual' | 'other';
export const REGISTRY_ROLE_LABEL: Record<RegistryDocRole, string> = {
  notice: '공고문', form: '서류 양식', guideline: '사용 지침', manual: '집행 매뉴얼', other: '기타',
};

export const registryEnabled = () => supabase !== null;

// 파일명으로 문서 역할을 추정한다 — 사용자가 수정할 수 있는 기본값.
export const guessDocRole = (name: string): RegistryDocRole => {
  if (/매뉴얼|manual|교육/i.test(name)) return 'manual';
  if (/양식|서식|별지|계획서/.test(name)) return 'form';
  if (/지침|기준|규정/.test(name)) return 'guideline';
  if (/공고|모집|질의응답|qna|q&a|faq/i.test(name)) return 'notice';
  return 'other';
};

export const searchRegistry = async (query: string): Promise<RegistryEntry[]> => {
  if (!supabase || !query.trim()) return [];
  const { data, error } = await supabase
    .from('program_registry')
    .select('id, program_name, year, verified, pack')
    .ilike('program_name', `%${query.trim()}%`)
    .order('year', { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    programName: row.program_name as string,
    year: (row.year as number | null) ?? null,
    verified: !!row.verified,
    pack: row.pack as RulePack,
  }));
};

// 현재 로그인 사용자가 레지스트리 관리자인지 (RLS 때문에 자기 행만 보이므로 행 존재 여부로 판정)
export const isRegistryAdmin = async (): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase.from('registry_admins').select('user_id').limit(1);
  return !error && !!data?.length;
};

export const saveRegistryEntry = async (programName: string, year: number | null, pack: RulePack, origin = 'pack'): Promise<string> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data, error } = await supabase
    .from('program_registry')
    .insert({ program_name: programName, year, pack, origin, created_by: (await supabase.auth.getUser()).data.user?.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
};

export const uploadRegistryDocument = async (
  file: File,
  meta: { programName: string; year: number | null; role: RegistryDocRole; registryId?: string },
): Promise<void> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  // Storage 키는 ASCII로 유지하고 원래 파일명은 메타 행에 보존한다.
  const ext = /\.[A-Za-z0-9]+$/.exec(file.name)?.[0] ?? '';
  const path = `${crypto.randomUUID()}${ext.toLowerCase()}`;
  const { error: uploadError } = await supabase.storage.from('registry').upload(path, file, { contentType: file.type || undefined });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await supabase.from('registry_documents').insert({
    registry_id: meta.registryId ?? null,
    program_name: meta.programName,
    year: meta.year,
    role: meta.role,
    file_name: file.name,
    storage_path: path,
    uploaded_by: (await supabase.auth.getUser()).data.user?.id,
  });
  if (error) throw new Error(error.message);
};

export interface RegistryDocEntry { id: string; role: RegistryDocRole; fileName: string; storagePath: string; year: number | null }

// 규칙의 출처(문서명·근거 문구)와 가장 잘 맞는 원본 문서를 고른다.
// 예: "QnA 사업비 3번" 근거는 공고문이 아니라 질의응답 파일로, "제65조" 근거는 지침 파일로.
const DOC_FEATURES: { re: RegExp; weight: number }[] = [
  { re: /질의응답|qna|q&a|faq/i, weight: 6 },
  { re: /별첨|양식|서식|별지/, weight: 5 },
  { re: /매뉴얼|교육/, weight: 5 },
  { re: /지침|기준|규정|조문|제\s*\d+\s*조/, weight: 4 },
  { re: /공고|모집/, weight: 3 },
];

export const matchDocToSource = (
  docs: RegistryDocEntry[],
  source: { doc?: string; ref?: string; matchLevel: string },
): RegistryDocEntry | undefined => {
  if (!docs.length) return undefined;
  const hint = `${source.doc ?? ''} ${source.ref ?? ''}`;
  const wantRole = source.matchLevel === 'guideline' ? 'guideline' : source.matchLevel.startsWith('notice') ? 'notice' : undefined;
  let best: RegistryDocEntry | undefined;
  let bestScore = -Infinity;
  for (const doc of docs) {
    let score = 0;
    for (const feature of DOC_FEATURES) {
      const inHint = feature.re.test(hint);
      const inName = feature.re.test(doc.fileName);
      if (inHint && inName) score += feature.weight;
      else if (!inHint && inName) score -= 2; // 출처와 무관한 특수 문서(QnA·별첨 등)는 감점
    }
    if (wantRole && doc.role === wantRole) score += 1;
    if (score > bestScore) { bestScore = score; best = doc; }
  }
  return best;
};

export const listRegistryDocuments = async (programName: string): Promise<RegistryDocEntry[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('registry_documents')
    .select('id, role, file_name, storage_path, year')
    .ilike('program_name', `%${programName.trim()}%`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string, role: row.role as RegistryDocRole, fileName: row.file_name as string,
    storagePath: row.storage_path as string, year: (row.year as number | null) ?? null,
  }));
};

export const downloadRegistryDocument = async (storagePath: string): Promise<Blob> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data, error } = await supabase.storage.from('registry').download(storagePath);
  if (error || !data) throw new Error(error?.message ?? '파일을 내려받지 못했습니다.');
  return data;
};

// 공유 DB의 원본 문서 삭제(관리자 전용, RLS로 강제) — Storage 파일과 메타 행을 함께 지운다.
export const deleteRegistryDocument = async (doc: RegistryDocEntry): Promise<void> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { error: storageError } = await supabase.storage.from('registry').remove([doc.storagePath]);
  if (storageError) throw new Error(storageError.message);
  const { error } = await supabase.from('registry_documents').delete().eq('id', doc.id);
  if (error) throw new Error(error.message);
};
