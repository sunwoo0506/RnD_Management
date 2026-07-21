import { supabase } from './supabase';
import { deleteEvidenceFiles, getEvidenceFile, parseProject, storeEvidenceFile } from './storage';
import type { Project } from './types';

// 로그인한 사용자 ID. App의 인증 리스너가 세션 변화에 맞춰 갱신한다.
let userId: string | null = null;
export const setCloudUser = (id: string | null) => { userId = id; };
export const cloudActive = () => supabase !== null && userId !== null;

export const signUpEmail = (email: string, password: string) => supabase!.auth.signUp({ email, password });
export const signInEmail = (email: string, password: string) => supabase!.auth.signInWithPassword({ email, password });
export const signOutCloud = () => supabase?.auth.signOut();

// Supabase 오류 메시지를 한국어로 옮긴다. 매핑에 없으면 원문을 그대로 보여준다.
export const authErrorKo = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/already registered/i.test(message)) return '이미 가입된 이메일입니다. 로그인해주세요.';
  if (/password should be at least/i.test(message)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/email not confirmed/i.test(message)) return '이메일 인증이 완료되지 않았습니다. 받은 편지함을 확인해주세요.';
  if (/rate limit/i.test(message)) return '시도가 너무 잦습니다. 잠시 후 다시 시도해주세요.';
  return message;
};

// 과제 데이터는 과제당 1행(user_projects), JSONB 통째로 저장한다 (last-write-wins).
// user_projects 테이블이 아직 없으면(supabase/user_projects.sql 실행 전) 구버전
// projects(사용자당 1건) 방식으로 폴백한다 — 이때는 마지막으로 저장한 과제만 클라우드에 남는다.
const fetchLegacyProject = async (): Promise<Project | null> => {
  const { data, error } = await supabase!.from('projects').select('data').eq('user_id', userId!).maybeSingle();
  if (error || !data) return null;
  return parseProject(JSON.stringify(data.data));
};

export const fetchCloudProjects = async (): Promise<Project[]> => {
  if (!cloudActive()) return [];
  const { data, error } = await supabase!.from('user_projects').select('data').eq('user_id', userId!).order('updated_at', { ascending: false });
  if (error) {
    // 마이그레이션 전 — 구버전 단일 행으로 폴백
    const legacy = await fetchLegacyProject();
    return legacy ? [legacy] : [];
  }
  const projects = (data ?? []).map((row) => parseProject(JSON.stringify(row.data))).filter((p): p is Project => !!p);
  if (projects.length) return projects;
  // 새 테이블이 비어 있으면 구버전 행을 이전한다 (SQL 마이그레이션을 건너뛴 경우 대비).
  const legacy = await fetchLegacyProject();
  if (!legacy) return [];
  await supabase!.from('user_projects').upsert({ id: legacy.id, user_id: userId!, data: legacy, updated_at: new Date().toISOString() });
  await supabase!.from('projects').delete().eq('user_id', userId!);
  return [legacy];
};

export const saveCloudProject = async (project: Project): Promise<boolean> => {
  if (!cloudActive()) return false;
  const { error } = await supabase!.from('user_projects').upsert({ id: project.id, user_id: userId!, data: project, updated_at: new Date().toISOString() });
  if (!error) return true;
  // 마이그레이션 전 폴백 — 단일 행 방식으로라도 현재 과제는 지킨다.
  const { error: legacyError } = await supabase!.from('projects').upsert({ user_id: userId!, data: project, updated_at: new Date().toISOString() });
  return !legacyError;
};

export const deleteCloudProject = async (projectId: string): Promise<boolean> => {
  if (!cloudActive()) return false;
  const { error } = await supabase!.from('user_projects').delete().eq('user_id', userId!).eq('id', projectId);
  if (error) {
    const { error: legacyError } = await supabase!.from('projects').delete().eq('user_id', userId!);
    return !legacyError;
  }
  return true;
};

// 증빙 파일: 로그인 상태면 Storage(사용자별 폴더), 아니면 브라우저 IndexedDB.
export const storeEvidence = async (id: string, file: File): Promise<void> => {
  if (!cloudActive()) return storeEvidenceFile(id, file);
  const { error } = await supabase!.storage.from('evidence').upload(`${userId}/${id}`, file, { upsert: true, contentType: file.type });
  if (error) throw error;
};

export const getEvidence = async (id: string): Promise<File | undefined> => {
  if (!cloudActive()) return getEvidenceFile(id);
  const { data, error } = await supabase!.storage.from('evidence').download(`${userId}/${id}`);
  if (error || !data) return undefined;
  return new File([data], id, { type: data.type });
};

export const deleteEvidence = async (ids: string[]): Promise<void> => {
  if (!ids.length) return;
  if (!cloudActive()) return deleteEvidenceFiles(ids);
  const { error } = await supabase!.storage.from('evidence').remove(ids.map((id) => `${userId}/${id}`));
  if (error) throw error;
};

// 과제 전용 문서(협약서·사업계획서 등): evidence와 같은 패턴이지만 공유 문서고 기능 자체가
// 클라우드 로그인 전제라 로컬 폴백은 두지 않는다 — 비로그인 시 화면에서 기능을 숨긴다.
export const storeProjectDocument = async (id: string, file: File): Promise<void> => {
  if (!cloudActive()) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase!.storage.from('project-documents').upload(`${userId}/${id}`, file, { upsert: true, contentType: file.type });
  if (error) throw error;
};

export const getProjectDocument = async (id: string): Promise<File | undefined> => {
  if (!cloudActive()) return undefined;
  const { data, error } = await supabase!.storage.from('project-documents').download(`${userId}/${id}`);
  if (error || !data) return undefined;
  return new File([data], id, { type: data.type });
};

export const deleteProjectDocuments = async (ids: string[]): Promise<void> => {
  if (!ids.length || !cloudActive()) return;
  const { error } = await supabase!.storage.from('project-documents').remove(ids.map((id) => `${userId}/${id}`));
  if (error) throw error;
};
