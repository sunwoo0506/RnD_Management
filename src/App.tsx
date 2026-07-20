import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, Bell, BookOpenCheck,
  Building2, CalendarDays, Check, CheckCircle2, ChevronRight, CircleDollarSign, CloudUpload,
  Download, Eye, FileCheck2, FileClock, FileSearch, FileText, HandCoins, Landmark, LayoutDashboard, LogOut, Mail, Package,
  Pencil, Plus, RefreshCw, ScanLine, Settings as SettingsIcon, ShieldCheck, Sparkles, Trash2, Upload, UserPlus, Users, WalletCards,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { capFor, categoryOf, deriveTotalBudget, documentsFor, formatWon, fundingBreakdown, globalRules, makeDraftBudgets, minFor, packFor, previewFunding, REASON_TEMPLATES, RULES_EFFECTIVE_DATE, rulesFor, transferLimitError, visibleCategories } from './rules';
import { collectEvidenceIds, downloadBackup, loadProject, parseBackup, saveProject } from './storage';
import { authErrorKo, deleteEvidence, fetchCloudProject, getEvidence, saveCloudProject, setCloudUser, signInEmail, signOutCloud, signUpEmail, storeEvidence } from './cloud';
import { isCloudEnabled, supabase } from './supabase';
import { deleteRegistryDocument, downloadRegistryDocument, guessDocRole, isRegistryAdmin, listRegistryDocuments, matchDocToSource, REGISTRY_ROLE_LABEL, registryEnabled, saveRegistryEntry, uploadRegistryDocument, type RegistryDocEntry } from './registry';
import { annotateVerification, buildCustomPack, fundingScheduleAmountWon, runExtraction, suggestedFundingRates, type Extraction } from './llmExtract';
import SetupWizard from './SetupWizard';
import type { BudgetCategoryId, BudgetItem, Evidence, Expense, Participant, PaymentMethod, Project, Screen } from './types';

// 문서 생성 라이브러리(docx·excel)는 무거워서 첫 화면 번들에서 제외하고 버튼 클릭 시에만 불러온다.
const withExporters = async (run: (mod: typeof import('./exporters')) => Promise<void>) => {
  try { await run(await import('./exporters')); }
  catch { alert('문서 생성에 실패했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.'); }
};

const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
// 금액 입력칸은 숫자만 상태에 저장하고 화면에는 천 단위 쉼표를 붙여 보여준다.
const digitsOnly = (value: string) => value.replace(/\D/g, '');
const withCommas = (value: string) => value ? Number(value).toLocaleString('ko-KR') : '';
const daysUntil = (date: string) => Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000);

const SYNC_LABEL = { local: '이 브라우저에만 저장', saving: '클라우드 저장 중…', synced: '클라우드 동기화됨', error: '동기화 오류 — 재시도 예정' } as const;

function Sidebar({ screen, setScreen, project, onReset, account, sync, onLogout }: { screen: Screen; setScreen: (s: Screen) => void; project: Project; onReset: () => void; account: string | null; sync: 'local' | 'saving' | 'synced' | 'error'; onLogout: () => void }) {
  const nav = [
    { id: 'overview' as Screen, label: '한눈에 보기', icon: LayoutDashboard },
    { id: 'budget' as Screen, label: '예산 편성', icon: WalletCards },
    { id: 'spending' as Screen, label: '집행 · 증빙', icon: FileCheck2 },
    { id: 'change' as Screen, label: '변경 관리', icon: RefreshCw },
    { id: 'team' as Screen, label: '인력 · 담당자', icon: Users },
    { id: 'settings' as Screen, label: '과제 설정', icon: SettingsIcon },
  ];
  const pack = packFor(project);
  return <aside className="sidebar">
    <div className="logo"><div className="brand-mark"><Check /></div><span>과제온</span><b>beta</b></div>
    <div className="project-chip"><Building2 /><div><small>현재 과제</small><strong>{project.name}</strong></div><ChevronRight /></div>
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id)}><Icon />{label}</button>)}</nav>
    <div className="sidebar-bottom"><div className="policy"><BookOpenCheck /><div><strong>{pack.name} · 예시 기준 (검증 전)</strong><span>{RULES_EFFECTIVE_DATE} 업데이트</span></div></div>{isCloudEnabled && <div className="cloud-chip"><span className={`sync-dot ${sync}`} /><div>{account ? <small>{account}</small> : null}<span>{SYNC_LABEL[sync]}</span></div>{account && <button onClick={onLogout}>로그아웃</button>}</div>}<button className="reset-button" onClick={onReset}><LogOut /> 과제 나가기</button></div>
  </aside>;
}

function Header({ project }: { project: Project }) {
  return <header className="topbar"><div><h1>{project.name}</h1><p>{project.agency} · {project.startDate} — {project.endDate}</p></div><div className="header-actions"><button className="icon-button" aria-label="알림"><Bell /></button><div className="avatar">{project.members[0]?.name.slice(0, 1) || '관'}</div><div className="user-meta"><strong>{project.members[0]?.name}</strong><span>{project.companyName}</span></div></div></header>;
}

function Overview({ project, setScreen }: { project: Project; setScreen: (s: Screen) => void }) {
  const pack = packFor(project);
  const cats = visibleCategories(pack, project);
  const spent = project.expenses.reduce((sum, item) => sum + item.amount, 0);
  const incomplete = project.expenses.reduce((sum, item) => sum + item.evidence.filter((e) => !e.completed).length, 0);
  const complete = project.expenses.length ? Math.round(project.expenses.filter((e) => e.evidence.every((x) => x.completed)).length / project.expenses.length * 100) : 0;
  const dday = daysUntil(project.settlementDeadline);
  const alerts = project.participants.filter((p) => p.projectRate + p.externalRate > 100).length;
  const funding = fundingBreakdown(project);
  const pct = (value: number) => project.totalBudget ? value / project.totalBudget * 100 : 0;
  return <div className="page-content">
    <section className="welcome"><div><span>{new Date().getHours() < 12 ? '좋은 아침이에요' : '오늘도 수고 많으셨어요'}, {project.members[0]?.name}님</span><h2>과제 상태를 확인해보세요.</h2></div><div className="deadline"><CalendarDays /><div><small>정산 마감까지</small><strong>{dday >= 0 ? `D-${dday}` : `D+${Math.abs(dday)}`}</strong></div></div></section>
    <div className="metric-grid">
      <article className="metric-card"><div className="metric-icon blue"><CircleDollarSign /></div><div><span>총 사업비</span><strong>{formatWon(project.totalBudget)}</strong><small>{pack.name}</small></div></article>
      <article className="metric-card"><div className="metric-icon violet"><ArrowUpRight /></div><div><span>누적 집행액</span><strong>{formatWon(spent)}</strong><small>{project.totalBudget ? (spent / project.totalBudget * 100).toFixed(1) : 0}% 집행</small></div></article>
      <article className="metric-card"><div className="metric-icon green"><FileCheck2 /></div><div><span>증빙 완비율</span><strong>{complete}%</strong><small>{incomplete ? `${incomplete}개 서류 미완료` : '모두 준비됐어요'}</small></div></article>
      <article className="metric-card"><div className={`metric-icon ${alerts ? 'red' : 'green'}`}><ShieldCheck /></div><div><span>참여율 경고</span><strong>{alerts}건</strong><small>{alerts ? '확인이 필요해요' : '안전한 상태예요'}</small></div></article>
    </div>
    <section className="panel funding-panel"><div className="panel-head"><div><span className="section-kicker">FUNDING</span><h3>총사업비 구성</h3><p>총 사업비 {formatWon(project.totalBudget)}의 세부 구성이에요.</p></div><button className="text-button" onClick={() => setScreen('settings')}>지원금 설정 <ArrowRight /></button></div>
      <div className="funding-grid two">
        <article className="funding-card major"><div className="metric-icon blue"><Landmark /></div><div><span>지원금</span><strong>{formatWon(funding.subsidy)}</strong><small>총사업비의 {pct(funding.subsidy).toFixed(0)}%</small></div></article>
        <article className="funding-card major"><div className="metric-icon violet"><HandCoins /></div><div><span>민간부담금</span><strong>{formatWon(funding.matching)}</strong><small>총사업비의 {pct(funding.matching).toFixed(0)}%</small>
          {funding.matching > 0 && (funding.matchingCashRateKnown
            ? <div className="matching-split">
                <div><Banknote /><span>현금</span><b>{formatWon(funding.matchingCash)}</b></div>
                <div><Package /><span>현물</span><b>{formatWon(funding.matchingInKind)}</b></div>
              </div>
            : <div className="matching-split unknown"><AlertCircle /><span>현금·현물 비율 확인 필요 — 과제 설정에서 입력하거나 공고문을 올려 AI로 채우세요</span></div>)}
        </div></article>
      </div>
      {funding.matching === 0
        ? <p className="field-hint">자기부담 없이 전액 지원되는 과제예요.</p>
        : funding.matchingCashRateKnown
        ? <p className="field-hint">민간부담금 중 현금 비율 {funding.matchingCashRate}% 적용 (과제 설정에서 변경). 공고문 기준 최소 금액이며, 실제 협약 내용을 우선 확인하세요.</p>
        : null}
    </section>
    <div className="overview-grid">
      <section className="panel budget-status"><div className="panel-head"><div><span className="section-kicker">BUDGET STATUS</span><h3>비목별 집행 현황</h3></div><button className="text-button" onClick={() => setScreen('budget')}>예산 자세히 <ArrowRight /></button></div>
        <div className="budget-bars">{cats.map((category) => { const amount = project.budgets.find((b) => b.categoryId === category.id)?.amount ?? 0; const used = project.expenses.filter((e) => e.categoryId === category.id).reduce((s, e) => s + e.amount, 0); const rate = amount ? Math.min(used / amount * 100, 100) : 0; return <div className="budget-row" key={category.id}><div><strong>{category.name}</strong><span>{formatWon(used)} / {formatWon(amount)}</span></div><div className="progress"><i style={{ width: `${rate}%` }} className={rate >= 90 ? 'danger' : ''} /></div><b>{rate.toFixed(0)}%</b></div>; })}</div>
      </section>
      <section className="panel next-actions"><div className="panel-head"><div><span className="section-kicker">NEXT ACTION</span><h3>지금 확인할 일</h3></div></div>
        {incomplete > 0 ? <button onClick={() => setScreen('spending')} className="action-item warning"><AlertCircle /><div><strong>증빙 {incomplete}개가 비어 있어요</strong><span>파일을 올리면 자동으로 완료 처리돼요</span></div><ChevronRight /></button> : <div className="empty-action"><CheckCircle2 /><strong>증빙이 모두 준비됐어요</strong><span>새 집행건을 등록하면 필요한 서류를 안내해드려요.</span></div>}
        {alerts > 0 && <button onClick={() => setScreen('team')} className="action-item danger"><AlertCircle /><div><strong>참여율 100% 초과</strong><span>참여 인력의 비율을 조정해주세요</span></div><ChevronRight /></button>}
        <button onClick={() => setScreen('spending')} className="quick-add"><Plus /> 새 집행건 등록</button>
      </section>
    </div>
    <section className="guide-banner"><div className="guide-icon"><ShieldCheck /></div><div><span>과제온 가이드</span><strong>집행 전에 인정 기준을 먼저 확인하세요.</strong><p>비목을 선택하면 중기부 기준 증빙 목록과 주의사항을 바로 보여드려요.</p></div><button onClick={() => setScreen('spending')}>집행 등록하기 <ArrowRight /></button></section>
  </div>;
}

