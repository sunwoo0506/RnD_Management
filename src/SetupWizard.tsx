import { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpenCheck, Check, CheckCircle2, CloudUpload, FileSearch, Search, ShieldCheck, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { deriveTotalBudget, formatWon, getPack, isRegulationDbPack, makeDraftBudgets, previewFunding, selectablePacks, settlementDeadlineFor } from './rules';
import { classifyProgram, guessProgramName, guessYear, type MatchResult } from './matching';
import { DOCUMENT_TYPE_LABEL, type DocumentType, guessDocumentType, registryEnabled, searchRegistry, submitRegistryShare, type RegistryEntry } from './registry';
import { annotateVerification, buildCustomPack, fundingScheduleAmountWon, runExtraction, suggestedFundingRates, type Extraction } from './llmExtract';
import type { Project, RulePack } from './types';

const RULE_KIND_LABEL = { ratio: '상한', warning: '금지·주의', funding: '재원', info: '참고' } as const;

const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const digitsOnly = (value: string) => value.replace(/\D/g, '');
const withCommas = (value: string) => value ? Number(value).toLocaleString('ko-KR') : '';

interface DocItem {
  id: string;
  file: File;
  role: DocumentType;
  status: 'reading' | 'done' | 'error';
  text?: string;
  error?: string;
}

export default function SetupWizard({ onCreate, onCancel }: { onCreate: (project: Project) => void; onCancel?: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({ name: '', subsidy: '100000000', subsidyRate: '', matchingCashRate: '', start: today(), end: '', company: '', owner: '', email: '' });
  const [participant, setParticipant] = useState('');
  // ---- 2단계: 규정 선택 ----
  // 기본값을 고정 id로 두면 그 팩이 폐기됐을 때(SUPERSEDED_PACK_IDS) 목록에 없는 팩이 선택된 채로 시작한다.
  // 선택 가능한 첫 팩을 쓴다 — selectablePacks()는 검증된 규정DB 팩을 앞에 놓는다.
  const [packId, setPackId] = useState(() => selectablePacks()[0]?.id ?? '');
  const [registryPick, setRegistryPick] = useState<RegistryEntry | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [programName, setProgramName] = useState('');
  const [programYear, setProgramYear] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<RegistryEntry[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [share, setShare] = useState(false);
  const [creating, setCreating] = useState(false);
  // ---- AI 세부 규정 추출 ----
  // DB 우선 원칙: 검색 결과가 있으면 추출 블록을 접어두고, 사용자가 명시적으로 열 때만 쓴다.
  const [forceAi, setForceAi] = useState(false);
  const [ai, setAi] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; extraction?: Extraction; cached?: boolean; message?: string; progress?: { done: number; total: number } }>({ status: 'idle' });
  const [acceptedRules, setAcceptedRules] = useState<Set<number>>(new Set());
  const [useDocCats, setUseDocCats] = useState(false);
  const [extractedPack, setExtractedPack] = useState<RulePack | null>(null);
  const [rateSuggestion, setRateSuggestion] = useState<ReturnType<typeof suggestedFundingRates> | null>(null);
  const [rateFilled, setRateFilled] = useState(false);

  const next = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name || !form.company || !form.owner || !form.email || !Number(form.subsidy) || !form.end) return;
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
    const added: DocItem[] = [...list].map((file) => ({ id: uid(), file, role: guessDocumentType(file.name), status: 'reading' }));
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

  // 추출 결과는 그때 읽혀 있던 문서로 만든 것이다. 파일을 더하거나 지우면 결과가 문서와 어긋나는데,
  // 화면은 그대로라 사용자는 새 문서까지 반영된 줄 안다 — 무엇으로 뽑은 것인지 기억해 두고 알려준다.
  const docsKey = (items: DocItem[]) => items.filter((item) => item.status === 'done').map((item) => item.id).sort().join(',');
  const [aiDocsKey, setAiDocsKey] = useState<string | null>(null);
  const aiStale = ai.status === 'done' && aiDocsKey !== null && aiDocsKey !== docsKey(docs);

  const runAi = async () => {
    const key = docsKey(docs);
    setAi({ status: 'working' });
    // 앞선 추출로 만든 팩은 이제 근거가 다른 문서다 — 남겨두면 옛 규칙이 조용히 과제에 적용된다.
    setExtractedPack(null);
    setRateSuggestion(null);
    setRateFilled(false);
    try {
      const { extraction, cached } = await runExtraction(docsText(), match?.packId ?? null,
        (done, total) => setAi((prev) => prev.status === 'working' ? { ...prev, progress: { done, total } } : prev));
      setAiDocsKey(key);
      const verified = annotateVerification(extraction, docsText());
      setAi({ status: 'done', extraction: verified, cached });
      // DB에 없는 사업을 추출했으면 공유 신청을 기본으로 켠다 — 승인되면 DB에 등록돼 다음부터 검색으로 쓴다.
      if (!registryPick) setShare(true);
      // 원문 대조에 성공한 규칙만 기본 선택 — 실패 항목은 사용자가 직접 확인 후 체크
      setAcceptedRules(new Set(verified.rules.map((rule, index) => rule.verified ? index : -1).filter((index) => index >= 0)));
      setUseDocCats(verified.categories.length > 0 && !match?.packId);
      const suggestion = suggestedFundingRates(verified);
      if (suggestion.subsidyRate || suggestion.matchingCashRate) setRateSuggestion(suggestion);
    } catch (error) {
      setAi({ status: 'error', message: error instanceof Error ? error.message : '추출에 실패했습니다.' });
    }
  };

  const fillRates = () => {
    if (!rateSuggestion) return;
    setForm((prev) => ({
      ...prev,
      subsidyRate: rateSuggestion.subsidyRate ? String(rateSuggestion.subsidyRate.pct) : prev.subsidyRate,
      matchingCashRate: rateSuggestion.matchingCashRate ? String(rateSuggestion.matchingCashRate.pct) : prev.matchingCashRate,
    }));
    setRateFilled(true); setTimeout(() => setRateFilled(false), 2500);
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

  // 예산편성 비목은 근거가 검증된 규정DB 팩에서만 온다. 추출 팩이 비목의 출처가 되는 것은
  // 대응하는 규정DB가 아직 없는 사업뿐이다 — 규정DB 팩을 고른 채로 공고문을 추출했다면 그 결과는
  // 보관함에만 담고, 무엇이 달라졌는지는 과제 설정의 "규정 변경사항 확인"에서 검토한다.
  const selectedPack = registryPick?.pack ?? getPack(packId);
  const extractedIsBase = !!extractedPack && !isRegulationDbPack(selectedPack);
  const chosenPack: RulePack = extractedIsBase ? extractedPack! : selectedPack;

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      // 공유를 선택했으면 팩·문서를 공유 신청 대기열에 올린다 (관리자 승인 후 반영, 실패해도 과제 생성은 진행).
      if (share && registryEnabled()) {
        try {
          const name = programName.trim() || form.name;
          const year = Number(programYear) || null;
          const shareDocs = docs.map((doc) => ({ file: doc.file, documentType: doc.role }));
          // 이미 공유 DB에 있는 규정 팩을 골랐다면(registryPick) 새 팩을 다시 신청하지 않고 문서만 신청한다.
          await submitRegistryShare({
            programName: name, year, docs: shareDocs,
            ...(registryPick ? {} : { pack: chosenPack, origin: extractedPack ? 'extracted' : 'pack' }),
          });
        } catch (error) {
          alert(`공유 신청에 실패했습니다 (${error instanceof Error ? error.message : ''}). 과제는 정상 생성됩니다.`);
        }
      }
      const subsidyAmount = Number(form.subsidy) || 0;
      // 비워두면 나중에 AI·설정에서 채울 수 있도록 "확인됨(100 등)"으로 단정해 저장하지 않고 비워둔다.
      const subsidyRate = form.subsidyRate === '' ? undefined : Math.min(100, Math.max(1, Number(form.subsidyRate) || 100));
      const matchingCashRate = form.matchingCashRate === '' ? undefined : Math.min(100, Math.max(0, Number(form.matchingCashRate) || 0));
      const totalBudget = deriveTotalBudget(subsidyAmount, subsidyRate ?? 100);
      onCreate({
        id: uid(), name: form.name, totalBudget, subsidyAmount, subsidyRate, matchingCashRate, startDate: form.start, endDate: form.end,
        settlementDeadline: settlementDeadlineFor(form.end), agency: chosenPack.agency.split(' (')[0], companyName: form.company,
        packId: extractedIsBase ? extractedPack!.id : registryPick ? `registry:${registryPick.id}` : packId,
        customPack: extractedIsBase ? extractedPack! : registryPick?.pack,
        // AI로 추출·적용한 팩은 보관함에도 담아 과제 설정 > AI 규정 추출에서 언제든 다시 열람할 수 있게 한다.
        extractedPacks: extractedPack ? [{ id: uid(), savedAt: new Date().toISOString(), sourceDocTitles: docs.filter((doc) => doc.status === 'done').map((doc) => doc.file.name), pack: extractedPack }] : undefined,
        programName: programName.trim() || registryPick?.programName || (ai.status === 'done' ? ai.extraction?.programName : undefined) || undefined,
        members: [{ id: uid(), name: form.owner, email: form.email, role: '대표' }],
        participants: participant.trim() ? [{ id: uid(), name: participant.trim(), projectRate: 0, externalRate: 0 }] : [],
        budgets: makeDraftBudgets(chosenPack, totalBudget), expenses: [], changes: [], emailLogs: [], createdAt: new Date().toISOString(),
      });
    } finally { setCreating(false); }
  };

  return <div className="setup-page">
    <div className="setup-brand"><div className="brand-mark"><Check /></div><span>과제온</span>{onCancel && <button type="button" className="wizard-cancel" onClick={onCancel}><ArrowLeft /> 기존 과제로 돌아가기</button>}</div>
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
        <div className="field-grid"><label>기업명<input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="주식회사 과제온" /></label><label>지원금(정부지원금)<input required inputMode="numeric" value={withCommas(form.subsidy)} onChange={(e) => setForm({ ...form, subsidy: digitsOnly(e.target.value) })} /></label></div>
        <div className="field-grid"><label><span className="label-line">지원비율(%) <b>선택 · 다음 단계 공고문 업로드 시 AI가 자동 입력</b></span><input inputMode="numeric" value={form.subsidyRate} onChange={(e) => setForm({ ...form, subsidyRate: digitsOnly(e.target.value).slice(0, 3) })} placeholder="공고문 확인 후 알면 직접 입력 (예: 75)" /></label>{form.subsidyRate !== '' && Number(form.subsidyRate) < 100 && <label><span className="label-line">민간부담금 중 현금 비율(%) <b>선택</b></span><input inputMode="numeric" value={form.matchingCashRate} onChange={(e) => setForm({ ...form, matchingCashRate: digitsOnly(e.target.value).slice(0, 3) })} placeholder="예: 10 (기업부담금 중 현금 10% 이상)" /></label>}</div>
        <p className="fine-print">{form.subsidyRate === ''
          ? '지원비율은 몰라도 다음 단계에서 공고문을 업로드하면 AI가 원문에서 찾아 채워드려요. 이미 아신다면 지금 입력하셔도 됩니다. (예: "연구개발비의 75% 이내" → 75)'
          : Number(form.subsidyRate) < 100 && form.matchingCashRate === ''
          ? '공고문의 "기업(민간)부담금 중 현금 비율"을 알면 입력하세요. 모르면 비워둬도 되고, 다음 단계에서 AI가 채워드려요. (예: "현금 10% 이상" → 10)'
          : (() => {
              const rate = Math.min(100, Math.max(1, Number(form.subsidyRate) || 100));
              const cashRate = Math.min(100, Math.max(0, Number(form.matchingCashRate) || 0));
              const { totalBudget, matching, matchingCash, matchingInKind } = previewFunding(Number(form.subsidy) || 0, rate, cashRate);
              return rate >= 100
                ? `자기부담 없이 전액 지원 — 총사업비 ${formatWon(totalBudget)}`
                : `총사업비 ${formatWon(totalBudget)} = 지원금 ${formatWon(Number(form.subsidy) || 0)} + 민간부담금 ${formatWon(matching)} (현금 ${formatWon(matchingCash)} · 현물 ${formatWon(matchingInKind)})`;
            })()}</p>
        {/* 정산 마감일은 따로 받지 않는다 — 종료일에서 셈해야 사업기간을 고쳤을 때 함께 따라온다. */}
        <div className="field-grid"><label>시작일<input required type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label><label>종료일<input required type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label></div>
        {form.end && <p className="wiz-hint">정산 마감일은 <strong>{settlementDeadlineFor(form.end)}</strong>로 잡습니다 (사업 종료 후 1개월). 증빙 누락 알림이 이 날짜의 D-30 · D-14 · D-7에 뜹니다.</p>}
        <div className="field-grid"><label>대표자 이름<input required value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label><label>알림 이메일<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label></div>
        <label><span className="label-line">참여 인력 <b>선택</b></span><input value={participant} onChange={(e) => setParticipant(e.target.value)} placeholder="첫 참여 인력 이름" /></label>
        <button className="primary large" type="submit">다음 — 적용 규정 정하기 <ArrowRight /></button>
        <p className="fine-print"><ShieldCheck /> 입력 정보는 계정(또는 이 브라우저)에만 저장됩니다.</p>
      </form>}

      {step === 2 && <div className="setup-form wizard">
        <div><span className="step-pill">2 / 2</span><h2>적용 규정을 정해볼까요?</h2><p>공유 DB 검색, 공고문 업로드, 직접 선택 중 편한 방법을 쓰세요.</p></div>

        {registryEnabled() && <div className="wiz-block">
          <h4><Search /> ① 사업명으로 규정 DB 검색 — 등록된 규정 우선 사용</h4>
          <div className="search-row"><input value={searchQ} placeholder="예: 예비창업패키지" onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }} /><button type="button" className="secondary" disabled={searchBusy} onClick={runSearch}>{searchBusy ? '검색 중…' : '검색'}</button></div>
          {searchResults && (searchResults.length
            ? <div className="registry-results">{searchResults.map((entry) => <button type="button" key={entry.id} className={registryPick?.id === entry.id ? 'active' : ''} onClick={() => { setRegistryPick(entry); setProgramName(entry.programName); if (entry.year) setProgramYear(String(entry.year)); }}><strong>{entry.programName}{entry.year ? ` (${entry.year})` : ''}</strong><span>{entry.pack.guideline}{entry.verified ? ' · 검증됨' : ' · 검증 전'}</span></button>)}</div>
            : <p className="wiz-hint">아직 DB에 등록되지 않은 사업이에요. 아래에서 공고문·지침을 업로드하면 AI가 규정을 추출해 이 과제에 적용할 수 있고, 공유 신청하면 관리자 승인 후 DB에 등록돼 다음부터는 검색만으로 바로 쓸 수 있어요.</p>)}
        </div>}

        <div className="wiz-block">
          <h4><FileSearch /> ② 공고문·지침 업로드 — 자동 식별</h4>
          <label className="upload-button wide"><Upload /> 파일 추가 (PDF · HWP · 이미지)<input type="file" multiple accept=".pdf,.hwp,.hwpx,.txt,.md,image/*" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label>
          {docs.length > 0 && <div className="doc-list">{docs.map((doc) => <div key={doc.id} className={`doc-item ${doc.status}`}>
            <span className="doc-name">{doc.file.name}</span>
            <select aria-label={`${doc.file.name} 문서 유형`} value={doc.role} onChange={(e) => setDocs((prev) => prev.map((item) => item.id === doc.id ? { ...item, role: e.target.value as DocumentType } : item))}>{Object.entries(DOCUMENT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <span className="doc-status">{doc.status === 'reading' ? '읽는 중…' : doc.status === 'done' ? '읽기 완료' : doc.error}</span>
            <button type="button" aria-label={`${doc.file.name} 제거`} onClick={() => removeDoc(doc.id)}><Trash2 /></button>
          </div>)}</div>}
          {match && (match.packId
            ? <div className="match-result"><CheckCircle2 /><div><strong>{getPack(match.packId).name}(으)로 식별했어요</strong><span>근거: {match.hits.map((hit) => `"${hit.keyword}" ${hit.count}회`).join(' · ')}</span></div></div>
            : <div className="match-result none"><AlertCircle /><div><strong>유형을 확정하지 못했어요</strong><span>아래에서 직접 선택해주세요. 문서가 스캔본이면 텍스트 인식이 어려울 수 있어요.</span></div></div>)}
        </div>

        {registryEnabled() && docs.some((doc) => doc.status === 'done') && !registryPick && <div className="wiz-block">
          <h4><Wand2 /> ③ AI 세부 규정 추출 — DB에 없는 사업용</h4>
          {ai.status === 'idle' && ((searchResults?.length ?? 0) > 0 && !forceAi
            ? <>
              <p className="wiz-hint">공유 DB에 등록된 사업이 검색됐어요. 위 ①에서 선택하면 추출 없이 검증된 규정을 바로 쓸 수 있어요. AI 추출은 DB에 없는 사업을 새로 등록할 때 쓰는 도구예요.</p>
              <button type="button" className="text-button" onClick={() => setForceAi(true)}>등록된 규정 대신 문서에서 새로 추출하기</button>
            </>
            : <>
              <p className="wiz-hint">{searchResults === null ? '먼저 ①에서 사업명을 검색해보세요 — 등록된 규정이 있으면 추출 없이 바로 쓸 수 있어요. DB에 없다면 ' : ''}읽힌 문서에서 상한·금지·재원 규정과 비목 구성을 추출해 <strong>원문 인용과 함께</strong> 보여드려요. 항목별로 검토·승인해야 적용되고, 공유 신청하면 관리자 승인 후 DB에 등록돼 다음부터 검색으로 바로 쓸 수 있어요.</p>
              <button type="button" className="secondary" onClick={runAi}><Sparkles /> 문서에서 규정 추출하기</button>
            </>)}
          {ai.status === 'working' && <p className="wiz-hint">{ai.progress && ai.progress.total > 1
            ? `문서가 길어 ${ai.progress.total}조각으로 나눠 분석하는 중… (${ai.progress.done}/${ai.progress.total} 완료)`
            : '문서를 분석하는 중… (문서 크기에 따라 최대 1~2분 걸릴 수 있어요)'}</p>}
          {ai.status === 'error' && <><p className="field-error"><AlertCircle /> {ai.message}</p><button type="button" className="secondary" onClick={runAi}>다시 시도</button></>}
          {ai.status === 'done' && ai.extraction && <div className="ai-review">
            {/* 파일을 더하거나 지우면 아래 결과는 옛 문서의 것이다 — 그대로 승인하면 문서에 없는 규칙이 적용된다. */}
            {aiStale
              ? <div className="ai-stale">
                <AlertCircle />
                <div><strong>업로드한 문서가 바뀌었어요</strong><span>아래 결과는 바뀌기 전 문서에서 뽑은 것이라 지금 문서와 맞지 않을 수 있어요. 다시 추출한 뒤 검토해주세요.</span></div>
                <button type="button" className="secondary" onClick={runAi}><Sparkles /> 문서에서 다시 추출하기</button>
              </div>
              : <div className="ai-rerun">
                {ai.cached && <span className="wiz-hint">이 문서는 이전에 분석된 적이 있어 캐시된 결과를 불러왔어요.</span>}
                <button type="button" className="text-button" onClick={runAi}><Sparkles /> 다시 추출하기</button>
              </div>}
            {rateSuggestion && (rateSuggestion.subsidyRate || rateSuggestion.matchingCashRate) && <div className="rate-suggestion">
              <h4><Sparkles /> AI가 문서에서 찾은 재원 비율 <b>확인 후 수정 가능</b></h4>
              {rateSuggestion.subsidyRate && <p className="wiz-hint">지원비율 {rateSuggestion.subsidyRate.pct}% — "{rateSuggestion.subsidyRate.rule.quote.slice(0, 80)}{rateSuggestion.subsidyRate.rule.quote.length > 80 ? '…' : ''}" ({rateSuggestion.subsidyRate.rule.ref})</p>}
              {rateSuggestion.matchingCashRate && <p className="wiz-hint">민간부담금 중 현금 최소비율 {rateSuggestion.matchingCashRate.pct}% — "{rateSuggestion.matchingCashRate.rule.quote.slice(0, 80)}{rateSuggestion.matchingCashRate.rule.quote.length > 80 ? '…' : ''}" ({rateSuggestion.matchingCashRate.rule.ref})</p>}
              <button type="button" className="secondary" onClick={fillRates}><Check /> 1단계 지원비율·현금비율 칸에 채우기</button>
              {rateFilled && <span className="save-ok"><CheckCircle2 /> 채웠어요 — 1단계에서 확인하세요</span>}
            </div>}
            {ai.extraction.fundingSchedule && (() => {
              const sched = ai.extraction.fundingSchedule!;
              const totalWon = fundingScheduleAmountWon(sched, sched.totalSubsidyMax);
              const currentSubsidy = Number(form.subsidy) || 0;
              return <div className={`funding-cap ${sched.verified ? '' : 'unverified'}`}>
                <h4>이 공고의 지원금 한도</h4>
                <p className="wiz-hint">"{sched.quote.slice(0, 80)}{sched.quote.length > 80 ? '…' : ''}" ({sched.ref}) {sched.verified ? '· 원문 확인됨' : '· ⚠ 원문에서 찾지 못한 인용 — 직접 확인하세요'}</p>
                {totalWon != null
                  ? <p><strong>합계 한도 {formatWon(totalWon)}</strong></p>
                  : sched.totalSubsidyMax != null && <p><strong>합계 한도 {sched.totalSubsidyMax.toLocaleString('ko-KR')}{sched.unit ?? ''}</strong> (단위를 자동 환산하지 못했어요 — 원문을 확인하세요)</p>}
                {sched.years.length > 0 && <ul className="funding-cap-years">{sched.years.map((y, i) => {
                  const subsidyWon = fundingScheduleAmountWon(sched, y.subsidy);
                  return <li key={i}>{y.label}: 정부지원 {subsidyWon != null ? formatWon(subsidyWon) : `${y.subsidy ?? '-'}${sched.unit ?? ''}`}</li>;
                })}</ul>}
                {totalWon != null && currentSubsidy > totalWon && <p className="field-error"><AlertCircle /> 1단계에 입력한 지원금({formatWon(currentSubsidy)})이 공고 한도({formatWon(totalWon)})를 초과했어요.</p>}
              </div>;
            })()}
            {ai.extraction.categories.length > 0 && <label className="share-toggle"><input type="checkbox" checked={useDocCats} onChange={(e) => setUseDocCats(e.target.checked)} /><span><strong>문서의 비목 구성 사용</strong> ({ai.extraction.categories.length}개: {ai.extraction.categories.map((c) => c.name).join(', ').slice(0, 60)})</span></label>}
            <div className="ai-rules">{ai.extraction.rules.map((rule, index) => <label key={index} className={`ai-rule ${rule.verified ? '' : 'unverified'}`}>
              <input type="checkbox" checked={acceptedRules.has(index)} onChange={(e) => setAcceptedRules((prev) => { const next = new Set(prev); if (e.target.checked) next.add(index); else next.delete(index); return next; })} />
              <span><strong>[{rule.minAmount != null ? '필수계상' : RULE_KIND_LABEL[rule.kind]}] {rule.message}{rule.minAmount != null && ` (${formatWon(rule.minAmount)})`}</strong><em>"{rule.quote.slice(0, 90)}{rule.quote.length > 90 ? '…' : ''}" ({rule.ref}) {rule.verified ? '· 원문 확인됨' : '· ⚠ 원문에서 찾지 못한 인용 — 직접 확인 후 선택하세요'}</em></span>
            </label>)}</div>
            {ai.extraction.uncertain.length > 0 && <p className="wiz-hint">AI가 판단을 보류한 항목: {ai.extraction.uncertain.join(' / ')}</p>}
            {ai.extraction.referencedRegulations && ai.extraction.referencedRegulations.length > 0 && <div className="ref-regs">
              <h4>이 공고가 참고하라고 명시한 규정</h4>
              <p className="wiz-hint">예산 편성 기준은 대개 공고문·사업계획서에 있지만, 증빙 서류는 아래 규정도 확인이 필요할 수 있어요. 정부 사이트에 흩어져 있어 자동으로 가져오지는 못하니, 직접 찾아 공유 규정 DB에 올려두면 다음부터 검색으로 바로 쓸 수 있어요.</p>
              <ul className="ref-reg-list">{ai.extraction.referencedRegulations.map((reg, index) => <li key={index} className={reg.verified ? '' : 'unverified'}><strong>{reg.name}</strong><em>"{reg.quote.slice(0, 70)}{reg.quote.length > 70 ? '…' : ''}" ({reg.ref})</em></li>)}</ul>
            </div>}
            <button type="button" className="primary" onClick={applyAi} disabled={acceptedRules.size === 0 && !useDocCats}><Check /> 선택한 규정 적용 ({acceptedRules.size}건{useDocCats ? ' + 비목 구성' : ''})</button>
          </div>}
        </div>}

        <div className="wiz-block">
          <h4><BookOpenCheck /> ④ 적용 규정 확정</h4>
          {extractedPack
            ? <div className={`registry-picked ${aiStale ? 'stale' : ''}`}><Wand2 /><div><strong>{extractedPack.name}</strong><span>{aiStale
              ? '업로드한 문서가 바뀐 뒤라 이 규정은 지금 문서와 다를 수 있어요 — ③에서 다시 추출해주세요.'
              : `추출·승인한 규정을 사용합니다 · ${extractedPack.guideline} · 비목 ${extractedPack.categories.length}개, 규칙 ${extractedPack.rules.length}건`}</span></div><button type="button" className="text-button" onClick={() => setExtractedPack(null)}>해제</button></div>
            : registryPick
            ? <div className="registry-picked"><CheckCircle2 /><div><strong>{registryPick.programName}</strong><span>공유 DB의 규정 팩을 사용합니다 · {registryPick.pack.guideline}</span></div><button type="button" className="text-button" onClick={() => setRegistryPick(null)}>해제</button></div>
            : <div className="pack-select" role="radiogroup" aria-label="사업 유형">{selectablePacks().map((pack) => <button type="button" key={pack.id} role="radio" aria-checked={packId === pack.id} className={packId === pack.id ? 'active' : ''} onClick={() => setPackId(pack.id)}><strong>{pack.name}{isRegulationDbPack(pack) && <em className="pack-verified">근거 검증됨</em>}</strong><span>{pack.guideline}</span></button>)}</div>}
        </div>

        {registryEnabled() && <div className="wiz-block share-block">
          <label className="share-toggle"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span><CloudUpload /> <strong>공유 규정 DB에 공유 신청</strong> — 관리자 검토 후 다른 사용자도 사업명 검색으로 이 규정·문서를 쓸 수 있게 합니다</span></label>
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
