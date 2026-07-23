// 과제온 공유 규정 문서고 관리자 Edge Function
// 일반 사용자 로그인 계정과는 별개로, document_reviewers 테이블에 등록된 전용 관리자 계정의
// 로그인 토큰(JWT)만 통과시킨다 — 고정 비밀번호를 여러 사람이 공유하지 않고, 각 관리자가
// 자기 계정으로 로그인한다. 이 판단은 클라이언트가 아니라 이 서버 코드 안에서만 이뤄지므로,
// 예전 registry_admins 방식에서 있었던 "RLS가 걸린 클라이언트 요청이 조용히 0건 처리되는"
// 문제가 재발할 수 없다.
// 대기 중인 신청(program_registry_submissions / document_submissions)을 조회·승인·반려한다 —
// 승인 시에만 documents/document_versions/file_assets(공유 문서고)·program_registry(규정 팩)에
// 반영된다. 문서 승인은 기존 문서에 새 버전을 추가하거나(documentId 지정), 새 문서를 만든다 —
// 어느 쪽이든 이전 버전은 지우지 않는다.
//
// 배포: Supabase 대시보드 → Edge Functions → registry-admin 함수 코드를 이 내용으로 갱신
// 관리자 등록: document_reviewers.sql 참고 (Authentication → Users에서 계정 생성 후 등록)

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const service = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// 호출자의 로그인 토큰(JWT)으로 사용자를 확인하고, document_reviewers에 등록된 계정인지 검사한다.
const getAuthorizedAdmin = async (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;
  const { data } = await service().from('document_reviewers').select('user_id').eq('user_id', user.id).maybeSingle();
  return data ? user : null;
};

// 신청 행에 email을 붙여준다 — 관리자 화면에서 "누가 올렸는지" 확인용.
const withEmails = async <T extends { submitted_by: string | null }>(rows: T[]): Promise<(T & { submitted_email: string | null })[]> => {
  const db = service();
  const ids = [...new Set(rows.map((row) => row.submitted_by).filter((id): id is string => !!id))];
  const emails = new Map<string, string>();
  for (const id of ids) {
    const { data } = await db.auth.admin.getUserById(id);
    if (data?.user?.email) emails.set(id, data.user.email);
  }
  return rows.map((row) => ({ ...row, submitted_email: row.submitted_by ? emails.get(row.submitted_by) ?? null : null }));
};

const list = async () => {
  const db = service();
  const [{ data: packs, error: packErr }, { data: docs, error: docErr }, { data: documents }, { data: programs }, { data: trash }] = await Promise.all([
    db.from('program_registry_submissions').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    db.from('document_submissions').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    db.from('documents').select('id, title, document_type, issuing_authority, document_number, legal_level, document_programs(program_registry_id)').eq('is_active', true).order('title'),
    db.from('program_registry').select('id, program_name, year').order('program_name'),
    db.from('registry_trash').select('id, kind, title, submitted_by, rejected_at').order('rejected_at', { ascending: false }),
  ]);
  if (packErr) throw new Error(packErr.message);
  if (docErr) throw new Error(docErr.message);
  return {
    packSubmissions: await withEmails(packs ?? []),
    docSubmissions: await withEmails(docs ?? []),
    existingDocuments: documents ?? [],
    existingPrograms: programs ?? [],
    trash: await withEmails(trash ?? []),
  };
};

const fileUrl = async (docSubmissionId: string) => {
  const db = service();
  const { data: doc, error } = await db.from('document_submissions').select('storage_path').eq('id', docSubmissionId).single();
  if (error || !doc) throw new Error('신청 파일을 찾을 수 없습니다.');
  const { data, error: urlError } = await db.storage.from('registry_pending').createSignedUrl(doc.storage_path, 60);
  if (urlError || !data) throw new Error(urlError?.message ?? 'URL 생성에 실패했습니다.');
  return data.signedUrl;
};

interface ApproveDocumentInput {
  docSubmissionId: string; documentId?: string | null; programRegistryId?: string | null;
  title: string; documentType: string; issuingAuthority?: string | null; documentNumber?: string | null; legalLevel?: number | null;
  versionLabel?: string | null; announcedDate?: string | null; effectiveFrom?: string | null; effectiveTo?: string | null; sourceUrl?: string | null;
}

