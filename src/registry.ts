// 공유 규정 문서고 클라이언트 — 문서 검색, 승인된 문서/버전/파일 읽기, 공유 신청.
// 문서는 Document(정체성) → DocumentVersion(개정·시행 버전) → FileAsset(실제 파일) 3단계로
// 분리돼 있다 — 개정되면 새 버전을 추가할 뿐 이전 버전은 지우지 않는다.
// 읽기는 로그인 사용자 전원. 쓰기는 아무 로그인 계정도 직접 하지 않는다 — 사용자는 "신청"만
// 하고(대기 테이블), 시스템 관리자가 별도 화면(비밀번호 인증, registry-admin Edge Function)
// 에서 검토·승인해야 문서고에 반영된다.
import { supabase } from './supabase';
import type { RulePack } from './types';

export interface RegistryEntry {
  id: string;
  programName: string;
  year: number | null;
  verified: boolean;
  pack: RulePack;
}

export type DocumentType =
  | 'LAW' | 'ENFORCEMENT_DECREE' | 'ADMINISTRATIVE_RULE' | 'MINISTRY_GUIDELINE' | 'AGENCY_GUIDELINE'
  | 'PROGRAM_NOTICE' | 'PROGRAM_ATTACHMENT' | 'AGREEMENT' | 'BUSINESS_PLAN' | 'OFFICIAL_LETTER'
  | 'FAQ' | 'QNA_RESPONSE' | 'INTERNAL_POLICY' | 'OTHER';

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  LAW: '법률', ENFORCEMENT_DECREE: '시행령', ADMINISTRATIVE_RULE: '행정규칙',
  MINISTRY_GUIDELINE: '부처 지침', AGENCY_GUIDELINE: '전문기관 지침', PROGRAM_NOTICE: '사업 공고',
  PROGRAM_ATTACHMENT: '공고 별첨', AGREEMENT: '협약서', BUSINESS_PLAN: '사업계획서',
  OFFICIAL_LETTER: '공문', FAQ: 'FAQ', QNA_RESPONSE: '질의회신', INTERNAL_POLICY: '기관 내부규정', OTHER: '기타',
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABEL) as DocumentType[];

export const registryEnabled = () => supabase !== null;

// 파일명으로 문서 유형을 추정한다 — 사용자가 수정할 수 있는 기본값.
export const guessDocumentType = (name: string): DocumentType => {
  if (/faq/i.test(name)) return 'FAQ';
  if (/질의응답|qna|q&a/i.test(name)) return 'QNA_RESPONSE';
  if (/협약서/.test(name)) return 'AGREEMENT';
  if (/사업계획/.test(name)) return 'BUSINESS_PLAN';
  if (/공문/.test(name)) return 'OFFICIAL_LETTER';
  if (/별첨|별지|서식|양식/.test(name)) return 'PROGRAM_ATTACHMENT';
  if (/매뉴얼|교육/.test(name)) return 'AGENCY_GUIDELINE';
  if (/부처|중기부|중소벤처|과기부|산업부/.test(name)) return 'MINISTRY_GUIDELINE';
  if (/지침|기준/.test(name)) return 'AGENCY_GUIDELINE';
  if (/시행령/.test(name)) return 'ENFORCEMENT_DECREE';
  if (/내부규정/.test(name)) return 'INTERNAL_POLICY';
  if (/규칙/.test(name)) return 'ADMINISTRATIVE_RULE';
  if (/법률|법$/.test(name)) return 'LAW';
  if (/공고|모집/.test(name)) return 'PROGRAM_NOTICE';
  return 'OTHER';
};

export const searchRegistry = async (query: string): Promise<RegistryEntry[]> => {
  if (!supabase || !query.trim()) return [];
  const { data, error } = await supabase
    .from('program_registry')
    .select('id, program_name, year, verified, pack')
    .ilike('program_name', `%${query.trim()}%`)
    // 팩이 갈리거나 이름이 바뀌면 옛 행은 is_active=false 로 남는다 (과제가 쓰고 있을 수 있어
    // 지우지 않는다). 검색 결과에까지 나오면 폐기된 사업을 새로 고르게 된다.
    .eq('is_active', true)
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

// 브라우저에서 SHA-256 해시를 계산한다 — 동일 파일 중복 등록을 막는 기준.
export const sha256File = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export interface DuplicateFile { documentTitle: string; versionLabel: string | null; fileName: string; createdAt: string }

// 동일 해시의 파일이 이미 문서고에 있는지 확인한다 (읽기는 전원 허용이라 클라이언트에서 바로 조회 가능).
export const findDuplicateFile = async (hash: string): Promise<DuplicateFile | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('file_assets')
    .select('original_filename, created_at, document_versions!inner(version_label, documents!inner(title))')
    .eq('file_hash', hash)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const version = data.document_versions as unknown as { version_label: string | null; documents: { title: string } };
  return {
    documentTitle: version.documents.title, versionLabel: version.version_label,
    fileName: data.original_filename as string, createdAt: data.created_at as string,
  };
};