// 공유 DB에 저장된 이 사업의 원본 문서(공고문·지침·매뉴얼)를 조회·업로드·미리보기하는 공용 훅.
interface DocViewer { doc: RegistryDocEntry; kind: 'loading' | 'pdf' | 'image' | 'text'; url?: string; text?: string; highlights?: string[] }

// 근거 문구에서 팝업 하이라이트용 위치 패턴(제65조, 사업비 3번, 별표 1...)을 뽑는다.
const refPatternTerms = (ref: string): string[] => {
  const terms: string[] = [];
  for (const pattern of [/제\s*\d+\s*조/, /사업비\s*\d+/, /별표\s*\d+/, /붙임\s*\d+/, /별지\s*제?\s*\d+호?/, /QnA|질의응답/i]) {
    const match = pattern.exec(ref);
    if (match) terms.push(match[0]);
  }
  return terms;
};

// 흔해서 문서 전체에 칠해질 단어들 — 하이라이트 키워드에서 제외
const COMMON_WORDS = new Set(['사업비', '사업', '지원', '창업', '기업', '경우', '집행', '비용', '금액', '대상', '신청', '이내', '불가', '가능', '있다', '한다', '해당', '관련']);
// 인용·메시지에서 문서에 그대로 있을 법한 특징 단어를 뽑는다 (길고 드문 단어 우선).
const keywordTokens = (text: string): string[] =>
  [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !COMMON_WORDS.has(token)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

// 규칙 전체의 하이라이트 검색어: 원문 인용(있으면) + 근거 위치 패턴 + 특징 단어.
const highlightTerms = (rule: { quote?: string; message?: string; source: { ref: string } }): string[] => [
  ...(rule.quote ? [rule.quote.slice(0, 40)] : []),
  ...refPatternTerms(rule.source.ref),
  ...keywordTokens(rule.quote ?? rule.message ?? ''),
];

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 텍스트 미리보기에서 검색어를 <mark>로 감싼다 (공백 차이 허용).
const renderHighlighted = (text: string, terms?: string[]) => {
  const usable = (terms ?? []).map((term) => term.trim()).filter((term) => term.length >= 2);
  if (!usable.length) return text;
  const pattern = usable.map((term) => term.split(/\s+/).map(escapeRegex).join('\\s*')).join('|');
  let re: RegExp;
  try { re = new RegExp(pattern, 'g'); } catch { return text; }
  const parts: (string | React.ReactElement)[] = [];
  let last = 0;
  let key = 0;
  let match = re.exec(text);
  while (match) {
    if (match[0].length === 0) { re.lastIndex += 1; match = re.exec(text); continue; }
    parts.push(text.slice(last, match.index));
    parts.push(<mark key={key++} className="hl">{match[0]}</mark>);
    last = match.index + match[0].length;
    match = re.exec(text);
  }
  parts.push(text.slice(last));
  return parts;
};

function useSourceDocs(project: Project) {
  const pack = packFor(project);
  const searchKey = project.programName ?? pack.name;
  const [srcDocs, setSrcDocs] = useState<RegistryDocEntry[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewer, setViewer] = useState<DocViewer | null>(null);
  useEffect(() => {
    if (!registryEnabled()) { setSrcDocs([]); return; }
    listRegistryDocuments(searchKey).then(setSrcDocs).catch(() => setSrcDocs([]));
  }, [searchKey]);
  useEffect(() => { if (registryEnabled()) isRegistryAdmin().then(setIsAdmin).catch(() => {}); }, []);
  const closeViewer = () => setViewer((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null; });
  const downloadDoc = async (doc: RegistryDocEntry) => {
    try {
      const blob = await downloadRegistryDocument(doc.storagePath);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = doc.fileName; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { alert(`다운로드에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
  };
  // 팝업 미리보기: PDF·이미지·텍스트는 그대로, HWP/HWPX는 본문 텍스트를 추출해 보여준다.
  // highlights가 있으면 텍스트 미리보기에서 해당 부분을 빨간색으로 강조한다.
  const viewDoc = async (doc: RegistryDocEntry, highlights?: string[]) => {
    setViewer({ doc, kind: 'loading', highlights });
    try {
      const blob = await downloadRegistryDocument(doc.storagePath);
      const name = doc.fileName.toLowerCase();
      if (name.endsWith('.pdf')) { setViewer({ doc, kind: 'pdf', url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), highlights }); return; }
      if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) { setViewer({ doc, kind: 'image', url: URL.createObjectURL(blob), highlights }); return; }
      if (/\.(txt|md)$/.test(name)) { setViewer({ doc, kind: 'text', text: await blob.text(), highlights }); return; }
      if (/\.hwpx?$/.test(name)) {
        const { extractDocumentText } = await import('./extract');
        const { text } = await extractDocumentText(new File([blob], doc.fileName));
        setViewer({ doc, kind: 'text', text, highlights });
        return;
      }
      // 미리보기 불가 형식은 다운로드로 폴백
      closeViewer();
      await downloadDoc(doc);
    } catch (error) {
      closeViewer();
      alert(`미리보기에 실패했습니다: ${error instanceof Error ? error.message : ''} — 다운로드로 확인해주세요.`);
    }
  };
  const uploadSourceDocs = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      for (const file of [...files]) {
        await uploadRegistryDocument(file, { programName: searchKey, year: null, role: guessDocRole(file.name) });
      }
      setSrcDocs(await listRegistryDocuments(searchKey));
    } catch (error) { alert(`업로드에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
  };
  const deleteSourceDoc = async (doc: RegistryDocEntry) => {
    if (!confirm(`"${doc.fileName}"을(를) 공유 규정 DB에서 삭제할까요? 같은 사업을 검색하는 다른 사용자에게도 더 이상 보이지 않습니다.`)) return;
    try {
      await deleteRegistryDocument(doc);
      setSrcDocs((prev) => prev?.filter((item) => item.id !== doc.id) ?? prev);
    } catch (error) { alert(`삭제에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
  };
  // 규칙의 출처(문서명·근거 문구)와 가장 잘 맞는 원본 문서를 찾는다 (QnA 근거→질의응답 파일, 조문 근거→지침 파일).
  const docForSource = (source: { doc?: string; ref?: string; matchLevel: string }): RegistryDocEntry | undefined =>
    srcDocs?.length ? matchDocToSource(srcDocs, source) : undefined;
  return { srcDocs, isAdmin, viewDoc, downloadDoc, uploadSourceDocs, deleteSourceDoc, docForSource, viewer, closeViewer };
}

function DocViewerModal({ source }: { source: ReturnType<typeof useSourceDocs> }) {
  const { viewer, closeViewer, downloadDoc } = source;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeViewer(); };
    window.addEventListener('keydown', onKey);
    // 하이라이트된 첫 근거 위치로 자동 스크롤
    if (viewer.kind === 'text') setTimeout(() => scrollRef.current?.querySelector('mark')?.scrollIntoView({ block: 'center' }), 60);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);
  if (!viewer) return null;
  const isHwp = /\.hwpx?$/.test(viewer.doc.fileName.toLowerCase());
  const highlighted = viewer.kind === 'text' && !!viewer.highlights?.length;
  return <div className="doc-viewer-overlay" onClick={closeViewer}>
    <div className="doc-viewer" role="dialog" aria-label={viewer.doc.fileName} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>{REGISTRY_ROLE_LABEL[viewer.doc.role]}</strong><span>{viewer.doc.fileName}</span></div>
        <div className="viewer-actions"><button type="button" className="secondary" onClick={() => downloadDoc(viewer.doc)}><Download /> 원본 다운로드</button><button type="button" className="close" aria-label="닫기" onClick={closeViewer}>×</button></div></header>
      {viewer.kind === 'loading' && <div className="viewer-scroll"><p className="viewer-note">문서를 불러오는 중…</p></div>}
      {viewer.kind === 'pdf' && <iframe title={viewer.doc.fileName} src={viewer.url} />}
      {viewer.kind === 'image' && <div className="viewer-scroll"><img src={viewer.url} alt={viewer.doc.fileName} /></div>}
      {viewer.kind === 'text' && <div className="viewer-scroll" ref={scrollRef}><p className="viewer-note">텍스트 미리보기입니다{isHwp ? ' — 한글(HWP) 문서는 서식 없이 본문만 표시됩니다' : ''}.{highlighted ? ' 근거 부분이 빨간색으로 표시됩니다.' : ''} 원본 서식은 "원본 다운로드"로 확인하세요.</p><pre>{renderHighlighted(viewer.text ?? '', viewer.highlights)}</pre></div>}
    </div>
  </div>;
}

function SourceDocsPanel({ source }: { source: ReturnType<typeof useSourceDocs> }) {
  if (!registryEnabled()) return null;
  const { srcDocs, isAdmin, viewDoc, uploadSourceDocs, deleteSourceDoc } = source;
  return <section className="panel source-docs"><div className="panel-head"><div><h3><FileText /> 근거 원본 문서</h3><p>공유 규정 DB에 저장된 이 사업의 원본 자료입니다. 누르면 팝업으로 바로 확인할 수 있어요.</p></div>{isAdmin && <label className="upload-button"><Upload /> 원본 문서 올리기<input type="file" multiple accept=".pdf,.hwp,.hwpx,.txt,.md,image/*" onChange={(e) => { uploadSourceDocs(e.target.files); e.target.value = ''; }} /></label>}</div>
    {srcDocs === null ? <p className="doc-empty">불러오는 중…</p> : srcDocs.length ? <div className="source-doc-list">{srcDocs.map((doc) => <div className="source-doc-row" key={doc.id}><button type="button" onClick={() => viewDoc(doc)}><FileText /><span><strong>{REGISTRY_ROLE_LABEL[doc.role]}</strong><small>{doc.fileName}{doc.year ? ` · ${doc.year}` : ''}</small></span><Eye /></button>{isAdmin && <button type="button" className="doc-delete" aria-label={`${doc.fileName} 삭제`} onClick={() => deleteSourceDoc(doc)}><Trash2 /></button>}</div>)}</div> : <p className="doc-empty">아직 저장된 원본 문서가 없어요. {isAdmin ? '"원본 문서 올리기"로 공고문·지침·매뉴얼을 올리면 모든 근거 표시에서 바로 열 수 있습니다.' : '관리자가 원본 문서를 올리면 여기에 나타납니다.'}</p>}
    <DocViewerModal source={source} />
  </section>;
}

function Budget({ project, update }: { project: Project; update: (p: Project) => void }) {
  const pack = packFor(project);
  const cats = visibleCategories(pack, project);
  const confirmed = !!project.budgetConfirmed;
  const sourceDocs = useSourceDocs(project);
  const { viewDoc, docForSource } = sourceDocs;
  // 근거가 "공고 비목 정의 + QnA 사업비 7번"처럼 복수면 각각을 해당 문서로 여는 개별 링크로 나눈다.
  const refLink = (rule: { quote?: string; message?: string; source: { doc: string; ref: string; matchLevel: string } }) => {
    const parts = rule.source.ref.split(/\s*\+\s*/).filter(Boolean);
    const composite = parts.length > 1;
    return <>{parts.map((part, index) => {
      // 복수 근거일 때는 부분 문구만으로 문서를 매칭한다 (합쳐진 문서명이 매칭을 흐리지 않게)
      const doc = docForSource(composite ? { ref: part, matchLevel: rule.source.matchLevel } : rule.source);
      const terms = [...(rule.quote ? [rule.quote.slice(0, 40)] : []), ...refPatternTerms(part), ...keywordTokens(rule.quote ?? rule.message ?? '')];
      return <span key={index}>{index > 0 && ' '}{doc
        ? <button type="button" className="ref-link" onClick={() => viewDoc(doc, terms)}>({part} · 원문 보기)</button>
        : <em>({part})</em>}</span>;
    })}</>;
  };
  const total = project.budgets.reduce((sum, item) => sum + item.amount, 0);
  const changeAmount = (id: BudgetCategoryId, amount: number) => update({ ...project, budgets: project.budgets.map((b) => b.categoryId === id ? { ...b, amount: Math.max(0, amount) } : b) });
  const toggleConfirm = () => {
    if (confirmed) { update({ ...project, budgetConfirmed: false }); return; }
    const zero = pack.categories.filter((c) => c.allowed && !(project.budgets.find((b) => b.categoryId === c.id)?.amount)).length;
    if (!confirm(`편성을 확정할까요?${zero ? ` 금액이 0원인 비목 ${zero}개는 화면에서 숨겨집니다.` : ''} 확정 후에는 "편성 수정"으로 다시 열 수 있어요.`)) return;
    update({ ...project, budgetConfirmed: true });
  };
  const packInfos = globalRules(pack, 'info');
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">모듈 1</span><h2>예산 편성 도우미</h2><p>{pack.name} 규정 체계 기준 초안입니다. 협약서의 개별 조건이 항상 우선합니다.</p></div><div className="title-actions"><button className="secondary" onClick={() => withExporters((m) => m.exportBudgetXlsx(project))}><Download /> 엑셀 내보내기</button><button className={confirmed ? 'secondary' : 'primary'} onClick={toggleConfirm}>{confirmed ? <><Pencil /> 편성 수정</> : <><Check /> 편성 확정</>}</button></div></div>
    <div className="notice"><BookOpenCheck /><div><strong>예시 기준 (검증 전) · {pack.guideline}</strong><span>{pack.agency} 기준으로 정리한 데이터입니다 ({RULES_EFFECTIVE_DATE} 업데이트). 실제 협약 및 최신 공고 원문이 항상 우선합니다. {(() => { const doc = docForSource({ doc: pack.guideline, matchLevel: 'guideline' }); return doc ? <button type="button" className="ref-link" onClick={() => viewDoc(doc)}>저장된 원문 보기 ({doc.fileName}) →</button> : pack.referenceUrl ? <a href={pack.referenceUrl} target="_blank" rel="noreferrer">공식 사이트에서 원문 확인 →</a> : null; })()}</span></div></div>
    {!pack.hasRatioLimits && packInfos.length > 0 && <div className="notice soft"><ShieldCheck /><div><strong>이 사업은 비목 간 비율 제한이 없습니다</strong><span>{packInfos.map((rule, index) => <span key={rule.id}>{index > 0 && ' · '}{rule.message} {refLink(rule)}</span>)}</span></div></div>}
    <section className="panel budget-editor"><div className="editor-head"><div><span>전체 사용 가능 예산</span><strong>{formatWon(project.totalBudget)}</strong></div><div className={total === project.totalBudget ? 'sum-ok' : 'sum-bad'}>{total === project.totalBudget ? <CheckCircle2 /> : <AlertCircle />} 편성 합계 {formatWon(total)} {total !== project.totalBudget && `(차이 ${formatWon(total - project.totalBudget)})`}{confirmed && ' · 편성 확정됨'}</div></div>
      <div className="budget-table"><div className="table-head"><span>비목 · 사용 예시</span><span>허용 상한</span><span>편성 금액</span><span>비율</span><span>상태</span></div>{cats.map((category) => {
        const amount = project.budgets.find((b) => b.categoryId === category.id)?.amount ?? 0;
        const rate = project.totalBudget ? amount / project.totalBudget * 100 : 0;
        const cap = capFor(pack, project.budgets, project.totalBudget, category.id);
        const min = minFor(pack, category.id);
        const over = cap?.amount != null && amount > cap.amount;
        const under = min != null && amount < min.amount;
        return <div className={`table-row ${over || under ? 'row-danger' : ''}`} key={category.id}><div><strong>{category.name}</strong><small>{category.definition ?? `초안 ${category.draftRate}%`}</small></div><div className="cap-cell">{cap
          ? <>{cap.amount != null && <strong>{formatWon(cap.amount)}</strong>}<small>{cap.label}</small>{cap.rule.note && <small className="cap-note">{cap.rule.note}</small>}</>
          : '제한 없음'}{min && <small className="cap-min">{min.label}</small>}</div><label className="money-input"><input aria-label={`${category.name} 편성 금액`} inputMode="numeric" value={withCommas(String(amount))} disabled={confirmed} onChange={(e) => changeAmount(category.id, Number(digitsOnly(e.target.value)) || 0)} /><b>원</b></label><div className="rate-cell"><div className="mini-progress"><i style={{ width: `${cap?.amount ? Math.min(amount / cap.amount * 100, 100) : Math.min(rate, 100)}%` }} /></div><b>{rate.toFixed(1)}%</b></div><span className={`status ${over || under ? 'bad' : 'good'}`}>{over ? <><AlertCircle /> 상한 초과</> : under ? <><AlertCircle /> 필수 금액 미달</> : <><Check /> 정상</>}</span></div>;
      })}</div>
    </section>
    <section><div className="section-title"><h3>항목별 기준 · 주의사항</h3><p>모든 기준에 원문 근거(조문·QnA 위치)가 표시됩니다.</p></div><div className="criteria-grid">{cats.map((category) => { const rules = rulesFor(pack, category.id); return <details key={category.id}><summary><div className="category-dot" />{category.name}<ChevronRight /></summary><div>{category.definition && <p><CheckCircle2 />{category.definition}</p>}{rules.map((rule) => <div key={rule.id}><p className={rule.kind === 'warning' ? 'rule-warn' : ''}>{rule.kind === 'warning' ? <AlertCircle /> : <CheckCircle2 />}{rule.message} {refLink(rule)}</p>{rule.note && <p className="rule-note">{rule.note}</p>}</div>)}{!category.definition && rules.length === 0 && <p><CheckCircle2 />등록된 세부 기준이 없습니다. 공고·협약 원문을 확인하세요.</p>}</div></details>; })}</div></section>
    {globalRules(pack, 'warning').length > 0 && <section><div className="section-title"><h3>과제 공통 주의사항</h3><p>비목과 무관하게 적용되는 금지·주의 규정입니다.</p></div><div className="global-warnings">{globalRules(pack, 'warning').map((rule) => <div key={rule.id} className={`warn-item ${rule.severity ?? 'medium'}`}><AlertCircle /><div><strong>{rule.trigger ?? rule.item}</strong><span>{rule.message} {refLink(rule)}</span></div></div>)}</div></section>}
    <SourceDocsPanel source={sourceDocs} />
  </div>;
}

function Spending({ project, update }: { project: Project; update: (p: Project) => void }) {
  const pack = packFor(project);
  const cats = visibleCategories(pack, project);
  const defaultCategoryId = cats[0]?.id ?? pack.categories[0]?.id ?? '';
  const emptyExpenseForm = () => ({ date: today(), categoryId: defaultCategoryId, payment: 'card' as PaymentMethod, supply: '', vat: '', purpose: '', vendor: '' });
  const [showForm, setShowForm] = useState(project.expenses.length === 0);
  const [form, setForm] = useState(emptyExpenseForm());
  const [receipt, setReceipt] = useState<File | null>(null);
  const [ocr, setOcr] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; message?: string; text?: string }>({ status: 'idle' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const selectedCategory = categoryOf(pack, form.categoryId);
  const categoryWarnings = rulesFor(pack, form.categoryId, 'warning');
  const budget = project.budgets.find((b) => b.categoryId === form.categoryId)?.amount ?? 0;
  // 수정 중인 집행건은 잔액 계산에서 제외해 이중 집계를 막는다.
  const spent = project.expenses.filter((e) => e.categoryId === form.categoryId && e.id !== editingId).reduce((s, e) => s + e.amount, 0);
  // 과제비 집계는 부가세를 제외한 공급가액 기준. 합계 금액은 영수증 결제금액과 대조하는 참고용이다.
  const amount = Number(form.supply) || 0;
  const totalWithVat = amount + (Number(form.vat) || 0);
  const isOver = amount > budget - spent;
  const setMoney = (key: 'supply' | 'vat', raw: string) => setForm((prev) => ({ ...prev, [key]: digitsOnly(raw) }));
  const onReceipt = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('OCR 자동 입력은 이미지 영수증(JPG·PNG)만 지원합니다. PDF는 집행 등록 후 증빙 칸에 업로드해주세요.'); return; }
    setOcr({ status: 'working' });
    try {
      const { recognizeReceipt, parseReceipt } = await import('./ocr');
      const text = await recognizeReceipt(file);
      const parsed = parseReceipt(text);
      setReceipt(file);
      setForm((prev) => {
        // 공급가액을 못 읽었으면 합계에서 부가세를 빼서 추정한다.
        const supply = parsed.supplyAmount ? String(parsed.supplyAmount)
          : parsed.totalAmount ? String(Math.max(parsed.totalAmount - (parsed.vatAmount ?? 0), 0))
          : prev.supply;
        const vat = parsed.vatAmount ? String(parsed.vatAmount) : prev.vat;
        return { ...prev, date: parsed.date ?? prev.date, vendor: parsed.vendor ?? prev.vendor, supply, vat };
      });
      const found = [parsed.date && '집행일자', parsed.vendor && '거래처명', parsed.supplyAmount && '공급가액', parsed.vatAmount && '부가세액'].filter(Boolean);
      setOcr(found.length
        ? { status: 'done', text, message: `자동 입력 완료: ${found.join(' · ')}${found.length < 4 ? ' — 못 읽은 항목은 직접 확인해주세요' : ''}` }
        : { status: 'done', text, message: '영수증은 첨부됐지만 값을 읽지 못했습니다. 인식 원문을 확인하고 직접 입력해주세요.' });
    } catch (error) {
      console.error('영수증 OCR 실패:', error);
      const detail = error instanceof Error && error.message ? ` (원인: ${error.message.slice(0, 80)})` : '';
      setOcr({ status: 'error', message: `OCR 인식에 실패했습니다${detail}. 첫 실행은 인식 엔진 내려받기에 시간이 걸릴 수 있어요. 잠시 후 다시 시도하거나 값을 직접 입력해주세요.` });
    }
  };
  const resetForm = () => { setForm(emptyExpenseForm()); setReceipt(null); setOcr({ status: 'idle' }); setEditingId(null); };
  const closeForm = () => { resetForm(); setShowForm(false); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isOver && !window.confirm(`잔액보다 ${formatWon(amount - (budget - spent))} 초과합니다. 그래도 등록할까요?`)) return;
    const editing = editingId ? project.expenses.find((e) => e.id === editingId) : undefined;
    // 수정 시에는 기존 증빙 체크리스트(업로드 파일 포함)를 유지하고, 신규 등록 시에만 새로 만든다.
    let evidence: Evidence[] = editing ? editing.evidence : documentsFor(selectedCategory, form.payment).map((label) => ({ id: uid(), label, completed: false }));
    // 먼저 올린 영수증은 증빙 체크리스트의 영수증 항목에 자동 첨부한다.
    if (receipt) {
      const slot = evidence.find((item) => item.label.includes('영수증'));
      if (slot) {
        try {
          await storeEvidence(slot.id, receipt);
          evidence = evidence.map((item) => item.id === slot.id ? { ...item, completed: true, fileName: receipt.name, fileSize: receipt.size } : item);
        } catch { alert('영수증 파일 저장에 실패했습니다. 증빙 칸에서 다시 업로드해주세요.'); }
      }
    }
    const base = { date: form.date, categoryId: form.categoryId, amount, supplyAmount: amount || undefined, vatAmount: Number(form.vat) || undefined, paymentMethod: form.payment, purpose: form.purpose, vendor: form.vendor, evidence };
    update(editing
      ? { ...project, expenses: project.expenses.map((e) => e.id === editing.id ? { ...editing, ...base } : e) }
      : { ...project, expenses: [{ id: uid(), createdAt: new Date().toISOString(), ...base }, ...project.expenses] });
    closeForm();
  };
  const startEdit = (expense: Expense) => {
    setForm({ date: expense.date, categoryId: expense.categoryId, payment: expense.paymentMethod ?? 'card', supply: String(expense.supplyAmount ?? expense.amount), vat: expense.vatAmount ? String(expense.vatAmount) : '', purpose: expense.purpose, vendor: expense.vendor });
    setReceipt(null); setOcr({ status: 'idle' }); setEditingId(expense.id); setShowForm(true);
  };
  const removeExpense = async (expense: Expense) => {
    if (!window.confirm(`"${expense.purpose}" 집행건을 삭제할까요? 업로드한 증빙 파일도 함께 삭제됩니다.`)) return;
    try { await deleteEvidence(expense.evidence.map((item) => item.id)); } catch { /* 파일 삭제에 실패해도 집행건 제거는 진행한다 */ }
    if (editingId === expense.id) closeForm();
    update({ ...project, expenses: project.expenses.filter((e) => e.id !== expense.id) });
  };
  const upload = async (expenseId: string, evidenceId: string, file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('파일은 건당 10MB 이하만 업로드할 수 있습니다.'); return; }
    if (!file.type.includes('pdf') && !file.type.startsWith('image/')) { alert('PDF 또는 이미지 파일만 업로드할 수 있습니다.'); return; }
    try {
      await storeEvidence(evidenceId, file);
      update({ ...project, expenses: project.expenses.map((expense) => expense.id !== expenseId ? expense : { ...expense, evidence: expense.evidence.map((e) => e.id === evidenceId ? { ...e, completed: true, fileName: file.name, fileSize: file.size } : e) }) });
    } catch { alert('업로드에 실패했습니다. 다시 시도해주세요. 체크리스트는 미완료 상태로 유지됩니다.'); }
  };
  const downloadEvidence = async (evidenceId: string, fileName?: string) => {
    const file = await getEvidence(evidenceId); if (!file) { alert('저장된 파일을 찾지 못했습니다.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fileName || file.name; a.click(); URL.revokeObjectURL(a.href);
  };
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">모듈 2</span><h2>집행 · 증빙 관리</h2><p>집행을 등록하면 잔액과 필요한 증빙을 바로 연결합니다.</p></div><button className="primary" onClick={() => showForm ? closeForm() : setShowForm(true)}><Plus /> 집행건 등록</button></div>
    {showForm && <form className="panel expense-form" onSubmit={submit}><div className="form-title"><div><h3>{editingId ? '집행건 수정' : '새 집행건'}</h3><p>{editingId ? '비목과 결제수단은 수정할 수 없어요. 바뀌었다면 삭제 후 다시 등록해주세요.' : '비목과 결제수단을 선택하면 필요한 서류가 자동으로 바뀝니다.'}</p></div><button type="button" className="close" onClick={closeForm}>×</button></div>
      <div className="ocr-strip"><div><ScanLine /><div><strong>영수증 먼저 업로드 — OCR 자동 입력</strong><span>집행일자 · 거래처명 · 공급가액 · 부가세액을 읽어 아래 칸을 자동으로 채워드려요.</span></div></div><label className="upload-button"><Upload /> {ocr.status === 'working' ? '인식 중…' : receipt ? '다시 업로드' : '영수증 업로드'}<input type="file" accept="image/*" disabled={ocr.status === 'working'} onChange={(e) => { onReceipt(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
      {ocr.status === 'done' && <p className="ocr-note ok"><CheckCircle2 /> {ocr.message}</p>}
      {ocr.status === 'error' && <p className="ocr-note bad"><AlertCircle /> {ocr.message}</p>}
      {ocr.text && <details className="ocr-raw"><summary>OCR 인식 원문 보기</summary><pre>{ocr.text}</pre></details>}
      <div className="field-grid three"><label>집행일<input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>비목<select value={form.categoryId} disabled={!!editingId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>결제수단<select value={form.payment} disabled={!!editingId} onChange={(e) => setForm({ ...form, payment: e.target.value as PaymentMethod })}><option value="card">카드 결제</option><option value="transfer">계좌이체 (세금계산서)</option></select></label></div><div className="field-grid three"><label><span className="label-line">공급가액 <b>집계 기준</b></span><input required inputMode="numeric" value={withCommas(form.supply)} onChange={(e) => setMoney('supply', e.target.value)} placeholder="0" /></label><label><span className="label-line">부가세액 <b>선택</b></span><input inputMode="numeric" value={withCommas(form.vat)} onChange={(e) => setMoney('vat', e.target.value)} placeholder="0" /></label><label><span className="label-line">합계 금액 <b>자동</b></span><input readOnly tabIndex={-1} value={withCommas(String(totalWithVat))} placeholder="0" /></label></div><p className="field-hint">과제비 집계는 <strong>공급가액 기준(부가세 제외)</strong>입니다. 합계 금액은 공급가액+부가세액으로 자동 계산되며, 영수증의 결제금액과 맞는지 확인하는 참고용입니다.</p><div className="field-grid"><label>용도<input required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="예: 외부 전문가 참석 정기 회의" /></label><label>거래처<input required value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="거래처명" /></label></div>
      {categoryWarnings.length > 0 && <div className="rule-warnings">{categoryWarnings.map((rule) => <p key={rule.id}><AlertCircle /> {rule.message} <em>({rule.source.ref})</em></p>)}</div>}
      <div className={`balance-preview ${isOver ? 'over' : ''}`}><WalletCards /><div><span>{selectedCategory.name} 등록 후 잔액</span><strong>{formatWon(budget - spent - amount)}</strong></div>{isOver && <p><AlertCircle /> 잔액을 초과합니다. 확인 후 등록할 수 있어요.</p>}</div>
      <div className="auto-docs"><strong><FileCheck2 /> 자동 안내 증빙</strong><div>{documentsFor(selectedCategory, form.payment).map((doc) => <span key={doc}><Check />{doc}</span>)}</div></div><div className="form-actions"><button type="button" className="secondary" onClick={closeForm}>취소</button><button className="primary" type="submit">{editingId ? '수정 저장' : isOver ? '확인 후 등록' : '집행 등록'}</button></div></form>}
    <div className="template-strip"><div><FileText /><div><strong>자주 쓰는 증빙 템플릿</strong><span>집행 기록에 필요한 기본 항목을 담았습니다.</span></div></div><div>{(['품의서', '회의록', '출장보고서'] as const).map((type) => <button key={type} onClick={() => withExporters((m) => m.downloadTemplate(type))}><Download /> {type}</button>)}</div></div>
    <section className="expense-list"><div className="section-title"><h3>집행 내역 <b>{project.expenses.length}</b></h3><p>파일 업로드 완료 응답 후에만 증빙이 완료 처리됩니다.</p></div>{project.expenses.length === 0 ? <div className="empty-state"><FileClock /><h3>아직 등록된 집행이 없어요</h3><p>첫 집행을 등록하면 증빙 체크리스트가 여기에 나타납니다.</p></div> : project.expenses.map((expense) => { const rule = categoryOf(pack, expense.categoryId); const complete = expense.evidence.filter((e) => e.completed).length; return <article className="expense-card" key={expense.id}><div className="expense-summary"><div className="date-box"><strong>{new Date(expense.date).getDate()}</strong><span>{new Date(expense.date).toLocaleDateString('ko-KR', { month: 'short' })}</span></div><div><span className="category-label">{rule.name}</span><h4>{expense.purpose}</h4><small>{expense.vendor}{expense.paymentMethod ? ` · ${expense.paymentMethod === 'card' ? '카드 결제' : '계좌이체'}` : ''}</small></div><div className="expense-amount"><strong>{formatWon(expense.amount)}</strong>{expense.vatAmount ? <small className="vat-note">부가세 {formatWon(expense.vatAmount)} 별도</small> : null}<span className={complete === expense.evidence.length ? 'complete' : 'incomplete'}>{complete}/{expense.evidence.length} 증빙 완료</span></div><div className="expense-actions"><button type="button" aria-label={`${expense.purpose} 수정`} onClick={() => startEdit(expense)}><Pencil /></button><button type="button" className="danger" aria-label={`${expense.purpose} 삭제`} onClick={() => removeExpense(expense)}><Trash2 /></button></div></div><div className="evidence-grid">{expense.evidence.map((evidence) => <div className={evidence.completed ? 'evidence done' : 'evidence'} key={evidence.id}><div>{evidence.completed ? <CheckCircle2 /> : <FileText />}<span><strong>{evidence.label}</strong><small>{evidence.fileName || 'PDF 또는 이미지 · 최대 10MB'}</small></span></div>{evidence.completed ? <button onClick={() => downloadEvidence(evidence.id, evidence.fileName)}><Download /> 열기</button> : <label className="upload-button"><Upload /> 업로드<input type="file" accept="application/pdf,image/*" onChange={(ev) => upload(expense.id, evidence.id, ev.target.files?.[0])} /></label>}</div>)}</div></article>; })}</section>
  </div>;
}

function ChangeManagement({ project, update }: { project: Project; update: (p: Project) => void }) {
  const pack = packFor(project);
  const cats = visibleCategories(pack, project);
  const [form, setForm] = useState({ from: cats[1]?.id ?? cats[0]?.id ?? '', to: cats[0]?.id ?? '', amount: '', reasonKey: REASON_TEMPLATES[0].key, reason: REASON_TEMPLATES[0].text });
  const source = project.budgets.find((b) => b.categoryId === form.from)?.amount ?? 0;
  const amount = Number(form.amount) || 0;
  const limitError = form.from !== form.to ? transferLimitError(pack, project.budgets, project.totalBudget, form.to, amount) : null;
  const valid = form.from !== form.to && amount > 0 && amount <= source && !limitError && form.reason.trim();
  const save = (event: React.FormEvent) => { event.preventDefault(); if (!valid) return; const before = project.budgets.map((b) => ({ ...b })); const after: BudgetItem[] = before.map((b) => b.categoryId === form.from ? { ...b, amount: b.amount - amount } : b.categoryId === form.to ? { ...b, amount: b.amount + amount } : b); update({ ...project, budgets: after, changes: [{ id: uid(), fromCategoryId: form.from, toCategoryId: form.to, amount, reasonKey: form.reasonKey, reason: form.reason, before, after, createdAt: new Date().toISOString() }, ...project.changes] }); };
  const change = project.changes[0];
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">모듈 3</span><h2>예산 변경 관리</h2><p>비목 간 이동을 기록하고 비교표와 공문 초안을 생성하세요.</p></div></div>
    <div className="change-layout"><form className="panel change-form" onSubmit={save}><div className="form-title"><div><h3>비목 간 금액 이동</h3><p>저장 시 현재 예산에 바로 반영되고 변경 이력에 누적 기록됩니다.</p></div></div><div className="transfer-row"><label>보내는 비목<select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>{cats.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select><small>현재 {formatWon(source)}</small></label><div className="transfer-icon"><ArrowRight /></div><label>받는 비목<select value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>{cats.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label></div><label>이동 금액<div className="money-input wide"><input required inputMode="numeric" value={withCommas(form.amount)} onChange={(e) => setForm({ ...form, amount: digitsOnly(e.target.value) })} placeholder="0" /><b>원</b></div></label>{form.from === form.to && <p className="field-error"><AlertCircle /> 서로 다른 비목을 선택해주세요.</p>}{limitError && <p className="field-error"><AlertCircle /> {limitError} 저장할 수 없습니다.</p>}
      <label>변경 사유 템플릿<select value={form.reasonKey} onChange={(e) => { const template = REASON_TEMPLATES.find((t) => t.key === e.target.value)!; setForm({ ...form, reasonKey: template.key, reason: template.text }); }}>{REASON_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label><label>공문에 들어갈 사유<textarea rows={6} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label><button disabled={!valid} className="primary large" type="submit"><RefreshCw /> 변경 비교표 생성</button></form>
      <section className="panel comparison"><div className="form-title"><div><h3>변경 전 · 후 비교</h3><p>{change ? `${new Date(change.createdAt).toLocaleString('ko-KR')} 생성` : '변경을 저장하면 자동으로 생성됩니다.'}</p></div></div>{!change ? <div className="empty-state compact"><RefreshCw /><h3>아직 변경 내역이 없어요</h3><p>왼쪽에서 이동할 비목과 금액을 입력해주세요.</p></div> : <><div className="comparison-table"><div className="comp-head"><span>비목</span><span>변경 전</span><span>변경 후</span><span>증감</span></div>{cats.map((category) => { const before = change.before.find((b) => b.categoryId === category.id)?.amount ?? 0; const after = change.after.find((b) => b.categoryId === category.id)?.amount ?? 0; const delta = after - before; return <div className={delta ? 'comp-row changed' : 'comp-row'} key={category.id}><strong>{category.name}</strong><span>{formatWon(before)}</span><span>{formatWon(after)}</span><span className={delta > 0 ? 'up' : delta < 0 ? 'down' : ''}>{delta > 0 ? <ArrowUpRight /> : delta < 0 ? <ArrowDownRight /> : null}{delta ? formatWon(Math.abs(delta)) : '-'}</span></div>; })}</div><div className="reason-box"><span>변경 사유</span><p>{change.reason}</p></div><div className="export-buttons"><button onClick={() => withExporters((m) => m.exportChangeDocx(project))}><FileText /> 비교표 Word</button><button className="primary" onClick={() => withExporters((m) => m.exportChangeDocx(project, true))}><Download /> 중기부 공문 Word</button></div></>}</section></div>
    {project.changes.length > 0 && <section className="panel history-panel"><div className="panel-head"><div><h3><FileClock /> 변경 이력 <b>{project.changes.length}</b>건</h3><p>모든 변경 기록이 순서대로 보관됩니다. 문서는 가장 최근 변경 기준으로 생성됩니다.</p></div></div>
      <div className="history-list">{project.changes.map((item, index) => <div key={item.id}><span>{new Date(item.createdAt).toLocaleString('ko-KR')}</span><strong>{categoryOf(pack, item.fromCategoryId).name} <ArrowRight /> {categoryOf(pack, item.toCategoryId).name}</strong><b>{formatWon(item.amount)}</b><small>{REASON_TEMPLATES.find((t) => t.key === item.reasonKey)?.label ?? '직접 입력'}{index === 0 && ' · 최신'}</small></div>)}</div>
    </section>}
  </div>;
}

function Team({ project, update }: { project: Project; update: (p: Project) => void }) {
  const [member, setMember] = useState({ name: '', email: '' });
  const [person, setPerson] = useState('');
  const addMember = (e: React.FormEvent) => { e.preventDefault(); if (project.members.length >= 2 || !member.name || !member.email) return; update({ ...project, members: [...project.members, { id: uid(), name: member.name, email: member.email, role: '담당자' }] }); setMember({ name: '', email: '' }); };
  const addPerson = (e: React.FormEvent) => { e.preventDefault(); if (!person.trim()) return; update({ ...project, participants: [...project.participants, { id: uid(), name: person.trim(), projectRate: 0, externalRate: 0 }] }); setPerson(''); };
  const setRate = (id: string, key: 'projectRate' | 'externalRate', value: number) => update({ ...project, participants: project.participants.map((p) => p.id === id ? { ...p, [key]: Math.max(0, value) } : p) });
  const refreshReminders = () => {
    const milestone = daysUntil(project.settlementDeadline);
    if (![30, 14, 7].includes(milestone)) { alert(`현재 정산 마감은 D-${milestone}입니다. 알림은 D-30, D-14, D-7에 생성됩니다.`); return; }
    const incomplete = project.expenses.reduce((s, e) => s + e.evidence.filter((x) => !x.completed).length, 0);
    if (!incomplete) { alert('미완료 증빙이 없어 알림을 생성하지 않았습니다.'); return; }
    if (project.emailLogs.some((l) => l.milestone === milestone)) { alert('해당 마감 알림 로그가 이미 있습니다.'); return; }
    update({ ...project, emailLogs: [...project.emailLogs, ...project.members.map((m) => ({ id: uid(), sentAt: new Date().toISOString(), recipient: m.email, milestone: milestone as 30 | 14 | 7, status: '제품 내 알림' as const, incompleteCount: incomplete }))] });
  };
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">운영 설정</span><h2>인력 · 담당자 관리</h2><p>참여율을 점검하고 담당자 정보를 기록합니다. 데이터는 이 브라우저에만 저장되며 계정·초대·동기화 기능은 서버 버전에서 제공될 예정입니다.</p></div></div>
    <div className="team-grid"><section className="panel"><div className="panel-head"><div><h3>담당자 정보</h3><p>{project.members.length} / 2명 입력됨 · 알림 수신 대상</p></div></div><div className="member-list">{project.members.map((m) => <div key={m.id}><div className="avatar">{m.name[0]}</div><span><strong>{m.name} <b>{m.role}</b></strong><small>{m.email}</small></span><CheckCircle2 /></div>)}</div>{project.members.length < 2 ? <form className="inline-add" onSubmit={addMember}><h4><UserPlus /> 담당자 추가</h4><div className="field-grid"><label>이름<input required value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} /></label><label>이메일<input required type="email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} /></label></div><button className="secondary" type="submit"><Plus /> 두 번째 담당자 추가</button></form> : <div className="limit-note"><ShieldCheck /> 담당자는 최대 2명까지 기록할 수 있습니다. 실제 공동 사용은 서버 버전에서 지원됩니다.</div>}</section>
      <section className="panel"><div className="panel-head"><div><h3>참여 인력과 참여율</h3><p>과제 참여율 + 타 과제 참여율을 합산합니다.</p></div></div><div className="participant-list">{project.participants.map((p) => { const total = p.projectRate + p.externalRate; const over = total > 100; return <div className={over ? 'participant over' : 'participant'} key={p.id}><div className="participant-name"><div className="avatar">{p.name[0]}</div><strong>{p.name}</strong></div><label>현재 과제<input aria-label={`${p.name} 현재 과제 참여율`} type="number" min="0" value={p.projectRate} onChange={(e) => setRate(p.id, 'projectRate', Number(e.target.value))} /><b>%</b></label><label>타 과제 합계<input aria-label={`${p.name} 타 과제 참여율`} type="number" min="0" value={p.externalRate} onChange={(e) => setRate(p.id, 'externalRate', Number(e.target.value))} /><b>%</b></label><div className="rate-total"><span>합산</span><strong>{total}%</strong></div>{over && <p><AlertCircle /> 참여율 합산이 100%를 초과했습니다. 100% 이하로 조정해주세요.</p>}</div>; })}</div><form className="person-add" onSubmit={addPerson}><input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="새 참여 인력 이름" /><button className="secondary" type="submit"><Plus /> 인력 추가</button></form>{project.participants.length === 0 && <div className="inline-warning"><AlertCircle /> 참여율 데이터가 없어 초과 경고가 작동하지 않습니다. 참여 인력을 추가해주세요.</div>}</section>
    </div>
    <section className="panel reminder-panel"><div className="panel-head"><div><h3><Mail /> 증빙 누락 알림 로그</h3><p>정산 마감 D-30 / D-14 / D-7에 미완료 증빙을 확인합니다.</p></div><button className="secondary" onClick={refreshReminders}><RefreshCw /> 오늘 기준 확인</button></div>{project.emailLogs.length ? <div className="log-table"><div><strong>발송 시각</strong><strong>수신자</strong><strong>시점</strong><strong>미완료</strong><strong>상태</strong></div>{project.emailLogs.map((log) => <div key={log.id}><span>{new Date(log.sentAt).toLocaleString('ko-KR')}</span><span>{log.recipient}</span><b>D-{log.milestone}</b><span>{log.incompleteCount}개</span><span className="log-status">{log.status}</span></div>)}</div> : <div className="empty-state compact"><Mail /><h3>아직 알림 로그가 없어요</h3><p>마감 기준일에 미완료 증빙이 있으면 제품 내 알림 로그가 생성됩니다.</p></div>}</section>
  </div>;
}

const RULE_KIND_LABEL = { ratio: '상한', warning: '금지·주의', funding: '재원', info: '참고' } as const;
interface LateDocItem { id: string; file: File; status: 'reading' | 'done' | 'error'; text?: string; error?: string }

// 과제 등록 때 공고문을 올리지 못한 경우, 설정 화면에서 나중에 올려 AI로 규정(비목·상한·금지)을 추출·반영한다.
function DocUpdatePanel({ project, update }: { project: Project; update: (p: Project) => void }) {
  const [docs, setDocs] = useState<LateDocItem[]>([]);
  const [ai, setAi] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; extraction?: Extraction; cached?: boolean; message?: string }>({ status: 'idle' });
  const [acceptedRules, setAcceptedRules] = useState<Set<number>>(new Set());
  const [useDocCats, setUseDocCats] = useState(false);
  const [applied, setApplied] = useState(false);
  const [rateSuggestion, setRateSuggestion] = useState<ReturnType<typeof suggestedFundingRates> | null>(null);
  const [rateForm, setRateForm] = useState<{ subsidyRate: string; matchingCashRate: string } | null>(null);
  const [rateApplied, setRateApplied] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [share, setShare] = useState(false);
  const [shareYear, setShareYear] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => { if (registryEnabled()) isRegistryAdmin().then(setAdmin).catch(() => setAdmin(false)); }, []);

  const docsText = () => docs.filter((item) => item.status === 'done').map((item) => item.text).join('\n');

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const added: LateDocItem[] = [...list].map((file) => ({ id: crypto.randomUUID(), file, status: 'reading' }));
    setDocs((prev) => [...prev, ...added]);
    const { extractDocumentText } = await import('./extract');
    const finished: LateDocItem[] = [];
    for (const item of added) {
      try {
        const { text } = await extractDocumentText(item.file);
        finished.push({ ...item, status: 'done', text });
      } catch (error) {
        finished.push({ ...item, status: 'error', error: error instanceof Error ? error.message : '읽기 실패' });
      }
    }
    setDocs((prev) => prev.map((item) => finished.find((f) => f.id === item.id) ?? item));
  };

  const removeDoc = (id: string) => setDocs((prev) => prev.filter((item) => item.id !== id));

  const runAi = async () => {
    setAi({ status: 'working' });
    try {
      const { extraction, cached } = await runExtraction(docsText(), project.packId);
      const verified = annotateVerification(extraction, docsText());
      setAi({ status: 'done', extraction: verified, cached });
      setAcceptedRules(new Set(verified.rules.map((rule, index) => rule.verified ? index : -1).filter((index) => index >= 0)));
      setUseDocCats(false);
      const suggestion = suggestedFundingRates(verified);
      if (suggestion.subsidyRate || suggestion.matchingCashRate) {
        setRateSuggestion(suggestion);
        setRateForm({
          subsidyRate: String(suggestion.subsidyRate?.pct ?? project.subsidyRate ?? 100),
          matchingCashRate: String(suggestion.matchingCashRate?.pct ?? project.matchingCashRate ?? ''),
        });
      } else { setRateSuggestion(null); setRateForm(null); }
      if (verified.year) setShareYear((prev) => prev || String(verified.year));
    } catch (error) {
      setAi({ status: 'error', message: error instanceof Error ? error.message : '추출에 실패했습니다.' });
    }
  };

  const apply = async () => {
    if (ai.status !== 'done' || !ai.extraction) return;
    const base = useDocCats ? null : packFor(project);
    const accepted = ai.extraction.rules.filter((_, index) => acceptedRules.has(index));
    const pack = buildCustomPack(base, ai.extraction, accepted, useDocCats);
    update({ ...project, customPack: pack, packId: pack.id });
    if (admin && share && registryEnabled()) {
      setApplying(true);
      try {
        const name = ai.extraction.programName || project.programName || packFor(project).name;
        const year = Number(shareYear) || null;
        const registryId = await saveRegistryEntry(name, year, pack, 'extracted');
        for (const doc of docs) {
          await uploadRegistryDocument(doc.file, { programName: name, year, role: guessDocRole(doc.file.name), registryId });
        }
      } catch (error) {
        alert(`공유 DB 등록에 실패했습니다 (${error instanceof Error ? error.message : ''}). 이 과제에는 정상 반영됐습니다.`);
      } finally { setApplying(false); }
    }
    setApplied(true); setTimeout(() => setApplied(false), 2500);
  };

  const applyRates = () => {
    if (!rateForm) return;
    const subsidyRate = Math.min(100, Math.max(1, Number(rateForm.subsidyRate) || 100));
    const matchingCashRate = Math.min(100, Math.max(0, Number(rateForm.matchingCashRate) || 0));
    const subsidyAmount = project.subsidyAmount ?? project.totalBudget;
    const totalBudget = deriveTotalBudget(subsidyAmount, subsidyRate);
    update({ ...project, totalBudget, subsidyAmount, subsidyRate, matchingCashRate });
    setRateApplied(true); setTimeout(() => setRateApplied(false), 2500);
  };

  return <section className="panel docupdate-panel">
    <div className="panel-head"><div><h3><FileSearch /> 공고문·지침 업로드 — 규정 나중에 반영</h3><p>과제 등록 때 공고문을 못 올렸다면 여기서 올려 비목·상한·금지 규정에 반영할 수 있어요.</p></div></div>
    <div className="docupdate-body">
      <label className="upload-button wide"><Upload /> 파일 추가 (PDF · HWP · 이미지)<input type="file" multiple accept=".pdf,.hwp,.hwpx,.txt,.md,image/*" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label>
      {docs.length > 0 && <div className="doc-list">{docs.map((doc) => <div key={doc.id} className={`doc-item ${doc.status}`}>
        <span className="doc-name">{doc.file.name}</span>
        <span className="doc-status">{doc.status === 'reading' ? '읽는 중…' : doc.status === 'done' ? '읽기 완료' : doc.error}</span>
        <button type="button" aria-label={`${doc.file.name} 제거`} onClick={() => removeDoc(doc.id)}><Trash2 /></button>
      </div>)}</div>}
      {docs.some((doc) => doc.status === 'done') && <>
        {ai.status === 'idle' && <button type="button" className="secondary" onClick={runAi}><Sparkles /> 문서에서 규정 추출하기</button>}
        {ai.status === 'working' && <p className="wiz-hint">문서를 분석하는 중… (문서 크기에 따라 최대 1~2분 걸릴 수 있어요)</p>}
        {ai.status === 'error' && <><p className="field-error"><AlertCircle /> {ai.message}</p><button type="button" className="secondary" onClick={runAi}>다시 시도</button></>}
        {ai.status === 'done' && ai.extraction && <div className="ai-review">
          {ai.cached && <p className="wiz-hint">이 문서는 이전에 분석된 적이 있어 캐시된 결과를 불러왔어요.</p>}
          {rateForm && <div className="rate-suggestion">
            <h4><Sparkles /> AI가 문서에서 찾은 재원 비율 <b>확인 후 수정 가능</b></h4>
            {rateSuggestion?.subsidyRate && <p className="wiz-hint">지원비율 {rateSuggestion.subsidyRate.pct}% — "{rateSuggestion.subsidyRate.rule.quote.slice(0, 80)}{rateSuggestion.subsidyRate.rule.quote.length > 80 ? '…' : ''}" ({rateSuggestion.subsidyRate.rule.ref})</p>}
            {rateSuggestion?.matchingCashRate && <p className="wiz-hint">민간부담금 중 현금 최소비율 {rateSuggestion.matchingCashRate.pct}% — "{rateSuggestion.matchingCashRate.rule.quote.slice(0, 80)}{rateSuggestion.matchingCashRate.rule.quote.length > 80 ? '…' : ''}" ({rateSuggestion.matchingCashRate.rule.ref})</p>}
            <div className="field-grid">
              <label><span className="label-line">지원비율(%)</span><input inputMode="numeric" value={rateForm.subsidyRate} onChange={(e) => setRateForm({ ...rateForm, subsidyRate: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
              <label><span className="label-line">민간부담금 중 현금 비율(%)</span><input inputMode="numeric" value={rateForm.matchingCashRate} onChange={(e) => setRateForm({ ...rateForm, matchingCashRate: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
            </div>
            <div className="settings-save"><button type="button" className="secondary" onClick={applyRates}><Check /> 재원 비율 반영</button>{rateApplied && <span className="save-ok"><CheckCircle2 /> 반영됐어요</span>}</div>
          </div>}
          {ai.extraction.fundingSchedule && (() => {
            const sched = ai.extraction.fundingSchedule!;
            const totalWon = fundingScheduleAmountWon(sched, sched.totalSubsidyMax);
            const currentSubsidy = project.subsidyAmount ?? project.totalBudget;
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
              {totalWon != null && currentSubsidy > totalWon && <p className="field-error"><AlertCircle /> 현재 입력된 지원금({formatWon(currentSubsidy)})이 공고 한도({formatWon(totalWon)})를 초과했어요.</p>}
            </div>;
          })()}
          {ai.extraction.categories.length > 0 && <label className="share-toggle"><input type="checkbox" checked={useDocCats} onChange={(e) => setUseDocCats(e.target.checked)} /><span><strong>문서의 비목 구성 사용</strong> ({ai.extraction.categories.length}개: {ai.extraction.categories.map((c) => c.name).join(', ').slice(0, 60)})</span></label>}
          <div className="ai-rules">{ai.extraction.rules.map((rule, index) => <label key={index} className={`ai-rule ${rule.verified ? '' : 'unverified'}`}>
            <input type="checkbox" checked={acceptedRules.has(index)} onChange={(e) => setAcceptedRules((prev) => { const next = new Set(prev); if (e.target.checked) next.add(index); else next.delete(index); return next; })} />
            <span><strong>[{rule.minAmount != null ? '필수계상' : RULE_KIND_LABEL[rule.kind]}] {rule.message}{rule.minAmount != null && ` (${formatWon(rule.minAmount)})`}</strong><em>"{rule.quote.slice(0, 90)}{rule.quote.length > 90 ? '…' : ''}" ({rule.ref}) {rule.verified ? '· 원문 확인됨' : '· ⚠ 원문에서 찾지 못한 인용 — 직접 확인 후 선택하세요'}</em></span>
          </label>)}</div>
          {ai.extraction.uncertain.length > 0 && <p className="wiz-hint">AI가 판단을 보류한 항목: {ai.extraction.uncertain.join(' / ')}</p>}
          {admin && registryEnabled() && <div className="wiz-block share-block">
            <label className="share-toggle"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span><CloudUpload /> <strong>공유 규정 DB에도 등록</strong> — 업로드한 공고문·지침을 다른 사용자도 사업명 검색으로 쓸 수 있게 합니다 (관리자 전용)</span></label>
            {share && <label>연도<input inputMode="numeric" value={shareYear} onChange={(e) => setShareYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2026" /></label>}
          </div>}
          <div className="settings-save"><button type="button" className="primary" onClick={apply} disabled={(acceptedRules.size === 0 && !useDocCats) || applying}><Check /> {applying ? '반영 중…' : `선택한 규정 적용 (${acceptedRules.size}건${useDocCats ? ' + 비목 구성' : ''})`}</button>{applied && <span className="save-ok"><CheckCircle2 /> 반영됐어요{share && admin ? ' · 공유 DB에도 등록됐어요' : ''}</span>}</div>
          {ai.extraction.referencedRegulations && ai.extraction.referencedRegulations.length > 0 && <div className="ref-regs">
            <h4>이 공고가 참고하라고 명시한 규정</h4>
            <p className="wiz-hint">예산 편성 기준은 대개 공고문·사업계획서에 있지만, 증빙 서류는 아래 규정도 함께 확인해야 할 수 있어요. 정부 사이트에 원문이 흩어져 있어 자동으로 가져오지는 못하니, 직접 찾아 "공유 규정 DB"에 올려두면 다음부터 검색으로 바로 쓸 수 있어요.</p>
            <ul className="ref-reg-list">{ai.extraction.referencedRegulations.map((reg, index) => <li key={index} className={reg.verified ? '' : 'unverified'}><strong>{reg.name}</strong><em>"{reg.quote.slice(0, 70)}{reg.quote.length > 70 ? '…' : ''}" ({reg.ref})</em></li>)}</ul>
          </div>}
        </div>}
      </>}
    </div>
  </section>;
}

function Settings({ project, update, onReset }: { project: Project; update: (p: Project) => void; onReset: () => void }) {
  const initialForm = (p: Project) => ({ name: p.name, company: p.companyName, subsidy: String(p.subsidyAmount ?? p.totalBudget), subsidyRate: String(p.subsidyRate ?? 100), matchingCashRate: p.matchingCashRate != null ? String(p.matchingCashRate) : '', start: p.startDate, end: p.endDate, deadline: p.settlementDeadline, programName: p.programName ?? '' });
  const [form, setForm] = useState(initialForm(project));
  const [saved, setSaved] = useState(false);
  const sourceDocs = useSourceDocs(project);
  useEffect(() => { setForm(initialForm(project)); }, [project]);
  const subsidyAmount = Number(form.subsidy) || 0;
  const subsidyRate = Math.min(100, Math.max(1, Number(form.subsidyRate) || 100));
  const matchingCashRate = Math.min(100, Math.max(0, Number(form.matchingCashRate) || 0));
  const { totalBudget: previewTotal, matching: previewMatching, matchingCash: previewCash, matchingInKind: previewInKind } = previewFunding(subsidyAmount, subsidyRate, matchingCashRate);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.company.trim() || !subsidyAmount) return;
    if (form.end < form.start) { alert('종료일이 시작일보다 빠릅니다. 날짜를 확인해주세요.'); return; }
    // 비워두면 "확인됨(0 등)"으로 단정해 저장하지 않고 비워둔다 — 한눈에 보기에서 "확인 필요"로 표시된다.
    const storedMatchingCashRate = form.matchingCashRate === '' ? undefined : matchingCashRate;
    update({ ...project, name: form.name.trim(), companyName: form.company.trim(), totalBudget: previewTotal, subsidyAmount, subsidyRate, matchingCashRate: storedMatchingCashRate, startDate: form.start, endDate: form.end, settlementDeadline: form.deadline, programName: form.programName.trim() || undefined });
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };
  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const restored = parseBackup(await file.text());
    if (!restored) { alert('백업 파일을 읽지 못했습니다. 과제온에서 내보낸 JSON 파일인지 확인해주세요.'); return; }
    if (confirm(`"${restored.name}" 백업으로 현재 과제 데이터를 교체할까요? 지금 데이터는 사라집니다.`)) update(restored);
  };
  const redistribute = () => {
    if (!confirm(`총 사업비 ${formatWon(project.totalBudget)} 기준 초안 비율로 예산을 다시 배분할까요? 직접 수정한 편성 금액이 초기화되고 편성 확정이 해제됩니다.`)) return;
    update({ ...project, budgets: makeDraftBudgets(packFor(project), project.totalBudget), budgetConfirmed: false });
  };
  const clearExpenses = async () => {
    if (!project.expenses.length) { alert('삭제할 집행 내역이 없습니다.'); return; }
    if (!confirm(`집행 내역 ${project.expenses.length}건과 업로드된 증빙 파일을 모두 삭제할까요? 예산 편성과 인력 정보는 유지됩니다.`)) return;
    try { await deleteEvidence(collectEvidenceIds(project)); } catch { alert('일부 증빙 파일 삭제에 실패했을 수 있습니다.'); }
    update({ ...project, expenses: [], emailLogs: [] });
  };
  const clearChanges = () => {
    if (!project.changes.length) { alert('삭제할 변경 이력이 없습니다.'); return; }
    if (!confirm(`변경 이력 ${project.changes.length}건을 삭제할까요? 현재 예산 편성 금액은 그대로 유지됩니다.`)) return;
    update({ ...project, changes: [] });
  };
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">운영 설정</span><h2>과제 설정</h2><p>과제 기본 정보를 수정하고, 백업·복원과 초기화를 관리합니다.</p></div></div>
    <section className="panel settings-panel"><div className="panel-head"><div><h3>과제 기본 정보</h3><p>적용 규정: <strong>{packFor(project).name}</strong> ({packFor(project).guideline}) · 수정 후 저장을 누르면 모든 화면에 바로 반영됩니다.</p></div></div>
      <form className="settings-form" onSubmit={save}>
        <div className="field-grid"><label>과제명<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>기업명<input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label></div>
        <div className="field-grid"><label>지원금(정부지원금)<input required inputMode="numeric" value={withCommas(form.subsidy)} onChange={(e) => setForm({ ...form, subsidy: digitsOnly(e.target.value) })} /></label><label><span className="label-line">지원비율(%) <b>공고문 기준</b></span><input required inputMode="numeric" value={form.subsidyRate} onChange={(e) => setForm({ ...form, subsidyRate: digitsOnly(e.target.value).slice(0, 3) })} placeholder="자기부담 없으면 100" /></label></div>
        {subsidyRate < 100 && <div className="field-grid"><label><span className="label-line">민간부담금 중 현금 비율(%) <b>선택 · 아래 문서 업로드 시 AI가 자동 입력</b></span><input inputMode="numeric" value={form.matchingCashRate} onChange={(e) => setForm({ ...form, matchingCashRate: digitsOnly(e.target.value).slice(0, 3) })} placeholder="공고문 확인 후 알면 직접 입력 (예: 10)" /></label><div /></div>}
        <div className="field-grid"><label>정산 마감일<input required type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label><label>사업명 <input value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} placeholder={`비워두면 규정 팩 이름(${packFor(project).name}) 사용`} /></label></div>
        <div className="field-grid"><label>시작일<input required type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label><label>종료일<input required type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label></div>
        <p className="field-hint">{subsidyRate >= 100
          ? `자기부담 없이 전액 지원 — 총사업비 ${formatWon(previewTotal)}`
          : form.matchingCashRate === ''
          ? '공고문의 "기업(민간)부담금 중 현금 비율"을 확인해 입력하면 현금·현물 금액이 계산돼요.'
          : `총사업비 ${formatWon(previewTotal)} = 지원금 ${formatWon(subsidyAmount)} + 민간부담금 ${formatWon(previewMatching)} (현금 ${formatWon(previewCash)} · 현물 ${formatWon(previewInKind)})`}</p>
        {previewTotal !== project.totalBudget && <p className="field-hint">총 사업비가 바뀌면 편성 합계와 차이가 생길 수 있어요. 저장 후 예산 편성 화면에서 금액을 조정하거나, 아래 "예산 초안 재배분"을 사용하세요.</p>}
        <div className="settings-save"><button className="primary" type="submit">과제 정보 저장</button>{saved && <span className="save-ok"><CheckCircle2 /> 저장됐어요</span>}</div>
      </form>
    </section>
    <DocUpdatePanel project={project} update={update} />
    <SourceDocsPanel source={sourceDocs} />
    <section className="panel backup-panel"><div className="panel-head"><div><h3>백업 · 복원</h3><p>브라우저 데이터 삭제나 기기 변경에 대비해 주기적으로 백업 파일을 보관하세요. 증빙 파일 원본은 포함되지 않습니다.</p></div></div><div className="backup-actions"><button className="secondary" onClick={() => downloadBackup(project)}><Download /> 백업 JSON 내보내기</button><label className="upload-button"><Upload /> 백업으로 복원<input type="file" accept="application/json,.json" onChange={importBackup} /></label></div></section>
    <section className="panel danger-panel"><div className="panel-head"><div><h3>초기화 · 삭제</h3><p>아래 작업은 되돌릴 수 없습니다. 실행 전에 백업을 권장합니다.</p></div></div>
      <div className="manage-list">
        <div className="manage-row"><div><strong>예산 초안 재배분</strong><span>현재 총 사업비 기준 초안 비율로 비목별 편성을 다시 계산합니다.</span></div><button className="secondary" onClick={redistribute}><RefreshCw /> 재배분</button></div>
        <div className="manage-row"><div><strong>집행 내역 초기화</strong><span>집행 {project.expenses.length}건과 증빙 파일, 알림 로그를 삭제합니다. 예산·인력은 유지됩니다.</span></div><button className="danger-button" aria-label="집행 내역 초기화" onClick={clearExpenses}><Trash2 /> 초기화</button></div>
        <div className="manage-row"><div><strong>변경 이력 초기화</strong><span>변경 이력 {project.changes.length}건을 삭제합니다. 현재 예산 금액은 유지됩니다.</span></div><button className="danger-button" aria-label="변경 이력 초기화" onClick={clearChanges}><Trash2 /> 초기화</button></div>
        <div className="manage-row"><div><strong>과제 삭제</strong><span>과제 전체를 삭제하고 처음 등록 화면으로 돌아갑니다.</span></div><button className="danger-button strong" onClick={onReset}><Trash2 /> 과제 삭제</button></div>
      </div>
    </section>
  </div>;
}

function AuthScreen({ onLocal }: { onLocal: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setNotice(null);
    try {
      if (mode === 'login') {
        const { error } = await signInEmail(form.email, form.password);
        if (error) setNotice({ kind: 'error', text: authErrorKo(error.message) });
      } else {
        const { data, error } = await signUpEmail(form.email, form.password);
        if (error) setNotice({ kind: 'error', text: authErrorKo(error.message) });
        else {
          // 가입이 끝나면 로그인 화면으로 전환한다. 이메일은 그대로 두고 비밀번호만 다시 입력받는다.
          setMode('login');
          setForm((prev) => ({ ...prev, password: '' }));
          setNotice({ kind: 'info', text: data.session ? '가입 완료! 로그인해주세요.' : '가입이 완료됐어요. 방금 만든 계정으로 로그인해주세요. (이메일 인증이 켜져 있다면 받은 편지함에서 인증 후 로그인)' });
        }
      }
    } finally { setBusy(false); }
  };
  return <div className="setup-page">
    <div className="setup-brand"><div className="brand-mark"><Check /></div><span>과제온</span></div>
    <main className="auth-card">
      <h1>{mode === 'login' ? '다시 만나서 반가워요' : '계정을 만들어볼까요?'}</h1>
      <p>과제 데이터와 증빙 파일이 계정에 안전하게 저장되고, 다른 기기에서도 이어서 쓸 수 있어요.</p>
      <form onSubmit={submit}>
        <label>이메일<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label>
        <label>비밀번호<input required type="password" minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="6자 이상" /></label>
        {notice && <p className={`auth-notice ${notice.kind}`}>{notice.kind === 'error' ? <AlertCircle /> : <CheckCircle2 />} {notice.text}</p>}
        <button className="primary large" disabled={busy} type="submit">{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setNotice(null); }}>{mode === 'login' ? '계정이 없나요? 회원가입' : '이미 계정이 있나요? 로그인'}</button>
      <button className="text-button muted" onClick={onLocal}>로그인 없이 이 브라우저에만 저장하고 시작하기</button>
    </main>
  </div>;
}

type SyncState = 'local' | 'saving' | 'synced' | 'error';

export default function App() {
  const [project, setProject] = useState<Project | null>(() => loadProject());
  const [screen, setScreen] = useState<Screen>('overview');
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!isCloudEnabled);
  const [localMode, setLocalMode] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('local');
  const saveWarned = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    if (!supabase) return;
    const apply = async (next: Session | null, initial = false) => {
      setCloudUser(next?.user.id ?? null);
      setSession(next);
      if (next) {
        // 클라우드에 데이터가 있으면 내려받고, 없으면 이 브라우저의 로컬 데이터를 올려 이전한다.
        const cloudProject = await fetchCloudProject();
        if (cloudProject) { setProject(cloudProject); setSyncState('synced'); }
        else if (projectRef.current) setSyncState(await saveCloudProject(projectRef.current) ? 'synced' : 'error');
        else setSyncState('synced');
      } else setSyncState('local');
      if (initial) setAuthChecked(true);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session, true));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') apply(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const saved = saveProject(project);
    if (!saved && !saveWarned.current) {
      saveWarned.current = true;
      alert('브라우저 저장 공간이 부족해 변경 내용을 저장하지 못했습니다. 인력 · 담당자 화면에서 백업 JSON을 내보내 데이터를 보관해주세요.');
    }
    if (saved) saveWarned.current = false;
    // 클라우드 저장은 입력이 잦아도 부담이 없도록 0.8초 디바운스로 미룬다.
    if (session) {
      setSyncState('saving');
      const timer = setTimeout(async () => setSyncState(await saveCloudProject(project) ? 'synced' : 'error'), 800);
      return () => clearTimeout(timer);
    }
  }, [project, session]);

  const logout = async () => { await signOutCloud(); setLocalMode(false); };
  if (!authChecked) return <div className="auth-splash"><div className="brand-mark"><Check /></div> 계정 확인 중…</div>;
  if (isCloudEnabled && !session && !localMode) return <AuthScreen onLocal={() => setLocalMode(true)} />;
  if (!project) return <SetupWizard onCreate={setProject} />;
  const update = (next: Project) => setProject(next);
  const reset = async () => {
    if (!confirm(session ? '현재 과제를 계정에서 제거할까요? 클라우드와 이 브라우저의 데이터가 삭제됩니다.' : '현재 과제를 브라우저에서 제거할까요? 입력한 데이터가 삭제됩니다.')) return;
    const evidenceIds = collectEvidenceIds(project);
    if (evidenceIds.length && confirm(`업로드한 증빙 파일 ${evidenceIds.length}개도 함께 삭제할까요?\n[확인] 파일까지 완전 삭제  [취소] 파일은 남겨두기`)) {
      try { await deleteEvidence(evidenceIds); } catch { alert('증빙 파일 삭제에 실패했습니다. 저장 공간에 파일이 남아 있을 수 있습니다.'); }
    }
    setProject(null);
  };
  return <div className="app-shell"><Sidebar screen={screen} setScreen={setScreen} project={project} onReset={reset} account={session?.user.email ?? null} sync={syncState} onLogout={logout} /><main className="main"><Header project={project} />{screen === 'overview' && <Overview project={project} setScreen={setScreen} />}{screen === 'budget' && <Budget project={project} update={update} />}{screen === 'spending' && <Spending project={project} update={update} />}{screen === 'change' && <ChangeManagement project={project} update={update} />}{screen === 'team' && <Team project={project} update={update} />}{screen === 'settings' && <Settings project={project} update={update} onReset={reset} />}</main></div>;
}