// 신청 파일 하나를 승인한다 — documentId가 있으면 기존 문서에 새 버전만 추가하고,
// 없으면 새 문서를 만든다. 어느 쪽이든 기존 버전·파일은 그대로 둔다.
const approveDocument = async (input: ApproveDocumentInput, reviewedBy: string) => {
  const db = service();
  if (!input.title.trim()) throw new Error('문서명을 입력해주세요.');
  const { data: submission, error } = await db.from('document_submissions').select('*').eq('id', input.docSubmissionId).single();
  if (error || !submission) throw new Error('신청 파일을 찾을 수 없습니다.');

  let documentId = input.documentId ?? null;
  if (!documentId) {
    const { data: inserted, error: insertError } = await db.from('documents').insert({
      title: input.title, document_type: input.documentType, issuing_authority: input.issuingAuthority ?? null,
      document_number: input.documentNumber ?? null, legal_level: input.legalLevel ?? null, created_by: submission.submitted_by,
    }).select('id').single();
    if (insertError) throw new Error(insertError.message);
    documentId = inserted.id as string;
  }

  if (input.programRegistryId) {
    const { error: linkError } = await db.from('document_programs')
      .upsert({ document_id: documentId, program_registry_id: input.programRegistryId }, { onConflict: 'document_id,program_registry_id' });
    if (linkError) throw new Error(linkError.message);
  }

  const { data: version, error: versionError } = await db.from('document_versions').insert({
    document_id: documentId, version_label: input.versionLabel ?? null, announced_date: input.announcedDate ?? null,
    effective_from: input.effectiveFrom ?? null, effective_to: input.effectiveTo ?? null, source_url: input.sourceUrl ?? null,
    status: 'CURRENT', reviewed_by: reviewedBy,
  }).select('id').single();
  if (versionError) throw new Error(versionError.message);
  const versionId = version.id as string;

  const { data: blob, error: downloadError } = await db.storage.from('registry_pending').download(submission.storage_path);
  if (downloadError || !blob) throw new Error(downloadError?.message ?? '신청 파일을 내려받지 못했습니다.');
  const ext = /\.[A-Za-z0-9]+$/.exec(submission.file_name)?.[0] ?? '';
  const fileId = crypto.randomUUID();
  const newPath = `${documentId}/${versionId}/${fileId}/original${ext.toLowerCase()}`;
  const { error: uploadError } = await db.storage.from('public-regulations').upload(newPath, blob, { contentType: blob.type || undefined });
  if (uploadError) throw new Error(uploadError.message);

  const { error: assetError } = await db.from('file_assets').insert({
    document_version_id: versionId, storage_bucket: 'public-regulations', storage_path: newPath,
    original_filename: submission.file_name, stored_filename: `original${ext.toLowerCase()}`, mime_type: submission.mime_type,
    file_size: submission.file_size, file_hash: submission.file_hash, asset_type: 'ORIGINAL', uploaded_by: submission.submitted_by,
  });
  if (assetError) throw new Error(assetError.message);

  await db.storage.from('registry_pending').remove([submission.storage_path]);
  await db.from('document_submissions').delete().eq('id', input.docSubmissionId);
  return { documentId, versionId };
};

// 반려는 지우지 않는다 — 휴지통(registry_trash)으로 옮겨 실수로 반려해도 복원할 수 있게 한다.
// 파일도 삭제하는 대신 버킷 안 trash/ 접두사로 옮긴다.
const rejectDocument = async (docSubmissionId: string, rejectedBy: string) => {
  const db = service();
  const { data: row, error } = await db.from('document_submissions').select('*').eq('id', docSubmissionId).single();
  if (error || !row) throw new Error('신청 파일을 찾을 수 없습니다.');
  let trashPath: string | null = null;
  if (row.storage_path) {
    trashPath = `trash/${row.storage_path}`;
    const { error: moveError } = await db.storage.from('registry_pending').move(row.storage_path, trashPath);
    if (moveError) throw new Error(moveError.message);
  }
  const { error: trashError } = await db.from('registry_trash').insert({
    kind: 'document', title: row.title, payload: row, storage_path: trashPath,
    submitted_by: row.submitted_by, rejected_by: rejectedBy,
  });
  if (trashError) {
    // 휴지통에 못 넣었으면 파일을 제자리로 되돌린다 — 신청 행이 남아 있으니 다시 시도할 수 있다.
    if (trashPath) await db.storage.from('registry_pending').move(trashPath, row.storage_path);
    throw new Error(trashError.message);
  }
  await db.from('document_submissions').delete().eq('id', docSubmissionId);
};

