import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpenCheck, Check, CheckCircle2, CloudUpload, FileSearch, Search, ShieldCheck, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { getPack, makeDraftBudgets, SELECTABLE_PACKS } from './rules';
import { classifyProgram, guessProgramName, guessYear, type MatchResult } from './matching';
import { guessDocRole, isRegistryAdmin, REGISTRY_ROLE_LABEL, registryEnabled, saveRegistryEntry, searchRegistry, uploadRegistryDocument, type RegistryDocRole, type RegistryEntry } from './registry';
import { annotateVerification, buildCustomPack, runExtraction, type Extraction } from './llmExtract';
import type { Project, RulePack } from './types';

const RULE_KIND_LABEL = { ratio: '상한', warning: '금지·주의', funding: '재원', info: '참고' } as const;

const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const digitsOnly = (value: string) => value.replace(/\D/g, '');
const withCommas = (value: string) => value ? Number(value).toLocaleString('ko-KR') : '';

interface DocItem {
  id: string;
  file: File;
  role: RegistryDocRole;
  status: 'reading' | 'done' | 'error';
  text?: string;
  error?: string;
}

export default function SetupWizard({ onCreate }: { onCreate: (project: Project) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({ name: '', total: '100000000', start: today(), end: '', deadline: '', company: '', owner: '', email: '' });
  const [participant, setParticipant] = useState('');
  // ---- 2단계: 규정 선택 ----
  const [packId, setPackId] = useState('prestartup');
  const [registryPick, setRegistryPick] = useState<RegistryEntry | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [programName, setProgramName] = useState('');
  const [programYear, setProgramYear] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<RegistryEntry[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [share, setShare] = useState(false);
  const [creating, setCreating] = useState(false);
  // ---- AI 세부 규정 추출 ----
  const [ai, setAi] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; extraction?: Extraction; cached?: boolean; message?: string }>({ status: 'idle' });
  const [acceptedRules, setAcceptedRules] = useState<Set<number>>(new Set());
  const [useDocCats, setUseDocCats] = useState(false);
  const [extractedPack, setExtractedPack] = useState<RulePack | null>(null);

  useEffect(() => {
    if (registryEnabled()) isRegistryAdmin().then(setAdmin).catch(() => setAdmin(false));
  }, []);

  const next = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || !form.company || !form.owner || !form.email || !Number(form.total) || !form.end || !form.deadline) return;
    setStep(2);
  };

  const runSearch = async () => {
    if (!searchQ.trim()) return;
    setSearchBusy(true);
    try { setSearchResults(await searchRegistry(searchQ)); }
    catch (error) { alert(`검색에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
    finally { setSearchBusy(false); }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const added: DocItem[] = [...list].map((file) => ({ id: uid(), file, role: guessDocRole(file.name), status: 'reading' }));
    setDocs((prev) => [...prev, ...added]);
    const { extractDocumentText } = await import('./extract');
    const finished: DocItem[] = [];
    for (const item of added) {
      try {
        const { text } = await extractDocumentText(item.file);
        finished.push({ ...item, status: 'done', text });
      } catch (error) {
        finished.push({ ...item, status: 'error', error: error instanceof Error ? error.message : '읽기 실패' });
      }
    }
    setDocs((prev) => {
      const merged = prev.map((item) => finished.find((f) => f.id === item.id) ?? item);
      applyClassification(merged);
      return merged;
    });
  };

  // 읽힌 문서 전체 텍스트로 유형을 식별하고 사업명·연도를 제안한다.
  const applyClassification = (items: DocItem[]) => {
    const text = items.filter((item) => item.status === 'done').map((item) => item.text).join('\n');
    if (!text.trim()) { setMatch(null); return; }
    const result = classifyProgram(text);
    setMatch(result);
    if (result.packId) { setPackId(result.packId); setRegistryPick(null); }
    setProgramName((prev) => prev || guessProgramName(text));
    setProgramYear((prev) => prev || String(guessYear(text) ?? ''));
  };

  const removeDoc = (id: string) => setDocs((prev) => {
    const nextDocs = prev.filter((item) => item.id !== id);
    applyClassification(nextDocs);
    return nextDocs;
  });

  const docsText = () => docs.filter((item) => item.status === 'done').map((item) => item.text).join('\n');

  const runAi = async () => {
    setAi({ status: 'working' });
    try {
      const { extraction, cached } = await runExtraction(docsText(), match?.packId ?? null);
      const verified = annotateVerification(extraction, docsText());
      setAi({ status: 'done', extraction: verified, cached });
      // 원문 대조에 성공한 규칙만 기본 선택 — 실패 항목은 사용자가 직접 확인 후 체크
      setAcceptedRules(new Set(verified.rules.map((rule, index) => rule.verified ? index : -1).filter((index) => index >= 0)));
      setUseDocCats(verified.categories.length > 0 && !match?.packId);
    } catch (error) {
      setAi({ status: 'error', message: error instanceof Error ? error.message : '추출에 실패했습니다.' });
    }
  };

  const applyAi = () => {
    if (ai.status !== 'done' || !ai.extraction) return;
    const base = useDocCats ? null : (registryPick?.pack ?? getPack(packId));
    const accepted = ai.extraction.rules.filter((_, index) => acceptedRules.has(index));
    const pack = buildCustomPack(base, ai.extraction, accepted, useDocCats);
    setExtractedPack(pack);
    if (ai.extraction.programName) setProgramName((prev) => prev || ai.extraction!.programName);
    if (ai.extraction.year) setProgramYear((prev) => prev || String(ai.extraction!.year));
  };

  const chosenPack: RulePack = extractedPack ?? registryPick?.pack ?? getPack(packId);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      // 관리자이고 공유를 선택했으면 팩·문서를 공유 레지스트리에 저장한다 (실패해도 과제 생성은 진행).
      if (admin && share && registryEnabled()) {
        try {
          const name = programName.trim() || form.name;
          const year = Number(programYear) || null;
          const registryId = registryPick?.id ?? await saveRegistryEntry(name, year, chosenPack, extractedPack ? 'extracted' : 'pack');
          for (const doc of docs) {
            await uploadRegistryDocument(doc.file, { programName: name, year, role: doc.role, registryId });
          }
        } catch (error) {
          alert(`공유 DB 등록에 실패했습니다 (${error instanceof Error ? error.message : ''}). 과제는 정상 생성됩니다.`);
        }
      }
      const totalBudget = Number(form.total);
      onCreate({
        id: uid(), name: form.name, totalBudget, startDate: form.start, endDate: form.end,
        settlementDeadline: form.deadline, agency: chosenPack.agency.split(' (')[0], companyName: form.company,
        packId: extractedPack ? extractedPack.id : registryPick ? `registry:${registryPick.id}` : packId,
        customPack: extractedPack ?? registryPick?.pack,
        programName: programName.trim() || registryPick?.programName || (ai.status === 'done' ? ai.extraction?.programName : undefined) || undefined,
        members: [{ id: uid(), name: form.owner, email: form.email, role: '대표' }],
        participants: participant.trim() ? [{ id: uid(), name: participant.trim(), projectRate: 0, externalRate: 0 }] : [],
        budgets: makeDraftBudgets(chosenPack, totalBudget), expenses: [], changes: [], emailLogs: [], createdAt: new Date().toISOString(),
      });
    } finally { setCreating(false); }
  };

  return <div className="setup-page">
    <div className="setup-brand"><div className="brand-mark"><Check /></div><span>과제온</span></div>
    <main className="setup-card">
      <div className="setup-copy">
        <span className="eyebrow"><Sparkles size={14} /> 정부지원사업 예산 가이드</span>
        <h1>처음이어도,<br /><em>실수 없이 끝까지.</em></h1>
        <p>공고문을 올리면 사업 유형을 식별하고, 해당 규정 체계로 예산 초안부터 증빙·변경 문서까지 안내해드려요.</p>
        <div className="setup-points">
          <span><CheckCircle2 /> 사업 유형 자동 식별</span>
          <span><CheckCircle2 /> 규정별 금지·상한 경고</span>
          <span><CheckCircle2 /> 증빙 누락 자동 체크</span>
        </div>
      </div>

      {step === 1 && <form className="setup-form" onSubmit={next}>
        <div><span className="step-pill">1 / 2</span><h2>기본 정보부터 알려주세요</h2><p>다음 단계에서 적용 규정을 정합니다.</p></div>
        <label>과제명<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: AI 기반 품질검사 시스템 개발" /></label>
        <div className="field-grid"><label>기업명<input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="주식회사 과제온" /></label><label>총 사업비<input required inputMode="numeric" value={withCommas(form.total)} onChange={(e) => setForm({ ...form, total: digitsOnly(e.target.value) })} /></label></div>
        <div className="field-grid three"><label>시작일<input required type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label><label>종료일<input required type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label><label>정산 마감일<input required type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label></div>
        <div className="field-grid"><label>대표자 이름<input required value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label><label>알림 이메일<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label></div>
        <label><span className="label-line">참여 인력 <b>선택</b></span><input value={participant} onChange={(e) => setParticipant(e.target.value)} placeholder="첫 참여 인력 이름" /></label>
        <button className="primary large" type="submit">다음 — 적용 규정 정하기 <ArrowRight /></button>
        <p className="fine-print"><ShieldCheck /> 입력 정보는 계정(또는 이 브라우저)에만 저장됩니다.</p>
      </form>}

      {step === 2 && <div className="setup-form wizard">
        <div><span className="step-pill">2 / 2</span><h2>적용 규정을 정해볼까요?</h2><p>공유 DB 검색, 공고문 업로드, 직접 선택 중 편한 방법을 쓰세요.</p></div>

        {registryEnabled() && <div className="wiz-block">
          <h4><Search /> 사업명으로 공유 규정 DB 검색</h4>
          <div className="search-row"><input value={searchQ} placeholder="예: 예비창업패키지" onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }} /><button type="button" className="secondary" disabled={searchBusy} onClick={runSearch}>{searchBusy ? '검색 중…' : '검색'}</button></div>
          {searchResults && (searchResults.length
            ? <div className="registry-results">{searchResults.map((entry) => <button type="button" key={entry.id} className={registryPick?.id === entry.id ? 'active' : ''} onClick={() => { setRegistryPick(entry); setProgramName(entry.programName); if (entry.year) setProgramYear(String(entry.year)); }}><strong>{entry.programName}{entry.year ? ` (${entry.year})` : ''}</strong><span>{entry.pack.guideline}{entry.verified ? ' · 검증됨' : ' · 검증 전'}</span></button>)}</div>
            : <p className="wiz-hint">등록된 사업이 없어요. 공고문을 업로드해 식별하거나 직접 선택하세요.</p>)}
        </div>}

        <div className="wiz-block">
          <h4><FileSearch /> 공고문·지침 업로드 — 자동 식별</h4>
          <label className="upload-button wide"><Upload /> 파일 추가 (PDF · HWP · 이미지)<input type="file" multiple accept=".pdf,.hwp,.hwpx,.txt,.md,image/*" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label>
          {docs.length > 0 && <div className="doc-list">{docs.map((doc) => <div key={doc.id} className={`doc-item ${doc.status}`}>
            <span className="doc-name">{doc.file.name}</span>
            <select aria-label={`${doc.file.name} 문서 역할`} value={doc.role} onChange={(e) => setDocs((prev) => prev.map((item) => item.id === doc.id ? { ...item, role: e.target.value as RegistryDocRole } : item))}>{Object.entries(REGISTRY_ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <span className="doc-status">{doc.status === 'reading' ? '읽는 중…' : doc.status === 'done' ? '읽기 완료' : doc.error}</span>
            <button type="button" aria-label={`${doc.file.name} 제거`} onClick={() => removeDoc(doc.id)}><Trash2 /></button>
          </div>)}</div>}
          {match && (match.packId
            ? <div className="match-result"><CheckCircle2 /><div><strong>{getPack(match.packId).name}(으)로 식별했어요</strong><span>근거: {match.hits.map((hit) => `"${hit.keyword}" ${hit.count}회`).join(' · ')}</span></div></div>
            : <div className="match-result none"><AlertCircle /><div><strong>유형을 확정하지 못했어요</strong><span>아래에서 직접 선택해주세요. 문서가 스캔본이면 텍스트 인식이 어려울 수 있어요.</span></div></div>)}
        </div>

        {registryEnabled() && docs.some((doc) => doc.status === 'done') && <div className="wiz-block">
          <h4><Wand2 /> AI 세부 규정 추출</h4>
          {ai.status === 'idle' && <>
            <p className="wiz-hint">읽힌 문서에서 상한·금지·재원 규정과 비목 구성을 추출해 <strong>원문 인용과 함께</strong> 보여드려요. 항목별로 검토·승인해야 적용됩니다.</p>
            <button type="button" className="secondary" onClick={runAi}><Sparkles /> 문서에서 규정 추출하기</button>
          </>}
          {ai.status === 'working' && <p className="wiz-hint">문서를 분석하는 중… (문서 크기에 따라 최대 1~2분 걸릴 수 있어요)</p>}
          {ai.status === 'error' && <><p className="field-error"><AlertCircle /> {ai.message}</p><button type="button" className="secondary" onClick={runAi}>다시 시도</button></>}
          {ai.status === 'done' && ai.extraction && <div className="ai-review">
            {ai.cached && <p className="wiz-hint">이 문서는 이전에 분석된 적이 있어 캐시된 결과를 불러왔어요.</p>}
            {ai.extraction.categories.length > 0 && <label className="share-toggle"><input type="checkbox" checked={useDocCats} onChange={(e) => setUseDocCats(e.target.checked)} /><span><strong>문서의 비목 구성 사용</strong> ({ai.extraction.categories.length}개: {ai.extraction.categories.map((c) => c.name).join(', ').slice(0, 60)})</span></label>}
            <div className="ai-rules">{ai.extraction.rules.map((rule, index) => <label key={index} className={`ai-rule ${rule.verified ? '' : 'unverified'}`}>
              <input type="checkbox" checked={acceptedRules.has(index)} onChange={(e) => setAcceptedRules((prev) => { const next = new Set(prev); if (e.target.checked) next.add(index); else next.delete(index); return next; })} />
              <span><strong>[{RULE_KIND_LABEL[rule.kind]}] {rule.message}</strong><em>"{rule.quote.slice(0, 90)}{rule.quote.length > 90 ? '…' : ''}" ({rule.ref}) {rule.verified ? '· 원문 확인됨' : '· ⚠ 원문에서 찾지 못한 인용 — 직접 확인 후 선택하세요'}</em></span>
            </label>)}</div>
            {ai.extraction.uncertain.length > 0 && <p className="wiz-hint">AI가 판단을 보류한 항목: {ai.extraction.uncertain.join(' / ')}</p>}
            <button type="button" className="primary" onClick={applyAi} disabled={acceptedRules.size === 0 && !useDocCats}><Check /> 선택한 규정 적용 ({acceptedRules.size}건{useDocCats ? ' + 비목 구성' : ''})</button>
          </div>}
        </div>}

        <div className="wiz-block">
          <h4><BookOpenCheck /> 적용 규정 확정</h4>
          {extractedPack
            ? <div className="registry-picked"><Wand2 /><div><strong>{extractedPack.name}</strong><span>추출·승인한 규정을 사용합니다 · {extractedPack.guideline} · 비목 {extractedPack.categories.length}개, 규칙 {extractedPack.rules.length}건</span></div><button type="button" className="text-button" onClick={() => setExtractedPack(null)}>해제</button></div>
            : registryPick
            ? <div className="registry-picked"><CheckCircle2 /><div><strong>{registryPick.programName}</strong><span>공유 DB의 규정 팩을 사용합니다 · {registryPick.pack.guideline}</span></div><button type="button" className="text-button" onClick={() => setRegistryPick(null)}>해제</button></div>
            : <div className="pack-select" role="radiogroup" aria-label="사업 유형">{SELECTABLE_PACKS.map((pack) => <button type="button" key={pack.id} role="radio" aria-checked={packId === pack.id} className={packId === pack.id ? 'active' : ''} onClick={() => setPackId(pack.id)}><strong>{pack.name}</strong><span>{pack.guideline}</span></button>)}</div>}
        </div>

        {admin && <div className="wiz-block share-block">
          <label className="share-toggle"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span><CloudUpload /> <strong>공유 규정 DB에 등록</strong> — 다른 사용자도 사업명 검색으로 이 규정·문서를 쓸 수 있게 합니다 (관리자 전용)</span></label>
          {share && <div className="field-grid"><label>사업명 (검색 키)<input value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="예: 예비창업패키지" /></label><label>연도<input inputMode="numeric" value={programYear} onChange={(e) => setProgramYear(digitsOnly(e.target.value).slice(0, 4))} placeholder="2026" /></label></div>}
        </div>}

        <div className="wizard-actions">
          <button type="button" className="secondary" onClick={() => setStep(1)}><ArrowLeft /> 이전</button>
          <button type="button" className="primary large" disabled={creating || docs.some((doc) => doc.status === 'reading')} onClick={create}>{creating ? '만드는 중…' : <>예산 초안 만들기 <ArrowRight /></>}</button>
        </div>
        <p className="fine-print"><ShieldCheck /> 적용 규정: {chosenPack.name} · 예시 기준(검증 전) — 실제 협약·공고 원문이 항상 우선합니다.</p>
      </div>}
    </main>
  </div>;
}
