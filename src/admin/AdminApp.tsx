// 과제온 공유 문서고 관리자 화면 — 일반 사용자 로그인 계정과 완전히 분리된 전용 화면.
// 고정 비밀번호 하나를 공유하는 대신, document_reviewers에 등록된 전용 관리자 계정으로
// 로그인한다(일반 로그인과 세션 저장소 자체가 분리돼 있다 — adminSupabase.ts 참고).
// 대기 중인 신청(규정 팩·원본 문서)을 검토해 사업명/문서명 오타·중복을 정리한 뒤 승인·반려한다.
// 문서 승인은 기존 문서에 새 버전을 추가하거나(연결 선택), 새 문서를 만든다 — 이전 버전은
// 절대 지우지 않는다.
import { useState } from 'react';
import { AlertCircle, Check, Download, Eye, FileText, LogOut, RefreshCw, Search, X } from 'lucide-react';
import { adminSupabase } from './adminSupabase';
import { authErrorKo } from '../cloud';
import { DOCUMENT_TYPE_LABEL, DOCUMENT_TYPES, type DocumentType } from '../registry';
import { validateRegulationPackage, type RegulationPackage } from '../regulationPackage';

interface PackSubmission {
  id: string; program_name: string; year: number | null; origin: string; program_registry_id: string | null;
  submitted_by: string | null; submitted_email: string | null; created_at: string;
  // 규정DB 패키지(manifest + 6 JSON). 승인 전에 사람이 만든 패키지와 같은 규격인지 검사한다.
  // 옛 버전 앱에서 팩만 공유한 신청은 null이다.
  package: unknown | null;
}
interface DocSubmission {
  id: string; document_id: string | null; title: string; document_type: DocumentType;
  issuing_authority: string | null; document_number: string | null; legal_level: number | null;
  version_label: string | null; announced_date: string | null; effective_from: string | null; effective_to: string | null;
  source_url: string | null; file_name: string; submitted_by: string | null; submitted_email: string | null; created_at: string;
}
interface ExistingDocument {
  id: string; title: string; document_type: DocumentType;
  issuing_authority: string | null; document_number: string | null; legal_level: number | null;
  document_programs: { program_registry_id: string }[];
}
interface ExistingProgram { id: string; program_name: string; year: number | null }
// 사업명 하나에 연결된 문서들 — 버전별로 뭐가 있고 없는지 확인하는 용도라 버전을 전부 담는다.
interface ProgramDocumentVersion {
  id: string; version_label: string | null; status: string; effective_from: string | null; source_url: string | null; created_at: string;
  file_assets: { original_filename: string; storage_path: string }[];
}
interface ProgramDocument { id: string; title: string; document_type: DocumentType; document_versions: ProgramDocumentVersion[] }
interface ListResponse { packSubmissions: PackSubmission[]; docSubmissions: DocSubmission[]; existingDocuments: ExistingDocument[]; existingPrograms: ExistingProgram[] }

interface PackEdit { programName: string; year: string; programRegistryId: string }
interface DocEdit {
  documentId: string; programRegistryId: string; title: string; documentType: DocumentType; issuingAuthority: string; documentNumber: string; legalLevel: string;
  versionLabel: string; effectiveFrom: string; sourceUrl: string;
}
interface DocFieldEdit { title: string; documentType: DocumentType; issuingAuthority: string; documentNumber: string; legalLevel: string }
interface VersionFieldEdit { versionLabel: string; status: string; effectiveFrom: string; sourceUrl: string }
interface ProgramNameEdit { id: string; programName: string; year: string }

const VERSION_STATUS_LABEL: Record<string, string> = { DRAFT: '초안', CURRENT: '현재 시행', EXPIRED: '만료', REPEALED: '폐지' };

// FunctionsHttpError는 message가 고정 문구라 실제 원인(응답 JSON body)을 context에서 다시 읽어야 한다.
const describeFunctionError = async (error: { message: string; context?: unknown }): Promise<string> => {
  const context = error.context;
  if (context instanceof Response) {
    try { const body = await context.clone().json(); if (typeof body?.error === 'string') return body.error; } catch { /* JSON이 아니면 기본 메시지 */ }
  }
  return error.message;
};

const call = async <T,>(body: Record<string, unknown>): Promise<T> => {
  if (!adminSupabase) throw new Error('클라우드가 연결되지 않았습니다.');
  const { data, error } = await adminSupabase.functions.invoke('registry-admin', { body });
  if (error) throw new Error(await describeFunctionError(error));
  if (data?.error) throw new Error(data.error);
  return data as T;
};

// "기존 사업에 연결"을 기본값으로 미리 골라둔다 — 관리자가 못 보고 그냥 승인해서 같은
// 사업명이 중복 생기는 걸 막는 안전장치. 신청에 이미 program_registry_id가 실려 있으면
// (사용자 화면에서 이미 사업명에 연결된 과제가 보낸 신청) 그걸 그대로 쓰고, 없으면 사업명·연도
// 텍스트가 정확히 같은 기존 사업을 찾아본다.
const packEditDefault = (row: PackSubmission, programs: ExistingProgram[]): PackEdit => {
  const linked = row.program_registry_id ? programs.find((p) => p.id === row.program_registry_id) : undefined;
  const nameMatch = linked ?? programs.find((p) => p.program_name.trim() === row.program_name.trim() && p.year === row.year);
  return { programName: row.program_name, year: row.year ? String(row.year) : '', programRegistryId: nameMatch?.id ?? '' };
};
const docEditDefault = (row: DocSubmission): DocEdit => ({
  documentId: row.document_id ?? '', programRegistryId: '', title: row.title, documentType: row.document_type,
  issuingAuthority: row.issuing_authority ?? '', documentNumber: row.document_number ?? '', legalLevel: row.legal_level ? String(row.legal_level) : '',
  versionLabel: row.version_label ?? '', effectiveFrom: row.effective_from ?? '',
  sourceUrl: row.source_url ?? '',
});
const documentFieldEditDefault = (doc: ExistingDocument): DocFieldEdit => ({
  title: doc.title, documentType: doc.document_type, issuingAuthority: doc.issuing_authority ?? '',
  documentNumber: doc.document_number ?? '', legalLevel: doc.legal_level ? String(doc.legal_level) : '',
});
const versionFieldEditDefault = (version: ProgramDocumentVersion): VersionFieldEdit => ({
  versionLabel: version.version_label ?? '', status: version.status, effectiveFrom: version.effective_from ?? '', sourceUrl: version.source_url ?? '',
});