// programRegistryId를 주면 새로 만들지 않고 기존 사업 행을 그대로 갱신한다 — 사업명이
// 이미 있는데 관리자가 모르고 승인해서 program_registry에 같은 사업명이 중복 생기는 걸 막는다.
const approvePack = async (packSubmissionId: string, programName: string, year: number | null, reviewedBy: string, programRegistryId: string | null) => {
  const db = service();
  if (!programName.trim()) throw new Error('사업명을 입력해주세요.');
  const { data: pack, error } = await db.from('program_registry_submissions').select('*').eq('id', packSubmissionId).single();
  if (error || !pack) throw new Error('신청 규정 팩을 찾을 수 없습니다.');
  if (programRegistryId) {
    const { error: updateError } = await db.from('program_registry')
      .update({ program_name: programName, year, pack: pack.pack, origin: pack.origin, reviewed_by: reviewedBy })
      .eq('id', programRegistryId);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { error: insertError } = await db.from('program_registry')
      .insert({ program_name: programName, year, pack: pack.pack, origin: pack.origin, created_by: pack.submitted_by, reviewed_by: reviewedBy });
    if (insertError) throw new Error(insertError.message);
  }
  await db.from('program_registry_submissions').delete().eq('id', packSubmissionId);
};

const rejectPack = async (packSubmissionId: string, rejectedBy: string) => {
  const db = service();
  const { data: row, error } = await db.from('program_registry_submissions').select('*').eq('id', packSubmissionId).single();
  if (error || !row) throw new Error('신청 규정 팩을 찾을 수 없습니다.');
  const { error: trashError } = await db.from('registry_trash').insert({
    kind: 'pack', title: row.program_name, payload: row, submitted_by: row.submitted_by, rejected_by: rejectedBy,
  });
  if (trashError) throw new Error(trashError.message);
  await db.from('program_registry_submissions').delete().eq('id', packSubmissionId);
};

// 휴지통 복원 — 신청 행을 원래 테이블에 되살리고(승인 대기로), 문서 파일은 제자리로 옮긴다.
const restoreTrash = async (trashId: string) => {
  const db = service();
  const { data: item, error } = await db.from('registry_trash').select('*').eq('id', trashId).single();
  if (error || !item) throw new Error('휴지통 항목을 찾을 수 없습니다.');
  const payload = { ...(item.payload as Record<string, unknown>), status: 'pending' };
  if (item.kind === 'document' && item.storage_path) {
    const original = String((item.payload as Record<string, unknown>).storage_path);
    const { error: moveError } = await db.storage.from('registry_pending').move(item.storage_path, original);
    if (moveError) throw new Error(moveError.message);
  }
  const table = item.kind === 'pack' ? 'program_registry_submissions' : 'document_submissions';
  const { error: insertError } = await db.from(table).insert(payload);
  if (insertError) {
    if (item.kind === 'document' && item.storage_path) {
      await db.storage.from('registry_pending').move(String((item.payload as Record<string, unknown>).storage_path), item.storage_path);
    }
    throw new Error(insertError.message);
  }
  await db.from('registry_trash').delete().eq('id', trashId);
};

// 휴지통 영구 삭제 — 여기서만 실제로 지운다.
const purgeTrash = async (trashId: string) => {
  const db = service();
  const { data: item } = await db.from('registry_trash').select('*').eq('id', trashId).single();
  if (!item) return;
  if (item.kind === 'document' && item.storage_path) await db.storage.from('registry_pending').remove([item.storage_path]);
  await db.from('registry_trash').delete().eq('id', trashId);
};

// 이미 승인된 문서(예전 승인분 포함)의 사업명 연결을 나중에도 추가·해제할 수 있게 한다.
// (문서별 현재 연결 목록은 list()의 documents.document_programs로 한 번에 내려주므로,
// 여기서는 추가·해제 쓰기 액션만 둔다.)
const linkDocumentProgram = async (documentId: string, programRegistryId: string) => {
  const db = service();
  const { error } = await db.from('document_programs')
    .upsert({ document_id: documentId, program_registry_id: programRegistryId }, { onConflict: 'document_id,program_registry_id' });
  if (error) throw new Error(error.message);
};

const unlinkDocumentProgram = async (documentId: string, programRegistryId: string) => {
  const db = service();
  const { error } = await db.from('document_programs').delete()
    .eq('document_id', documentId).eq('program_registry_id', programRegistryId);
  if (error) throw new Error(error.message);
};

