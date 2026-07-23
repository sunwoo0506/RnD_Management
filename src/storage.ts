import { saveAs } from 'file-saver';
import { parseResearchers } from './researchers';
import type { Project, Researcher } from './types';

const PROJECT_KEY = 'gwajeon.project.v1';           // 구버전 단일 과제 (마이그레이션 소스로만 사용)
const PROJECTS_KEY = 'gwajeon.projects.v1';         // 다중 과제 배열
const ACTIVE_KEY = 'gwajeon.active-project';        // 마지막으로 열어둔 과제 id
const OWNER_KEY = 'gwajeon.project.owner';
const RESEARCHERS_KEY = 'gwajeon.researchers.v1';   // 연구자 명부 (회사 공통, 과제와 별개)
const CORRUPT_BACKUP_KEY = 'gwajeon.project.corrupt-backup';
const FILE_DB = 'gwajeon-evidence';
const FILE_STORE = 'files';

export const PROJECT_SCHEMA_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// 저장된 JSON이 현재 Project 구조와 맞는지 검증하고, 구버전 데이터의 빠진 필드를 기본값으로 채운다.
export const parseProject = (raw: string | null): Project | null => {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value)) return null;
  const required: [string, 'string' | 'number'][] = [
    ['id', 'string'], ['name', 'string'], ['totalBudget', 'number'], ['startDate', 'string'],
    ['endDate', 'string'], ['settlementDeadline', 'string'], ['companyName', 'string'], ['createdAt', 'string'],
  ];
  for (const [key, type] of required) if (typeof value[key] !== type) return null;
  for (const key of ['members', 'participants', 'budgets', 'expenses']) if (!Array.isArray(value[key])) return null;
  const project = value as unknown as Project;
  if (!Array.isArray(value.emailLogs)) project.emailLogs = [];
  // 구버전 데이터는 latestChange 1건만 저장했다 — changes 이력 배열로 옮긴다.
  if (!Array.isArray(value.changes)) project.changes = isRecord(value.latestChange) ? [value.latestChange as unknown as Project['changes'][number]] : [];
  // 규정 팩 도입 이전 데이터는 구버전 예시 팩(legacy-rnd)으로 계속 동작시킨다.
  if (typeof value.packId !== 'string') project.packId = 'legacy-rnd';
  // customPack이 깨진 형태면 내장 팩으로 되돌아가도록 제거한다.
  if (value.customPack !== undefined && (!isRecord(value.customPack) || !Array.isArray((value.customPack as Record<string, unknown>).categories))) delete (project as Partial<Project>).customPack;
  // 규정팩 보관함이 깨진 형태면 통째로 제거한다 — 열람 이력만 잃고 과제는 정상 동작.
  if (value.extractedPacks !== undefined && (!Array.isArray(value.extractedPacks) || value.extractedPacks.some((entry) => !isRecord(entry) || !isRecord(entry.pack)))) delete (project as Partial<Project>).extractedPacks;
  return project;
};

export const loadProject = (): Project | null => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PROJECT_KEY); } catch { return null; }
  const project = parseProject(raw);
  if (raw && !project) {
    // 손상된 데이터는 조용히 버리지 않고 복구용 키로 옮겨 둔다.
    try {
      localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
      localStorage.removeItem(PROJECT_KEY);
    } catch { /* 저장 공간 부족 시에도 로드는 계속한다 */ }
  }
  return project;
};

export const saveProject = (project: Project | null): boolean => {
  try {
    if (project) localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    else localStorage.removeItem(PROJECT_KEY);
    return true;
  } catch {
    return false;
  }
};

// ---- 다중 과제 저장 ----
// 새 키(projects.v1)가 없으면 구버전 단일 과제(project.v1)를 배열로 이전해 읽는다.
export const loadProjects = (): Project[] => {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) return value.map((item) => parseProject(JSON.stringify(item))).filter((p): p is Project => !!p);
    }
  } catch { /* 아래 구버전 폴백으로 */ }
  const legacy = loadProject();
  return legacy ? [legacy] : [];
};

export const saveProjectsLocal = (projects: Project[]): boolean => {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    localStorage.removeItem(PROJECT_KEY); // 이전 완료 — 구버전 키가 다시 살아나지 않게 비운다
    return true;
  } catch {
    return false;
  }
};

// ---- 연구자 명부 저장 ----
// 과제 배열과 같은 방식(로컬 우선, 로그인 시 클라우드 병행)이지만 회사 공통이라 키가 따로다.
export const loadResearchers = (): Researcher[] => {
  try {
    const raw = localStorage.getItem(RESEARCHERS_KEY);
    if (!raw) return [];
    return parseResearchers(JSON.parse(raw)) ?? [];
  } catch { return []; }
};

export const saveResearchersLocal = (researchers: Researcher[]): boolean => {
  try {
    localStorage.setItem(RESEARCHERS_KEY, JSON.stringify(researchers));
    return true;
  } catch { return false; }
};

export const loadActiveProjectId = (): string | null => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
};

export const saveActiveProjectId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* 다음 방문에 첫 과제가 열릴 뿐 */ }
};

// 브라우저 사본이 누구 것인지 기록한다 — 'local'(로그인 없이 만든 데이터) 또는 계정 user_id.
// 다른 계정으로 로그인할 때 이전 계정의 로컬 잔재를 새 계정 클라우드로 잘못 이전하는 것을 막는 기준.
export const loadProjectOwner = (): string | null => {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
};

export const saveProjectOwner = (owner: string | null) => {
  try {
    if (owner) localStorage.setItem(OWNER_KEY, owner);
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* 기록 실패 시 다음 로그인 때 이전 여부만 보수적으로 판단된다 */ }
};

export const collectEvidenceIds = (project: Project): string[] =>
  project.expenses.flatMap((expense) => expense.evidence.map((item) => item.id));

export const downloadBackup = (project: Project) => {
  const payload = JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), project }, null, 2);
  saveAs(new Blob([payload], { type: 'application/json' }), `과제온_${project.name}_백업.json`);
};

export const parseBackup = (text: string): Project | null => {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && 'project' in value) return parseProject(JSON.stringify(value.project));
    return parseProject(text);
  } catch {
    return null;
  }
};

const openFileDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(FILE_DB, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const storeEvidenceFile = async (id: string, file: File) => {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.objectStore(FILE_STORE).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

export const getEvidenceFile = async (id: string) => {
  const db = await openFileDb();
  const file = await new Promise<File | undefined>((resolve, reject) => {
    const request = db.transaction(FILE_STORE).objectStore(FILE_STORE).get(id);
    request.onsuccess = () => resolve(request.result as File | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return file;
};

export const deleteEvidenceFiles = async (ids: string[]) => {
  if (!ids.length) return;
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite');
    const store = tx.objectStore(FILE_STORE);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};