export default function AdminApp() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [packSubmissions, setPackSubmissions] = useState<PackSubmission[]>([]);
  const [docSubmissions, setDocSubmissions] = useState<DocSubmission[]>([]);
  const [existingDocuments, setExistingDocuments] = useState<ExistingDocument[]>([]);
  const [existingPrograms, setExistingPrograms] = useState<ExistingProgram[]>([]);
  const [packEdits, setPackEdits] = useState<Record<string, PackEdit>>({});
  const [docEdits, setDocEdits] = useState<Record<string, DocEdit>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [submissionPreview, setSubmissionPreview] = useState<Record<string, ProgramDocument[]>>({});
  const [submissionPreviewLoading, setSubmissionPreviewLoading] = useState<string | null>(null);
  const [docSearchQ, setDocSearchQ] = useState('');
  const [showMatchedDocs, setShowMatchedDocs] = useState(false);
  const [addProgramSelect, setAddProgramSelect] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [programSearchQ, setProgramSearchQ] = useState('');
  const [expandedProgramName, setExpandedProgramName] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [programDocs, setProgramDocs] = useState<ProgramDocument[]>([]);
  const [programDocsLoading, setProgramDocsLoading] = useState(false);
  const [programNameEdit, setProgramNameEdit] = useState<ProgramNameEdit | null>(null);
  const [savingProgram, setSavingProgram] = useState(false);
  const [documentEdits, setDocumentEdits] = useState<Record<string, DocFieldEdit>>({});
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [savingDocId, setSavingDocId] = useState<string | null>(null);
  const [versionEdits, setVersionEdits] = useState<Record<string, VersionFieldEdit>>({});
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [savingVersionId, setSavingVersionId] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const data = await call<ListResponse>({ action: 'list' });
      setPackSubmissions(data.packSubmissions ?? []);
      setDocSubmissions(data.docSubmissions ?? []);
      setExistingDocuments(data.existingDocuments ?? []);
      setExistingPrograms(data.existingPrograms ?? []);
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '불러오기에 실패했습니다.');
      setAuthed(false);
    } finally { setBusy(false); }
  };

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adminSupabase) return;
    setBusy(true); setError('');
    const { error: signInError } = await adminSupabase.auth.signInWithPassword({ email: form.email, password: form.password });
    if (signInError) { setError(authErrorKo(signInError.message)); setBusy(false); return; }
    await refresh();
  };

  const logout = async () => {
    await adminSupabase?.auth.signOut();
    setAuthed(false); setForm({ email: '', password: '' });
  };

  const packEdit = (row: PackSubmission) => packEdits[row.id] ?? packEditDefault(row, existingPrograms);
  const setPackEdit = (row: PackSubmission, patch: Partial<PackEdit>) => setPackEdits((prev) => ({ ...prev, [row.id]: { ...packEdit(row), ...patch } }));
  const docEdit = (row: DocSubmission) => docEdits[row.id] ?? docEditDefault(row);
  const setDocEdit = (row: DocSubmission, patch: Partial<DocEdit>) => setDocEdits((prev) => ({ ...prev, [row.id]: { ...docEdit(row), ...patch } }));

  const previewDoc = async (row: DocSubmission) => {
    try {
      const data = await call<{ url: string }>({ action: 'fileUrl', docSubmissionId: row.id });
      window.open(data.url, '_blank', 'noopener');
    } catch (err) { alert(err instanceof Error ? err.message : '미리보기에 실패했습니다.'); }
  };

  const approvePack = async (row: PackSubmission) => {
    const edit = packEdit(row);
    if (!edit.programName.trim()) { alert('사업명을 입력해주세요.'); return; }
    setActing(row.id);
    try {
      await call({ action: 'approvePack', packSubmissionId: row.id, programName: edit.programName.trim(), year: edit.year ? Number(edit.year) : null, programRegistryId: edit.programRegistryId || null });
      await refresh();
    } catch (err) { alert(err instanceof Error ? err.message : '승인에 실패했습니다.'); }
    finally { setActing(null); }
  };

  const rejectPack = async (row: PackSubmission) => {
    if (!confirm('이 신청을 반려할까요?')) return;
    setActing(row.id);
    try { await call({ action: 'rejectPack', packSubmissionId: row.id }); await refresh(); }
    catch (err) { alert(err instanceof Error ? err.message : '반려에 실패했습니다.'); }
    finally { setActing(null); }
  };

  const approveDoc = async (row: DocSubmission) => {
    const edit = docEdit(row);
    if (!edit.title.trim()) { alert('문서명을 입력해주세요.'); return; }
    setActing(row.id);
    try {
      await call({
        action: 'approveDocument', docSubmissionId: row.id, documentId: edit.documentId || null, programRegistryId: edit.programRegistryId || null,
        title: edit.title.trim(), documentType: edit.documentType, issuingAuthority: edit.issuingAuthority || null,
        documentNumber: edit.documentNumber || null, legalLevel: edit.legalLevel ? Number(edit.legalLevel) : null,
        versionLabel: edit.versionLabel || null, effectiveFrom: edit.effectiveFrom || null, sourceUrl: edit.sourceUrl || null,
      });
      await refresh();
    } catch (err) { alert(err instanceof Error ? err.message : '승인에 실패했습니다.'); }
    finally { setActing(null); }
  };

  const rejectDoc = async (row: DocSubmission) => {
    if (!confirm('이 신청을 반려할까요? 첨부 파일이 함께 삭제됩니다.')) return;
    setActing(row.id);
    try { await call({ action: 'rejectDocument', docSubmissionId: row.id }); await refresh(); }
    catch (err) { alert(err instanceof Error ? err.message : '반려에 실패했습니다.'); }
    finally { setActing(null); }
  };

  // "연결할 사업"을 고르면 그 사업에 이미 뭐가 있는지(몇 차 공고문·FAQ 등) 바로 보여준다.
  const loadSubmissionPreview = async (rowId: string, programRegistryId: string) => {
    if (!programRegistryId) { setSubmissionPreview((prev) => ({ ...prev, [rowId]: [] })); return; }
    setSubmissionPreviewLoading(rowId);
    try {
      const data = await call<{ documents: ProgramDocument[] }>({ action: 'programDocuments', programRegistryId });
      setSubmissionPreview((prev) => ({ ...prev, [rowId]: data.documents ?? [] }));
    } catch { /* 미리보기 실패는 조용히 무시 — 승인 자체엔 지장 없음 */ }
    finally { setSubmissionPreviewLoading(null); }
  };

  // 미리보기 목록에서 문서 하나를 클릭하면 "그 문서의 새 버전"으로 승인하도록 지정한다(다시
  // 누르면 해제 → 새 문서로 등록). 제목·유형도 그 문서 것으로 맞춰준다.
  const pickVersionTarget = (row: DocSubmission, doc: ProgramDocument) => {
    const current = docEdit(row);
    if (current.documentId === doc.id) { setDocEdit(row, { documentId: '' }); return; }
    setDocEdit(row, { documentId: doc.id, title: doc.title, documentType: doc.document_type });
  };

  // 사업명 검색 → 그 사업에 등록된 문서를 버전별로 확인 (승인 대기와 무관하게 아무 때나 조회).
  const loadProgramDocuments = async (programRegistryId: string) => {
    setSelectedProgramId(programRegistryId);
    setProgramDocs([]);
    setProgramDocsLoading(true);
    try {
      const data = await call<{ documents: ProgramDocument[] }>({ action: 'programDocuments', programRegistryId });
      setProgramDocs(data.documents ?? []);
    } catch (err) { alert(err instanceof Error ? err.message : '불러오기에 실패했습니다.'); }
    finally { setProgramDocsLoading(false); }
  };

  // 새 탭에서 파일을 바로 열어 미리보기만 한다 — 다운로드가 아니라 브라우저가 렌더링해서 보여준다.
  const previewFile = async (storagePath: string) => {
    if (!adminSupabase) return;
    try {
      const { data, error } = await adminSupabase.storage.from('public-regulations').download(storagePath);
      if (error || !data) throw new Error(error?.message ?? '파일을 불러오지 못했습니다.');
      window.open(URL.createObjectURL(data), '_blank', 'noopener');
    } catch (err) { alert(err instanceof Error ? err.message : '미리보기에 실패했습니다.'); }
  };

  // 사업명 자체에 오타가 있으면 여기서 고친다. 문서 연결(document_programs)은 id 기준이라
  // 이름만 바뀌어도 이미 연결된 문서들은 그대로 유지된다.
  const startEditProgram = (program: ExistingProgram) => setProgramNameEdit({ id: program.id, programName: program.program_name, year: program.year ? String(program.year) : '' });

  const saveProgramEdit = async () => {
    if (!programNameEdit) return;
    if (!programNameEdit.programName.trim()) { alert('사업명을 입력해주세요.'); return; }
    setSavingProgram(true);
    try {
      const { id, programName, year } = programNameEdit;
      await call({ action: 'updateProgram', programRegistryId: id, programName: programName.trim(), year: year ? Number(year) : null });
      setExistingPrograms((prev) => prev.map((p) => p.id === id ? { ...p, program_name: programName.trim(), year: year ? Number(year) : null } : p));
      setProgramNameEdit(null);
    } catch (err) { alert(err instanceof Error ? err.message : '수정에 실패했습니다.'); }
    finally { setSavingProgram(false); }
  };

  // 문서가 엉뚱한 사업명/연도에 잘못 연결됐으면 다른 걸로 옮긴다 (해제 후 새로 연결).
  const relinkDocument = async (documentId: string, fromProgramId: string, toProgramId: string) => {
    if (!toProgramId || toProgramId === fromProgramId) return;
    setLinking(documentId);
    try {
      await call({ action: 'unlinkDocumentProgram', documentId, programRegistryId: fromProgramId });
      await call({ action: 'linkDocumentProgram', documentId, programRegistryId: toProgramId });
      setExistingDocuments((prev) => prev.map((d) => d.id === documentId
        ? { ...d, document_programs: [...d.document_programs.filter((p) => p.program_registry_id !== fromProgramId), { program_registry_id: toProgramId }] }
        : d));
      if (selectedProgramId === fromProgramId) await loadProgramDocuments(fromProgramId); // 이 문서는 더 이상 안 보여야 하니 새로고침
    } catch (err) { alert(err instanceof Error ? err.message : '사업명 변경에 실패했습니다.'); }
    finally { setLinking(null); }
  };

  // 승인 때 잘못 입력한 버전 정보(버전명·상태·시행일·출처)를 나중에 고친다.
  const versionEdit = (version: ProgramDocumentVersion) => versionEdits[version.id] ?? versionFieldEditDefault(version);
  const setVersionEditField = (version: ProgramDocumentVersion, patch: Partial<VersionFieldEdit>) => setVersionEdits((prev) => ({ ...prev, [version.id]: { ...versionEdit(version), ...patch } }));

  const saveVersionEdit = async (version: ProgramDocumentVersion) => {
    const edit = versionEdit(version);
    setSavingVersionId(version.id);
    try {
      await call({ action: 'updateDocumentVersion', versionId: version.id, versionLabel: edit.versionLabel || null, status: edit.status, effectiveFrom: edit.effectiveFrom || null, sourceUrl: edit.sourceUrl || null });
      setProgramDocs((prev) => prev.map((doc) => ({
        ...doc,
        document_versions: doc.document_versions.map((v) => v.id === version.id
          ? { ...v, version_label: edit.versionLabel || null, status: edit.status, effective_from: edit.effectiveFrom || null, source_url: edit.sourceUrl || null } : v),
      })));
      setEditingVersionId(null);
    } catch (err) { alert(err instanceof Error ? err.message : '수정에 실패했습니다.'); }
    finally { setSavingVersionId(null); }
  };

  // 이미 승인된 문서(예전 승인분 포함)의 사업명 연결을 추가·해제한다 — list()가 내려준
  // document_programs를 그대로 갱신해서 다시 불러오지 않아도 화면에 바로 반영한다.
  const addProgramLink = async (doc: ExistingDocument) => {
    const programId = addProgramSelect[doc.id];
    if (!programId) return;
    setLinking(doc.id);
    try {
      await call({ action: 'linkDocumentProgram', documentId: doc.id, programRegistryId: programId });
      setExistingDocuments((prev) => prev.map((d) => d.id === doc.id ? { ...d, document_programs: [...d.document_programs, { program_registry_id: programId }] } : d));
      setAddProgramSelect((prev) => ({ ...prev, [doc.id]: '' }));
    } catch (err) { alert(err instanceof Error ? err.message : '연결에 실패했습니다.'); }
    finally { setLinking(null); }
  };

  const removeProgramLink = async (doc: ExistingDocument, programId: string) => {
    setLinking(doc.id);
    try {
      await call({ action: 'unlinkDocumentProgram', documentId: doc.id, programRegistryId: programId });
      setExistingDocuments((prev) => prev.map((d) => d.id === doc.id ? { ...d, document_programs: d.document_programs.filter((p) => p.program_registry_id !== programId) } : d));
    } catch (err) { alert(err instanceof Error ? err.message : '연결 해제에 실패했습니다.'); }
    finally { setLinking(null); }
  };

  // 승인 때 잘못 입력한 문서명·유형 등을 나중에 고친다.
  const documentFieldEdit = (doc: ExistingDocument) => documentEdits[doc.id] ?? documentFieldEditDefault(doc);
  const setDocumentEditField = (doc: ExistingDocument, patch: Partial<DocFieldEdit>) => setDocumentEdits((prev) => ({ ...prev, [doc.id]: { ...documentFieldEdit(doc), ...patch } }));

  const saveDocumentEdit = async (doc: ExistingDocument) => {
    const edit = documentFieldEdit(doc);
    if (!edit.title.trim()) { alert('문서명을 입력해주세요.'); return; }
    setSavingDocId(doc.id);
    try {
      await call({
        action: 'updateDocument', documentId: doc.id, title: edit.title.trim(), documentType: edit.documentType,
        issuingAuthority: edit.issuingAuthority || null, documentNumber: edit.documentNumber || null, legalLevel: edit.legalLevel ? Number(edit.legalLevel) : null,
      });
      setExistingDocuments((prev) => prev.map((d) => d.id === doc.id ? {
        ...d, title: edit.title.trim(), document_type: edit.documentType,
        issuing_authority: edit.issuingAuthority || null, document_number: edit.documentNumber || null, legal_level: edit.legalLevel ? Number(edit.legalLevel) : null,
      } : d));
      setEditingDocId(null);
    } catch (err) { alert(err instanceof Error ? err.message : '수정에 실패했습니다.'); }
    finally { setSavingDocId(null); }
  };

  if (!authed) {
    return <div className="setup-page">
      <div className="setup-brand"><div className="brand-mark"><Check /></div><span>과제온 관리자</span></div>
      <main className="auth-card">
        <h1>시스템 관리자 화면</h1>
        <p>일반 사용자 로그인과는 별개인 전용 관리자 계정으로 로그인하세요.</p>
        <form onSubmit={login}>
          <label>관리자 이메일<input required type="email" autoComplete="username" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>비밀번호<input required type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          {error && <p className="auth-notice error"><AlertCircle /> {error}</p>}
          <button className="primary large" disabled={busy} type="submit">{busy ? '확인 중…' : '로그인'}</button>
        </form>
      </main>
    </div>;
  }

  return <main className="page-content">
    <div className="page-title">
      <div><span className="eyebrow">과제온 관리자</span><h2>공유 문서고 승인 대기</h2><p>문서명·사업명 오타·중복을 정리한 뒤 승인하면 모든 사용자에게 공유됩니다.</p></div>
      <div className="admin-actions" style={{ padding: 0 }}>
        <button type="button" className="secondary" onClick={() => refresh()} disabled={busy}><RefreshCw /> 새로고침</button>
        <button type="button" className="secondary" onClick={logout}><LogOut /> 로그아웃</button>
      </div>
    </div>

    <section className="panel admin-card">
      <div className="panel-head"><div><h3>규정 팩 신청 ({packSubmissions.length})</h3></div></div>
      {packSubmissions.length === 0 && <p className="doc-empty">대기 중인 규정 팩 신청이 없습니다.</p>}
      <div className="admin-groups admin-card-fields">
        {packSubmissions.map((row) => {
          const edit = packEdit(row);
          const nameMatches = existingPrograms.filter((p) => p.program_name.trim().toLowerCase() === edit.programName.trim().toLowerCase());
          return <div className="panel" key={row.id}>
            <div className="panel-head"><div><h3><FileText /> {edit.programName || '(사업명 없음)'}</h3><p>{row.submitted_email ?? '알 수 없음'} · {row.created_at.slice(0, 10)}</p></div></div>
            <div className="field-grid admin-card-fields">
              <label>사업명 (오타·중복 정리)<input value={edit.programName} onChange={(e) => setPackEdit(row, { programName: e.target.value })} /></label>
              <label>연도<input inputMode="numeric" value={edit.year} onChange={(e) => setPackEdit(row, { year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2026" /></label>
              <label>기존 사업에 연결(선택)
                <select value={edit.programRegistryId} onChange={(e) => setPackEdit(row, { programRegistryId: e.target.value })}>
                  <option value="">새 사업으로 등록</option>
                  {existingPrograms.map((program) => <option key={program.id} value={program.id}>{program.program_name}{program.year ? ` · ${program.year}` : ''}</option>)}
                </select>
              </label>
            </div>
            {/* 승인 전 규격 검사 — AI 추출 패키지가 사람이 만든 규정DB와 같은 규격이어야
                검토·변환·적재를 그대로 태우고 서비스가 일괄 규칙으로 읽을 수 있다. */}
            {row.package
              ? (() => {
                const checks = validateRegulationPackage(row.package);
                const failed = checks.filter((check) => !check.ok).length;
                return <div className="pkg-checklist">
                  <strong>패키지 규격 검사 {failed ? <em className="bad">{failed}건 확인 필요</em> : <em className="ok">모두 통과</em>}</strong>
                  {checks.map((check) => <p key={check.label} className={check.ok ? 'ok' : 'bad'}>
                    {check.ok ? <Check /> : <X />}<b>{check.label}</b><span>{check.detail}</span>
                  </p>)}
                  <button type="button" className="secondary" onClick={() => import('../exporters').then((m) => m.exportExtractionReview(row.package as RegulationPackage))}>
                    <Download /> 검토본 엑셀(Review.xlsx) 내려받기
                  </button>
                  <small>검토본은 사람이 만든 규정DB와 같은 6시트 구성입니다 — RuleReview 시트에서 화면 문구와 원문 인용을 나란히 대조하세요.</small>
                </div>;
              })()
              : <p className="pkg-missing"><AlertCircle /> 규정DB 패키지가 없는 신청입니다 (옛 버전 앱에서 팩만 공유). 조문 원문(source_text)과 검토본이 없어 공통 규격 검토가 불가능하니, 반려하고 다시 신청하도록 안내하세요.</p>}
            {row.program_registry_id && edit.programRegistryId === row.program_registry_id && <p className="doc-empty">사용자 화면에서 이미 사업명에 연결된 과제가 보낸 신청이라 자동으로 연결을 골라뒀어요.</p>}
            {!edit.programRegistryId && nameMatches.length > 0 && <p className="doc-empty" style={{ color: '#d6453d' }}>같은 이름의 사업이 이미 있어요 — "기존 사업에 연결"에서 골라야 사업명이 중복 등록되지 않아요.</p>}
            <div className="admin-actions">
              <button type="button" className="danger-button" disabled={acting === row.id} onClick={() => rejectPack(row)}><X /> 반려</button>
              <button type="button" className="primary" disabled={acting === row.id} onClick={() => approvePack(row)}><Check /> 승인</button>
            </div>
          </div>;
        })}
      </div>
    </section>

    <section className="panel admin-card">
      <div className="panel-head"><div><h3>문서 신청 ({docSubmissions.length})</h3></div></div>
      {docSubmissions.length === 0 && <p className="doc-empty">대기 중인 문서 신청이 없습니다.</p>}
      <div className="admin-groups admin-card-fields">
        {docSubmissions.map((row) => {
          const edit = docEdit(row);
          const preview = submissionPreview[row.id];
          return <div className="panel" key={row.id}>
            <div className="panel-head"><div><h3><FileText /> {edit.title || '(문서명 없음)'}</h3><p>{row.file_name} · {row.submitted_email ?? '알 수 없음'} · {row.created_at.slice(0, 10)}</p></div>
              <button type="button" className="secondary" onClick={() => previewDoc(row)}>미리보기</button></div>
            <div className="field-grid admin-card-fields">
              <label>연결할 사업(먼저 선택하세요)
                <select value={edit.programRegistryId} onChange={(e) => { setDocEdit(row, { programRegistryId: e.target.value, documentId: '' }); loadSubmissionPreview(row.id, e.target.value); }}>
                  <option value="">연결 안 함</option>
                  {existingPrograms.map((program) => <option key={program.id} value={program.id}>{program.program_name}{program.year ? ` · ${program.year}` : ''}</option>)}
                </select>
              </label>
              <label>문서명<input value={edit.title} onChange={(e) => setDocEdit(row, { title: e.target.value })} /></label>
              <label>문서 유형<select value={edit.documentType} onChange={(e) => setDocEdit(row, { documentType: e.target.value as DocumentType })}>{DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABEL[type]}</option>)}</select></label>
              <label>발행기관<input value={edit.issuingAuthority} onChange={(e) => setDocEdit(row, { issuingAuthority: e.target.value })} /></label>
              <label>문서번호<input value={edit.documentNumber} onChange={(e) => setDocEdit(row, { documentNumber: e.target.value })} /></label>
              <label>규정 계층(선택)<input inputMode="numeric" value={edit.legalLevel} onChange={(e) => setDocEdit(row, { legalLevel: e.target.value.replace(/\D/g, '') })} /></label>
              <label>버전명<input value={edit.versionLabel} onChange={(e) => setDocEdit(row, { versionLabel: e.target.value })} placeholder="예: 2026년 시행본" /></label>
              <label>시행일<input type="date" value={edit.effectiveFrom} onChange={(e) => setDocEdit(row, { effectiveFrom: e.target.value })} /></label>
              <label>원문 출처 URL(선택)<input value={edit.sourceUrl} onChange={(e) => setDocEdit(row, { sourceUrl: e.target.value })} placeholder="https://..." /></label>
            </div>
            {edit.programRegistryId && <div className="admin-card-fields">
              <p className="wiz-hint">이 사업에 이미 등록된 자료예요 — 몇 차까지 있는지 보고, 같은 문서의 새 버전이면 클릭해서 연결하세요.</p>
              {submissionPreviewLoading === row.id ? <p className="doc-empty">불러오는 중…</p> : (preview?.length
                ? <div className="source-doc-list">{preview.map((doc) => {
                    const versions = [...doc.document_versions].sort((a, b) => b.created_at.localeCompare(a.created_at));
                    const selected = edit.documentId === doc.id;
                    return <div className="source-doc-row" key={doc.id}>
                      <button type="button" onClick={() => pickVersionTarget(row, doc)} style={selected ? { borderColor: 'var(--blue)', background: '#eef3ff' } : undefined}>
                        <FileText /><span><strong>{DOCUMENT_TYPE_LABEL[doc.document_type]}</strong><small>{doc.title} · {versions.map((v) => v.version_label || '버전명 없음').join(', ')}</small></span>
                        {selected && <Check />}
                      </button>
                    </div>;
                  })}</div>
                : <p className="doc-empty">이 사업에 아직 등록된 자료가 없어요 — 새 문서로 등록됩니다.</p>)}
              {edit.documentId && <p className="wiz-hint">선택한 문서의 새 버전으로 등록됩니다. 다시 누르면 새 문서로 등록하는 것으로 되돌아가요.</p>}
            </div>}
            <div className="admin-actions">
              <button type="button" className="danger-button" disabled={acting === row.id} onClick={() => rejectDoc(row)}><X /> 반려</button>
              <button type="button" className="primary" disabled={acting === row.id} onClick={() => approveDoc(row)}><Check /> 승인</button>
            </div>
          </div>;
        })}
      </div>
    </section>

    <section className="panel admin-card">
      <div className="panel-head"><div><h3><Search /> 사업명 검색</h3><p>사업명 → 연도 → 차수 순으로 등록된 문서를 확인·미리보기·수정할 수 있어요.</p></div></div>
      <div className="search-row admin-card-fields"><input value={programSearchQ} onChange={(e) => setProgramSearchQ(e.target.value)} placeholder="사업명 검색" /></div>
      {programSearchQ.trim() && (() => {
        const matches = existingPrograms.filter((p) => p.program_name.toLowerCase().includes(programSearchQ.trim().toLowerCase()));
        const groups = new Map<string, ExistingProgram[]>();
        for (const p of matches) { if (!groups.has(p.program_name)) groups.set(p.program_name, []); groups.get(p.program_name)!.push(p); }
        for (const list of groups.values()) list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
        if (groups.size === 0) return <p className="doc-empty admin-card-fields">검색 결과가 없어요.</p>;
        return <div className="admin-groups admin-card-fields">
          {[...groups.entries()].map(([name, programs]) => {
            const groupExpanded = expandedProgramName === name;
            return <div key={name}>
              <button type="button" className="secondary" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => setExpandedProgramName(groupExpanded ? null : name)}>
                {groupExpanded ? '▾' : '▸'}&nbsp;{name} ({programs.length}개 연도)
              </button>
              {groupExpanded && <div style={{ paddingLeft: 18, marginTop: 8, display: 'grid', gap: 10 }}>
                {programs.map((program) => {
                  const yearExpanded = selectedProgramId === program.id;
                  const editingThis = programNameEdit?.id === program.id;
                  return <div key={program.id}>
                    {editingThis ? <div className="field-grid">
                      <label>사업명<input value={programNameEdit.programName} onChange={(e) => setProgramNameEdit({ ...programNameEdit, programName: e.target.value })} /></label>
                      <label>연도<input inputMode="numeric" value={programNameEdit.year} onChange={(e) => setProgramNameEdit({ ...programNameEdit, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
                      <div className="admin-actions" style={{ padding: 0 }}>
                        <button type="button" className="secondary" onClick={() => setProgramNameEdit(null)}>취소</button>
                        <button type="button" className="primary" disabled={savingProgram} onClick={saveProgramEdit}>{savingProgram ? '저장 중…' : '저장'}</button>
                      </div>
                    </div> : <div className="admin-actions" style={{ justifyContent: 'space-between', padding: 0 }}>
                      <button type="button" className="secondary" onClick={() => (yearExpanded ? (setSelectedProgramId(''), setProgramDocs([])) : loadProgramDocuments(program.id))}>
                        {yearExpanded ? '▾' : '▸'} {program.year ?? '연도 미상'}
                      </button>
                      <button type="button" className="secondary" onClick={() => startEditProgram(program)}>사업명 수정</button>
                    </div>}
                    {yearExpanded && (programDocsLoading ? <p className="doc-empty">불러오는 중…</p> : (() => {
                      const rounds = new Map<string, { doc: ProgramDocument; version: ProgramDocumentVersion }[]>();
                      for (const doc of programDocs) for (const version of doc.document_versions) {
                        const label = version.version_label?.trim() || '버전명 없음';
                        if (!rounds.has(label)) rounds.set(label, []);
                        rounds.get(label)!.push({ doc, version });
                      }
                      const roundList = [...rounds.entries()].sort((a, b) => {
                        const aTime = Math.max(...a[1].map((r) => new Date(r.version.created_at).getTime()));
                        const bTime = Math.max(...b[1].map((r) => new Date(r.version.created_at).getTime()));
                        return bTime - aTime;
                      });
                      if (roundList.length === 0) return <p className="doc-empty">이 사업에 등록된 문서가 없어요.</p>;
                      return <div style={{ paddingLeft: 18, marginTop: 8, display: 'grid', gap: 12 }}>
                        {roundList.map(([label, items]) => <div key={label}>
                          <p className="wiz-hint"><strong>{label}</strong> ({items.length}건)</p>
                          <div className="source-doc-list">
                            {items.map(({ doc, version }) => {
                              const file = version.file_assets[0];
                              const editingVersion = editingVersionId === version.id;
                              const vEdit = versionEdit(version);
                              const fullDoc = existingDocuments.find((d) => d.id === doc.id);
                              const editingDoc = editingDocId === doc.id;
                              return <div key={version.id}>
                                {!editingVersion && !editingDoc && <div className="source-doc-row">
                                  <button type="button" disabled={!file} onClick={() => file && previewFile(file.storage_path)}>
                                    <FileText /><span><strong>{DOCUMENT_TYPE_LABEL[doc.document_type]}</strong><small>{doc.title} · {file?.original_filename ?? '파일 없음'}{version.status !== 'CURRENT' ? ` · ${VERSION_STATUS_LABEL[version.status] ?? version.status}` : ''}</small></span><Eye />
                                  </button>
                                  <button type="button" className="secondary" onClick={() => setEditingVersionId(version.id)}>버전 수정</button>
                                  {fullDoc && <button type="button" className="secondary" onClick={() => setEditingDocId(doc.id)}>문서 수정</button>}
                                </div>}
                                {editingVersion && <div className="field-grid" style={{ padding: '8px 0' }}>
                                  <label>버전명<input value={vEdit.versionLabel} onChange={(e) => setVersionEditField(version, { versionLabel: e.target.value })} /></label>
                                  <label>상태<select value={vEdit.status} onChange={(e) => setVersionEditField(version, { status: e.target.value })}>{Object.entries(VERSION_STATUS_LABEL).map(([value, l]) => <option key={value} value={value}>{l}</option>)}</select></label>
                                  <label>시행일<input type="date" value={vEdit.effectiveFrom} onChange={(e) => setVersionEditField(version, { effectiveFrom: e.target.value })} /></label>
                                  <label>원문 출처 URL(선택)<input value={vEdit.sourceUrl} onChange={(e) => setVersionEditField(version, { sourceUrl: e.target.value })} /></label>
                                  <div className="admin-actions" style={{ padding: 0 }}>
                                    <button type="button" className="secondary" onClick={() => setEditingVersionId(null)}>취소</button>
                                    <button type="button" className="primary" disabled={savingVersionId === version.id} onClick={() => saveVersionEdit(version)}>{savingVersionId === version.id ? '저장 중…' : '저장'}</button>
                                  </div>
                                </div>}
                                {editingDoc && fullDoc && (() => {
                                  const dEdit = documentFieldEdit(fullDoc);
                                  return <div className="field-grid" style={{ padding: '8px 0' }}>
                                    <label>문서명<input value={dEdit.title} onChange={(e) => setDocumentEditField(fullDoc, { title: e.target.value })} /></label>
                                    <label>문서 유형<select value={dEdit.documentType} onChange={(e) => setDocumentEditField(fullDoc, { documentType: e.target.value as DocumentType })}>{DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABEL[type]}</option>)}</select></label>
                                    <label>발행기관<input value={dEdit.issuingAuthority} onChange={(e) => setDocumentEditField(fullDoc, { issuingAuthority: e.target.value })} /></label>
                                    <label>문서번호<input value={dEdit.documentNumber} onChange={(e) => setDocumentEditField(fullDoc, { documentNumber: e.target.value })} /></label>
                                    <label>규정 계층(선택)<input inputMode="numeric" value={dEdit.legalLevel} onChange={(e) => setDocumentEditField(fullDoc, { legalLevel: e.target.value.replace(/\D/g, '') })} /></label>
                                    <label>다른 사업명으로 이동(선택)
                                      <select value="" disabled={linking === fullDoc.id} onChange={(e) => e.target.value && relinkDocument(fullDoc.id, program.id, e.target.value)}>
                                        <option value="">선택 안 함</option>
                                        {existingPrograms.filter((p) => p.id !== program.id).map((p) => <option key={p.id} value={p.id}>{p.program_name}{p.year ? ` · ${p.year}` : ''}</option>)}
                                      </select>
                                    </label>
                                    <div className="admin-actions" style={{ padding: 0 }}>
                                      <button type="button" className="secondary" onClick={() => setEditingDocId(null)}>취소</button>
                                      <button type="button" className="primary" disabled={savingDocId === fullDoc.id} onClick={() => saveDocumentEdit(fullDoc)}>{savingDocId === fullDoc.id ? '저장 중…' : '저장'}</button>
                                    </div>
                                  </div>;
                                })()}
                              </div>;
                            })}
                          </div>
                        </div>)}
                      </div>;
                    })())}
                  </div>;
                })}
              </div>}
            </div>;
          })}
        </div>;
      })()}
    </section>

    <section className="panel admin-card">
      <div className="panel-head"><div><h3>문서 ↔ 사업명 매칭</h3><p>이미 승인은 됐지만 아직 사업명이 연결 안 된 문서를 한꺼번에 확인하고 연결할 수 있어요.</p></div></div>
      <div className="field-grid admin-card-fields">
        <label>문서명으로 찾기<input value={docSearchQ} onChange={(e) => setDocSearchQ(e.target.value)} placeholder="문서명 일부 입력" /></label>
        <label className="share-toggle"><input type="checkbox" checked={showMatchedDocs} onChange={(e) => setShowMatchedDocs(e.target.checked)} /><span>이미 매칭된 문서도 보기</span></label>
      </div>
      <div className="admin-groups admin-card-fields">
        {existingDocuments
          .filter((doc) => showMatchedDocs || doc.document_programs.length === 0)
          .filter((doc) => doc.title.toLowerCase().includes(docSearchQ.trim().toLowerCase()))
          .map((doc) => {
            const linkedPrograms = doc.document_programs
              .map((link) => existingPrograms.find((p) => p.id === link.program_registry_id))
              .filter((p): p is ExistingProgram => !!p);
            const docEditing = editingDocId === doc.id;
            const dEdit = documentFieldEdit(doc);
            return <div className="panel" key={doc.id}>
              <div className="panel-head"><div><h3><FileText /> {doc.title}</h3><p>{DOCUMENT_TYPE_LABEL[doc.document_type]}{linkedPrograms.length === 0 ? ' · 미매칭' : ''}</p></div>
                <button type="button" className="secondary" onClick={() => setEditingDocId(docEditing ? null : doc.id)}>{docEditing ? '접기' : '문서 수정'}</button></div>
              {docEditing && <div className="field-grid admin-card-fields">
                <label>문서명<input value={dEdit.title} onChange={(e) => setDocumentEditField(doc, { title: e.target.value })} /></label>
                <label>문서 유형<select value={dEdit.documentType} onChange={(e) => setDocumentEditField(doc, { documentType: e.target.value as DocumentType })}>{DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABEL[type]}</option>)}</select></label>
                <label>발행기관<input value={dEdit.issuingAuthority} onChange={(e) => setDocumentEditField(doc, { issuingAuthority: e.target.value })} /></label>
                <label>문서번호<input value={dEdit.documentNumber} onChange={(e) => setDocumentEditField(doc, { documentNumber: e.target.value })} /></label>
                <label>규정 계층(선택)<input inputMode="numeric" value={dEdit.legalLevel} onChange={(e) => setDocumentEditField(doc, { legalLevel: e.target.value.replace(/\D/g, '') })} /></label>
                <div className="admin-actions" style={{ padding: 0 }}>
                  <button type="button" className="secondary" onClick={() => setEditingDocId(null)}>취소</button>
                  <button type="button" className="primary" disabled={savingDocId === doc.id} onClick={() => saveDocumentEdit(doc)}>{savingDocId === doc.id ? '저장 중…' : '저장'}</button>
                </div>
              </div>}
              <div className="admin-card-fields">
                {linkedPrograms.length > 0 && <div className="source-doc-list">{linkedPrograms.map((program) => <div className="source-doc-row" key={program.id}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 9, padding: '8px 10px' }}><FileText /><span><strong>{program.program_name}</strong><small>{program.year ?? ''}</small></span></div>
                  <button type="button" className="danger-button" disabled={linking === doc.id} onClick={() => removeProgramLink(doc, program.id)}><X /> 해제</button>
                </div>)}</div>}
                <div className="search-row" style={{ marginTop: linkedPrograms.length ? 10 : 0 }}>
                  <select value={addProgramSelect[doc.id] ?? ''} onChange={(e) => setAddProgramSelect((prev) => ({ ...prev, [doc.id]: e.target.value }))}>
                    <option value="">사업명 선택</option>
                    {existingPrograms.filter((p) => !linkedPrograms.some((lp) => lp.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.program_name}{p.year ? ` · ${p.year}` : ''}</option>)}
                  </select>
                  <button type="button" className="secondary" disabled={linking === doc.id} onClick={() => addProgramLink(doc)}>연결 추가</button>
                </div>
              </div>
            </div>;
          })}
        {existingDocuments.filter((doc) => showMatchedDocs || doc.document_programs.length === 0).filter((doc) => doc.title.toLowerCase().includes(docSearchQ.trim().toLowerCase())).length === 0
          && <p className="doc-empty">{showMatchedDocs ? '문서가 없어요.' : '미매칭 문서가 없어요 — 전부 사업명이 연결돼 있어요.'}</p>}
      </div>
    </section>
  </main>;
}