// 승인 시 문서명·유형 등을 잘못 입력했을 때 나중에 고칠 수 있게 한다. 원본 파일이나 이전
// 버전은 건드리지 않고 메타데이터만 수정한다.
interface UpdateDocumentInput { title: string; documentType: string; issuingAuthority?: string | null; documentNumber?: string | null; legalLevel?: number | null }
const updateDocument = async (documentId: string, input: UpdateDocumentInput) => {
  if (!input.title.trim()) throw new Error('문서명을 입력해주세요.');
  const db = service();
  const { error } = await db.from('documents').update({
    title: input.title.trim(), document_type: input.documentType,
    issuing_authority: input.issuingAuthority ?? null, document_number: input.documentNumber ?? null, legal_level: input.legalLevel ?? null,
  }).eq('id', documentId);
  if (error) throw new Error(error.message);
};

interface UpdateVersionInput { versionLabel?: string | null; status: string; effectiveFrom?: string | null; effectiveTo?: string | null; sourceUrl?: string | null }
const updateDocumentVersion = async (versionId: string, input: UpdateVersionInput) => {
  const db = service();
  const { error } = await db.from('document_versions').update({
    version_label: input.versionLabel ?? null, status: input.status,
    effective_from: input.effectiveFrom ?? null, effective_to: input.effectiveTo ?? null, source_url: input.sourceUrl ?? null,
  }).eq('id', versionId);
  if (error) throw new Error(error.message);
};

// 사업명 자체에 오타가 있으면 여기서 고친다 — 문서 연결(document_programs)은 program_registry.id
// 기준이라 이름만 바뀌어도 연결은 그대로 유지된다.
const updateProgram = async (programRegistryId: string, programName: string, year: number | null) => {
  if (!programName.trim()) throw new Error('사업명을 입력해주세요.');
  const db = service();
  const { error } = await db.from('program_registry').update({ program_name: programName.trim(), year }).eq('id', programRegistryId);
  if (error) throw new Error(error.message);
};

// 반대 방향 조회: 이 사업명에 지금 연결된 문서(버전·파일 포함)를 전부 보여준다 — "이 사업엔 뭐가
// 등록돼 있지?"를 관리자 화면에서 바로 확인하기 위한 것.
const programDocuments = async (programRegistryId: string) => {
  const db = service();
  const { data, error } = await db.from('document_programs')
    .select('documents!inner(id, title, document_type, document_versions(id, version_label, status, effective_from, source_url, created_at, file_assets(original_filename, storage_path, created_at)))')
    .eq('program_registry_id', programRegistryId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.documents);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = await getAuthorizedAdmin(req);
    if (!admin) return json({ error: '관리자 계정으로 로그인해주세요.' }, 401);

    const body = await req.json();
    switch (body.action) {
      case 'list': return json(await list());
      case 'fileUrl': return json({ url: await fileUrl(body.docSubmissionId) });
      case 'approveDocument': return json(await approveDocument(body as ApproveDocumentInput, admin.id));
      case 'rejectDocument': await rejectDocument(body.docSubmissionId, admin.id); return json({ ok: true });
      case 'approvePack': await approvePack(body.packSubmissionId, body.programName ?? '', body.year ?? null, admin.id, body.programRegistryId ?? null); return json({ ok: true });
      case 'rejectPack': await rejectPack(body.packSubmissionId, admin.id); return json({ ok: true });
      case 'restoreTrash': await restoreTrash(body.trashId); return json({ ok: true });
      case 'purgeTrash': await purgeTrash(body.trashId); return json({ ok: true });
      case 'linkDocumentProgram': await linkDocumentProgram(body.documentId, body.programRegistryId); return json({ ok: true });
      case 'unlinkDocumentProgram': await unlinkDocumentProgram(body.documentId, body.programRegistryId); return json({ ok: true });
      case 'programDocuments': return json({ documents: await programDocuments(body.programRegistryId) });
      case 'updateDocument': await updateDocument(body.documentId, body as UpdateDocumentInput); return json({ ok: true });
      case 'updateDocumentVersion': await updateDocumentVersion(body.versionId, body as UpdateVersionInput); return json({ ok: true });
      case 'updateProgram': await updateProgram(body.programRegistryId, body.programName ?? '', body.year ?? null); return json({ ok: true });
      default: return json({ error: '알 수 없는 요청입니다.' }, 400);
    }
  } catch (error) {
    console.error('registry-admin 실패:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return json({ error: `처리에 실패했습니다: ${message}` }, 500);
  }
});