// 공유 신청 — 즉시 문서고에 들어가지 않고 대기 테이블에 저장된다.
// pack을 주면 규정 팩도 함께 신청(program_registry_submissions), docs는 원본 문서 신청
// (document_submissions, 파일은 registry_pending 버킷에 본인 폴더로 업로드).
// 동일 해시 파일이 이미 등록돼 있으면 업로드 자체를 막는다 (기본 동작: 신규 등록 차단).
export interface ShareSubmission {
  programName: string;
  year: number | null;
  pack?: RulePack;
  origin?: string;
  docs?: { file: File; documentType: DocumentType }[];
  // 과제가 이미 특정 사업명(program_registry)에 연결돼 있으면 그 id를 실어 보낸다 — 관리자
  // 승인 화면이 사업명 텍스트 비교 대신 이 id로 정확히 매칭해, 표기 차이로 인한 중복을 막는다.
  programRegistryId?: string | null;
}

export const submitRegistryShare = async (input: ShareSubmission): Promise<void> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const docs = input.docs ?? [];
  const hashed = await Promise.all(docs.map(async (doc) => ({ ...doc, hash: await sha256File(doc.file) })));
  for (const doc of hashed) {
    const dup = await findDuplicateFile(doc.hash);
    if (dup) throw new Error(`"${doc.file.name}"은(는) 이미 등록된 파일과 같습니다 — "${dup.documentTitle}"${dup.versionLabel ? ` (${dup.versionLabel})` : ''}, ${dup.createdAt.slice(0, 10)} 등록. 새로 올리지 않아도 됩니다.`);
  }

  if (input.pack) {
    const { error } = await supabase.from('program_registry_submissions')
      .insert({
        program_name: input.programName, year: input.year, pack: input.pack, origin: input.origin ?? 'pack',
        submitted_by: user.id, program_registry_id: input.programRegistryId ?? null,
      });
    if (error) throw new Error(error.message);
  }

  for (const doc of hashed) {
    const ext = /\.[A-Za-z0-9]+$/.exec(doc.file.name)?.[0] ?? '';
    const path = `${user.id}/${crypto.randomUUID()}${ext.toLowerCase()}`;
    const { error: uploadError } = await supabase.storage.from('registry_pending').upload(path, doc.file, { contentType: doc.file.type || undefined });
    if (uploadError) throw new Error(uploadError.message);
    const { error } = await supabase.from('document_submissions').insert({
      title: doc.file.name.replace(/\.[^./]+$/, ''), document_type: doc.documentType,
      file_name: doc.file.name, storage_path: path, file_hash: doc.hash,
      mime_type: doc.file.type || null, file_size: doc.file.size, submitted_by: user.id,
    });
    if (error) throw new Error(error.message);
  }
};

// 앱에서 만든 규정DB 패키지를 등록 신청한다 — 승인되면 사람이 만든 패키지와 똑같이
// regulation_packages + regulation-db 버킷에 들어가 예산편성 화면의 비목이 된다.
// 공유 데이터에 직접 쓰는 경로는 없다(schema.sql). 여기서 하는 일은 대기열에 넣는 것뿐이다.
export interface RegulationPackageSubmission {
  programName: string;
  year: number | null;
  pack: RulePack;                            // 변환된 규정 팩 (관리자 화면 미리보기용)
  regulationPackage: unknown;                // manifest + 6개 JSON
  diff?: unknown;                            // 기존 규정DB와의 변경사항 (있으면)
  basePackId?: string | null;                // 그 비교의 기준이 된 팩
  programRegistryId?: string | null;
}

export const submitRegulationPackage = async (input: RegulationPackageSubmission): Promise<void> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('program_registry_submissions').insert({
    program_name: input.programName,
    year: input.year,
    pack: input.pack,
    package: input.regulationPackage,
    diff: input.diff ?? null,
    base_pack_id: input.basePackId ?? null,
    origin: 'extracted',
    submitted_by: user.id,
    program_registry_id: input.programRegistryId ?? null,
  });
  if (error) throw new Error(error.message);
};

export interface PendingSubmission { id: string; title: string; createdAt: string }

// 본인이 올린 신청 중 아직 검토 대기 중인 것 — "공유 신청됨" 안내에 사용.
export const myPendingSubmissions = async (): Promise<PendingSubmission[]> => {
  if (!supabase) return [];
  const [{ data: packs }, { data: docs }] = await Promise.all([
    supabase.from('program_registry_submissions').select('id, program_name, created_at').eq('status', 'pending'),
    supabase.from('document_submissions').select('id, title, created_at').eq('status', 'pending'),
  ]);
  return [
    ...(packs ?? []).map((row) => ({ id: row.id as string, title: row.program_name as string, createdAt: row.created_at as string })),
    ...(docs ?? []).map((row) => ({ id: row.id as string, title: row.title as string, createdAt: row.created_at as string })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export interface DocumentEntry {
  id: string;              // document_versions.id — 이 버전의 파일을 가리키는 기준 id
  documentId: string;
  title: string;
  documentType: DocumentType;
  versionLabel: string | null;
  effectiveFrom: string | null;
  fileName: string;
  storagePath: string;
}

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
  docs: DocumentEntry[],
  source: { doc?: string; ref?: string; matchLevel: string },
): DocumentEntry | undefined => {
  if (!docs.length) return undefined;
  const hint = `${source.doc ?? ''} ${source.ref ?? ''}`;
  const wantTypes: DocumentType[] = source.matchLevel === 'guideline'
    ? ['ADMINISTRATIVE_RULE', 'MINISTRY_GUIDELINE', 'AGENCY_GUIDELINE']
    : source.matchLevel.startsWith('notice') ? ['PROGRAM_NOTICE'] : [];
  let best: DocumentEntry | undefined;
  let bestScore = -Infinity;
  for (const doc of docs) {
    let score = 0;
    for (const feature of DOC_FEATURES) {
      const inHint = feature.re.test(hint);
      const inName = feature.re.test(doc.fileName);
      if (inHint && inName) score += feature.weight;
      else if (!inHint && inName) score -= 2; // 출처와 무관한 특수 문서(QnA·별첨 등)는 감점
    }
    if (wantTypes.length && wantTypes.includes(doc.documentType)) score += 1;
    if (score > bestScore) { bestScore = score; best = doc; }
  }
  return best;
};

// 문서명으로 승인된 문서를 검색한다 — 각 문서의 현재(CURRENT) 버전과 그 원본 파일만 반환한다.
export const searchDocuments = async (query: string): Promise<DocumentEntry[]> => {
  if (!supabase || !query.trim()) return [];
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, document_type, document_versions(id, version_label, effective_from, status, created_at, file_assets(storage_path, original_filename, asset_type, created_at))')
    .ilike('title', `%${query.trim()}%`)
    .eq('is_active', true)
    .limit(20);
  if (error) throw new Error(error.message);
  return toDocumentEntries(data ?? []);
};

interface DocumentRow {
  id: string; title: string; document_type: string;
  document_versions: { id: string; version_label: string | null; effective_from: string | null; status: string; created_at: string;
    file_assets: { storage_path: string; original_filename: string; asset_type: string; created_at: string }[] }[];
}

const toDocumentEntries = (rows: DocumentRow[]): DocumentEntry[] => {
  const entries: DocumentEntry[] = [];
  for (const row of rows) {
    const versions = [...row.document_versions].sort((a, b) => (a.status === 'CURRENT' ? -1 : b.status === 'CURRENT' ? 1 : b.created_at.localeCompare(a.created_at)));
    const version = versions[0];
    const file = version?.file_assets.find((asset) => asset.asset_type === 'ORIGINAL') ?? version?.file_assets[0];
    if (!version || !file) continue;
    entries.push({
      id: version.id, documentId: row.id, title: row.title, documentType: row.document_type as DocumentType,
      versionLabel: version.version_label, effectiveFrom: version.effective_from,
      fileName: file.original_filename, storagePath: file.storage_path,
    });
  }
  return entries;
};

// 사업명(program_registry) 기준으로 명시적으로 연결된 문서만 반환한다 — 문서 제목 텍스트가
// 사업명과 겹치는지로 억지로 추측하지 않는다. 과제가 공유 규정 팩을 쓰는 중이면(packId가
// 'registry:<uuid>') 그 사업명이 곧 이 값이다 (projectRegistryId로 뽑는다).
export const searchDocumentsByProgram = async (programRegistryId: string): Promise<DocumentEntry[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('document_programs')
    .select('documents!inner(id, title, document_type, document_versions(id, version_label, effective_from, status, created_at, file_assets(storage_path, original_filename, asset_type, created_at)))')
    .eq('program_registry_id', programRegistryId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => row.documents as unknown as DocumentRow);
  return toDocumentEntries(rows);
};

// 과제가 쓰는 규정 팩이 공유 레지스트리 것이면 그 program_registry id를, 아니면 null을 반환한다.
export const projectRegistryId = (packId: string): string | null =>
  packId.startsWith('registry:') ? packId.slice('registry:'.length) : null;

export const getProgramById = async (id: string): Promise<{ id: string; programName: string; year: number | null } | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase.from('program_registry').select('id, program_name, year').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string, programName: data.program_name as string, year: (data.year as number | null) ?? null };
};

export const downloadRegistryDocument = async (storagePath: string): Promise<Blob> => {
  if (!supabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data, error } = await supabase.storage.from('public-regulations').download(storagePath);
  if (error || !data) throw new Error(error?.message ?? '파일을 내려받지 못했습니다.');
  return data;
};
