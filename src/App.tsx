import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, Bell, BookOpenCheck,
  Building2, CalendarDays, Check, CheckCircle2, ChevronRight, CircleDollarSign, CloudUpload,
  Download, Eye, FileCheck2, FileClock, FileSearch, FileText, HandCoins, Landmark, LayoutDashboard, Mail, Package,
  Pencil, Plus, RefreshCw, ScanLine, Settings as SettingsIcon, ShieldCheck, Sparkles, Trash2, Upload, UserPlus, Users, WalletCards,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { baseStandardFor, basisFormula, budgetBases, capFor, categoryOf, DEFAULT_INSURANCE_RATE, mandatoryNotesFor, maxAmountWithinCap, packIsMissing, subItemChoicesFor, replacementPacksFor, selectablePacks, fundingCapChecks, fundingRateChecks, rescaleBudgets, deriveTotalBudget, evidenceGuide, evidenceChecklistFor, commonEvidenceRuleNames, primaryEvidence, withAlwaysRequired, formatWon, fundingBreakdown, globalRules, isRegulationDbPack, laborCostFor, makeDraftBudgets, minFor, packFor, previewFunding, REASON_TEMPLATES, RULES_EFFECTIVE_DATE, findArticles, referenceStandardFor, rulesFor, severanceApplies, spendingCautions, subItemStandardFor, transferLimitError, visibleCategories } from './rules';
import { evidenceReadiness, monthSequence, setMonthlyPlan, spendingMatrix } from './spending';
import { detailFieldsFor } from './spendingForms';
import { collectEvidenceIds, downloadBackup, loadActiveProjectId, loadProjectOwner, loadProjects, parseBackup, saveActiveProjectId, saveProjectOwner, saveProjectsLocal } from './storage';
import { authErrorKo, deleteCloudProject, deleteEvidence, deleteProjectDocuments, fetchCloudProjects, getEvidence, getProjectDocument, saveCloudProject, setCloudUser, signInEmail, signOutCloud, signUpEmail, storeEvidence, storeProjectDocument } from './cloud';
import { isCloudEnabled, supabase } from './supabase';
import { DOCUMENT_TYPE_LABEL, downloadRegistryDocument, getProgramById, guessDocumentType, matchDocToSource, myPendingSubmissions, projectRegistryId, registryEnabled, searchDocumentsByProgram, searchRegistry, submitRegistryShare, submitRegulationPackage, type DocumentEntry, type DocumentType, type RegistryEntry } from './registry';
import { annotateVerification, buildCustomPack, fundingScheduleAmountWon, runExtraction, suggestedFundingRates, type Extraction } from './llmExtract';
import { initRegulationPacks, type RegulationPackStatus } from './regulationDb';
import { buildRegulationPackage } from './regulationPackage';
import { diffExtraction, overlayRulesFrom, summarizeDiff, type PackDiff } from './packDiff';
import SetupWizard from './SetupWizard';
import type { BudgetBasis, CautionItem, CategoryCap, CategoryMin, ReferenceStandard, SubItemChoice, SubItemChoices } from './rules';
import type { BudgetCategoryId, BudgetItem, BudgetSubItem, Evidence, Expense, PackAllowedItem, PackArticle, PackCategory, PackRule, Participant, PaymentMethod, Project, ProjectDocumentLink, RulePack, SavedRulePack, Screen } from './types';

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

// 규정 팩이 "언제 기준"인지. 규정DB 팩은 규정 자체의 시행일을 쓰고, 그게 없는 내장 예시 팩만
// 앱이 데이터를 정리한 날(RULES_EFFECTIVE_DATE)로 떨어진다.
const packBasisDate = (pack: RulePack): string =>
  pack.effectiveFrom ? `${pack.effectiveFrom} 시행 기준` : `${RULES_EFFECTIVE_DATE} 업데이트`;

function Sidebar({ screen, setScreen, project, projects, onSelect, onAdd, onReset, account, sync, onLogout }: { screen: Screen; setScreen: (s: Screen) => void; project: Project; projects: Project[]; onSelect: (id: string) => void; onAdd: () => void; onReset: () => void; account: string | null; sync: 'local' | 'saving' | 'synced' | 'error'; onLogout: () => void }) {
  const nav = [
    { id: 'overview' as Screen, label: '한눈에 보기', icon: LayoutDashboard },
    { id: 'budget' as Screen, label: '예산 편성', icon: WalletCards },
    { id: 'spending' as Screen, label: '집행 · 증빙', icon: FileCheck2 },
    { id: 'change' as Screen, label: '변경 관리', icon: RefreshCw },
    { id: 'team' as Screen, label: '담당자 · 알림', icon: Users },
    { id: 'settings' as Screen, label: '과제 설정', icon: SettingsIcon },
  ];
  const pack = packFor(project);
  const [menuOpen, setMenuOpen] = useState(false);
  return <aside className="sidebar">
    <div className="logo"><div className="brand-mark"><Check /></div><span>과제온</span><b>beta</b></div>
    <button type="button" className="project-chip" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Building2 /><div><small>현재 과제 {projects.length > 1 ? `(${projects.length}개 중)` : ''}</small><strong>{project.name}</strong></div><ChevronRight style={{ transform: menuOpen ? 'rotate(90deg)' : undefined }} /></button>
    {menuOpen && <div className="project-menu">
      {projects.map((p) => <button type="button" key={p.id} className={p.id === project.id ? 'active' : ''} onClick={() => { onSelect(p.id); setMenuOpen(false); }}><strong>{p.name}</strong><small>{p.companyName}{p.programName ? ` · ${p.programName}` : ''}</small></button>)}
      <button type="button" className="add" onClick={() => { setMenuOpen(false); onAdd(); }}><Plus /> 새 과제 등록</button>
    </div>}
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id)}><Icon />{label}</button>)}</nav>
    {/* 검증 여부·기준일은 팩에서 읽는다 — 규정DB 팩은 근거 조문까지 검토를 마쳤고 사업마다 시행일이 다르다. */}
    <div className="sidebar-bottom"><div className={`policy ${pack.verified ? 'verified' : ''}`}><BookOpenCheck /><div><strong>{pack.name}{pack.verified ? ' · 규정DB' : ' · 예시 기준 (검증 전)'}</strong><span>{packBasisDate(pack)}</span></div></div>{isCloudEnabled && <div className="cloud-chip"><span className={`sync-dot ${sync}`} /><div>{account ? <small>{account}</small> : null}<span>{SYNC_LABEL[sync]}</span></div>{account && <button onClick={onLogout}>로그아웃</button>}</div>}<button className="reset-button" onClick={onReset}><Trash2 /> 과제 삭제</button></div>
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
  const readiness = evidenceReadiness(pack, project);
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
        {incomplete > 0 ? <button onClick={() => setScreen('spending')} className="action-item warning"><AlertCircle /><div><strong>증빙 {incomplete}개가 비어 있어요</strong><span>아래에서 무엇이 빠졌는지 확인하세요</span></div><ChevronRight /></button> : <div className="empty-action"><CheckCircle2 /><strong>증빙이 모두 준비됐어요</strong><span>새 집행건을 등록하면 필요한 서류를 안내해드려요.</span></div>}
        {alerts > 0 && <button onClick={() => setScreen('budget')} className="action-item danger"><AlertCircle /><div><strong>참여율 100% 초과</strong><span>예산 편성의 인건비 산정에서 비율을 조정해주세요</span></div><ChevronRight /></button>}
        <button onClick={() => setScreen('spending')} className="quick-add"><Plus /> 새 집행건 등록</button>
      </section>
    </div>
    {/* 숫자 하나("증빙 12개가 비어 있어요")로는 무엇을 준비해야 하는지 알 수 없다.
        서류 종류별로 얼마나 밀렸는지, 집행건별로 무엇이 빠졌는지 나눠서 체크리스트로 보여준다. */}
    {readiness.total > 0 && <section className="panel evidence-readiness">
      <div className="panel-head">
        <div><span className="section-kicker">EVIDENCE</span><h3>증빙 준비 현황</h3>
          <p>집행건 {project.expenses.length}건 중 {readiness.readyExpenses}건 완료 · 서류 {readiness.done}/{readiness.total}건 준비됨</p></div>
        <button className="text-button" onClick={() => setScreen('spending')}>집행·증빙으로 <ArrowRight /></button>
      </div>
      <div className="readiness-bar"><i style={{ width: `${readiness.rate}%` }} className={readiness.rate >= 100 ? 'done' : ''} /></div>
      {/* 같은 서류를 몰아서 만들 수 있게 종류별로도 센다 */}
      <div className="doc-tally">{readiness.byDocument.map((entry) => <span key={entry.label} className={entry.done === entry.total ? 'ok' : ''}>
        {entry.done === entry.total ? <CheckCircle2 /> : <FileText />}{entry.label} <b>{entry.done}/{entry.total}</b>
      </span>)}</div>
      {readiness.todos.length > 0
        ? <div className="todo-list">{readiness.todos.map((todo) => <button type="button" key={todo.expenseId} onClick={() => setScreen('spending')}>
          <div className="todo-head">
            <strong>{todo.purpose}</strong>
            <em>{todo.categoryName}{todo.subItemName ? ` · ${todo.subItemName}` : ''} · {todo.date}</em>
            <b className={todo.done ? '' : 'none'}>{todo.done}/{todo.total}</b>
          </div>
          <div className="todo-missing">{todo.missing.map((label) => <span key={label}><FileClock />{label}</span>)}</div>
        </button>)}</div>
        : <p className="field-hint">모든 집행건의 증빙이 준비됐습니다.</p>}
    </section>}
    <section className="guide-banner"><div className="guide-icon"><ShieldCheck /></div><div><span>과제온 가이드</span><strong>집행 전에 인정 기준을 먼저 확인하세요.</strong><p>비목을 선택하면 중기부 기준 증빙 목록과 주의사항을 바로 보여드려요.</p></div><button onClick={() => setScreen('spending')}>집행 등록하기 <ArrowRight /></button></section>
  </div>;
}

// 공유 DB에 저장된 이 사업의 원본 문서(공고문·지침·매뉴얼)를 조회·업로드·미리보기하는 공용 훅.
interface DocViewer { doc: DocumentEntry; kind: 'loading' | 'pdf' | 'image' | 'text'; url?: string; text?: string; highlights?: string[]; fallbacks?: string[] }

// 근거 문구에서 팝업 하이라이트용 위치 패턴(제65조, 사업비 3번, 별표 1...)을 전부 뽑는다.
// "제8조·제23조"처럼 출처가 여러 조문이면 각각을 하이라이트 대상으로 삼는다 (DB화된 규정의 출처 컬럼 대응).
const refPatternTerms = (ref: string): string[] => {
  const terms: string[] = [];
  for (const pattern of [/제\s*\d+\s*조(?:의\s*\d+)?/g, /사업비\s*\d+/g, /별표\s*\d+/g, /붙임\s*\d+/g, /별지\s*제?\s*\d+호?/g, /QnA|질의응답/gi]) {
    for (const match of ref.matchAll(pattern)) terms.push(match[0]);
  }
  return [...new Set(terms)];
};

// 규정 문구의 핵심 수치("3천만원", "20%", "6개월", "2명")는 원문에 그대로 있을 확률이 가장 높은 하이라이트 대상이다.
const numberTokens = (text: string): string[] =>
  [...new Set((text.match(/\d[\d,.]*\s*(?:억|천만|백만|십만|만)?\s*원|\d[\d,.]*\s*(?:%|퍼센트)|\d+\s*(?:개월|개년|년|일|명|회|건|시간|인)/g) ?? []).map((token) => token.trim()))].slice(0, 5);

// 흔해서 문서 전체에 칠해질 단어들 — 하이라이트 키워드에서 제외
const COMMON_WORDS = new Set(['사업비', '사업', '지원', '창업', '기업', '경우', '집행', '비용', '금액', '대상', '신청', '이내', '불가', '가능', '있다', '한다', '해당', '관련']);
// 인용·메시지에서 문서에 그대로 있을 법한 특징 단어를 뽑는다 (길고 드문 단어 우선).
const keywordTokens = (text: string): string[] =>
  [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !COMMON_WORDS.has(token)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

// 조문 원문은 조 전체라 다른 세목 내용까지 함께 실려 있다 (제25조가 회의비·출장비를 모두 다룬다).
// 유의사항 제목·설명의 특징 단어가 여러 개 겹치는 문단을 짚어, 어디를 읽어야 하는지 알려준다.
// 한국어는 같은 말이라도 조사·어미가 달라붙는다 ("규정에" ↔ "규정을", "계상해야" ↔ "계상한다").
// 꼬리를 떼고 비교해야 같은 조항을 가리키는 문단을 놓치지 않는다.
const PARTICLE_TAIL = /(으로써|으로서|에서는|에게서|합니다|한다면|으로|에게|에서|까지|부터|이나|한다|해야|하여|이란|은|는|이|가|을|를|에|의|도|만|과|와|나|로)$/;
const stemOf = (token: string): string => {
  const stem = token.replace(PARTICLE_TAIL, '');
  return stem.length >= 2 ? stem : token;
};

// 두 글자짜리 한국어 낱말(현금·현물·대체·채용)이 뜻을 가르는 일이 많아 길이 2까지 받는다.
// 대신 어느 조문에나 나오는 뼈대 낱말은 제외해야 아무 문단이나 걸리지 않는다.
const STRUCTURE_WORDS = new Set(['등', '및', '또는', '다음', '각호', '이내', '이상', '이하', '미만', '따라', '위해', '통해', '대해', '관해', '경우', '때는', '한다', '있다', '없다', '한다면', '제외', '포함']);

const termsOf = (text: string, minLength: number): string[] => {
  const words = text.split(/[^\p{L}\p{N}]+/u).map(stemOf)
    .filter((token) => token.length >= minLength && !COMMON_WORDS.has(token) && !STRUCTURE_WORDS.has(token));
  return [...new Set([...numberTokens(text), ...words])].sort((a, b) => b.length - a.length).slice(0, 24);
};

// '초과채용'이 조문에는 '초과로 채용한'으로 풀려 있어 통째로는 안 맞는다. 낱말을 쪼개 검색어로
// 쓰면 '참여연구자'에서 '구자' 같은 조각이 나와 엉뚱한 문단이 걸리므로, 낱말은 그대로 두고
// 두 글자 조각이 얼마나 겹치는지로 판단한다 (초과채용 → 초과·과채·채용 중 둘이 있으면 같은 말).
const bigramsOf = (text: string): string[] =>
  Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2));

const termMatches = (paragraph: string, term: string): boolean => {
  if (paragraph.includes(term)) return true;
  if (term.length < 4) return false;   // 짧은 말은 통째로 맞아야 한다 — 조각으로 풀면 아무 데나 걸린다
  const grams = bigramsOf(term);
  return grams.filter((gram) => paragraph.includes(gram)).length / grams.length >= 2 / 3;
};

// 문단을 찾을 때는 잘게 쪼갠 낱말까지 쓰고, 실제로 색칠할 때는 뜻이 뚜렷한 세 글자 이상만 쓴다
// (두 글자 낱말까지 칠하면 문단이 온통 노랗게 된다).
export const articleTerms = (text: string): string[] => termsOf(text, 3);

// 문구를 여러 개 받으면 각각이 가리키는 문단을 따로 짚어 합친다.
// 한 조문이 여러 항목의 근거일 때(팁스 '비목별 증빙서류' 표에는 세목이 통째로 들어 있다)
// 문구를 하나로 합쳐 찾으면 그중 가장 센 항목의 줄 하나만 남는다 —
// 외부 전문기술 활용비를 골랐는데 그 안의 연구개발서비스활용비 줄만 짚히던 원인이다.
export const markArticleParagraphs = (articleText: string, phrase: string | string[], minHits = 2): { paragraphs: string[]; marked: Set<number>; terms: string[] } => {
  const paragraphs = articleText.split('\n');
  const phrases = (Array.isArray(phrase) ? phrase : [phrase]).filter((one) => one.trim());
  const marked = new Set<number>();
  const terms: string[] = [];
  for (const one of phrases) {
    for (const term of articleTerms(one)) if (!terms.includes(term)) terms.push(term);
    const scoreTerms = termsOf(one, 2);
    const hits = paragraphs.map((paragraph) => scoreTerms.filter((term) => termMatches(paragraph, term)).length);
    // 문구 하나가 가장 잘 맞는 문단만 짚는다. 비목별 증빙서류 표처럼 한 조문이 수백 줄이고
    // '카드매출전표…'가 반복되는 곳에서는 "N개 이상"으로 자르면 표 절반이 칠해진다.
    // 최고 점수와 같은 문단만 남기고, 그 최고 점수가 minHits에 못 미치면 아무 데도 짚지 않는다.
    const best = Math.max(0, ...hits);
    const threshold = best >= minHits ? best : Infinity;
    hits.forEach((hit, index) => { if (hit >= threshold) marked.add(index); });
  }
  return { paragraphs, marked, terms };
};

// 원문 인용(quote)을 길이가 다른 여러 검색어로 쪼갠다. 인용 전체가 문서와 한 글자도 안 틀리는
// 경우는 드물어서(추출 과정에서 표·머리글이 끼어들거나 줄이 갈린다) 긴 조각부터 짧은 조각까지
// 후보로 넣고, 실제로 문서에 있는 것만 하이라이트된다. 12자 미만 조각은 흔한 표현이라 넣지 않는다.
const MIN_QUOTE_TERM = 12;
export const quoteTerms = (quote?: string): string[] => {
  const clean = (quote ?? '').trim();
  if (clean.length < MIN_QUOTE_TERM) return [];
  const terms = [clean.slice(0, 60)];
  // 문장·절 단위로 끊어 각각을 후보로 (한 절만 원문과 일치해도 위치를 찾을 수 있다)
  for (const piece of clean.split(/[.。;·]|(?<=다)\s|,\s/)) {
    const trimmed = piece.trim();
    if (trimmed.length >= MIN_QUOTE_TERM) terms.push(trimmed.slice(0, 40));
  }
  terms.push(clean.slice(0, 30), clean.slice(0, MIN_QUOTE_TERM + 6));
  return [...new Set(terms)].sort((a, b) => b.length - a.length);
};

// 규칙의 하이라이트 검색어 2단계. primary는 확실한 근거(원문 인용·출처 조문·수치),
// fallback은 primary가 문서에서 하나도 안 잡힐 때 대신 쓰는 비목·항목명 + 특징 단어 —
// "연구개발계획서에" 같은 엉뚱한 단어가 1순위로 칠해지는 문제를 막으면서도, 문구가 다르게
// 표기된 문서에서 빈손으로 끝나지 않게 한다. refOverride는 복수 근거를 링크별로 나눠 열 때 사용.
export const highlightTermSets = (rule: { quote?: string; message?: string; item?: string; source: { ref: string } }, refOverride?: string): { primary: string[]; fallback: string[] } => ({
  primary: [
    ...quoteTerms(rule.quote),
    ...refPatternTerms(refOverride ?? rule.source.ref),
    ...numberTokens(`${rule.quote ?? ''} ${rule.message ?? ''}`),
  ],
  fallback: [...(rule.item ? [rule.item] : []), ...keywordTokens(rule.message ?? '')],
});

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 근거 표시는 조·항·호 번호가 있으면 그 번호만 보여준다. AI 추출 팩의 ref는 "붙임2-5 1. 세부
// 지원내용 - 주요 연구개발비 산정기준"처럼 목차 경로 전체가 오는 경우가 있어 링크가 본문을 덮는다.
// (추출 프롬프트는 번호 우선으로 고쳤지만, 이미 저장된 팩에도 같은 축약이 적용돼야 한다.)
// 구체적인 것부터 시도한다 — "붙임2-5 … 제65조 제7항"에서 붙임 번호가 아니라 조문 번호를 남겨야 한다.
const REF_NUMBER_PATTERNS = [
  /제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제?\s*\d+\s*[항호목])*/,
  /지침\s*[\d]+[.가-힣\d)(]*/,
  /별표\s*\d+|별지\s*제?\s*\d+호?/,
  /QnA\s*[^\s,]*\s*\d+번?/i,
  /붙임\s*[\d-]+/,
];
export const shortRef = (ref: string): string => {
  const trimmed = ref.trim();
  if (trimmed.length <= 24) return trimmed;
  for (const pattern of REF_NUMBER_PATTERNS) {
    const found = pattern.exec(trimmed)?.[0];
    if (found) return found.replace(/\s+/g, ' ').trim();
  }
  return `${trimmed.slice(0, 22)}…`;
};

// 같은 글자가 문서마다 다른 코드로 쓰인다 (가운뎃점·물결·괄호·따옴표). 인용문이 한 글자 차이로
// 통째로 안 잡히는 걸 막으려고 흔한 변형을 한 묶음으로 취급한다.
const CHAR_VARIANTS: Record<string, string> = {
  '·': '[·‧ㆍ•・]', '~': '[~∼〜～]', '(': '[(（]', ')': '[)）]', '-': '[-–—―]',
  "'": "['’‘]", '"': '["“”]', ',': '[,，]', '%': '[%％]',
};

// 검색어를 "글자 사이에 공백·줄바꿈이 끼어도 잡히는" 정규식 조각으로 바꾼다 —
// HWP·PDF에서 뽑은 본문은 원문과 줄바꿈 위치가 달라서 공백을 그대로 요구하면 대부분 실패한다.
const flexiblePattern = (term: string): string =>
  [...term.replace(/\s+/g, '')].map((ch) => CHAR_VARIANTS[ch] ?? escapeRegex(ch)).join('\\s*');

const buildTermRegex = (terms: string[] | undefined, flags: string): RegExp | null => {
  const usable = (terms ?? []).map((term) => term.trim()).filter((term) => term.replace(/\s+/g, '').length >= 2);
  if (!usable.length) return null;
  try { return new RegExp(usable.map(flexiblePattern).join('|'), flags); } catch { return null; }
};

// 하이라이트 검색어들이 문서 텍스트에 실제로 존재하는지 검사한다 (renderHighlighted와 같은 매칭 방식).
export const anyTermMatches = (text: string, terms?: string[]): boolean => buildTermRegex(terms, '')?.test(text) ?? false;

// 텍스트 미리보기에서 검색어를 <mark>로 감싼다 (공백·줄바꿈·구두점 변형 허용).
const renderHighlighted = (text: string, terms?: string[]) => {
  const re = buildTermRegex(terms, 'g');
  if (!re) return text;
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

// "근거 원본 문서" — project.documents(과제가 실제로 골라둔 문서 세트)가 유일한 출처다.
// kind:'link'(공유 문서고에서 연결)만 규정 인용 매칭(docForSource)·팝업 미리보기 대상이 되고,
// kind:'upload'(이 과제 전용 비공개 파일)는 목록·다운로드에만 쓰인다.
function useSourceDocs(project: Project, update: (p: Project) => void) {
  const docs = project.documents ?? [];
  const linkedEntries: DocumentEntry[] = docs
    .filter((d): d is ProjectDocumentLink & { documentVersionId: string; storagePath: string } => d.kind === 'link' && !!d.documentVersionId && !!d.storagePath)
    .map((d) => ({
      id: d.documentVersionId, documentId: d.documentVersionId, title: d.title,
      documentType: (d.documentType ?? 'OTHER') as DocumentEntry['documentType'],
      versionLabel: null, effectiveFrom: null, fileName: d.fileName, storagePath: d.storagePath,
    }));
  const [pendingCount, setPendingCount] = useState(0);
  const [viewer, setViewer] = useState<DocViewer | null>(null);
  const [uploading, setUploading] = useState(false);
  const [programQuery, setProgramQuery] = useState('');
  const [programResults, setProgramResults] = useState<RegistryEntry[] | null>(null);
  const [programSearching, setProgramSearching] = useState(false);
  const [programDocChecklist, setProgramDocChecklist] = useState<DocumentEntry[] | null>(null);
  const [loadingProgramDocs, setLoadingProgramDocs] = useState(false);
  const [checkedDocIds, setCheckedDocIds] = useState<Set<string>>(new Set());

  const refreshPending = () => {
    if (!registryEnabled()) return;
    myPendingSubmissions().then((rows) => setPendingCount(rows.length)).catch(() => {});
  };
  useEffect(() => { refreshPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeViewer = () => setViewer((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null; });
  const downloadDoc = async (doc: DocumentEntry) => {
    try {
      const blob = await downloadRegistryDocument(doc.storagePath);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = doc.fileName; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { alert(`다운로드에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
  };
  // kind에 따라 버킷이 다르다 — 업로드 파일은 미리보기 인프라가 없어 바로 다운로드로 처리한다.
  const downloadAny = async (link: ProjectDocumentLink) => {
    try {
      const blob = link.kind === 'upload' && link.fileId ? await getProjectDocument(link.fileId) : await downloadRegistryDocument(link.storagePath!);
      if (!blob) throw new Error('파일을 찾을 수 없습니다.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = link.fileName; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { alert(`다운로드에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
  };
  // 팝업 미리보기: PDF·이미지·텍스트는 그대로, HWP/HWPX는 본문 텍스트를 추출해 보여준다.
  // highlights(확실한 근거)가 문서에서 안 잡히면 fallbacks(비목명·특징 단어)로 2차 표시한다.
  const viewDoc = async (doc: DocumentEntry, highlights?: string[], fallbacks?: string[]) => {
    setViewer({ doc, kind: 'loading', highlights, fallbacks });
    try {
      const blob = await downloadRegistryDocument(doc.storagePath);
      const name = doc.fileName.toLowerCase();
      if (name.endsWith('.pdf')) { setViewer({ doc, kind: 'pdf', url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), highlights, fallbacks }); return; }
      if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) { setViewer({ doc, kind: 'image', url: URL.createObjectURL(blob), highlights, fallbacks }); return; }
      if (/\.(txt|md)$/.test(name)) { setViewer({ doc, kind: 'text', text: await blob.text(), highlights, fallbacks }); return; }
      if (/\.hwpx?$/.test(name)) {
        const { extractDocumentText } = await import('./extract');
        const { text } = await extractDocumentText(new File([blob], doc.fileName));
        setViewer({ doc, kind: 'text', text, highlights, fallbacks });
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

  const setDocs = (next: ProjectDocumentLink[]) => update({ ...project, documents: next });

  // 이 과제 전용으로 즉시 저장(목록에 바로 뜬다). share가 true면 공유 문서고에도 추가로 신청한다
  // (관리자 검토 후 다른 사용자에게도 노출 — 업로드 자체와는 별개라 신청만 실패해도 업로드는 유지).
  const uploadDocs = async (files: FileList | null, share: boolean) => {
    if (!files?.length) return;
    if (!registryEnabled()) { alert('로그인 후 이용할 수 있어요.'); return; }
    // 배열로 한 번에 복사해둔다 — input이 비동기 처리 중간에 초기화되면(호출부에서
    // e.target.value = '' 처리) 원본 FileList가 그 즉시 비어버려서, 나중에(await 이후)
    // files를 다시 읽으면 빈 배열이 된다. 그래서 공유 신청 쪽 docs가 조용히 빈 배열로
    // 전달돼 아무 것도 안 올라가는데 에러도 안 나는 문제가 있었다.
    const fileArray = [...files];
    setUploading(true);
    try {
      const added: ProjectDocumentLink[] = [];
      for (const file of fileArray) {
        const fileId = crypto.randomUUID();
        await storeProjectDocument(fileId, file);
        added.push({
          id: crypto.randomUUID(), kind: 'upload', fileId, fileName: file.name,
          documentType: guessDocumentType(file.name), title: file.name.replace(/\.[^./]+$/, ''),
          applicationType: 'REFERENCE', isConfirmed: false, createdAt: new Date().toISOString(),
        });
      }
      setDocs([...docs, ...added]);
      if (share) {
        try {
          const shareDocs = fileArray.map((file) => ({ file, documentType: guessDocumentType(file.name) }));
          await submitRegistryShare({ programName: project.programName ?? packFor(project).name, year: null, docs: shareDocs });
          refreshPending();
        } catch (shareError) { alert(`업로드는 됐지만 공유 신청에는 실패했습니다: ${shareError instanceof Error ? shareError.message : ''}`); }
      }
    } catch (error) { alert(`업로드에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
    finally { setUploading(false); }
  };

  const searchPrograms = async () => {
    if (!programQuery.trim()) return;
    setProgramSearching(true);
    try { setProgramResults(await searchRegistry(programQuery)); }
    catch (error) { alert(`검색에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
    finally { setProgramSearching(false); }
  };

  // 사업명을 고르면 그 사업의 문서 체크박스 목록을 불러온다. 과제가 아직 사업명에 연결돼
  // 있지 않으면(내장·AI추출 팩) 이 선택이 곧 그 연결이 된다.
  const pickProgram = async (entry: RegistryEntry) => {
    if (!projectRegistryId(project.packId) && !project.programRegistryId) update({ ...project, programRegistryId: entry.id });
    setCheckedDocIds(new Set());
    setLoadingProgramDocs(true);
    try { setProgramDocChecklist(await searchDocumentsByProgram(entry.id)); }
    catch (error) { alert(`불러오기에 실패했습니다: ${error instanceof Error ? error.message : ''}`); }
    finally { setLoadingProgramDocs(false); }
  };

  const toggleChecked = (id: string) => setCheckedDocIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const addCheckedDocs = () => {
    if (!programDocChecklist) return;
    const chosen = programDocChecklist.filter((doc) => checkedDocIds.has(doc.id) && !docs.some((d) => d.documentVersionId === doc.id));
    if (!chosen.length) return;
    const added: ProjectDocumentLink[] = chosen.map((doc) => ({
      id: crypto.randomUUID(), kind: 'link', documentVersionId: doc.id, storagePath: doc.storagePath,
      fileName: doc.fileName, title: doc.title, documentType: doc.documentType,
      applicationType: 'COMMON', isConfirmed: false, createdAt: new Date().toISOString(),
    }));
    setDocs([...docs, ...added]);
    setCheckedDocIds(new Set());
  };

  const toggleConfirm = (id: string) => setDocs(docs.map((item) => item.id === id ? { ...item, isConfirmed: !item.isConfirmed } : item));

  const removeDoc = async (link: ProjectDocumentLink) => {
    if (!confirm(`"${link.title}"을(를) 목록에서 삭제할까요?`)) return;
    if (link.kind === 'upload' && link.fileId) {
      try { await deleteProjectDocuments([link.fileId]); } catch { /* 파일 삭제 실패해도 목록에서는 제거 */ }
    }
    setDocs(docs.filter((item) => item.id !== link.id));
  };

  // 규칙의 출처(문서명·근거 문구)와 가장 잘 맞는 원본 문서를 찾는다 (QnA 근거→질의응답 파일, 조문 근거→지침 파일).
  const docForSource = (source: { doc?: string; ref?: string; matchLevel: string }): DocumentEntry | undefined =>
    linkedEntries.length ? matchDocToSource(linkedEntries, source) : undefined;

  return {
    docs, linkedEntries, pendingCount, viewer, closeViewer, viewDoc, downloadDoc, downloadAny, docForSource,
    uploading, uploadDocs, programQuery, setProgramQuery, programResults, programSearching, searchPrograms, pickProgram,
    programDocChecklist, loadingProgramDocs, checkedDocIds, toggleChecked, addCheckedDocs, toggleConfirm, removeDoc,
  };
}

function DocViewerModal({ source }: { source: ReturnType<typeof useSourceDocs> }) {
  const { viewer, closeViewer, downloadDoc } = source;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [markPos, setMarkPos] = useState({ index: 0, total: 0 });
  // n번째(1부터) 하이라이트로 이동하고 현재 위치를 진하게 표시한다. 끝에서 다음을 누르면 처음으로 순환.
  const gotoMark = (next: number) => {
    const marks = scrollRef.current?.querySelectorAll('mark');
    if (!marks?.length) return;
    const index = ((next - 1 + marks.length) % marks.length) + 1;
    marks.forEach((mark, i) => mark.classList.toggle('current', i === index - 1));
    marks[index - 1].scrollIntoView({ block: 'center' });
    setMarkPos({ index, total: marks.length });
  };
  useEffect(() => {
    if (!viewer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeViewer(); };
    window.addEventListener('keydown', onKey);
    // 렌더 후 하이라이트 개수를 세고 첫 근거 위치로 자동 스크롤
    setMarkPos({ index: 0, total: 0 });
    if (viewer.kind === 'text') {
      const timer = setTimeout(() => {
        const total = scrollRef.current?.querySelectorAll('mark').length ?? 0;
        if (total) gotoMark(1); else setMarkPos({ index: 0, total: 0 });
      }, 60);
      return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
    }
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);
  if (!viewer) return null;
  const isHwp = /\.hwpx?$/.test(viewer.doc.fileName.toLowerCase());
  // 확실한 근거(조문·수치·인용)가 문서에 있으면 그것만, 없으면 비목명·특징 단어로 2차 표시한다.
  const text = viewer.text ?? '';
  const primaryHit = viewer.kind === 'text' && anyTermMatches(text, viewer.highlights);
  const fallbackHit = viewer.kind === 'text' && !primaryHit && anyTermMatches(text, viewer.fallbacks);
  const activeTerms = primaryHit ? viewer.highlights : fallbackHit ? viewer.fallbacks : viewer.highlights;
  const highlighted = viewer.kind === 'text' && (!!viewer.highlights?.length || !!viewer.fallbacks?.length);
  return <div className="doc-viewer-overlay" onClick={closeViewer}>
    <div className="doc-viewer" role="dialog" aria-label={viewer.doc.fileName} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>{DOCUMENT_TYPE_LABEL[viewer.doc.documentType]}</strong><span>{viewer.doc.fileName}</span></div>
        <div className="viewer-actions"><button type="button" className="secondary" onClick={() => downloadDoc(viewer.doc)}><Download /> 원본 다운로드</button><button type="button" className="close" aria-label="닫기" onClick={closeViewer}>×</button></div></header>
      {viewer.kind === 'loading' && <div className="viewer-scroll"><p className="viewer-note">문서를 불러오는 중…</p></div>}
      {viewer.kind === 'pdf' && <iframe title={viewer.doc.fileName} src={viewer.url} />}
      {viewer.kind === 'image' && <div className="viewer-scroll"><img src={viewer.url} alt={viewer.doc.fileName} /></div>}
      {viewer.kind === 'text' && <div className="viewer-scroll" ref={scrollRef}>
        {highlighted && markPos.total > 0 && <div className="mark-nav">
          <span>근거 위치 <b>{markPos.index}</b> / {markPos.total}</span>
          <button type="button" className="secondary" onClick={() => gotoMark(markPos.index - 1)}>◀ 이전</button>
          <button type="button" className="secondary" onClick={() => gotoMark(markPos.index + 1)}>다음 ▶</button>
        </div>}
        <p className="viewer-note">텍스트 미리보기입니다{isHwp ? ' — 한글(HWP) 문서는 서식 없이 본문만 표시됩니다' : ''}.{highlighted ? (primaryHit ? ' 근거 부분이 빨간색으로 표시됩니다 — 위 이동 버튼으로 위치를 오갈 수 있어요.' : fallbackHit ? ' 정확한 근거 문구는 찾지 못해 규정의 항목명·특징 단어가 나오는 위치를 대신 표시했어요.' : ' 근거 문구를 이 문서에서 찾지 못했어요 — 다른 근거 문서일 수 있습니다.') : ''} 원본 서식은 "원본 다운로드"로 확인하세요.</p>
        <pre>{renderHighlighted(text, activeTerms)}</pre>
      </div>}
    </div>
  </div>;
}

type RefLink = (rule: { quote?: string; message?: string; item?: string; source: { doc: string; ref: string; matchLevel: string } }) => React.ReactNode;

// 계상 가능 세목 — 이름만 나열하면 "그 밖의 비용"처럼 무엇을 담는 세목인지 알 수 없다.
// 세목이 자기 인정 항목을 갖고 있으면 그것을 설명으로 함께 적는다.
// 증빙은 여기서 다루지 않는다 — 편성은 얼마를 잡을지 정하는 자리이고, 증빙은 집행 화면에서 챙긴다.
function SubItemChoiceList({ choices, canAddSub, onAddSub }: { choices: SubItemChoice[]; canAddSub: boolean; onAddSub: (name: string) => void }) {
  return <div className="sub-choices">{choices.map((choice) => <div className="sub-choice" key={choice.name}>
    <button type="button" disabled={!canAddSub} onClick={() => onAddSub(choice.name)}><Plus />{choice.name}</button>
    {choice.items?.length
      ? <span>{choice.items.join(' · ')}</span>
      : choice.note ? <span>{choice.note}</span> : null}
  </div>)}</div>;
}

// 비목 기준 사이드 패널 — 편성표 행의 "기준" 버튼으로 연다.
// 편성 화면에 규정을 길게 나열하지 않고, 궁금한 비목의 기준만 그 자리에서 펼쳐 본다.
// 블록은 네 가지로 고정: 상한(계산식) / 계상 가능 세목 / 인정 항목 / 주의 · 절차.
// 금액으로 계산할 수 없는 상한의 안내 문구 — 편성표의 "허용 상한" 칸과 기준 패널이 같은 말을 쓴다.
// 연구시설·장비비의 "구입가의 20% 이내"처럼 현물로 계상할 때만 걸리는 상한은, 현물이 없으면
// 적용 자체가 안 되므로 "직접 확인하세요"가 아니라 현물이 필요하다는 것을 알려줘야 한다.
const capHint = (cap: CategoryCap, inKindAmount: number, hasMatching: boolean): string => {
  if (cap.inKindOnly) {
    if (!hasMatching) return '현물로 계상할 때만 적용되는 상한이에요. 이 과제는 전액 지원금이라 현물 계상이 없어 해당하지 않습니다.';
    if (inKindAmount <= 0) return '현물로 계상할 때만 적용되는 상한이에요. 이 비목 현물이 0원이면 해당하지 않습니다 — 현물로 잡으려면 현물 칸에 금액을 넣으세요.';
    return `현물 ${formatWon(inKindAmount)}이 이 상한 안인지 직접 확인하세요. 기준 금액(구입가 등)이 편성표 밖이라 자동 계산할 수 없어요.`;
  }
  if (cap.partial) return '비목 전체가 아니라 세부항목 기준이라 자동 계산하지 않아요';
  return '편성표 밖 기준(구입가 등)이라 금액은 직접 확인하세요';
};

// 집행 시 유의사항 한 건. "인정 필요"라고만 적혀 있으면 무엇을 인정받아야 하는지 알 수 없어서,
// 같은 조항의 설명 문구를 함께 싣고 근거 조문 원문은 토글로 펼쳐 보게 한다.
// 근거 조문 원문을 접어서 보여주고, 그 안에서 이 항목이 가리키는 문단을 짚는다.
// 유의사항과 증빙이 같은 방식으로 근거를 펼쳐 보게 한다.
// 근거 번호가 조문 표에 없으면 아무것도 내놓지 않는다. 번호가 비슷한 조문을 대신 붙이면
// 간접비 증빙에 연구활동비 조문이 달린다 — 엉뚱한 근거는 없는 것만 못하다.
function ArticleToggle({ pack, refText, phrase, label = '근거 조문 보기' }: { pack: RulePack; refText: string; phrase: string | string[]; label?: string }) {
  const articles = findArticles(pack, refText)?.articles ?? [];
  const located = articles.map((article) => ({ article, ...markArticleParagraphs(article.text, phrase) }));
  // 규정DB에 원문이 안 실린 근거가 있다 (팁스 '비목별 증빙서류' 표 등) — 근거 번호만 밝힌다.
  if (!located.length) return <span className="caution-ref">근거 {refText} <em>원문 미수록</em></span>;
  const markedCount = located.reduce((total, entry) => total + entry.marked.size, 0);
  return <details className="caution-article">
    <summary>{label} <em>{refText}{markedCount ? ' · 해당 문단 표시' : ''}</em></summary>
    {located.map(({ article, paragraphs, marked, terms }) => <div key={article.key}>
      <b>{article.ref}{article.title ? ` ${article.title}` : ''}</b>
      <pre>{paragraphs.map((paragraph, index) => <span key={index} className={marked.has(index) ? 'hit' : undefined}>
        {marked.has(index) ? renderHighlighted(paragraph, terms) : paragraph}{index < paragraphs.length - 1 ? '\n' : ''}
      </span>)}</pre>
    </div>)}
  </details>;
}

function CautionCard({ item, pack }: { item: CautionItem; pack: RulePack }) {
  return <div className={`caution ${item.kind}`}>
    <div className="caution-head">
      {item.kind === 'approval' ? <ShieldCheck /> : <AlertCircle />}
      <div>
        <strong>{item.title}</strong>
        {item.status && <em className="tag warn">{item.status}</em>}
        {item.detail && <p>{item.detail}</p>}
      </div>
    </div>
    <ArticleToggle pack={pack} refText={item.ref} phrase={`${item.title} ${item.detail ?? ''}`} />
  </div>;
}

interface StandardPanelProps {
  category: PackCategory;
  reference: PackCategory | null;   // 공고 팩에 기준이 없을 때 이름으로 찾은 공통 규정 비목
  referenceDoc?: string;
  cap: CategoryCap | null;
  amount: number;
  inKindAmount: number;   // 이 비목에 현물로 잡은 금액 — 현물 전용 상한 안내에 쓴다
  hasMatching: boolean;   // 민간부담금이 있어 현물 계상이 가능한 과제인지
  choices: SubItemChoices;              // 계상 가능 세목 (이 사업 기준 + 상위 규정 기준)
  baseStandard: ReferenceStandard | null; // 이 사업이 따르는 상위 규정의 같은 비목 기준
  baseRules: PackRule[];                  // 그 상위 규정 팩의 이 비목 규칙 (주의사항 상속용)
  min: CategoryMin | null;
  rules: PackRule[];
  refLink: RefLink;
  onAddSub: (name: string) => void;
  canAddSub: boolean;
  onClose: () => void;
}

function StandardPanel({ category, reference, referenceDoc, cap, amount, inKindAmount, hasMatching, choices, baseStandard, baseRules, min, rules, refLink, onAddSub, canAddSub, onClose }: StandardPanelProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // 공고 팩에 기준이 없으면 공통 규정 비목의 것을 대신 보여준다 (출처는 헤더에 표시).
  const std = reference ?? category;
  const subOptions = [...choices.own, ...choices.base];
  const limitText = category.limitText ?? std.limitText;
  const limitDetail = category.limitDetailText ?? std.limitDetailText;
  const warnings = rules.filter((rule) => rule.kind === 'warning');
  const approvals = category.approvals ?? std.approvals ?? [];
  const evidenceRules = category.evidenceRules ?? std.evidenceRules ?? [];
  const applicability = category.applicability ?? std.applicability ?? [];
  const cautions = warnings.length + approvals.length + evidenceRules.length;
  return <aside className="standard-panel" role="dialog" aria-label={`${category.name} 기준`}>
    <header>
      <div><strong>{category.name}</strong><span>{reference ? `${referenceDoc} 기준 참고` : '이 사업 공고 기준'}</span></div>
      <button type="button" className="close" aria-label="기준 닫기" onClick={onClose}>×</button>
    </header>
    <div className="panel-body">
      {reference && <p className="panel-note"><BookOpenCheck /><span>이 사업 공고에 세부 기준이 없어 <b>{referenceDoc}</b>의 「{reference.name}」 기준을 보여드려요. 공고·협약이 따로 정한 내용이 있으면 그쪽이 우선합니다.</span></p>}

      <section className="panel-block">
        <h4>상한</h4>
        {cap?.amount != null
          ? <div className="panel-cap">
              <strong>{formatWon(cap.amount)}</strong>
              <small>{cap.basisLabel} {formatWon(cap.basisAmount!)} × {cap.limitPct}%</small>
              <small className="panel-cap-formula">{basisFormula(cap.basisParts)}</small>
              <small className={amount > cap.amount ? 'over' : 'ok'}>현재 {formatWon(amount)} — {amount > cap.amount ? `${formatWon(amount - cap.amount)} 초과` : `여유 ${formatWon(cap.amount - amount)}`}</small>
            </div>
          : cap?.referenceAmount != null
          ? <div className="panel-cap">
              <strong className="cap-partial">{formatWon(cap.referenceAmount)}</strong>
              <small>{cap.basisLabel} {formatWon(cap.basisAmount!)} × {cap.limitPct}%</small>
              <small className="panel-cap-formula">{basisFormula(cap.basisParts)}</small>
              <small>{cap.rule.item}에 걸리는 상한 — 비목 전체가 아니라 이 세목 합계를 이 금액 안에서 잡으세요.</small>
            </div>
          : cap
          ? <p className="panel-line">{cap.label}<em>{capHint(cap, inKindAmount, hasMatching)}</em></p>
          : limitText
          ? <p className="panel-line">{limitText}{limitDetail ? <em>{limitDetail}</em> : null}</p>
          : <p className="panel-line muted">별도 상한 없음</p>}
        {min && <p className="panel-line ok-line"><Check /> {min.label}</p>}
        {(limitText || limitDetail) && cap?.basisAmount != null && <p className="panel-line muted">{limitText}{limitDetail ? ` — ${limitDetail}` : ''}</p>}
        <p className="panel-ref">근거 {refLink({ item: category.name, message: limitDetail ?? limitText ?? category.name, source: category.limitSource ?? std.limitSource ?? category.source })}</p>
      </section>

      {/* 세목마다 무엇을 쓸 수 있는지 함께 적는다. 예전에는 이 아래에 "인정 항목"을 따로 나열했는데,
          비목의 인정 항목은 세목별 항목을 평평하게 합친 것이라(연구활동비 71건) 회의비와
          "회의장 임차료"가 같은 층에 놓여 읽을 수 없었다. 세목 아래로 접어 넣는다. */}
      {subOptions.length > 0 && <section className="panel-block">
        <h4>계상 가능 세목 <b>{subOptions.length}</b></h4>
        <SubItemChoiceList choices={choices.own} canAddSub={canAddSub} onAddSub={onAddSub} />
        {choices.base.length > 0 && <>
          <p className="panel-note sub"><BookOpenCheck /><span>공고가 따로 정하지 않은 항목은 <b>{choices.basePack!.guideline}</b>을 따릅니다.</span></p>
          <SubItemChoiceList choices={choices.base} canAddSub={canAddSub} onAddSub={onAddSub} />
        </>}
      </section>}

      {cautions > 0 && <section className="panel-block caution">
        <h4>주의 · 절차 <b>{cautions}</b></h4>
        {approvals.map((item, index) => <p key={`av${index}`} className="allowed-item conditional"><ShieldCheck /><span><b>{item.name}</b><em className="tag warn">{item.status}</em> {refLink({ item: category.name, message: item.name, source: item.source })}</span></p>)}
        {evidenceRules.map((item, index) => <p key={`ev${index}`} className="allowed-item"><FileCheck2 /><span><b>{item.name}</b> {item.documents.join(' · ')} {refLink({ item: category.name, message: item.name, source: item.source })}</span></p>)}
        {warnings.map((rule) => <p key={rule.id} className="allowed-item conditional"><AlertCircle /><span>{rule.message} {refLink(rule)}</span></p>)}
      </section>}

      {/* 공고·지침은 자기가 따로 정한 것만 담는다 — 디딤돌처럼 주의·절차를 아예 안 적은 팩은
          이 블록이 통째로 비어 버린다. 인정 항목과 똑같이 상위 규정에서 마저 가져와 출처를 밝혀 보여준다. */}
      {(() => {
        if (!baseStandard) return null;
        const ownNames = new Set([...approvals.map((item) => item.name), ...evidenceRules.map((item) => item.name)]);
        const ownMessages = new Set(warnings.map((rule) => rule.message));
        const baseApprovals = (baseStandard.category.approvals ?? []).filter((item) => !ownNames.has(item.name));
        const baseEvidence = (baseStandard.category.evidenceRules ?? []).filter((item) => !ownNames.has(item.name));
        const baseWarnings = baseRules.filter((rule) => rule.kind === 'warning' && !ownMessages.has(rule.message));
        const total = baseApprovals.length + baseEvidence.length + baseWarnings.length;
        if (!total) return null;
        return <section className="panel-block caution">
          <h4>{baseStandard.pack.guideline} 주의 · 절차 <b>{total}</b></h4>
          <p className="panel-note sub"><BookOpenCheck /><span>이 사업 공고·지침이 따로 정하지 않은 부분은 이 기준을 따릅니다.</span></p>
          {baseApprovals.map((item, index) => <p key={`bav${index}`} className="allowed-item conditional"><ShieldCheck /><span><b>{item.name}</b><em className="tag warn">{item.status}</em> {refLink({ item: category.name, message: item.name, source: item.source })}</span></p>)}
          {baseEvidence.map((item, index) => <p key={`bev${index}`} className="allowed-item"><FileCheck2 /><span><b>{item.name}</b> {item.documents.join(' · ')} {refLink({ item: category.name, message: item.name, source: item.source })}</span></p>)}
          {baseWarnings.map((rule) => <p key={`bw${rule.id}`} className="allowed-item conditional"><AlertCircle /><span>{rule.message} {refLink(rule)}</span></p>)}
        </section>;
      })()}

      {(() => {
        // 기관 적용 조건도 마찬가지 — 이 사업이 안 적었으면 상위 규정 것을 쓴다.
        const inherited = !applicability.length && !!baseStandard?.category.applicability?.length;
        const shown = inherited ? baseStandard!.category.applicability! : applicability;
        if (!shown.length) return null;
        return <section className="panel-block">
          <h4>기관 적용 조건{inherited ? ` — ${baseStandard!.pack.guideline}` : ''}</h4>
          {shown.map((rule, index) => <p key={`ap${index}`} className={`allowed-item ${rule.applies ? '' : 'other-scope'}`}>
            <Building2 /><span><b>{rule.scopeKo}</b>{rule.applies ? '' : ' (이 과제 유형은 해당 없음)'} {rule.condition} — <b>{rule.result}</b> {refLink({ item: category.name, message: rule.condition, source: rule.source })}</span>
          </p>)}
        </section>;
      })()}
    </div>
  </aside>;
}

// 규정 DB의 조문 원문 팝업. 근거 링크를 누르면 원본 파일을 열지 않고도 그 조문을 바로 볼 수 있다
// (HWP 본문에는 자동 매긴 조문 번호가 빠져 있어 원본 검색이 자주 실패한다).
// 원본 문서가 연결돼 있으면 여기서 "원본 문서에서 보기"로 이어간다.
function ArticleModal({ articles, ref: refText, doc, onClose, onOpenDoc }: { articles: PackArticle[]; ref: string; doc: string; onClose: () => void; onOpenDoc?: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="doc-viewer-overlay" onClick={onClose}>
    <div className="doc-viewer" role="dialog" aria-label={`근거 조문 ${refText}`} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>근거 조문 원문 · {refText}</strong><span>{doc}</span></div>
        <div className="viewer-actions">
          {onOpenDoc && <button type="button" className="secondary" onClick={onOpenDoc}><FileText /> 원본 문서에서 보기</button>}
          <button type="button" className="close" aria-label="닫기" onClick={onClose}>×</button>
        </div></header>
      <div className="viewer-scroll article-view">
        <p className="viewer-note">규정 DB에 보관된 조문 원문입니다. 개정 시점에 따라 최신 원문과 다를 수 있으니 중요한 판단은 원본 문서로 확인하세요.</p>
        {articles.map((article) => <article key={article.key}>
          <h4>{article.ref}{article.title ? ` (${article.title})` : ''}</h4>
          <pre>{article.text}</pre>
        </article>)}
      </div>
    </div>
  </div>;
}

function SourceDocsPanel({ source }: { source: ReturnType<typeof useSourceDocs> }) {
  if (!registryEnabled()) return null;
  const {
    docs, linkedEntries, pendingCount, viewDoc, downloadAny, uploading, uploadDocs,
    programQuery, setProgramQuery, programResults, programSearching, searchPrograms, pickProgram,
    programDocChecklist, loadingProgramDocs, checkedDocIds, toggleChecked, addCheckedDocs,
    toggleConfirm, removeDoc,
  } = source;
  const [share, setShare] = useState(false);
  const openDoc = (link: ProjectDocumentLink) => {
    if (link.kind === 'link') {
      const entry = linkedEntries.find((e) => e.id === link.documentVersionId);
      if (entry) { viewDoc(entry); return; }
    }
    downloadAny(link);
  };
  return <section className="panel source-docs">
    <div className="panel-head">
      <div><h3><FileText /> 근거 원본 문서</h3><p>이 과제의 근거 자료입니다. 직접 올리거나, 사업명을 검색해 공유 문서고에서 불러올 수 있어요.</p></div>
    </div>
    {/* 파일 선택 즉시 업로드가 시작되므로, 공유 체크는 반드시 업로드 "전에" 눌러야 한다 —
        순서를 놓치기 쉬워서 별도 안내 박스로 눈에 띄게 분리했다. */}
    <div className="notice" style={{ margin: '0 22px 14px' }}>
      <CloudUpload />
      <div>
        <strong>다른 사람과도 공유하려면 순서가 중요해요</strong>
        <span>① "공유" 체크 → ② "문서 업로드" 클릭 — 이 순서로 눌러야 관리자 검토 후 공유돼요. 업로드부터 하면 이 과제에만 저장되고 공유되지 않아요.</span>
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, padding: '0 22px 14px', flexWrap: 'wrap' }}>
      <label className="share-toggle" style={{ padding: 0 }}><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span><b>① 공유</b> — 다른 사용자와도 공유(관리자 검토 후)</span></label>
      <label className="upload-button"><Upload /> {uploading ? '업로드 중…' : '② 문서 업로드'}<input type="file" multiple disabled={uploading} accept=".pdf,.hwp,.hwpx,.txt,.md,image/*" onChange={(e) => { uploadDocs(e.target.files, share); e.target.value = ''; }} /></label>
    </div>
    {pendingCount > 0 && <p className="doc-empty">내가 올린 공유 신청 중 검토 대기 중인 것이 {pendingCount}건 있어요.</p>}

    <div className="admin-card-fields">
      <p className="wiz-hint">사업명을 검색하면 공유 문서고에 등록된 문서를 체크박스로 골라 불러올 수 있어요.</p>
      <div className="search-row"><input value={programQuery} onChange={(e) => setProgramQuery(e.target.value)} placeholder="사업명 검색" onKeyDown={(e) => { if (e.key === 'Enter') searchPrograms(); }} /><button type="button" className="secondary" onClick={searchPrograms} disabled={programSearching}>{programSearching ? '검색 중…' : '검색'}</button></div>
      {programResults && (programResults.length ? <div className="source-doc-list">{programResults.map((entry) => <div className="source-doc-row" key={entry.id}>
        <button type="button" onClick={() => pickProgram(entry)}><FileText /><span><strong>{entry.programName}</strong><small>{entry.year ?? ''}</small></span></button>
      </div>)}</div> : <p className="doc-empty">검색 결과가 없어요.</p>)}
      {loadingProgramDocs && <p className="doc-empty">불러오는 중…</p>}
      {programDocChecklist && !loadingProgramDocs && (programDocChecklist.length ? <>
        <div className="source-doc-list">{programDocChecklist.map((doc) => {
          const already = docs.some((d) => d.documentVersionId === doc.id);
          return <label key={doc.id} className="share-toggle">
            <input type="checkbox" disabled={already} checked={already || checkedDocIds.has(doc.id)} onChange={() => toggleChecked(doc.id)} />
            <span><strong>{DOCUMENT_TYPE_LABEL[doc.documentType]}</strong> {doc.title}{doc.versionLabel ? ` · ${doc.versionLabel}` : ''}{already ? ' · 이미 추가됨' : ''}</span>
          </label>;
        })}</div>
        <button type="button" className="secondary" disabled={checkedDocIds.size === 0} onClick={addCheckedDocs}>선택한 문서 추가 ({checkedDocIds.size})</button>
      </> : <p className="doc-empty">이 사업에 등록된 문서가 없어요.</p>)}
    </div>

    {docs.length === 0 ? <p className="doc-empty">아직 등록된 문서가 없어요. 위에서 업로드하거나 사업명을 검색해 불러와보세요.</p> : <div className="source-doc-list">
      {docs.map((link) => <div className="source-doc-row" key={link.id}>
        <button type="button" onClick={() => openDoc(link)}>
          <FileText /><span><strong>{DOCUMENT_TYPE_LABEL[(link.documentType as DocumentType) ?? 'OTHER']}</strong><small>{link.title} · {link.kind === 'link' ? '공유 문서' : '이 과제 전용'}{link.isConfirmed ? ' · 적용 확정' : ''}</small></span>
          {link.kind === 'link' ? <Eye /> : <Download />}
        </button>
        <button type="button" className="secondary" onClick={() => toggleConfirm(link.id)}>{link.isConfirmed ? '확정 해제' : '적용 확정'}</button>
        <button type="button" className="danger-button" onClick={() => removeDoc(link)}><Trash2 /> 삭제</button>
      </div>)}
    </div>}
    <DocViewerModal source={source} />
  </section>;
}

// ---- 예산 구성 도넛 ----
// 색은 비목의 "팩 내 순서"에 고정 배정한다(금액 순위가 아니라) — 금액이 바뀌어도 비목 색이 따라 바뀌지 않는다.
// 색 슬롯은 8개까지: 9번째 이후 비목은 회색 "기타"로 묶는다 (색을 더 만들면 색약 구분이 깨진다).
// 팔레트는 색약 시뮬레이션 검증을 통과한 순서 그대로다 — 순서를 바꾸면 인접 조각 구분이 깨진다.
const CAT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const COMP_SLOTS = CAT_COLORS.length;
const ETC_COLOR = '#8f98a9';
const FREE_COLOR = '#e4e9f1';

function BudgetComposition({ pack, project, cats, bases }: { pack: RulePack; project: Project; cats: PackCategory[]; bases: BudgetBasis[] }) {
  const slotOf = new Map(pack.categories.filter((c) => c.allowed).map((c, i) => [c.id, i]));
  const entries = cats
    .map((cat) => ({ cat, amount: project.budgets.find((b) => b.categoryId === cat.id)?.amount ?? 0, slot: slotOf.get(cat.id) ?? COMP_SLOTS }))
    .filter((e) => e.amount > 0);
  const planned = entries.reduce((sum, e) => sum + e.amount, 0);
  // 상한 계산의 기준 금액은 도넛과 같은 자리에 둔다 — 편성 금액을 옮길 때 함께 보는 숫자다.
  // 아직 아무것도 편성하지 않아 도넛을 그릴 수 없어도 기준 금액은 보여준다.
  const basisBlock = bases.length === 0 ? null : <div className="basis-strip">
    <span className="basis-title">상한 계산의 기준 금액</span>
    <div className="basis-items">{bases.map((basis) => <div className="basis-item" key={basis.basis} title={basis.basis}>
      <span>{basis.label}</span>
      <strong>{formatWon(basis.amount)}</strong>
      {/* 계산식을 보여줘야 "왜 이 금액이 안 움직이지"가 풀린다 — 직접비 기준은 간접비·위탁을 바꿔야 움직인다. */}
      <small className="basis-formula">{basis.formula}</small>
      <small>{basis.categories.join(' · ')} 상한의 기준</small>
    </div>)}</div>
    <p className="basis-note">계산식에 있는 비목의 편성 금액을 바꿔야 기준 금액이 움직입니다. 이름 위에 마우스를 올리면 규정 문구 그대로 볼 수 있어요.</p>
  </div>;
  if (!project.totalBudget || planned === 0) return basisBlock && <div className="budget-comp">{basisBlock}</div>;
  const folded = entries.filter((e) => e.slot >= COMP_SLOTS);
  const foldedSum = folded.reduce((sum, e) => sum + e.amount, 0);
  const free = Math.max(0, project.totalBudget - planned);
  const share = (value: number) => (value / project.totalBudget * 100).toFixed(1);
  const slices = [
    ...entries.filter((e) => e.slot < COMP_SLOTS).map((e) => ({ key: e.cat.id, name: e.cat.name, amount: e.amount, color: CAT_COLORS[e.slot] })),
    ...(foldedSum > 0 ? [{ key: '__etc', name: `기타 ${folded.length}개 비목`, amount: foldedSum, color: ETC_COLOR }] : []),
    ...(free > 0 ? [{ key: '__free', name: '미편성 잔액', amount: free, color: FREE_COLOR }] : []),
  ];
  // 편성이 총사업비를 넘으면 눈금을 편성 합계로 키워 넘친 만큼이 원에 그대로 보이게 한다.
  const scale = Math.max(project.totalBudget, planned);
  // 도넛은 원둘레를 stroke-dasharray로 잘라 그린다. 조각 사이 2px 틈을 둬 인접 색이 붙지 않게 한다.
  const R = 46;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = s.amount / scale * CIRC;
    const draw = Math.max(len - 2, 0.6);
    const arc = { ...s, draw, offset };
    offset += len;
    return arc;
  });
  return <div className="budget-comp">
    <figure className="donut-figure">
      <svg viewBox="0 0 120 120" role="img" aria-label={`비목별 편성 구성 — 편성 합계 ${formatWon(planned)} / 총사업비 ${formatWon(project.totalBudget)}`}>
        <g transform="rotate(-90 60 60)">
          {arcs.map((a) => <circle key={a.key} cx="60" cy="60" r={R} fill="none" stroke={a.color} strokeWidth="17"
            strokeDasharray={`${a.draw} ${CIRC - a.draw}`} strokeDashoffset={-a.offset}>
            <title>{`${a.name} ${formatWon(a.amount)} (총사업비의 ${share(a.amount)}%)`}</title>
          </circle>)}
        </g>
        <text x="60" y="55" textAnchor="middle" className="donut-label">편성 합계</text>
        <text x="60" y="70" textAnchor="middle" className="donut-value">{(planned / 100_000_000).toFixed(planned >= 1_000_000_000 ? 0 : 1)}억</text>
      </svg>
      <figcaption>총사업비 {formatWon(project.totalBudget)} 기준</figcaption>
    </figure>
    <div className="comp-legend">
      {slices.map((s) => <span className="comp-chip" key={s.key}><i className="dot" style={{ background: s.color }} /><b>{s.name}</b><span>{formatWon(s.amount)} · {share(s.amount)}%</span></span>)}
      {planned > project.totalBudget && <span className="comp-chip over"><AlertCircle /><b>총사업비 초과</b><span>{formatWon(planned - project.totalBudget)}</span></span>}
    </div>
    {basisBlock}
  </div>;
}

// ---- 참여인력 · 인건비 산정 패널 (예산 편성 화면) ----
// 참여율 점검과 인건비(4대보험·퇴직금) 자동 계산을 한 뒤 "예산 편성에 반영"으로 인건비 비목을 채운다.
function ParticipantsPanel({ project, update }: { project: Project; update: (p: Project) => void }) {
  const pack = packFor(project);
  const [person, setPerson] = useState('');
  const addPerson = (e: React.FormEvent) => { e.preventDefault(); if (!person.trim()) return; update({ ...project, participants: [...project.participants, { id: uid(), name: person.trim(), projectRate: 0, externalRate: 0 }] }); setPerson(''); };
  const setRate = (id: string, key: 'projectRate' | 'externalRate', value: number) => update({ ...project, participants: project.participants.map((p) => p.id === id ? { ...p, [key]: Math.max(0, value) } : p) });
  const removePerson = (p: Participant) => {
    if (!confirm(`참여 인력 "${p.name}"을(를) 삭제할까요?`)) return;
    update({ ...project, participants: project.participants.filter((x) => x.id !== p.id) });
  };
  const insRate = project.insuranceRate ?? DEFAULT_INSURANCE_RATE;
  const includeInsurance = project.laborIncludeInsurance ?? true;
  const includeSeverance = project.laborIncludeSeverance ?? true;
  const laborOpts = { startDate: project.startDate, endDate: project.endDate, insuranceRate: insRate, includeInsurance, includeSeverance };
  const setP = (id: string, patch: Partial<Participant>) => update({ ...project, participants: project.participants.map((p) => p.id === id ? { ...p, ...patch } : p) });
  const laborSum = (type: 'existing' | 'new') => project.participants
    .filter((p) => (p.laborType ?? 'existing') === type)
    .reduce((acc, p) => { const c = laborCostFor(p, laborOpts); return { total: acc.total + c.total, cash: acc.cash + c.cash, inKind: acc.inKind + c.inKind }; }, { total: 0, cash: 0, inKind: 0 });
  const sumExisting = laborSum('existing');
  const sumNew = laborSum('new');
  const [reflected, setReflected] = useState(false);
  // 기존/신규 인건비 합계를 예산 편성의 해당 비목에 반영한다. 비목 이름으로 찾는다:
  // "기존인력 인건비"/"신규인력 인건비"가 있으면 각각, 없으면 일반 "인건비" 비목에 합산.
  const reflectToBudget = () => {
    const norm = (text: string) => text.replace(/\s/g, '');
    const existingCat = pack.categories.find((c) => /기존/.test(norm(c.name)) && /인건비|인력/.test(norm(c.name)));
    const newCat = pack.categories.find((c) => /신규/.test(norm(c.name)) && /인건비|인력/.test(norm(c.name)));
    const genericCat = pack.categories.find((c) => /인건비/.test(norm(c.name)) && c.id !== existingCat?.id && c.id !== newCat?.id);
    const totals = new Map<string, { name: string; amount: number; inKind: number; parts: string[] }>();
    const assign = (cat: PackCategory | undefined, sum: { total: number; inKind: number }, label: string): boolean => {
      if (!cat) return false;
      const entry = totals.get(cat.id) ?? { name: cat.name, amount: 0, inKind: 0, parts: [] };
      entry.amount += sum.total; entry.inKind += sum.inKind; entry.parts.push(label);
      totals.set(cat.id, entry);
      return true;
    };
    const okExisting = sumExisting.total === 0 || assign(existingCat ?? genericCat, sumExisting, '기존인력');
    const okNew = sumNew.total === 0 || assign(newCat ?? genericCat, sumNew, '신규인력');
    if (totals.size === 0) { alert('반영할 인건비가 없거나 이 규정 팩에서 인건비 비목을 찾지 못했어요. 월급여·참여기간 입력과 비목 구성을 확인해주세요.'); return; }
    const missed = [!okExisting && '기존인력', !okNew && '신규인력'].filter(Boolean).join(', ');
    const lines = [...totals.values()].map((t) => `· ${t.name} ← ${t.parts.join(' + ')} 합계 ${formatWon(t.amount)} (현금 ${formatWon(t.amount - t.inKind)} · 현물 ${formatWon(t.inKind)})`).join('\n');
    if (!confirm(`예산 편성에 반영할까요? 아래 비목의 기존 편성 금액(현금·현물 포함)은 대체됩니다.\n${lines}${missed ? `\n(${missed} 인건비는 맞는 비목이 없어 반영하지 않았어요.)` : ''}`)) return;
    const budgets = [...project.budgets];
    for (const [id, t] of totals) {
      const idx = budgets.findIndex((b) => b.categoryId === id);
      if (idx >= 0) budgets[idx] = { ...budgets[idx], amount: t.amount, inKindAmount: t.inKind || undefined };
      else budgets.push({ categoryId: id, amount: t.amount, inKindAmount: t.inKind || undefined });
    }
    update({ ...project, budgets });
    setReflected(true); setTimeout(() => setReflected(false), 3000);
  };
  // 계상 구분(현물 → 혼합 → 현금)별로 묶어 보여준다. 같은 구분 안에서는 등록 순서를 유지한다.
  const fundingKindOf = (p: Participant): 'inkind' | 'mixed' | 'cash' => p.laborFunding ?? (p.laborInKind != null ? 'mixed' : 'cash');
  const KIND_ORDER = { inkind: 0, mixed: 1, cash: 2 } as const;
  const KIND_LABEL = { inkind: '현물 계상', mixed: '혼합 계상 (현금+현물)', cash: '현금 계상' } as const;
  const sortedParticipants = [...project.participants].sort((a, b) => KIND_ORDER[fundingKindOf(a)] - KIND_ORDER[fundingKindOf(b)]);
  return <section className="panel participants-panel">
    <div className="panel-head"><div><span className="section-kicker">STEP 1 · 인건비 산정</span><h3>참여인력 · 참여율 · 인건비</h3><p>인력을 등록하고 인건비(4대보험·퇴직금 자동 계산)를 산출한 뒤, 아래 비목별 편성에 바로 반영하세요. 계상 구분(현물/현금)별로 묶어 보여드려요.</p></div></div>
    {/* 인력 한 명이 카드 하나를 차지하면 몇 명만 넣어도 편성표가 화면 밖으로 밀린다.
        한 명 = 한 줄로 두고, 계산식처럼 늘 볼 필요 없는 것은 합계 칸 툴팁으로 넘긴다. */}
    <div className="labor-table"><div className="labor-head">
      <span>인력</span><span>구분</span><span>참여 기간</span><span>월급여</span><span>참여율 (현재 / 타 과제)</span><span>계상 구분</span><span>인건비 합계</span><span />
    </div>{sortedParticipants.map((p, index) => {
      const total = p.projectRate + p.externalRate; const over = total > 100;
      const cost = laborCostFor(p, laborOpts); const kind = fundingKindOf(p);
      const hasSeverance = severanceApplies(p, includeSeverance);
      const showGroup = index === 0 || fundingKindOf(sortedParticipants[index - 1]) !== kind;
      const calc = `월급여 ${formatWon(cost.pay)}${includeInsurance ? ` + 4대보험 ${formatWon(cost.insurance)}` : ''}${hasSeverance ? ` + 퇴직금 ${formatWon(cost.severance)}` : ' (퇴직금 미계상)'} → 월 ${formatWon(cost.monthly)} (참여율 ${p.projectRate}% 적용) × ${cost.months}개월 = 합계 ${formatWon(cost.total)}`;
      return <Fragment key={p.id}>
        {showGroup && <div className="labor-group"><b>{KIND_LABEL[kind]}</b><span>{sortedParticipants.filter((x) => fundingKindOf(x) === kind).length}명</span></div>}
        <div className={over ? 'labor-row over' : 'labor-row'}>
          <div className="labor-person"><div className="avatar">{p.name[0]}</div><strong>{p.name}</strong></div>
          <select aria-label={`${p.name} 기존/신규 구분`} value={p.laborType ?? 'existing'} onChange={(e) => setP(p.id, { laborType: e.target.value as 'existing' | 'new' })}><option value="existing">기존인력</option><option value="new">신규인력</option></select>
          <div className="labor-period">
            <input type="date" aria-label={`${p.name} 참여 시작일`} value={p.laborStart ?? project.startDate} onChange={(e) => setP(p.id, { laborStart: e.target.value })} />
            <input type="date" aria-label={`${p.name} 참여 종료일`} value={p.laborEnd ?? project.endDate} onChange={(e) => setP(p.id, { laborEnd: e.target.value })} />
          </div>
          <div className="labor-pay">
            <label className="money-input"><input inputMode="numeric" aria-label={`${p.name} 월급여`} value={withCommas(String(p.monthlyPay ?? ''))} placeholder="0" onChange={(e) => setP(p.id, { monthlyPay: Number(digitsOnly(e.target.value)) || undefined })} /><b>원</b></label>
            <label className="labor-sev" title="1년 이상 근무자만 퇴직금을 포함할 수 있어요 (월급여의 1/12)"><input type="checkbox" aria-label={`${p.name} 퇴직금 포함`} checked={hasSeverance} onChange={(e) => setP(p.id, { includeSeverance: e.target.checked })} /><span>퇴직금 포함</span></label>
          </div>
          <div className="labor-rates">
            <label><input aria-label={`${p.name} 현재 과제 참여율`} type="number" min="0" value={p.projectRate} onChange={(e) => setRate(p.id, 'projectRate', Number(e.target.value))} /><b>%</b></label>
            <label><input aria-label={`${p.name} 타 과제 참여율`} type="number" min="0" value={p.externalRate} onChange={(e) => setRate(p.id, 'externalRate', Number(e.target.value))} /><b>%</b></label>
            <b className={over ? 'sum over' : 'sum'}>{total}%</b>
          </div>
          <div className="labor-fund">
            <select aria-label={`${p.name} 인건비 계상 구분`} value={kind} onChange={(e) => setP(p.id, { laborFunding: e.target.value as Participant['laborFunding'] })}><option value="cash">현금 (전액)</option><option value="inkind">현물 (전액)</option><option value="mixed">혼합</option></select>
            {kind === 'mixed' && <label className="money-input" title="합계 인건비 중 현물로 계상할 금액"><input inputMode="numeric" aria-label={`${p.name} 현물 계상액`} value={withCommas(String(p.laborInKind ?? ''))} placeholder="현물 0" onChange={(e) => setP(p.id, { laborInKind: Number(digitsOnly(e.target.value)) || undefined })} /><b>원</b></label>}
          </div>
          {/* 계산식은 매번 읽을 것이 아니라 "왜 이 금액이지" 할 때만 필요하다 — 합계 칸에 올리면 보인다. */}
          <div className="labor-total" title={calc}>
            <strong>{formatWon(cost.total)}</strong>
            <small>현금 {formatWon(cost.cash)} · 현물 {formatWon(cost.inKind)}</small>
            <small className="labor-basis">월 {formatWon(cost.monthly)} × {cost.months}개월</small>
          </div>
          <button type="button" className="person-remove" aria-label={`${p.name} 삭제`} onClick={() => removePerson(p)}><Trash2 /></button>
        </div>
        {over && <p className="labor-warn"><AlertCircle /> 참여율 합산이 100%를 초과했습니다. 100% 이하로 조정해주세요.</p>}
      </Fragment>;
    })}</div>
    <form className="person-add" onSubmit={addPerson}><input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="새 참여 인력 이름" /><button className="secondary" type="submit"><Plus /> 인력 추가</button></form>
    {project.participants.length === 0 && <div className="inline-warning"><AlertCircle /> 참여율 데이터가 없어 초과 경고가 작동하지 않습니다. 참여 인력을 추가해주세요.</div>}
    {project.participants.length > 0 && <div className="labor-summary">
      {/* 합계는 표를 다 읽고 나서 바로 눈이 가는 자리(표 바로 아래)에 둔다 —
          4대보험·퇴직금 설정 밑으로 내려가면 인력을 고칠 때마다 시선이 화면 끝까지 내려가야 한다. */}
      <div className="labor-sum-row"><span>기존인력 인건비 합계</span><strong>{formatWon(sumExisting.total)}</strong><small>현금 {formatWon(sumExisting.cash)} · 현물 {formatWon(sumExisting.inKind)}</small></div>
      <div className="labor-sum-row"><span>신규인력 인건비 합계</span><strong>{formatWon(sumNew.total)}</strong><small>현금 {formatWon(sumNew.cash)} · 현물 {formatWon(sumNew.inKind)}</small></div>
      <div className="labor-toggles">
        <label className="share-toggle"><input type="checkbox" checked={includeInsurance} onChange={(e) => update({ ...project, laborIncludeInsurance: e.target.checked })} /><span><strong>4대보험 포함</strong> — 사업별 계상 기준에 따라</span></label>
        {/* 단위(%)는 입력칸 뒤에 둔다 — "요율(%) [11]"보다 "요율 [11] %"가 읽는 순서와 같다. */}
        {includeInsurance && <label className="labor-rate">요율<input aria-label="4대보험 요율(%)" inputMode="decimal" value={String(insRate)} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); update({ ...project, insuranceRate: Math.min(30, Number(v) || 0) }); }} /><b>%</b></label>}
        <label className="share-toggle"><input type="checkbox" checked={includeSeverance} onChange={(e) => update({ ...project, laborIncludeSeverance: e.target.checked })} /><span><strong>퇴직금 기본값</strong> — 새로 추가하는 인력의 기본 설정 (1년 이상 근무자만 계상 가능해 개인별로 조정하세요)</span></label>
      </div>
      {(() => {
        const withSev = project.participants.filter((p) => severanceApplies(p, includeSeverance)).length;
        return <p className="field-hint">퇴직금 계상 인력 {withSev}명 / 전체 {project.participants.length}명 — 계속근로 1년 미만인 인력은 개인 카드에서 "퇴직금 포함"을 해제하세요.</p>;
      })()}
      {(() => {
        // 인건비 현물이 재원 구성의 민간부담 현물 한도를 넘으면 반영 전에 미리 경고한다.
        const laborFunding = fundingBreakdown(project);
        const laborInKindTotal = sumExisting.inKind + sumNew.inKind;
        if (laborInKindTotal === 0) return null;
        if (!laborFunding.matchingCashRateKnown) return <p className="field-hint"><AlertCircle /> 현물 {formatWon(laborInKindTotal)} 계상됨 — 한도 검증을 하려면 과제 설정에서 "민간부담금 중 현금 비율"을 입력하세요.</p>;
        if (laborInKindTotal > laborFunding.matchingInKind) return <p className="field-error"><AlertCircle /> 인건비 현물 합계({formatWon(laborInKindTotal)})가 재원 구성의 현물 한도({formatWon(laborFunding.matchingInKind)})를 {formatWon(laborInKindTotal - laborFunding.matchingInKind)} 초과했어요. 계상 구분(현금/현물)이나 지원비율·현금 비율을 확인하세요.</p>;
        return null;
      })()}
      <div className="settings-save"><button type="button" className="primary" onClick={reflectToBudget}><WalletCards /> 예산 편성에 반영</button>{reflected && <span className="save-ok"><CheckCircle2 /> 반영됐어요 — 아래 편성표에서 확인하세요</span>}</div>
    </div>}
  </section>;
}

function Budget({ project, update, setScreen }: { project: Project; update: (p: Project) => void; setScreen: (s: Screen) => void }) {
  const pack = packFor(project);
  const cats = visibleCategories(pack, project);
  const confirmed = !!project.budgetConfirmed;
  const sourceDocs = useSourceDocs(project, update);
  const { viewDoc, docForSource } = sourceDocs;
  // 근거 링크를 누르면 규정 DB의 조문 원문을 먼저 띄운다 — 원본 파일이 없어도, HWP처럼 조문
  // 번호가 유실된 문서여도 항상 정확한 조문이 열린다. 원본 문서가 연결돼 있으면 팝업 안에서 이어간다.
  const [openArticles, setOpenArticles] = useState<{ ref: string; articles: PackArticle[]; doc: string; openDoc?: () => void } | null>(null);
  // 근거가 "공고 비목 정의 + QnA 사업비 7번"처럼 복수면 각각을 해당 문서로 여는 개별 링크로 나눈다.
  const refLink = (rule: { quote?: string; message?: string; item?: string; source: { doc: string; ref: string; matchLevel: string } }) => {
    const parts = rule.source.ref.split(/\s*\+\s*/).filter(Boolean);
    const composite = parts.length > 1;
    return <>{parts.map((part, index) => {
      // 복수 근거일 때는 부분 문구만으로 문서를 매칭한다 (합쳐진 문서명이 매칭을 흐리지 않게)
      const doc = docForSource(composite ? { ref: part, matchLevel: rule.source.matchLevel } : rule.source);
      const sets = highlightTermSets(rule, part);
      const openDoc = doc ? () => { setOpenArticles(null); viewDoc(doc, sets.primary, sets.fallback); } : undefined;
      const found = findArticles(pack, part);
      if (found) return <span key={index}>{index > 0 && ' '}
        <button type="button" className="ref-link" title={`${part} — ${found.pack.guideline} 조문 원문 보기`} onClick={() => setOpenArticles({ ref: part, articles: found.articles, doc: found.pack.guideline, openDoc })}>{shortRef(part)} <BookOpenCheck /></button>
      </span>;
      return <span key={index}>{index > 0 && ' '}{openDoc
        ? <button type="button" className="ref-link" title={`${part} — ${doc!.fileName}에서 이 근거 위치 열기`} onClick={openDoc}>{shortRef(part)} <FileSearch /></button>
        : <em title={part}>({shortRef(part)})</em>}</span>;
    })}</>;
  };
  const total = project.budgets.reduce((sum, item) => sum + item.amount, 0);
  const funding = fundingBreakdown(project);
  // "직접비(현물 제외)" 같은 상한 기준에 쓰는 민간부담 현물 금액
  const inKind = funding.matchingInKind;
  // 비목별 현물 계상 합계 (편성 금액을 넘는 부분은 세지 않는다)
  const totalInKind = project.budgets.reduce((sum, b) => sum + Math.min(b.inKindAmount ?? 0, b.amount), 0);
  const changeAmount = (id: BudgetCategoryId, amount: number) => update({ ...project, budgets: project.budgets.map((b) => b.categoryId === id ? { ...b, amount: Math.max(0, amount), inKindAmount: b.inKindAmount != null ? Math.min(b.inKindAmount, Math.max(0, amount)) || undefined : undefined } : b) });
  const setInKindAmount = (id: BudgetCategoryId, value: number) => update({ ...project, budgets: project.budgets.map((b) => b.categoryId === id ? { ...b, inKindAmount: Math.max(0, Math.min(value, b.amount)) || undefined } : b) });
  // ---- 비목 기준 사이드 패널 ----
  const [standardId, setStandardId] = useState<BudgetCategoryId | null>(null);
  // 이 팩에 규정 DB 기준이 없는 비목(공고문 AI 추출 팩·내장 예시 팩)은 이름으로 공통 규정 기준을 찾아둔다.
  // 편성표의 상한 칸과 기준 패널이 같은 결과를 쓴다.
  const referenceByCategory = useMemo(() => {
    const map = new Map<string, ReferenceStandard | null>();
    for (const category of cats) {
      const hasOwn = !!(category.allowedItems?.length || category.limitText || category.approvals?.length || category.evidenceRules?.length);
      map.set(category.id, hasOwn ? null : referenceStandardFor(category.name, pack.id));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id, cats.map((c) => c.id).join('|')]);
  // ---- 세목(비목 내 하위 항목) 편집 ----
  const [subOpen, setSubOpen] = useState<Set<string>>(new Set());
  const toggleSub = (id: string) => setSubOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // 세목이 있으면 비목 금액은 항상 세목 합계로 맞춘다. 세목을 모두 지우면 직접 입력으로 돌아간다.
  const setSubItems = (id: BudgetCategoryId, subs: BudgetSubItem[]) => {
    const sum = subs.reduce((s, x) => s + x.amount, 0);
    const exists = project.budgets.some((b) => b.categoryId === id);
    const budgets = exists
      ? project.budgets.map((b) => b.categoryId === id ? { ...b, subItems: subs.length ? subs : undefined, amount: subs.length ? sum : b.amount } : b)
      : [...project.budgets, { categoryId: id, amount: sum, subItems: subs.length ? subs : undefined }];
    update({ ...project, budgets });
  };
  // 세목을 처음 만들 때는 이미 편성해둔 비목 금액을 첫 세목에 그대로 옮긴다 —
  // 안 그러면 세목 합계(0원)로 덮여 편성 합계가 조용히 깨진다.
  const addSubItem = (id: BudgetCategoryId, name = '') => {
    const item = project.budgets.find((b) => b.categoryId === id);
    const subs = item?.subItems ?? [];
    const amount = subs.length === 0 ? item?.amount ?? 0 : 0;
    setSubItems(id, [...subs, { id: uid(), name, amount }]);
    setSubOpen((prev) => new Set(prev).add(id));
  };
  const toggleConfirm = () => {
    if (confirmed) { update({ ...project, budgetConfirmed: false }); return; }
    const zero = pack.categories.filter((c) => c.allowed && !(project.budgets.find((b) => b.categoryId === c.id)?.amount)).length;
    if (!confirm(`편성을 확정할까요?${zero ? ` 금액이 0원인 비목 ${zero}개는 화면에서 숨겨집니다.` : ''} 확정 후에는 "편성 수정"으로 다시 열 수 있어요.`)) return;
    update({ ...project, budgetConfirmed: true });
  };
  const packInfos = globalRules(pack, 'info');
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">모듈 1</span><h2>예산 편성 도우미</h2><p>{pack.name} 규정 체계 기준 초안입니다. 협약서의 개별 조건이 항상 우선합니다.</p></div><div className="title-actions"><button className="secondary" onClick={() => withExporters((m) => m.exportBudgetXlsx(project))}><Download /> 엑셀 내보내기</button><button className={confirmed ? 'secondary' : 'primary'} onClick={toggleConfirm}>{confirmed ? <><Pencil /> 편성 수정</> : <><Check /> 편성 확정</>}</button></div></div>
    <div className={`notice ${pack.verified ? 'soft' : ''}`}><BookOpenCheck /><div><strong>{pack.verified ? '규정DB 검증본' : '예시 기준 (검증 전)'} · {pack.guideline}</strong><span>{pack.agency} 기준으로 정리한 데이터입니다 ({packBasisDate(pack)}). 실제 협약 및 최신 공고 원문이 항상 우선합니다. {(() => { const doc = docForSource({ doc: pack.guideline, matchLevel: 'guideline' }); return doc ? <button type="button" className="ref-link" onClick={() => viewDoc(doc)}>저장된 원문 보기 ({doc.fileName}) →</button> : pack.referenceUrl ? <a href={pack.referenceUrl} target="_blank" rel="noreferrer">공식 사이트에서 원문 확인 →</a> : null; })()}</span></div></div>
    {!pack.hasRatioLimits && packInfos.length > 0 && <div className="notice soft"><ShieldCheck /><div><strong>이 사업은 비목 간 비율 제한이 없습니다</strong><span>{packInfos.map((rule, index) => <span key={rule.id}>{index > 0 && ' · '}{rule.message} {refLink(rule)}</span>)}</span></div></div>}
    {/* 규정이 개정돼 이 과제가 쓰던 팩이 사라지면, 화면은 적용 시점 스냅샷으로 계속 돌아가
        새 한도·규칙이 반영되지 않는다. 사용자는 알 방법이 없으므로 여기서 알리고 바로 옮겨준다. */}
    {packIsMissing(project) && (() => {
      const options = replacementPacksFor(project);
      const movePack = (next: RulePack) => {
        if (!confirm(`규정을 "${next.name}"으로 바꿀까요?\n비목 구성이 같으면 편성 금액은 그대로 유지되고, 새 한도·규칙이 적용됩니다.`)) return;
        // 비목 id 가 같은 것만 편성을 옮긴다 — 없어진 비목의 금액을 엉뚱한 비목에 붙이면 안 된다.
        const keep = new Set(next.categories.map((category) => category.id));
        const budgets = project.budgets.filter((item) => keep.has(item.categoryId));
        const dropped = project.budgets.length - budgets.length;
        if (dropped > 0 && !confirm(`새 규정에 없는 비목 ${dropped}개의 편성 금액은 지워집니다. 계속할까요?`)) return;
        // 스냅샷을 지워야 새 팩이 실제로 쓰인다 (packFor 는 규정DB 팩이 아니면 customPack 을 쓴다).
        update({ ...project, packId: next.id, customPack: undefined, packOverlay: undefined, budgets, budgetConfirmed: false });
      };
      return <section className="cap-alert under">
        <div className="cap-alert-head">
          <span className="cap-badge">규정 개정</span>
          <h3>이 과제가 쓰던 규정이 더 이상 제공되지 않습니다</h3>
        </div>
        <p className="cap-alert-basis">
          지금은 규정을 적용하던 시점의 사본(<b>{pack.name}</b>)으로 표시하고 있어, 그 뒤에 바뀐 한도·규칙이 반영되지 않습니다.
          {options.length > 0 ? ' 아래에서 바뀐 규정을 고르면 편성 금액을 유지한 채 옮겨드려요.' : ' 과제 설정에서 규정을 다시 선택해주세요.'}
        </p>
        <div className="cap-alert-actions">
          {options.map((option) => (
            <button type="button" key={option.id} className="primary" onClick={() => movePack(option)}>{option.name}(으)로 변경</button>
          ))}
          <button type="button" className="secondary" onClick={() => setScreen('settings')}>과제 설정에서 고르기</button>
        </div>
      </section>;
    })()}
    {/* 사업비 한도가 정해진 사업은 입력한 금액과 대조한다 — 잘못 입력한 채로 편성을 끝내면 나중에 전부 다시 짜야 한다.
        금액이 한도와 다르면 다른 안내와 섞이지 않게 확인 카드로 띄우고, 그 자리에서 바로 고칠 수 있게 한다. */}
    {fundingCapChecks(pack, project).map((check) => {
      const matches = check.entered === check.cap;
      const acknowledged = (project.fundingCapAck ?? []).includes(check.rule.id);
      if (matches) return <div key={check.rule.id} className="notice soft"><CheckCircle2 /><div>
        <strong>{check.targetLabel}이 이 사업의 한도와 일치합니다</strong>
        <span>{formatWon(check.cap)} · {check.basis} {refLink(check.rule)}</span>
      </div></div>;
      // 한도에 맞추면 총사업비와 비목 편성을 함께 옮긴다 — 금액만 바꾸고 편성을 두면 합계가 어긋난다.
      const applyCap = () => {
        const subsidyRate = project.subsidyRate ?? 100;
        const nextSubsidy = check.target === 'subsidy' ? check.cap : Math.round(check.cap * subsidyRate / 100);
        const nextTotal = check.target === 'total' ? check.cap : deriveTotalBudget(nextSubsidy, subsidyRate);
        if (!confirm(`${check.targetLabel}을 ${formatWon(check.cap)}으로 맞출까요?\n총사업비 ${formatWon(project.totalBudget)} → ${formatWon(nextTotal)}\n비목별 편성 금액도 지금 비율 그대로 새 총액에 맞춰 조정됩니다.`)) return;
        update({
          ...project,
          subsidyAmount: nextSubsidy,
          totalBudget: nextTotal,
          budgets: rescaleBudgets(project.budgets, project.totalBudget, nextTotal),
          budgetConfirmed: false,
          fundingCapAck: (project.fundingCapAck ?? []).filter((id) => id !== check.rule.id),
        });
      };
      const keep = () => update({ ...project, fundingCapAck: [...(project.fundingCapAck ?? []), check.rule.id] });
      const undoKeep = () => update({ ...project, fundingCapAck: (project.fundingCapAck ?? []).filter((id) => id !== check.rule.id) });

      if (acknowledged) return <div key={check.rule.id} className="notice"><CircleDollarSign /><div>
        <strong>이 사업의 {check.basis} 한도는 {formatWon(check.cap)}입니다 — 현재 금액을 유지 중</strong>
        <span>입력한 {check.targetLabel} {formatWon(check.entered)} · 확인함 {refLink(check.rule)} <button type="button" className="ref-link" onClick={undoKeep}>다시 확인하기</button></span>
      </div></div>;

      return <section key={check.rule.id} className={`cap-alert ${check.over ? 'over' : 'under'}`}>
        <div className="cap-alert-head">
          <span className="cap-badge">{check.over ? '확인 필요' : '금액 확인'}</span>
          <h3>{check.over
            ? `입력한 ${check.targetLabel}이 이 사업 한도를 넘습니다`
            : `입력한 ${check.targetLabel}이 이 사업 한도보다 적습니다`}</h3>
        </div>
        <div className="cap-alert-figures">
          <div><span>입력한 {check.targetLabel}</span><strong>{formatWon(check.entered)}</strong></div>
          <div className="cap-arrow"><ArrowRight /></div>
          <div><span>이 사업 한도</span><strong className="cap-target">{formatWon(check.cap)}</strong></div>
          <div className="cap-diff"><span>차이</span><strong>{check.over ? '+' : '−'}{formatWon(Math.abs(check.diff))}</strong></div>
        </div>
        <p className="cap-alert-basis">{check.basis} · {check.rule.message} {refLink(check.rule)}</p>
        <div className="cap-alert-actions">
          <button type="button" className="primary" onClick={applyCap}><Check /> {formatWon(check.cap)}으로 수정</button>
          <button type="button" className="secondary" onClick={keep}>현재 금액 유지</button>
          <small>수정하면 비목별 편성 금액도 지금 비율 그대로 새 총액에 맞춰집니다.</small>
        </div>
      </section>;
    })}
    {/* 재원 구성 비율 규정 — 금액 한도가 없는 사업도 이 비율은 거의 항상 있다. */}
    {(() => {
      const rates = fundingRateChecks(pack, project).filter((check) => !check.ok);
      if (!rates.length) return null;
      const broken = rates.filter((check) => !check.unknown);
      const fixRate = (check: typeof rates[number]) => {
        if (check.role === 'matching_cash_min') { update({ ...project, matchingCashRate: check.pct }); return; }
        // 지원 비율이 바뀌면 총사업비가 달라지고, 편성해둔 비목도 새 총액에 맞춰야 한다.
        const nextRate = check.role === 'subsidy_max' ? check.pct : 100 - check.pct;
        const subsidy = project.subsidyAmount ?? project.totalBudget;
        const nextTotal = deriveTotalBudget(subsidy, nextRate);
        if (!confirm(`지원비율을 ${nextRate}%로 맞출까요?\n총사업비 ${formatWon(project.totalBudget)} → ${formatWon(nextTotal)}\n비목별 편성 금액도 지금 비율 그대로 새 총액에 맞춰 조정됩니다.`)) return;
        update({ ...project, subsidyRate: nextRate, totalBudget: nextTotal, budgets: rescaleBudgets(project.budgets, project.totalBudget, nextTotal), budgetConfirmed: false });
      };
      return <section className={`cap-alert ${broken.length ? 'over' : 'under'}`}>
        <div className="cap-alert-head">
          <span className="cap-badge">{broken.length ? '규정 위반' : '입력 필요'}</span>
          <h3>{broken.length ? '재원 구성이 이 사업 규정과 맞지 않습니다' : '재원 구성을 확인해주세요'}</h3>
        </div>
        <div className="cap-rate-list">{rates.map((check) => (
          <div key={check.rule.id} className={check.unknown ? 'cap-rate unknown' : 'cap-rate'}>
            <div><span>{check.label}</span><strong>{check.unknown ? '미입력' : `${check.entered}%`}</strong></div>
            <div className="cap-arrow"><ArrowRight /></div>
            <div><span>규정</span><strong className="cap-target">{check.role === 'subsidy_max' ? `${check.pct}% 이하` : `${check.pct}% 이상`}</strong></div>
            <button type="button" className="secondary" onClick={() => fixRate(check)}>
              {check.role === 'matching_cash_min' ? `현금 ${check.pct}%로 설정` : `${check.role === 'subsidy_max' ? check.pct : 100 - check.pct}%로 수정`}
            </button>
          </div>
        ))}</div>
        <p className="cap-alert-basis">{rates.map((check, index) => <span key={check.rule.id}>{index > 0 && ' · '}{check.rule.message} {refLink(check.rule)}</span>)}</p>
      </section>;
    })()}
    <ParticipantsPanel project={project} update={update} />
    <section className="panel budget-editor"><div className="editor-head"><div><span className="section-kicker">STEP 2 · 비목별 편성</span><span>전체 사용 가능 예산</span><strong>{formatWon(project.totalBudget)}</strong>{funding.matching > 0 && funding.matchingCashRateKnown && <small className="funding-split-note">현금 {formatWon(funding.subsidy + funding.matchingCash)} (지원금+민간 현금) · 현물 {formatWon(funding.matchingInKind)}</small>}</div><div className="editor-head-sums">{funding.matching > 0 && funding.matchingCashRateKnown
        ? (() => {
            // 현금·현물을 각각 검증한다 — 둘 다 맞으면 편성 합계도 자동으로 맞는다.
            const gap = (planned: number, target: number) => planned === target ? '' : ` — ${planned > target ? '초과' : '부족'} ${formatWon(Math.abs(planned - target))}`;
            const cashTarget = funding.subsidy + funding.matchingCash;
            const cashTotal = total - totalInKind;
            return <>
              <div className={cashTotal === cashTarget ? 'sum-ok' : 'sum-bad'}>{cashTotal === cashTarget ? <CheckCircle2 /> : <AlertCircle />} 현금 편성 {formatWon(cashTotal)} / 재원 현금 {formatWon(cashTarget)}{gap(cashTotal, cashTarget)}{confirmed && ' · 편성 확정됨'}</div>
              <div className={totalInKind === funding.matchingInKind ? 'sum-ok' : 'sum-bad'}>{totalInKind === funding.matchingInKind ? <CheckCircle2 /> : <AlertCircle />} 현물 편성 {formatWon(totalInKind)} / 재원 현물 {formatWon(funding.matchingInKind)}{gap(totalInKind, funding.matchingInKind)}</div>
            </>;
          })()
        : <>
          <div className={total === project.totalBudget ? 'sum-ok' : 'sum-bad'}>{total === project.totalBudget ? <CheckCircle2 /> : <AlertCircle />} 편성 합계 {formatWon(total)} {total !== project.totalBudget && `(차이 ${formatWon(total - project.totalBudget)})`}{confirmed && ' · 편성 확정됨'}</div>
          {funding.matching > 0 && totalInKind > 0 && <div className="sum-bad"><AlertCircle /> 현물 {formatWon(totalInKind)} 편성됨 — 한도 검증을 하려면 과제 설정에서 "민간부담금 중 현금 비율"을 입력하세요</div>}
        </>}</div></div>
      <BudgetComposition pack={pack} project={project} cats={cats} bases={budgetBases(pack, project.budgets, project.totalBudget, inKind)} />
      <div className="budget-table"><div className="table-head"><span>비목 · 사용 예시</span><span>허용 상한</span><span>편성 금액</span><span>비율</span><span>상태</span><span>기준</span></div>{cats.map((category) => {
        const item = project.budgets.find((b) => b.categoryId === category.id);
        const amount = item?.amount ?? 0;
        const itemInKind = Math.min(item?.inKindAmount ?? 0, amount);
        const subs = item?.subItems ?? [];
        const hasSubs = subs.length > 0;
        const open = subOpen.has(category.id);
        const rate = project.totalBudget ? amount / project.totalBudget * 100 : 0;
        const cap = capFor(pack, project.budgets, project.totalBudget, category.id, inKind);
        const min = minFor(pack, category.id);
        const over = cap?.amount != null && amount > cap.amount;
        const under = min != null && amount < min.amount;
        // 비목 칸에는 이름만 둔다 — 용도 설명은 마우스를 올렸을 때 옆에 띄워 편성표를 가볍게 유지한다.
        const definition = category.definition ?? referenceByCategory.get(category.id)?.category.definition;
        const mustNotes = mandatoryNotesFor(pack, category.id);
        return <div key={category.id}><div className={`table-row ${over || under ? 'row-danger' : ''}`}><div className="name-cell">
          <strong>{category.name}</strong>
          <button type="button" className="text-button sub-toggle" onClick={() => toggleSub(category.id)}>{hasSubs ? `세목 ${subs.length}개 ${open ? '접기' : '보기'}` : open ? '세목 입력 닫기' : '+ 세목 나누기'}</button>
          {definition && <div className="def-card" role="tooltip"><strong>{category.name}</strong><p>{definition}</p>{!category.definition && <em>{referenceByCategory.get(category.id)?.pack.guideline} 기준</em>}</div>}</div>
        {/* 상한의 근거·조건은 "기준" 패널에 있으므로, 여기서는 금액이 어떻게 나왔는지 계산식만 보여준다. */}
        <div className="cap-cell">{cap
          ? cap.amount != null
            ? <><strong>{formatWon(cap.amount)}</strong><small className="cap-formula">{cap.basisLabel} {formatWon(cap.basisAmount!)} × {cap.limitPct}%</small>{amount > 0 && cap.amount > 0 && <small className={over ? 'cap-used over' : 'cap-used'}>{over ? `상한 ${formatWon(amount - cap.amount)} 초과` : `여유 ${formatWon(cap.amount - amount)}`}</small>}</>
            // 세부항목에 걸리는 상한도 금액은 알려준다 — 얼마까지 쓸 수 있는지 알아야 세목을 짠다.
            : cap.referenceAmount != null
            ? <><strong className="cap-partial">{formatWon(cap.referenceAmount)}</strong><small className="cap-formula">{cap.basisLabel} {formatWon(cap.basisAmount!)} × {cap.limitPct}%</small><small className="cap-db"><em>{cap.rule.item}에 걸리는 상한이에요 — 비목 전체가 아니라 이 세목 합계를 이 금액 안에서 잡으세요.</em></small></>
            : <small className={cap.inKindOnly && funding.matching > 0 && itemInKind <= 0 ? 'cap-db cap-inkind' : 'cap-db'}>{cap.label}<br /><em>{capHint(cap, itemInKind, funding.matching > 0)}</em></small>
          : (category.limitText ?? referenceByCategory.get(category.id)?.category.limitText)
          ? <small className="cap-db">{category.limitText ?? referenceByCategory.get(category.id)?.category.limitText}{!category.limitText && <em> · 공통 규정 기준</em>}</small>
          : <small className="cap-db muted">규정 상한 없음</small>}{min && <small className="cap-min">{min.label}</small>}</div><div className="amount-cell"><label className="money-input"><input aria-label={`${category.name} 편성 금액`} inputMode="numeric" value={withCommas(String(amount))} disabled={confirmed || hasSubs} onChange={(e) => changeAmount(category.id, Number(digitsOnly(e.target.value)) || 0)} /><b>원</b></label>{funding.matching > 0 && <div className="inkind-row"><span>현물</span><label className="money-input"><input aria-label={`${category.name} 현물 계상액`} inputMode="numeric" disabled={confirmed} placeholder="0" value={withCommas(String(itemInKind || ''))} onChange={(e) => setInKindAmount(category.id, Number(digitsOnly(e.target.value)) || 0)} /><b>원</b></label><small>현금 {formatWon(amount - itemInKind)}</small></div>}{hasSubs && <div className="amount-slider"><small>세목 {subs.length}개 합계 자동</small></div>}{!confirmed && !hasSubs && (() => {
          // 막대바 눈금은 총사업비로 고정한다(썸 위치 = 총사업비 대비 비율). 눈금을 "현재 금액+잔액"으로
          // 잡으면 한 비목을 움직일 때마다 잔액이 변해 다른 슬라이더 썸까지 시각적으로 따라 움직인다.
          // 잔액·허용 상한 제한은 드래그된 값에만 적용 — 상한 초과 편성이 필요하면 직접 입력으로 한다.
          // 상한 금액은 이 비목 편성액에 따라 같이 움직일 수 있어(간접비 = 직접비의 10%) 화면에 보이는
          // 상한이 아니라 "끌어올린 뒤에도 상한 안에 남는" 최대 금액에서 멈춘다.
          const free = Math.max(0, project.totalBudget - total);
          const capped = maxAmountWithinCap(pack, project.budgets, project.totalBudget, category.id, amount + free, inKind);
          const dragLimit = Math.max(amount, capped);
          const step = Math.max(10000, Math.round(project.totalBudget / 200 / 10000) * 10000);
          const hint = free <= 0
            ? total > project.totalBudget ? '예산 초과 — 줄여주세요' : '남은 잔액 없음'
            : capped < amount + free
            ? `미편성 잔액 ${formatWon(free)} · 이 비목은 상한 ${formatWon(capped)}까지`
            : `미편성 잔액 ${formatWon(free)}`;
          return <div className="amount-slider"><input type="range" aria-label={`${category.name} 편성 금액 조절`} min={0} max={project.totalBudget} step={step} value={Math.min(amount, project.totalBudget)} onChange={(e) => changeAmount(category.id, Math.min(Number(e.target.value), dragLimit))} /><small>{hint}</small></div>;
        })()}</div><div className="rate-cell"><div className="mini-progress"><i className={over || under ? 'danger' : ''} style={{ width: `${cap?.amount ? Math.min(amount / cap.amount * 100, 100) : Math.min(rate, 100)}%` }} /></div><b>{rate.toFixed(1)}%</b></div><span className={`status ${over || under ? 'bad' : 'good'}`}>{over ? <><AlertCircle /> 상한 초과</> : under ? <><AlertCircle /> 필수 금액 미달</> : <><Check /> 정상</>}</span>
        <button type="button" className={`standard-open ${standardId === category.id ? 'active' : ''}`} aria-label={`${category.name} 기준 보기`} title={definition ? `${category.name} — ${definition}` : `${category.name} 기준 보기`} onClick={() => setStandardId(standardId === category.id ? null : category.id)}><BookOpenCheck /></button></div>
        {/* 빠뜨리면 협약까지 걸리는 필수 계상은 기준 패널 안이 아니라 비목 바로 아래에 세운다. */}
        {mustNotes.map((rule) => <p key={rule.id} className="must-note">
          <AlertCircle /><span><b>{rule.trigger ?? '필수 계상'}</b> {rule.message} {refLink(rule)}</span>
        </p>)}
        {open && <div className="sub-items">
          {subs.map((sub) => <div className="sub-item-row" key={sub.id}>
            <input aria-label={`${category.name} 세목 이름`} placeholder="세목 이름 (예: 기술도입비)" value={sub.name} disabled={confirmed} onChange={(e) => setSubItems(category.id, subs.map((x) => x.id === sub.id ? { ...x, name: e.target.value } : x))} />
            <label className="money-input"><input aria-label={`${sub.name || '세목'} 금액`} inputMode="numeric" disabled={confirmed} value={withCommas(String(sub.amount))} onChange={(e) => setSubItems(category.id, subs.map((x) => x.id === sub.id ? { ...x, amount: Number(digitsOnly(e.target.value)) || 0 } : x))} /><b>원</b></label>
            {!confirmed && <button type="button" className="danger-button" aria-label={`${sub.name || '세목'} 삭제`} onClick={() => setSubItems(category.id, subs.filter((x) => x.id !== sub.id))}><Trash2 /></button>}
          </div>)}
          {/* 세목 이름은 직접 입력해도 되지만, 규정에 있는 이름을 골라 쓰면 정산 때 비목-세목 대응을 다시 맞출 일이 없다. */}
          {!confirmed && (() => {
            const choices = subItemChoicesFor(pack, category.id);
            if (!choices.own.length && !choices.base.length) return null;
            const used = new Set(subs.map((sub) => sub.name.replace(/\s/g, '')));
            const chip = (choice: SubItemChoice) => <button type="button" key={choice.name} title={choice.note ?? choice.name}
              disabled={used.has(choice.name.replace(/\s/g, ''))} onClick={() => addSubItem(category.id, choice.name)}><Plus />{choice.name}</button>;
            return <div className="sub-picker">
              <span className="sub-picker-label">계상 가능 세목 — 눌러서 추가</span>
              {choices.own.length > 0 && <div className="panel-chips">{choices.own.map(chip)}</div>}
              {choices.base.length > 0 && <>
                {/* 공고·지침은 그 사업이 따로 정한 것만 담는다 — 나머지 세목은 상위 규정에서 가져와 함께 보여준다. */}
                <span className="sub-picker-label base">{choices.basePack!.guideline} <em>공고에 없는 항목은 이 기준을 따릅니다</em></span>
                <div className="panel-chips">{choices.base.map(chip)}</div>
              </>}
            </div>;
          })()}
          {!confirmed && <button type="button" className="secondary sub-add" onClick={() => addSubItem(category.id)}><Plus /> 직접 입력으로 세목 추가</button>}
          <p className="sub-hint">{hasSubs ? `비목 금액은 세목 합계 ${formatWon(amount)}(으)로 자동 계산됩니다. 세목을 모두 지우면 직접 입력으로 돌아가요.` : '세목을 추가하면 비목 금액이 세목 합계로 자동 계산됩니다. 첫 세목에는 지금 편성 금액이 그대로 옮겨져요.'}</p>
        </div>}</div>;
      })}</div>
    </section>
    {/* 비목 기준은 화면에 길게 나열하지 않고 편성표의 "기준" 버튼으로 그때그때 연다. */}
    {(() => {
      if (!standardId) return null;
      const category = cats.find((c) => c.id === standardId);
      if (!category) return null;
      const reference = referenceByCategory.get(category.id) ?? null;
      const base = baseStandardFor(pack, category.id);
      return <StandardPanel
        category={category}
        reference={reference?.category ?? null}
        referenceDoc={reference?.pack.guideline}
        cap={capFor(pack, project.budgets, project.totalBudget, category.id, inKind)}
        amount={project.budgets.find((b) => b.categoryId === category.id)?.amount ?? 0}
        inKindAmount={(() => { const item = project.budgets.find((b) => b.categoryId === category.id); return Math.min(item?.inKindAmount ?? 0, item?.amount ?? 0); })()}
        hasMatching={funding.matching > 0}
        choices={subItemChoicesFor(pack, category.id)}
        baseStandard={base}
        baseRules={base ? rulesFor(base.pack, base.category.id) : []}
        min={minFor(pack, category.id)}
        rules={rulesFor(pack, category.id)}
        refLink={refLink}
        canAddSub={!confirmed}
        onAddSub={(name) => addSubItem(category.id, name)}
        onClose={() => setStandardId(null)}
      />;
    })()}
    {pack.reviewIssues?.length ? <section><div className="section-title"><h3>규정 DB 검토 메모</h3><p>규정을 DB로 옮기면서 원문 확인이 필요하다고 표시해둔 지점입니다.</p></div>
      <div className="global-warnings">{pack.reviewIssues.map((issue) => <div key={issue.code} className={`warn-item ${issue.severity === 'warning' ? 'medium' : 'low'}`}>
        <AlertCircle /><div><strong>{issue.description}</strong><span>{issue.handling} {issue.ref && refLink({ message: issue.description, source: { doc: pack.guideline, ref: issue.ref, matchLevel: 'guideline' } })}</span></div>
      </div>)}</div>
    </section> : null}
    {globalRules(pack, 'warning').length > 0 && <section><div className="section-title"><h3>과제 공통 주의사항</h3><p>비목과 무관하게 적용되는 금지·주의 규정입니다.</p></div><div className="global-warnings">{globalRules(pack, 'warning').map((rule) => <div key={rule.id} className={`warn-item ${rule.severity ?? 'medium'}`}><AlertCircle /><div><strong>{rule.trigger ?? rule.item}</strong><span>{rule.message} {refLink(rule)}</span></div></div>)}</div></section>}
    {/* 근거 원본 문서 관리는 과제 설정 화면에서만 — 여기서는 "원문 보기" 팝업만 뜬다. */}
    <DocViewerModal source={sourceDocs} />
    {openArticles && <ArticleModal articles={openArticles.articles} ref={openArticles.ref} doc={openArticles.doc} onOpenDoc={openArticles.openDoc} onClose={() => setOpenArticles(null)} />}
  </div>;
}

function Spending({ project, update }: { project: Project; update: (p: Project) => void }) {
  const pack = packFor(project);
  const cats = visibleCategories(pack, project);
  const defaultCategoryId = cats[0]?.id ?? pack.categories[0]?.id ?? '';
  const emptyExpenseForm = () => ({ date: today(), categoryId: defaultCategoryId, subItemId: '', payment: 'card' as PaymentMethod, supply: '', vat: '', purpose: '', vendor: '', details: {} as Record<string, string> });
  // 등록 폼은 집행 현황 표 바로 아래에 늘 펼쳐 둔다 — 따로 여는 버튼이 없다.
  const [form, setForm] = useState(emptyExpenseForm());
  const [receipt, setReceipt] = useState<File | null>(null);
  const [ocr, setOcr] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; message?: string; text?: string }>({ status: 'idle' });
  const [editingId, setEditingId] = useState<string | null>(null);
  // 규정 증빙 중 이 집행건에는 해당하지 않아 꺼둔 것 (체크리스트는 모두 켠 채로 시작한다).
  const [extraDocs, setExtraDocs] = useState<Set<string>>(new Set());
  // 규정에 없지만 실무에서 요구받는 서류 — 사용자가 직접 넣은 것.
  const [customDocs, setCustomDocs] = useState<string[]>([]);
  const [newDoc, setNewDoc] = useState('');
  // ---- 예산 집행 현황 (비목·세목 × 월) ----
  // 월 열은 숨길 수 있고, 다 숨겨도 예산·집행·잔액 열은 남는다.
  const allMonths = monthSequence(project.startDate, project.endDate);
  const [hiddenMonths, setHiddenMonths] = useState<Set<string>>(new Set());
  const [monthsHidden, setMonthsHidden] = useState(false);
  const shownMonths = monthsHidden ? [] : allMonths.filter((month) => !hiddenMonths.has(month));
  const matrix = spendingMatrix(pack, project, shownMonths);
  const toggleMonth = (month: string) => setHiddenMonths((prev) => { const next = new Set(prev); if (next.has(month)) next.delete(month); else next.add(month); return next; });
  const editPlan = (categoryId: string, subItemId: string | undefined, month: string, raw: string) =>
    update(setMonthlyPlan(project, { categoryId, subItemId }, month, Number(digitsOnly(raw)) || 0));
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => setOpenRows((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // 대시보드에서 비목을 누르면 등록 폼을 그 비목으로 맞춘다. 수정 중일 때는 비목을 바꿀 수 없으므로 건드리지 않는다.
  const pickCategory = (categoryId: string, subItemId?: string) => {
    if (editingId) return;   // 수정 중에는 비목을 바꿀 수 없다
    if (subItemId) { setForm((prev) => ({ ...prev, categoryId, subItemId, details: {} })); setExtraDocs(new Set()); setCustomDocs([]); }
    else pickCategoryId(categoryId);

  };
  // 비목 행과 펼친 세목 행을 한 줄짜리 목록으로 편다 — 표를 그릴 때 조각(Fragment) 없이 쓰기 위해서다.
  const matrixRows = matrix.rows.flatMap((row) => [
    { key: row.categoryId, row, sub: undefined },
    ...(openRows.has(row.categoryId) ? row.subRows.map((sub) => ({ key: `${row.categoryId}:${sub.subItemId ?? 'none'}`, row, sub })) : []),
  ]);
  const selectedCategory = categoryOf(pack, form.categoryId);
  // 유의사항은 세목까지 골랐으면 그 세목 것만 (subStandard는 아래에서 정해진다).
  // ---- 비목 → 세목 (편성 화면에서 나눠둔 것만 고르게 한다) ----
  const subItems = project.budgets.find((b) => b.categoryId === form.categoryId)?.subItems ?? [];
  const selectedSub = subItems.find((sub) => sub.id === form.subItemId);
  const subRequired = subItems.length > 0;   // 세목을 나눈 비목만 세목을 요구한다 (안 나눴으면 칸 자체를 숨긴다)
  // 세목이 있으면 그 세목의 규정 기준(회의비·출장비의 증빙 규칙)을 쓰고, 없으면 비목 기준을 쓴다.
  const subStandard = selectedSub ? subItemStandardFor(pack, selectedSub.name) : null;
  const subGuide = subStandard ? evidenceGuide(subStandard.pack, subStandard.category, form.payment) : null;
  // 세목 기준을 쓸지 판단할 때 '모든 비목 공통' 규칙은 세지 않는다 — 그것만 갖고 있는 세목(팁스
  // 인건비 세목)은 사실상 비어 있는 것이라, 비목 기준으로 내려가야 증빙과 근거 조문이 나온다.
  const commonRuleNames = commonEvidenceRuleNames(subStandard?.pack ?? pack);
  const subHasOwn = !!subGuide && (subGuide.items.length > 0 || !!subGuide.base
    || subGuide.rules.some((rule) => !commonRuleNames.has(rule.name)));
  const guide = subHasOwn ? subGuide! : evidenceGuide(pack, selectedCategory, form.payment);
  // 주의사항은 상위 규정 것까지 이어받는다 — 공고는 자기가 따로 정한 것만 담기 때문이다.
  const cautions = spendingCautions(pack, form.categoryId, selectedSub?.name, subStandard?.category);
  const primary = primaryEvidence(guide);
  // 규정이 요구하는 증빙을 서류 단위로 쪼개 체크리스트로 만든다. 모두 켠 채로 시작하고
  // 해당 없는 조건(국내/국외 출장 등)만 사용자가 끈다 — extraDocs는 '끈 것' 목록이다.
  const docList = evidenceChecklistFor(pack, form.categoryId, selectedSub?.name, subStandard?.category, primary.rules, subStandard?.pack ?? pack);
  const toggleDoc = (doc: string) => setExtraDocs((prev) => { const next = new Set(prev); if (next.has(doc)) next.delete(doc); else next.add(doc); return next; });
  const baseDocs = docList.documents.length ? docList.documents : withAlwaysRequired(primary.template);
  const checklist = [...baseDocs, ...customDocs].filter((doc) => !extraDocs.has(doc));
  const addCustomDoc = () => {
    const name = newDoc.trim();
    if (!name || checklist.includes(name)) { setNewDoc(''); return; }
    setCustomDocs((prev) => [...prev, name]);
    setNewDoc('');
  };
  // 체크리스트를 실제로 만든 근거를 그대로 토글로 쓴다. primary.items를 따로 보면 세목 기준이
  // 비목으로 fallback되거나 evidenceRules에서 서류가 온 경우 체크리스트만 나오고 원문이 빠진다.
  const evidenceArticles = docList.sources;
  // 세목별 추가 입력은 규정 기준으로 해석한 이름(회의비·출장비)으로 찾는다 — '회의 식비'로 편성돼도 회의비 서식을 쓴다.
  const detailFields = detailFieldsFor(subStandard?.category.name ?? selectedSub?.name);
  const setDetail = (key: string, value: string) => setForm((prev) => ({ ...prev, details: { ...prev.details, [key]: value } }));
  // 수정 중인 집행건은 세목 잔액 계산에서도 제외한다.
  const subSpent = selectedSub ? project.expenses.filter((e) => e.categoryId === form.categoryId && e.subItemId === selectedSub.id && e.id !== editingId).reduce((total, e) => total + e.amount, 0) : 0;
  // 비목을 바꾸면 세목·고른 증빙·세목별 입력이 모두 안 맞으므로 함께 비운다.
  const pickCategoryId = (categoryId: string) => { setForm((prev) => ({ ...prev, categoryId, subItemId: '', details: {} })); setExtraDocs(new Set()); setCustomDocs([]); };
  const pickSubItem = (subItemId: string) => { setForm((prev) => ({ ...prev, subItemId, details: {} })); setExtraDocs(new Set()); setCustomDocs([]); };
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
  const resetForm = () => { setForm(emptyExpenseForm()); setReceipt(null); setOcr({ status: 'idle' }); setEditingId(null); setExtraDocs(new Set()); setCustomDocs([]); setNewDoc(''); };
  const closeForm = () => resetForm();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isOver && !window.confirm(`잔액보다 ${formatWon(amount - (budget - spent))} 초과합니다. 그래도 등록할까요?`)) return;
    const editing = editingId ? project.expenses.find((e) => e.id === editingId) : undefined;
    // 수정 시에는 기존 증빙 체크리스트(업로드 파일 포함)를 유지하고, 신규 등록 시에만 새로 만든다.
    // 화면에서 고른 기준 하나만 체크리스트에 넣는다 — 규정이 증빙을 정했으면 앱 기본 예시는 쓰지 않는다.
    // 품의서·지출결의서는 어느 기준이든 항상 들어간다.
    const docs = checklist;
    let evidence: Evidence[] = editing ? editing.evidence : docs.map((label) => ({ id: uid(), label, completed: false }));
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
    const base = { date: form.date, categoryId: form.categoryId, subItemId: form.subItemId || undefined, subItemName: selectedSub?.name, amount, supplyAmount: amount || undefined, vatAmount: Number(form.vat) || undefined, paymentMethod: form.payment, purpose: form.purpose, vendor: form.vendor, details: Object.keys(form.details).length ? form.details : undefined, evidence };
    update(editing
      ? { ...project, expenses: project.expenses.map((e) => e.id === editing.id ? { ...editing, ...base } : e) }
      : { ...project, expenses: [{ id: uid(), createdAt: new Date().toISOString(), ...base }, ...project.expenses] });
    closeForm();
  };
  const startEdit = (expense: Expense) => {
    setForm({ date: expense.date, categoryId: expense.categoryId, subItemId: expense.subItemId ?? '', payment: expense.paymentMethod ?? 'card', supply: String(expense.supplyAmount ?? expense.amount), vat: expense.vatAmount ? String(expense.vatAmount) : '', purpose: expense.purpose, vendor: expense.vendor, details: expense.details ?? {} });
    setReceipt(null); setOcr({ status: 'idle' }); setEditingId(expense.id);
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
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">모듈 2</span><h2>집행 · 증빙 관리</h2><p>집행을 등록하면 잔액과 필요한 증빙을 바로 연결합니다.</p></div></div>
    <section className="panel spend-dashboard">
      <div className="panel-head">
        <div><h3><WalletCards /> 예산 집행 현황</h3><p>편성에서 확정한 예산 기준입니다. 비목을 누르면 아래 등록 폼이 그 비목으로 맞춰집니다.</p></div>
        {allMonths.length > 0 && <button type="button" className="secondary" onClick={() => setMonthsHidden(!monthsHidden)}>{monthsHidden ? '월별 보기' : '월별 숨기기'}</button>}
      </div>
      {!monthsHidden && allMonths.length > 0 && <div className="month-picker">
        <span>월 표시</span>
        <em className="period">사업기간 {project.startDate} ~ {project.endDate} · {allMonths.length}개월</em>
        <div className="month-checks">{allMonths.map((month) => <label key={month}><input type="checkbox" checked={!hiddenMonths.has(month)} onChange={() => toggleMonth(month)} />{month.slice(2)}</label>)}</div>
        <button type="button" className="text-button" onClick={() => setHiddenMonths(new Set())}>전체</button>
        <button type="button" className="text-button" onClick={() => setHiddenMonths(new Set(allMonths))}>해제</button>
      </div>}
      {/* 월 열이 하나뿐이거나 아예 없으면 계산이 아니라 과제 정보가 잘못된 것이다 — 어디를 고쳐야 하는지 알려준다. */}
      {allMonths.length <= 1 && <p className="month-gap">{allMonths.length === 0
        ? `사업기간이 설정되어 있지 않아 월별 계획을 만들 수 없습니다 (시작일 "${project.startDate || '없음'}" · 종료일 "${project.endDate || '없음'}").`
        : `사업기간이 ${project.startDate} ~ ${project.endDate}, 1개월로 잡혀 있어 월이 하나만 나옵니다.`} 설정 → 과제 정보에서 시작일·종료일을 확인해주세요.</p>}
      <div className="matrix-scroll">
        <table className="spend-matrix">
          <thead>
            <tr>
              <th rowSpan={2} className="col-name">비목 · 세목</th>
              <th rowSpan={2}>예산</th><th rowSpan={2}>집행금액</th><th rowSpan={2}>잔액</th><th rowSpan={2}>소진율</th>
              {shownMonths.map((month) => <th key={month} colSpan={2} className="month-group">{month}</th>)}
            </tr>
            <tr>{shownMonths.flatMap((month) => [
              <th key={`${month}-p`} className="cell-plan">계획</th>,
              <th key={`${month}-a`}>집행</th>,
            ])}</tr>
          </thead>
          <tbody>
            {matrixRows.map(({ key, row, sub }) => {
              const line = sub ?? row;
              const editable = sub ? sub.planEditable : row.planEditable;
              return <tr key={key} className={`${sub ? 'sub' : 'cat'} ${!sub && row.over ? 'over' : ''} ${!sub && form.categoryId === row.categoryId ? 'on' : ''}`}>
                <td className="col-name">{sub
                  ? (sub.subItemId && !sub.orphan
                    ? <button type="button" className="text-button" onClick={() => pickCategory(row.categoryId, sub.subItemId)}>└ {sub.name}</button>
                    : <span>└ {sub.name}{sub.orphan ? ' (편성에서 삭제됨)' : ''}</span>)
                  : <><button type="button" className="text-button" onClick={() => pickCategory(row.categoryId)}>{row.name}</button>
                    {row.subRows.length > 0 && <button type="button" className="text-button sub-toggle" onClick={() => toggleRow(row.categoryId)}>세목 {row.subRows.length}개 {openRows.has(row.categoryId) ? '접기' : '보기'}</button>}</>}
                </td>
                <td>{sub && !sub.budget ? '—' : formatWon(line.budget)}</td>
                <td>{formatWon(line.spent)}</td>
                <td className={line.remaining < 0 ? 'bad' : ''}>{sub && !sub.budget ? '—' : formatWon(line.remaining)}</td>
                <td>{sub ? '' : <span className="spend-rate"><span className="track"><i style={{ width: `${Math.min(100, row.rate)}%` }} /></span>{Math.round(row.rate)}%</span>}</td>
                {line.cells.flatMap((cell) => [
                  <td key={`${cell.month}-p`} className="cell-plan">{editable
                    ? <input aria-label={`${line.name} ${cell.month} 계획`} inputMode="numeric" value={withCommas(String(cell.plan))} onChange={(e) => editPlan(row.categoryId, sub?.subItemId, cell.month, e.target.value)} />
                    : cell.plan ? formatWon(cell.plan) : '—'}</td>,
                  // 계획보다 많이 쓴 달은 눈에 띄어야 한다.
                  <td key={`${cell.month}-a`} className={cell.actual > cell.plan ? 'bad' : ''}>{cell.actual ? formatWon(cell.actual) : '—'}</td>,
                ])}
              </tr>;
            })}
            {matrix.outOfRange && <tr className="outside">
              <td className="col-name">기간 외 집행 <em>{matrix.outOfRange.count}건</em></td>
              <td>—</td><td className="bad">{formatWon(matrix.outOfRange.actual)}</td><td>—</td><td />
              {shownMonths.flatMap((month) => [<td key={`${month}-p`} className="cell-plan">—</td>, <td key={`${month}-a`}>—</td>])}
            </tr>}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-name"><strong>합계</strong></td>
              <td>{formatWon(matrix.totals.budget)}</td>
              <td>{formatWon(matrix.totals.spent)}</td>
              <td className={matrix.totals.remaining < 0 ? 'bad' : ''}>{formatWon(matrix.totals.remaining)}</td>
              <td><span className="spend-rate"><span className="track"><i style={{ width: `${Math.min(100, matrix.totals.rate)}%` }} /></span>{Math.round(matrix.totals.rate)}%</span></td>
              {matrix.totals.cells.flatMap((cell) => [
                <td key={`${cell.month}-p`} className="cell-plan">{formatWon(cell.plan)}</td>,
                <td key={`${cell.month}-a`} className={cell.actual > cell.plan ? 'bad' : ''}>{formatWon(cell.actual)}</td>,
              ])}
            </tr>
          </tfoot>
        </table>
      </div>
      {matrix.outOfRange && <p className="month-gap">사업기간 밖 집행이 {matrix.outOfRange.count}건 있습니다. 정산에서 문제가 될 수 있으니 집행일을 확인해주세요.</p>}
    </section>
    <form className="panel expense-form" onSubmit={submit}><div className="form-title"><div><h3>{editingId ? '집행건 수정' : '새 집행건'}</h3><p>{editingId ? '비목·세목과 결제수단은 수정할 수 없어요. 바뀌었다면 삭제 후 다시 등록해주세요.' : '비목과 세목을 고르면 그 규정이 요구하는 서류가 자동으로 바뀝니다.'}</p></div>{editingId && <button type="button" className="close" onClick={closeForm} aria-label="수정 취소">×</button>}</div>
      {/* ① 무엇을 집행하는지부터 고른다. 비목·세목이 정해져야 어떤 규정을 따르는지 알 수 있다. */}
      <fieldset className="step-block"><legend>① 무엇을 집행하나요?</legend>
        <div className="field-grid"><label>비목<select value={form.categoryId} disabled={!!editingId} onChange={(e) => pickCategoryId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {/* 편성 화면에서 나눠둔 세목만 올린다. 안 나눈 비목은 이 칸 자체가 나오지 않는다. */}
          {subRequired && <label>세목<select required value={form.subItemId} disabled={!!editingId} onChange={(e) => pickSubItem(e.target.value)}><option value="">세목을 선택하세요</option>{subItems.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label>}</div>
        {subRequired && !form.subItemId && !editingId && <p className="field-error"><AlertCircle /> 세목을 선택해야 집행을 등록할 수 있습니다. 비목마다 요구하는 증빙이 다릅니다.</p>}
      </fieldset>

      {/* ② 고른 비목·세목의 규정을 먼저 읽고 나서 금액을 적게 한다. */}
      <fieldset className="step-block"><legend>② {selectedSub?.name ?? selectedCategory.name} 집행 시 유의사항</legend>
        {/* 사전승인은 집행하고 나서 알면 되돌릴 수 없다 — 승인이 먼저 오도록 정렬해서 낸다. */}
        {cautions.items.length > 0 && <div className="caution-list">{cautions.items.map((item) => <CautionCard key={item.key} item={item} pack={pack} />)}</div>}
        {/* 공고가 따로 정하지 않은 부분은 상위 규정을 따른다 — 출처를 밝혀 함께 보여준다. */}
        {cautions.inherited.length > 0 && <details className="inherited-cautions" open={!cautions.items.length}>
          <summary>상위 규정도 지켜야 합니다 — {cautions.inheritedGuideline} <b>{cautions.inherited.length}건</b></summary>
          <div className="caution-list">{cautions.inherited.map((item) => <CautionCard key={item.key} item={item} pack={pack} />)}</div>
        </details>}
        {selectedSub && subStandard?.category.limitText && <p className="field-hint"><strong>{selectedSub.name} 기준</strong> — {subStandard.category.limitText}{subStandard.category.limitSource?.ref ? ` (${subStandard.category.limitSource.ref})` : ''}</p>}
        {/* 조건별 증빙과 항목별 증빙은 서로 다른 기준이 아니라 같은 기준(고른 세목)에서 나온 두 가지다.
            제목을 따로 세우면 경쟁하는 출처처럼 보여서, 한 덩어리로 묶고 그 안에서 나눈다. */}
        {/* 규정이 요구하는 증빙을 서류 단위로 쪼개 조건별로 묶은 체크리스트.
            규정이 말하는 것은 모두 켠 채로 시작하고, 해당 없는 조건만 끈다. */}
        <div className="doc-checklist">
          <strong><FileCheck2 /> 이 집행건에 들어갈 증빙 <em>{docList.sourceName} 기준 · {checklist.length}건</em></strong>
          {docList.groups.length > 0
            ? docList.groups.map((group) => <div className="doc-group" key={group.condition ?? '공통'}>
              <span className="doc-group-label">{group.condition ?? '공통'}{group.ref && <em>({group.ref})</em>}</span>
              <div className="doc-boxes">{group.documents.map((doc) => <label key={doc} className={extraDocs.has(doc) ? 'off' : ''}>
                <input type="checkbox" checked={!extraDocs.has(doc)} onChange={() => toggleDoc(doc)} />{doc}
              </label>)}</div>
            </div>)
            : <div className="doc-boxes">{baseDocs.map((doc) => <label key={doc} className={extraDocs.has(doc) ? 'off' : ''}>
              <input type="checkbox" checked={!extraDocs.has(doc)} onChange={() => toggleDoc(doc)} />{doc}
            </label>)}</div>}
          {customDocs.length > 0 && <div className="doc-group">
            <span className="doc-group-label">직접 추가<em>규정에는 없는 서류</em></span>
            <div className="doc-boxes">{customDocs.map((doc) => <label key={doc} className={extraDocs.has(doc) ? 'off' : ''}>
              <input type="checkbox" checked={!extraDocs.has(doc)} onChange={() => toggleDoc(doc)} />{doc}
              <button type="button" aria-label={`${doc} 삭제`} onClick={() => setCustomDocs((prev) => prev.filter((entry) => entry !== doc))}>×</button>
            </label>)}</div>
          </div>}
          {/* 규정DB에 그 세목 증빙이 없으면 왜 짧은지 알려준다 — 빈 화면으로 두면 누락으로 오해한다. */}
          <small>{docList.groups.every((group) => group.condition === '항상 필요')
            ? `${docList.sourceName}은 규정에 증빙이 따로 적혀 있지 않습니다. 필요한 서류를 아래에서 직접 추가하세요.`
            : '해당하지 않는 조건은 체크를 풀어주세요. 켜둔 서류가 이 집행건의 증빙 목록이 됩니다.'}</small>
          {/* 유의사항과 같은 방식으로 근거 조문 원문을 펼쳐 본다. 같은 조문을 가리키는 항목이
              여러 개라(인건비 4개 항목이 모두 '비목별 증빙서류') 조문 단위로 한 번만 낸다. */}
          {evidenceArticles.map((item) => <ArticleToggle key={item.ref} pack={pack} refText={item.ref} phrase={item.phrases} label="근거 지침 원문 보기" />)}
          {/* 규정에 없는 서류도 실무에서 요구받는다 (월별 4대보험가입자 명부·완납증명서 등) — 직접 넣을 수 있게 한다. */}
          <div className="doc-add">
            <input aria-label="증빙 직접 추가" value={newDoc} placeholder="규정에 없는 증빙 직접 추가 (예: 4대보험 완납증명서)"
              onChange={(e) => setNewDoc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomDoc(); } }} />
            <button type="button" className="secondary" onClick={addCustomDoc} disabled={!newDoc.trim()}><Plus /> 추가</button>
          </div>
        </div>
        <div className={`balance-preview ${isOver ? 'over' : ''}`}><WalletCards /><div><span>{selectedCategory.name} 등록 후 잔액</span><strong>{formatWon(budget - spent - amount)}</strong></div>
          {selectedSub && <div><span>{selectedSub.name} 등록 후 잔액</span><strong>{formatWon(selectedSub.amount - subSpent - amount)}</strong></div>}
          {isOver && <p><AlertCircle /> 잔액을 초과합니다. 확인 후 등록할 수 있어요.</p>}</div>
      </fieldset>

      {/* ③ 집행 내용 */}
      <fieldset className="step-block"><legend>③ 집행 내용</legend>
        <div className="ocr-strip"><div><ScanLine /><div><strong>영수증 먼저 업로드 — OCR 자동 입력</strong><span>집행일자 · 거래처명 · 공급가액 · 부가세액을 읽어 아래 칸을 자동으로 채워드려요.</span></div></div><label className="upload-button"><Upload /> {ocr.status === 'working' ? '인식 중…' : receipt ? '다시 업로드' : '영수증 업로드'}<input type="file" accept="image/*" disabled={ocr.status === 'working'} onChange={(e) => { onReceipt(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
        {ocr.status === 'done' && <p className="ocr-note ok"><CheckCircle2 /> {ocr.message}</p>}
        {ocr.status === 'error' && <p className="ocr-note bad"><AlertCircle /> {ocr.message}</p>}
        {ocr.text && <details className="ocr-raw"><summary>OCR 인식 원문 보기</summary><pre>{ocr.text}</pre></details>}
        <div className="field-grid"><label>집행일<input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>결제수단<select value={form.payment} disabled={!!editingId} onChange={(e) => setForm({ ...form, payment: e.target.value as PaymentMethod })}><option value="card">카드 결제</option><option value="transfer">계좌이체 (세금계산서)</option></select></label></div>
        <div className="field-grid three"><label><span className="label-line">공급가액 <b>집계 기준</b></span><input required inputMode="numeric" value={withCommas(form.supply)} onChange={(e) => setMoney('supply', e.target.value)} placeholder="0" /></label><label><span className="label-line">부가세액 <b>선택</b></span><input inputMode="numeric" value={withCommas(form.vat)} onChange={(e) => setMoney('vat', e.target.value)} placeholder="0" /></label><label><span className="label-line">합계 금액 <b>자동</b></span><input readOnly tabIndex={-1} value={withCommas(String(totalWithVat))} placeholder="0" /></label></div>
        <p className="field-hint">과제비 집계는 <strong>공급가액 기준(부가세 제외)</strong>입니다. 합계 금액은 공급가액+부가세액으로 자동 계산되며, 영수증의 결제금액과 맞는지 확인하는 참고용입니다.</p>
        <div className="field-grid"><label>용도<input required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="예: 외부 전문가 참석 정기 회의" /></label><label>거래처<input required value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="거래처명" /></label></div>
        {detailFields.length > 0 && <div className="detail-fields"><strong>{selectedSub?.name} 집행에 필요한 항목</strong><div className="field-grid">{detailFields.map((field) => <label key={field.key}>{field.label}{field.required ? '' : ' (선택)'}
          {field.type === 'textarea'
            ? <textarea rows={3} required={field.required} value={form.details[field.key] ?? ''} onChange={(e) => setDetail(field.key, e.target.value)} />
            : <input type={field.type === 'date' ? 'date' : 'text'} required={field.required} value={form.details[field.key] ?? ''} onChange={(e) => setDetail(field.key, e.target.value)} placeholder={field.hint} />}
        </label>)}</div></div>}
      </fieldset>
      <div className="form-actions"><button type="button" className="secondary" onClick={closeForm}>{editingId ? '수정 취소' : '입력 초기화'}</button><button className="primary" type="submit" disabled={!editingId && subRequired && !form.subItemId}>{editingId ? '수정 저장' : isOver ? '확인 후 등록' : '집행 등록'}</button></div></form>
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
  const limitError = form.from !== form.to ? transferLimitError(pack, project.budgets, project.totalBudget, form.to, amount, fundingBreakdown(project).matchingInKind) : null;
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

function Team({ project, update, setScreen }: { project: Project; update: (p: Project) => void; setScreen: (s: Screen) => void }) {
  const [member, setMember] = useState({ name: '', email: '' });
  const addMember = (e: React.FormEvent) => { e.preventDefault(); if (project.members.length >= 2 || !member.name || !member.email) return; update({ ...project, members: [...project.members, { id: uid(), name: member.name, email: member.email, role: '담당자' }] }); setMember({ name: '', email: '' }); };
  const refreshReminders = () => {
    const milestone = daysUntil(project.settlementDeadline);
    if (![30, 14, 7].includes(milestone)) { alert(`현재 정산 마감은 D-${milestone}입니다. 알림은 D-30, D-14, D-7에 생성됩니다.`); return; }
    const incomplete = project.expenses.reduce((s, e) => s + e.evidence.filter((x) => !x.completed).length, 0);
    if (!incomplete) { alert('미완료 증빙이 없어 알림을 생성하지 않았습니다.'); return; }
    if (project.emailLogs.some((l) => l.milestone === milestone)) { alert('해당 마감 알림 로그가 이미 있습니다.'); return; }
    update({ ...project, emailLogs: [...project.emailLogs, ...project.members.map((m) => ({ id: uid(), sentAt: new Date().toISOString(), recipient: m.email, milestone: milestone as 30 | 14 | 7, status: '제품 내 알림' as const, incompleteCount: incomplete }))] });
  };
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">운영 설정</span><h2>담당자 · 알림 관리</h2><p>담당자 정보를 기록하고 증빙 누락 알림을 확인합니다.</p></div></div>
    <div className="notice"><Users /><div><strong>참여 인력 · 인건비 관리는 예산 편성 화면으로 이동했어요</strong><span>참여율 점검과 인건비 계산은 이제 예산 편성의 "STEP 1 · 인건비 산정"에서 합니다. <button type="button" className="ref-link" onClick={() => setScreen('budget')}>예산 편성으로 이동 →</button></span></div></div>
    <div className="team-grid single"><section className="panel"><div className="panel-head"><div><h3>담당자 정보</h3><p>{project.members.length} / 2명 입력됨 · 알림 수신 대상</p></div></div><div className="member-list">{project.members.map((m) => <div key={m.id}><div className="avatar">{m.name[0]}</div><span><strong>{m.name} <b>{m.role}</b></strong><small>{m.email}</small></span><CheckCircle2 /></div>)}</div>{project.members.length < 2 ? <form className="inline-add" onSubmit={addMember}><h4><UserPlus /> 담당자 추가</h4><div className="field-grid"><label>이름<input required value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} /></label><label>이메일<input required type="email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} /></label></div><button className="secondary" type="submit"><Plus /> 두 번째 담당자 추가</button></form> : <div className="limit-note"><ShieldCheck /> 담당자는 최대 2명까지 기록할 수 있습니다. 실제 공동 사용은 서버 버전에서 지원됩니다.</div>}</section>
    </div>
    <section className="panel reminder-panel"><div className="panel-head"><div><h3><Mail /> 증빙 누락 알림 로그</h3><p>정산 마감 D-30 / D-14 / D-7에 미완료 증빙을 확인합니다.</p></div><button className="secondary" onClick={refreshReminders}><RefreshCw /> 오늘 기준 확인</button></div>{project.emailLogs.length ? <div className="log-table"><div><strong>발송 시각</strong><strong>수신자</strong><strong>시점</strong><strong>미완료</strong><strong>상태</strong></div>{project.emailLogs.map((log) => <div key={log.id}><span>{new Date(log.sentAt).toLocaleString('ko-KR')}</span><span>{log.recipient}</span><b>D-{log.milestone}</b><span>{log.incompleteCount}개</span><span className="log-status">{log.status}</span></div>)}</div> : <div className="empty-state compact"><Mail /><h3>아직 알림 로그가 없어요</h3><p>마감 기준일에 미완료 증빙이 있으면 제품 내 알림 로그가 생성됩니다.</p></div>}</section>
  </div>;
}

const RULE_KIND_LABEL = { ratio: '상한', warning: '금지·주의', funding: '재원', info: '참고' } as const;

const DIFF_STATUS_LABEL: Record<PackDiff['status'], string> = {
  changed: '달라짐', added: '새로 나옴', missing: '확인 필요', unchanged: '동일',
};
const DIFF_TARGET_LABEL: Record<PackDiff['target'], string> = {
  limit: '상한', minimum: '필수계상', category: '비목', rule: '규칙',
};

// "근거 원본 문서"에 이미 있는 문서 중 골라서 AI로 규정(비목·상한·금지)을 추출·반영한다.
// 파일 업로드는 여기서 하지 않는다 — 문서 확보는 "근거 원본 문서" 패널의 역할이고, 여긴 그중
// 무엇을 분석에 쓸지 고르기만 한다.
function DocUpdatePanel({ project, update, source }: { project: Project; update: (p: Project) => void; source: ReturnType<typeof useSourceDocs> }) {
  const docs = project.documents ?? [];
  // 과제가 이미 사업명에 연결돼 있으면(공유 팩을 쓰거나 "근거 원본 문서"에서 수동 연결) 그
  // 사업명을 그대로 쓴다 — 사용자가 직접 타이핑하지 않게 해서 표기 차이로 인한 중복을 막는다.
  const linkedProgramId = projectRegistryId(project.packId) ?? project.programRegistryId ?? null;
  const [linkedProgramName, setLinkedProgramName] = useState<string | null>(null);
  useEffect(() => {
    if (!linkedProgramId) { setLinkedProgramName(null); return; }
    getProgramById(linkedProgramId).then((p) => setLinkedProgramName(p?.programName ?? null)).catch(() => setLinkedProgramName(null));
  }, [linkedProgramId]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [ai, setAi] = useState<{ status: 'idle' | 'working' | 'done' | 'error'; extraction?: Extraction; cached?: boolean; message?: string; progress?: { done: number; total: number } }>({ status: 'idle' });
  const [acceptedRules, setAcceptedRules] = useState<Set<number>>(new Set());
  // 인정 항목은 규칙과 별개로 승인한다 — 원문 확인된 것만 기본 선택.
  const [acceptedItems, setAcceptedItems] = useState<Set<number>>(new Set());
  const [useDocCats, setUseDocCats] = useState(false);
  const [applied, setApplied] = useState(false);
  const [rateSuggestion, setRateSuggestion] = useState<ReturnType<typeof suggestedFundingRates> | null>(null);
  const [rateForm, setRateForm] = useState<{ subsidyRate: string; matchingCashRate: string } | null>(null);
  const [rateApplied, setRateApplied] = useState(false);
  const [shareYear, setShareYear] = useState('');
  const [applying, setApplying] = useState(false);
  const [openPack, setOpenPack] = useState<SavedRulePack | null>(null);
  // 규정DB가 이미 있는 사업이면 추출 결과를 그대로 적용하지 않고 "무엇이 달라졌는지"만 보여준다.
  const [acceptedDiffs, setAcceptedDiffs] = useState<Set<number>>(new Set());
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const basePack = packFor(project);
  const onRegulationDb = isRegulationDbPack(basePack);
  // 변경사항 비교. 규정DB 팩이 아닐 때는 비교 기준이 없으므로 예전처럼 규칙을 직접 승인한다.
  const diffs = useMemo(
    () => (ai.status === 'done' && ai.extraction && onRegulationDb ? diffExtraction(basePack, ai.extraction) : []),
    [ai.status, ai.extraction, onRegulationDb, basePack],
  );
  const diffCounts = useMemo(() => summarizeDiff(diffs), [diffs]);
  // 승인 대상 — 값이 맞부딪히는 변경과 이 공고 고유로 새로 나온 것. 비목 신설은 규정DB 갱신
  // 사안이라 여기서 승인할 수 없고, missing 은 추출 누락일 수 있어 자동 반영하지 않는다.
  const actionableDiffs = useMemo(
    () => diffs.map((diff, index) => ({ diff, index }))
      .filter(({ diff }) => !!diff.extracted && (diff.status === 'changed' || diff.status === 'added') && diff.target !== 'category'),
    [diffs],
  );

  const toggleChecked = (id: string) => setCheckedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const runAi = async () => {
    const chosen = docs.filter((link) => checkedIds.has(link.id));
    if (!chosen.length) return;
    setAi({ status: 'working' });
    try {
      const { extractDocumentText } = await import('./extract');
      const texts = await Promise.all(chosen.map(async (link) => {
        const blob = link.kind === 'upload' && link.fileId ? await getProjectDocument(link.fileId) : await downloadRegistryDocument(link.storagePath!);
        if (!blob) throw new Error(`"${link.title}" 파일을 불러오지 못했습니다.`);
        const { text } = await extractDocumentText(new File([blob], link.fileName, { type: blob.type }));
        return text;
      }));
      const combined = texts.join('\n');
      // 긴 지침은 조각으로 나눠 순차 호출된다 — 진행 상황을 보여준다.
      const { extraction, cached } = await runExtraction(combined, project.packId,
        (done, total) => setAi((prev) => prev.status === 'working' ? { ...prev, progress: { done, total } } : prev));
      const verified = annotateVerification(extraction, combined);
      setAi({ status: 'done', extraction: verified, cached });
      // DB에 연결 안 된(미등록) 사업이면 공유 신청을 기본으로 켠다 — 승인되면 DB에 등록돼 재사용된다.
      setAcceptedRules(new Set(verified.rules.map((rule, index) => rule.verified ? index : -1).filter((index) => index >= 0)));
      setAcceptedItems(new Set((verified.allowedItems ?? []).map((item, index) => item.verified ? index : -1).filter((index) => index >= 0)));
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

  // 추출 결과를 규정DB 패키지(manifest + 6개 JSON)로 만든다 — 사람이 만든 패키지와 같은 구성이라
  // 그대로 검토·변환·적재 스크립트를 태울 수 있고, 승인되면 예산편성 화면의 비목이 된다.
  const regulationPackage = useMemo(() => {
    if (ai.status !== 'done' || !ai.extraction) return null;
    return buildRegulationPackage(ai.extraction, {
      programName: linkedProgramName ?? ai.extraction.programName ?? project.programName,
      year: Number(shareYear) || ai.extraction.year,
      sourceFiles: docs.filter((link) => checkedIds.has(link.id)).map((link) => link.fileName),
    });
  }, [ai.status, ai.extraction, linkedProgramName, project.programName, shareYear, docs, checkedIds]);

  // 규정DB 등록 신청 — 공유 데이터에 직접 쓰지 않고 대기열에 넣는다. 관리자가 근거를 검토해
  // 승인해야 origin='regulation_db'가 되어 비목으로 쓰인다.
  const submitPackage = async () => {
    if (!regulationPackage || ai.status !== 'done' || !ai.extraction) return;
    setApplying(true);
    try {
      const items = (ai.extraction.allowedItems ?? []).filter((_, index) => acceptedItems.has(index));
      const accepted = ai.extraction.rules.filter((_, index) => acceptedRules.has(index));
      await submitRegulationPackage({
        programName: linkedProgramName || ai.extraction.programName || project.programName || basePack.name,
        year: Number(shareYear) || ai.extraction.year,
        pack: buildCustomPack(null, ai.extraction, accepted.length ? accepted : ai.extraction.rules, true, items),
        regulationPackage,
        ...(onRegulationDb ? { diff: diffs, basePackId: basePack.id } : {}),
        programRegistryId: linkedProgramId,
      });
      setSubmitted(true); setTimeout(() => setSubmitted(false), 3000);
    } catch (error) {
      alert(`규정DB 등록 신청에 실패했습니다 (${error instanceof Error ? error.message : ''}).`);
    } finally { setApplying(false); }
  };

  // 규정DB가 있는 사업 — 승인한 변경사항만 오버레이로 얹는다. 비목은 규정DB 것을 그대로 쓴다.
  const applyOverlayChanges = () => {
    if (ai.status !== 'done' || !ai.extraction) return;
    const approved = actionableDiffs.filter(({ index }) => acceptedDiffs.has(index)).map(({ diff }) => diff);
    const { rules, supersededRuleIds } = overlayRulesFrom(basePack, approved);
    update({
      ...project,
      packOverlay: {
        basePackId: basePack.id,
        appliedAt: new Date().toISOString(),
        sourceDocTitles: docs.filter((link) => checkedIds.has(link.id)).map((link) => link.title),
        rules,
        ...(supersededRuleIds.length ? { supersededRuleIds } : {}),
      },
    });
    setApplied(true); setTimeout(() => setApplied(false), 2500);
  };

  const clearOverlay = () => {
    if (!confirm('최신 공고에서 반영한 변경사항을 걷어내고 규정DB 기준으로 되돌릴까요?')) return;
    const next = { ...project }; delete next.packOverlay; update(next);
  };

  const apply = async () => {
    if (ai.status !== 'done' || !ai.extraction) return;
    const base = useDocCats ? null : packFor(project);
    const accepted = ai.extraction.rules.filter((_, index) => acceptedRules.has(index));
    const items = (ai.extraction.allowedItems ?? []).filter((_, index) => acceptedItems.has(index));
    const pack = buildCustomPack(base, ai.extraction, accepted, useDocCats, items);
    // 적용한 팩은 보관함(extractedPacks)에도 쌓아 언제든 다시 열람·재적용할 수 있게 한다.
    const saved: SavedRulePack = {
      id: crypto.randomUUID(), savedAt: new Date().toISOString(),
      sourceDocTitles: docs.filter((link) => checkedIds.has(link.id)).map((link) => link.title),
      pack,
    };
    // 규정DB가 없는 사업이라 추출 팩이 비목의 출처가 된다 — 화면에는 "미검증"으로 표시된다.
    // 공유는 여기서 하지 않는다. 규정DB 등록은 위의 "규정DB 등록 신청"이 패키지째로 처리한다.
    update({ ...project, customPack: pack, packId: pack.id, extractedPacks: [saved, ...(project.extractedPacks ?? [])].slice(0, 20) });
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
    <div className="panel-head"><div><h3><FileSearch /> AI 규정 추출 — DB에 없는 사업의 DB화 도구</h3><p>공유 DB에 규정이 없는 사업일 때 "근거 원본 문서"의 문서에서 규정을 추출해요. 이 과제에 바로 적용되고, 공유 신청하면 관리자 승인 후 DB에 등록돼 다음부터는 사업명 검색으로 바로 쓸 수 있어요.</p></div></div>
    <div className="docupdate-body">
      {docs.length === 0 ? <p className="doc-empty">아직 근거 원본 문서가 없어요. 아래 "근거 원본 문서"에서 먼저 업로드하거나 불러와주세요.</p> : <div className="source-doc-list">
        {docs.map((link) => <label key={link.id} className="share-toggle">
          <input type="checkbox" checked={checkedIds.has(link.id)} onChange={() => toggleChecked(link.id)} />
          <span><strong>{link.title}</strong> <em>{link.kind === 'link' ? '· 공유 문서' : '· 이 과제 전용'}</em></span>
        </label>)}
      </div>}
      {docs.length > 0 && <>
        {ai.status === 'idle' && <button type="button" className="secondary" disabled={checkedIds.size === 0} onClick={runAi}><Sparkles /> 선택한 문서에서 규정 추출하기 ({checkedIds.size})</button>}
        {ai.status === 'working' && <p className="wiz-hint">{ai.progress && ai.progress.total > 1
          ? `문서가 길어 ${ai.progress.total}조각으로 나눠 분석하는 중… (${ai.progress.done}/${ai.progress.total} 완료) 조각당 1분 내외 걸립니다.`
          : '문서를 분석하는 중… (문서 크기에 따라 최대 1~2분 걸릴 수 있어요)'}</p>}
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
          {onRegulationDb && <div className="diff-block">
            <h4><ShieldCheck /> 규정DB와 비교한 변경사항</h4>
            <p className="wiz-hint">이 과제는 근거가 검증된 규정DB(<b>{basePack.name}</b>)를 쓰고 있어요. 그래서 추출 결과를 그대로 덮어쓰지 않고, <b>규정DB와 무엇이 달라졌는지</b>만 비교해 보여줍니다. 예산 화면의 비목은 규정DB 것이 그대로 유지됩니다.</p>
            <div className="diff-counts">
              <span className="diff-chip changed">달라짐 <b>{diffCounts.changed}</b></span>
              <span className="diff-chip added">새로 나옴 <b>{diffCounts.added}</b></span>
              <span className="diff-chip missing">확인 필요 <b>{diffCounts.missing}</b></span>
              <span className="diff-chip unchanged">동일 <b>{diffCounts.unchanged}</b></span>
            </div>
            {diffCounts.changed === 0 && diffCounts.added === 0
              ? <p className="wiz-hint">규정DB와 달라진 기준을 찾지 못했어요 — 최신 공고가 기존 규정과 같습니다.</p>
              : <div className="diff-list">{diffs.map((diff, index) => {
                if (diff.status === 'unchanged' && !showUnchanged) return null;
                const selectable = !!diff.extracted && (diff.status === 'changed' || diff.status === 'added') && diff.target !== 'category';
                const body = <>
                  <strong><span className={`diff-tag ${diff.status}`}>{DIFF_STATUS_LABEL[diff.status]}</span> <span className="diff-target">{DIFF_TARGET_LABEL[diff.target]}</span> {diff.label}</strong>
                  {(diff.before || diff.after) && <em className="diff-values">
                    {diff.before && <span className="diff-before">{diff.before}</span>}
                    {diff.before && diff.after && <ArrowRight />}
                    {diff.after && <span className="diff-after">{diff.after}</span>}
                  </em>}
                  {diff.note && <em>{diff.note}</em>}
                  {diff.extracted?.quote && <em>"{diff.extracted.quote.slice(0, 90)}{diff.extracted.quote.length > 90 ? '…' : ''}" ({diff.extracted.ref}){diff.extracted.verified ? ' · 원문 확인됨' : ' · ⚠ 원문에서 찾지 못한 인용'}</em>}
                </>;
                return selectable
                  ? <label key={index} className={`ai-rule ${diff.extracted?.verified ? '' : 'unverified'}`}>
                    <input type="checkbox" checked={acceptedDiffs.has(index)} onChange={(e) => setAcceptedDiffs((prev) => { const next = new Set(prev); if (e.target.checked) next.add(index); else next.delete(index); return next; })} />
                    <span>{body}</span>
                  </label>
                  : <div key={index} className="ai-rule static"><span>{body}</span></div>;
              })}</div>}
            {diffCounts.unchanged > 0 && <button type="button" className="link-btn" onClick={() => setShowUnchanged((v) => !v)}>{showUnchanged ? '동일한 항목 접기' : `동일한 항목 ${diffCounts.unchanged}건 보기`}</button>}
            <div className="settings-save">
              <button type="button" className="primary" disabled={acceptedDiffs.size === 0} onClick={applyOverlayChanges}><Check /> 선택한 변경사항 반영 ({acceptedDiffs.size}건)</button>
              {project.packOverlay && <button type="button" className="secondary" onClick={clearOverlay}><RefreshCw /> 규정DB 기준으로 되돌리기</button>}
              {applied && <span className="save-ok"><CheckCircle2 /> 반영됐어요</span>}
            </div>
          </div>}
          {!onRegulationDb && <>
          {ai.extraction.categories.length > 0 && <label className="share-toggle"><input type="checkbox" checked={useDocCats} onChange={(e) => setUseDocCats(e.target.checked)} /><span><strong>문서의 비목 구성 사용</strong> ({ai.extraction.categories.length}개: {ai.extraction.categories.map((c) => c.name).join(', ').slice(0, 60)})</span></label>}
          <div className="ai-rules">{ai.extraction.rules.map((rule, index) => <label key={index} className={`ai-rule ${rule.verified ? '' : 'unverified'}`}>
            <input type="checkbox" checked={acceptedRules.has(index)} onChange={(e) => setAcceptedRules((prev) => { const next = new Set(prev); if (e.target.checked) next.add(index); else next.delete(index); return next; })} />
            <span><strong>[{rule.minAmount != null ? '필수계상' : RULE_KIND_LABEL[rule.kind]}] {rule.message}{rule.minAmount != null && ` (${formatWon(rule.minAmount)})`}</strong><em>"{rule.quote.slice(0, 90)}{rule.quote.length > 90 ? '…' : ''}" ({rule.ref}) {rule.verified ? '· 원문 확인됨' : '· ⚠ 원문에서 찾지 못한 인용 — 직접 확인 후 선택하세요'}</em></span>
          </label>)}</div>
          {/* 인정 항목 — 기준 패널의 "인정 항목"이 된다. 규칙과 따로 승인한다. */}
          {(ai.extraction.allowedItems?.length ?? 0) > 0 && <div className="extract-block">
            <h4><Package /> 인정 항목 <b>{ai.extraction.allowedItems!.length}</b> <em>비목별로 무엇을 쓸 수 있는지</em></h4>
            <div className="ai-rules">{ai.extraction.allowedItems!.map((item, index) => <label key={index} className={`ai-rule ${item.verified ? '' : 'unverified'}`}>
              <input type="checkbox" checked={acceptedItems.has(index)} onChange={(e) => setAcceptedItems((prev) => { const next = new Set(prev); if (e.target.checked) next.add(index); else next.delete(index); return next; })} />
              <span><strong>[{item.categoryName}] {item.name}{item.status === 'CONDITIONAL' ? ' (조건부)' : item.status === 'NOT_ALLOWED' ? ' (계상 불가)' : ''}</strong>
                <em>{item.description ?? ''}{item.condition ? ` · 조건: ${item.condition}` : ''}{item.restriction ? ` · 제한: ${item.restriction}` : ''}</em>
                <em>"{item.quote.slice(0, 80)}{item.quote.length > 80 ? '…' : ''}" ({item.ref}) {item.verified ? '· 원문 확인됨' : '· ⚠ 원문에서 찾지 못한 인용 — 직접 확인 후 선택하세요'}</em></span>
            </label>)}</div>
          </div>}
          </>}
          {/* 조문 원문 — 근거 링크를 눌렀을 때 원본 파일 없이 바로 열리게 한다. 개별 승인 대상이 아니다. */}
          {(ai.extraction.articles?.length ?? 0) > 0 && <p className="wiz-hint">
            <BookOpenCheck /> 근거 조문 원문 <b>{ai.extraction.articles!.length}건</b>을 함께 저장합니다 — 적용 후 근거 링크를 누르면 원본 파일 없이도 조문이 그대로 열립니다.
            {ai.extraction.articles!.some((a) => !a.verified) && ' (일부 조문은 원문 대조에 실패했어요 — 문서에서 직접 확인하세요)'}
          </p>}
          {ai.extraction.uncertain.length > 0 && <p className="wiz-hint">AI가 판단을 보류한 항목: {ai.extraction.uncertain.join(' / ')}</p>}
          {/* 규정DB 등록 — 추출 결과를 사람이 만든 패키지와 같은 구성으로 묶어 신청한다. */}
          {regulationPackage && <div className="wiz-block share-block">
            <h4><Package /> 규정DB로 등록</h4>
            <p className="wiz-hint">
              추출 결과를 <b>규정DB 패키지</b>(manifest + 6개 JSON)로 만들었어요 — 기존 규정DB와 똑같은 구성입니다.
              {onRegulationDb
                ? ' 이 사업은 이미 규정DB가 있으니, 위 변경사항까지 함께 실어 개정본으로 신청합니다.'
                : ' 관리자가 근거를 검토해 승인하면 이 사업의 비목·상한이 규정DB가 되어, 다음부터는 사업명 검색만으로 바로 쓸 수 있어요.'}
            </p>
            <div className="pkg-counts">
              <span>비목 <b>{regulationPackage.expense_categories.length}</b></span>
              <span>인정항목 <b>{regulationPackage.expense_allowed_items.length}</b></span>
              <span>상한 <b>{regulationPackage.expense_limit_rules.length}</b></span>
              <span>규칙 <b>{regulationPackage.regulation_rules.length}</b></span>
              <span>조문 <b>{regulationPackage.source_text.length}</b></span>
            </div>
            {(() => {
              const v = (regulationPackage.manifest as { validation: { unverified_rules: number; unverified_items: number; unverified_articles: number } }).validation;
              const unverified = v.unverified_rules + v.unverified_items + v.unverified_articles;
              return unverified > 0
                ? <p className="field-error"><AlertCircle /> 원문 대조에 실패한 항목이 {unverified}건 있어요 — 승인 전에 검토자가 원문을 직접 확인해야 합니다.</p>
                : <p className="wiz-hint">추출된 항목의 인용이 모두 원문에서 확인됐어요.</p>;
            })()}
            {!linkedProgramId && <label>연도<input inputMode="numeric" value={shareYear} onChange={(e) => setShareYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2026" /></label>}
            {linkedProgramId && <p className="wiz-hint">"{linkedProgramName ?? '연결된 사업'}" 사업으로 신청됩니다 — 사업명은 관리자가 근거 문서 승인 때 이미 정리해뒀어요.</p>}
            <div className="settings-save">
              {registryEnabled() && <button type="button" className="secondary" onClick={submitPackage} disabled={applying}><CloudUpload /> {applying ? '신청 중…' : '규정DB 등록 신청'}</button>}
              <button type="button" className="secondary" onClick={() => withExporters((m) => m.exportRegulationPackage(regulationPackage))}><Download /> 패키지 ZIP</button>
              {submitted && <span className="save-ok"><CheckCircle2 /> 신청됐어요 — 관리자 검토 후 반영됩니다</span>}
            </div>
          </div>}
          <div className="settings-save">
            {!onRegulationDb && <button type="button" className="primary" onClick={apply} disabled={(acceptedRules.size === 0 && acceptedItems.size === 0 && !useDocCats) || applying}><Check /> {applying ? '반영 중…' : `선택한 규정 적용 (규칙 ${acceptedRules.size}건${acceptedItems.size ? ` · 인정항목 ${acceptedItems.size}건` : ''}${useDocCats ? ' + 비목 구성' : ''})`}</button>}
            {/* 엑셀로 받아 사람이 검토·보강한 뒤 관리자가 공유 DB에 올리는 흐름 */}
            <button type="button" className="secondary" disabled={!regulationPackage} onClick={() => regulationPackage && withExporters((m) => m.exportExtractionReview(regulationPackage))}><Download /> 검토본 엑셀</button>{applied && !onRegulationDb && <span className="save-ok"><CheckCircle2 /> 반영됐어요</span>}</div>
          {ai.extraction.referencedRegulations && ai.extraction.referencedRegulations.length > 0 && <div className="ref-regs">
            <h4>이 공고가 참고하라고 명시한 규정</h4>
            <p className="wiz-hint">예산 편성 기준은 대개 공고문·사업계획서에 있지만, 증빙 서류는 아래 규정도 함께 확인해야 할 수 있어요. 정부 사이트에 원문이 흩어져 있어 자동으로 가져오지는 못하니, 직접 찾아 "공유 규정 DB"에 올려두면 다음부터 검색으로 바로 쓸 수 있어요.</p>
            <ul className="ref-reg-list">{ai.extraction.referencedRegulations.map((reg, index) => <li key={index} className={reg.verified ? '' : 'unverified'}><strong>{reg.name}</strong><em>"{reg.quote.slice(0, 70)}{reg.quote.length > 70 ? '…' : ''}" ({reg.ref})</em></li>)}</ul>
          </div>}
        </div>}
      </>}
      {(project.extractedPacks?.length ?? 0) > 0 && <div className="saved-packs">
        <h4><Package /> 완료된 규정팩 <b>{project.extractedPacks!.length}</b></h4>
        <p className="wiz-hint">추출해서 적용까지 마친 규정팩이 여기 보관됩니다. 클릭하면 비목·규칙을 근거 원문과 함께 언제든 다시 볼 수 있어요.</p>
        <div className="source-doc-list">{project.extractedPacks!.map((entry) => <div className="source-doc-row" key={entry.id}>
          <button type="button" onClick={() => setOpenPack(entry)}>
            <Package /><span><strong>{entry.pack.name}</strong><small>{new Date(entry.savedAt).toLocaleString('ko-KR')} · 비목 {entry.pack.categories.length}개 · 규칙 {entry.pack.rules.length}건{project.packId === entry.pack.id ? ' · 현재 적용 중' : ''}</small></span><Eye />
          </button>
        </div>)}</div>
      </div>}
    </div>
    {openPack && <SavedPackModal entry={openPack} project={project} update={update} source={source} onClose={() => setOpenPack(null)} />}
  </section>;
}

const PACK_RULE_KIND_LABEL: Record<string, string> = { ratio: '상한', warning: '금지·주의', info: '참고', evidence: '증빙', minimum: '필수계상' };

// 보관된 규정팩 열람 팝업 — 비목·규칙을 근거 인용과 함께 보여주고, 근거는 기존 원문 미리보기 창으로 연다.
// 재적용·삭제도 여기서 처리한다. 원문 미리보기(DocViewerModal)는 같은 source를 쓰는 SourceDocsPanel이 띄운다.
function SavedPackModal({ entry, project, update, source, onClose }: { entry: SavedRulePack; project: Project; update: (p: Project) => void; source: ReturnType<typeof useSourceDocs>; onClose: () => void }) {
  const { viewer, viewDoc, docForSource } = source;
  // 원문 미리보기가 위에 떠 있을 때 Escape는 미리보기만 닫혀야 한다 (이 팝업까지 닫히지 않게).
  const viewerOpen = useRef(false);
  viewerOpen.current = !!viewer;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !viewerOpen.current) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const current = project.packId === entry.pack.id;
  const applyPack = () => {
    if (!confirm(`"${entry.pack.name}" 규정팩을 이 과제에 다시 적용할까요? 현재 적용 중인 규정을 대체합니다.`)) return;
    update({ ...project, customPack: entry.pack, packId: entry.pack.id });
  };
  const removePack = () => {
    if (!confirm(`"${entry.pack.name}" 보관 기록을 삭제할까요?${current ? ' 현재 적용 중인 규정은 그대로 유지되고 보관 목록에서만 사라집니다.' : ''}`)) return;
    update({ ...project, extractedPacks: (project.extractedPacks ?? []).filter((p) => p.id !== entry.id) });
    onClose();
  };
  const ruleRef = (rule: PackRule) => {
    const doc = docForSource(rule.source);
    if (!doc) return <>({rule.source.ref})</>;
    const sets = highlightTermSets(rule);
    return <button type="button" className="ref-link" onClick={() => viewDoc(doc, sets.primary, sets.fallback)}>({rule.source.ref} · 원문 보기)</button>;
  };
  return <div className="doc-viewer-overlay" onClick={onClose}>
    <div className="doc-viewer" role="dialog" aria-label={`규정팩 ${entry.pack.name}`} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>{entry.pack.name}</strong><span>{new Date(entry.savedAt).toLocaleString('ko-KR')} 적용 · {entry.pack.guideline}</span></div>
        <div className="viewer-actions">
          {current
            ? <span className="save-ok"><CheckCircle2 /> 현재 적용 중</span>
            : <button type="button" className="secondary" onClick={applyPack}><Check /> 이 규정팩 적용</button>}
          <button type="button" className="secondary" onClick={removePack}><Trash2 /> 삭제</button>
          <button type="button" className="close" aria-label="닫기" onClick={onClose}>×</button>
        </div></header>
      <div className="viewer-scroll pack-view">
        <p className="viewer-note">기관: {entry.pack.agency}{entry.sourceDocTitles.length ? ` · 추출에 쓴 문서: ${entry.sourceDocTitles.join(', ')}` : ''} · 근거 표시가 파란 링크면 저장된 원문 미리보기로 바로 열 수 있어요.</p>
        <h4>비목 구성 <b>{entry.pack.categories.length}개</b></h4>
        <ul className="ref-reg-list">{entry.pack.categories.map((category) => <li key={category.id}>
          <strong>{category.name}{category.allowed ? '' : ' · 사용 불가'}</strong>
          {category.definition && <em>{category.definition}</em>}
        </li>)}</ul>
        <h4>규칙 <b>{entry.pack.rules.length}건</b></h4>
        <div className="ai-rules pack-rules">{entry.pack.rules.map((rule) => <div key={rule.id} className="ai-rule">
          <span><strong>[{PACK_RULE_KIND_LABEL[rule.kind] ?? rule.kind}] {rule.message}{rule.minAmount != null && ` (${formatWon(rule.minAmount)})`}</strong>
            <em>{rule.quote && `"${rule.quote.slice(0, 90)}${rule.quote.length > 90 ? '…' : ''}" `}{ruleRef(rule)}</em></span>
        </div>)}</div>
      </div>
    </div>
  </div>;
}

// 과제에 적용된 규정을 바꾼다. 지금까지는 새 과제를 만들 때(SetupWizard)만 고를 수 있어,
// 규정이 개정되거나 처음에 잘못 골랐을 때 되돌릴 방법이 없었다.
function RulePackPanel({ project, update }: { project: Project; update: (p: Project) => void }) {
  const current = packFor(project);
  const missing = packIsMissing(project);
  const suggested = replacementPacksFor(project);
  const suggestedIds = new Set(suggested.map((pack) => pack.id));
  // 권장 후보(같은 규정에서 갈린 팩)를 앞에 두고, 나머지 선택 가능한 팩을 뒤에 붙인다.
  const options = [...suggested, ...selectablePacks().filter((pack) => !suggestedIds.has(pack.id) && pack.id !== current.id)];
  const [choice, setChoice] = useState('');
  const [changed, setChanged] = useState(false);

  const apply = () => {
    const next = options.find((pack) => pack.id === choice);
    if (!next) return;
    // 비목 id 가 같은 편성만 옮긴다 — 없어진 비목의 금액을 엉뚱한 곳에 붙이면 안 된다.
    const keep = new Set(next.categories.map((category) => category.id));
    const budgets = project.budgets.filter((item) => keep.has(item.categoryId));
    const dropped = project.budgets.filter((item) => !keep.has(item.categoryId));
    const droppedSum = dropped.reduce((sum, item) => sum + item.amount, 0);
    const message = [
      `적용 규정을 "${next.name}"으로 바꿀까요?`,
      dropped.length
        ? `새 규정에 없는 비목 ${dropped.length}개의 편성 금액 ${formatWon(droppedSum)}은 지워집니다.`
        : '비목 구성이 같아 편성 금액은 그대로 유지됩니다.',
      '편성 확정은 해제되고, 새 규정의 한도·규칙이 적용됩니다.',
    ].join('\n');
    if (!confirm(message)) return;
    // 스냅샷(customPack)과 오버레이를 지워야 새 팩이 실제로 쓰인다.
    update({ ...project, packId: next.id, customPack: undefined, packOverlay: undefined, budgets, budgetConfirmed: false });
    setChoice('');
    setChanged(true);
    setTimeout(() => setChanged(false), 3000);
  };

  return <section className={`panel settings-panel ${missing ? 'pack-missing' : ''}`}>
    <div className="panel-head"><div>
      <h3>적용 규정</h3>
      <p>예산 편성의 비목·상한·주의사항이 여기서 고른 규정에서 옵니다.</p>
    </div></div>
    <div className="settings-form">
      <div className="pack-current">
        <div>
          <span>{missing ? '적용 시점 사본 (규정이 개정돼 원본이 없어졌어요)' : '현재 적용 중'}</span>
          <strong>{current.name}</strong>
          <small>{current.guideline}{current.effectiveFrom ? ` · ${current.effectiveFrom} 시행 기준` : ''}</small>
        </div>
        {isRegulationDbPack(current) && !missing && <em className="pack-verified">근거 검증됨</em>}
      </div>
      {missing && <p className="field-error"><AlertCircle /> 이 규정은 더 이상 제공되지 않아 개정 내용이 반영되지 않습니다. 아래에서 바꿔주세요.</p>}
      <label>바꿀 규정
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">규정을 선택하세요</option>
          {suggested.length > 0 && <optgroup label="이 과제의 규정이 갈린 것">
            {suggested.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </optgroup>}
          <optgroup label="그 밖의 규정">
            {options.filter((pack) => !suggestedIds.has(pack.id)).map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </optgroup>
        </select>
      </label>
      <p className="field-hint">비목 이름이 같으면 편성 금액이 유지됩니다. 새 규정에 없는 비목의 금액은 지워지며, 바꾸기 전에 무엇이 지워지는지 알려드려요.</p>
      <div className="settings-save">
        <button type="button" className={missing ? 'primary' : 'secondary'} disabled={!choice} onClick={apply}>규정 변경</button>
        {changed && <span className="save-ok"><CheckCircle2 /> 바뀌었어요 — 예산 편성에서 확인하세요</span>}
      </div>
    </div>
  </section>;
}

function Settings({ project, update, onReset }: { project: Project; update: (p: Project) => void; onReset: () => void }) {
  const initialForm = (p: Project) => ({ name: p.name, company: p.companyName, subsidy: String(p.subsidyAmount ?? p.totalBudget), subsidyRate: String(p.subsidyRate ?? 100), matchingCashRate: p.matchingCashRate != null ? String(p.matchingCashRate) : '', start: p.startDate, end: p.endDate, deadline: p.settlementDeadline, programName: p.programName ?? '' });
  const [form, setForm] = useState(initialForm(project));
  const [saved, setSaved] = useState(false);
  const sourceDocs = useSourceDocs(project, update);
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
  return <div className="page-content"><div className="page-title"><div><span className="eyebrow">운영 설정</span><h2>과제 설정</h2><p>적용 규정과 과제 기본 정보를 수정하고, 백업·복원과 초기화를 관리합니다.</p></div></div>
    <RulePackPanel project={project} update={update} />
    <section className="panel settings-panel"><div className="panel-head"><div><h3>과제 기본 정보</h3><p>수정 후 저장을 누르면 모든 화면에 바로 반영됩니다.</p></div></div>
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
    <DocUpdatePanel project={project} update={update} source={sourceDocs} />
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
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveProjectId());
  const [adding, setAdding] = useState(false); // 기존 과제가 있어도 "새 과제 등록" 마법사를 띄운다
  const [screen, setScreen] = useState<Screen>('overview');
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!isCloudEnabled);
  const [localMode, setLocalMode] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('local');
  const saveWarned = useRef(false);
  const project = projects.find((p) => p.id === activeId) ?? projects[0] ?? null;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => { saveActiveProjectId(project?.id ?? null); }, [project?.id]);

  // 규정DB(검증된 비목·상한·규칙)를 서버에서 받아 등록한다. 예산편성 화면의 비목이 여기서 온다.
  // 읽기에 로그인이 필요하므로 세션이 바뀔 때마다 다시 시도한다. 실패해도 번들 팩으로 동작한다.
  // packFor는 모듈 상태를 읽는 동기 함수라 React가 갱신을 감지하지 못한다 — 버전을 올려 다시 그린다.
  const [packStatus, setPackStatus] = useState<RegulationPackStatus | null>(null);
  const [, setPackVersion] = useState(0);
  useEffect(() => {
    let live = true;
    initRegulationPacks().then((status) => { if (!live) return; setPackStatus(status); setPackVersion((v) => v + 1); });
    return () => { live = false; };
  }, [session?.user.id]);

  useEffect(() => {
    if (!supabase) return;
    const apply = async (next: Session | null, initial = false) => {
      setCloudUser(next?.user.id ?? null);
      setSession(next);
      if (next) {
        // 클라우드에 데이터가 있으면 내려받는다. 없을 때는 "로그인 없이 만든(owner='local')" 로컬
        // 데이터만 이 계정으로 이전한다 — 다른 계정이 이 브라우저에 남긴 사본을 새 계정으로
        // 복사하면 안 되기 때문 (그 데이터는 원래 계정 클라우드에 이미 있다).
        const cloudProjects = await fetchCloudProjects();
        if (cloudProjects.length) {
          setProjects(cloudProjects);
          setActiveId((prev) => cloudProjects.some((p) => p.id === prev) ? prev : cloudProjects[0].id);
          setSyncState('synced');
        } else if (projectsRef.current.length && (loadProjectOwner() ?? 'local') === 'local') {
          let ok = true;
          for (const p of projectsRef.current) ok = (await saveCloudProject(p)) && ok;
          setSyncState(ok ? 'synced' : 'error');
        } else {
          if (projectsRef.current.length) setProjects([]); // 이전 계정의 잔재는 치우고 새 과제 등록부터 시작
          setSyncState('synced');
        }
      } else setSyncState('local');
      if (initial) setAuthChecked(true);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session, true));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // 로그아웃하면 이 브라우저의 과제 사본도 치운다 — 데이터는 그 계정 클라우드에 남아 있고,
      // 남겨두면 다음에 로그인하는 다른 계정에 이전 계정 과제가 노출·복사될 수 있다.
      if (event === 'SIGNED_OUT') setProjects([]);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') apply(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const saved = saveProjectsLocal(projects);
    saveProjectOwner(projects.length ? (session?.user.id ?? 'local') : null);
    if (!saved && !saveWarned.current) {
      saveWarned.current = true;
      alert('브라우저 저장 공간이 부족해 변경 내용을 저장하지 못했습니다. 과제 설정 화면에서 백업 JSON을 내보내 데이터를 보관해주세요.');
    }
    if (saved) saveWarned.current = false;
    // 클라우드 저장은 입력이 잦아도 부담이 없도록 0.8초 디바운스로 미룬다.
    // 변경은 항상 "현재 열려 있는 과제"에서만 일어나므로 그 과제만 저장한다 (삭제는 reset에서 별도 처리).
    const current = projectRef.current;
    if (session && current) {
      setSyncState('saving');
      const timer = setTimeout(async () => setSyncState(await saveCloudProject(current) ? 'synced' : 'error'), 800);
      return () => clearTimeout(timer);
    }
  }, [projects, session]);

  const logout = async () => { await signOutCloud(); setLocalMode(false); };
  if (!authChecked) return <div className="auth-splash"><div className="brand-mark"><Check /></div> 계정 확인 중…</div>;
  if (isCloudEnabled && !session && !localMode) return <AuthScreen onLocal={() => setLocalMode(true)} />;
  const handleCreate = (created: Project) => {
    setProjects((list) => [...list, created]);
    setActiveId(created.id);
    setAdding(false);
    setScreen('overview');
  };
  if (!project || adding) return <SetupWizard onCreate={handleCreate} onCancel={project && adding ? () => setAdding(false) : undefined} />;
  const update = (next: Project) => {
    const currentId = project.id;
    setProjects((list) => list.map((p) => p.id === currentId ? next : p));
    if (next.id !== currentId) setActiveId(next.id); // 백업 복원처럼 과제 id가 바뀌는 경우
  };
  const reset = async () => {
    if (!confirm(`"${project.name}" 과제를 삭제할까요? ${session ? '클라우드와 이 브라우저에서' : '이 브라우저에서'} 이 과제만 삭제되고 다른 과제는 유지됩니다.${session ? '\n(계정을 바꾸려는 거라면 삭제 대신 "로그아웃"을 사용하세요.)' : ''}`)) return;
    const evidenceIds = collectEvidenceIds(project);
    if (evidenceIds.length && confirm(`업로드한 증빙 파일 ${evidenceIds.length}개도 함께 삭제할까요?\n[확인] 파일까지 완전 삭제  [취소] 파일은 남겨두기`)) {
      try { await deleteEvidence(evidenceIds); } catch { alert('증빙 파일 삭제에 실패했습니다. 저장 공간에 파일이 남아 있을 수 있습니다.'); }
    }
    if (session) await deleteCloudProject(project.id);
    setProjects((list) => list.filter((p) => p.id !== project.id));
    setActiveId(null);
  };
  return <div className="app-shell"><Sidebar screen={screen} setScreen={setScreen} project={project} projects={projects} onSelect={(id) => { setActiveId(id); setScreen('overview'); }} onAdd={() => setAdding(true)} onReset={reset} account={session?.user.email ?? null} sync={syncState} onLogout={logout} /><main className="main"><Header project={project} />{screen === 'overview' && <Overview project={project} setScreen={setScreen} />}{screen === 'budget' && <Budget project={project} update={update} setScreen={setScreen} />}{screen === 'spending' && <Spending project={project} update={update} />}{screen === 'change' && <ChangeManagement project={project} update={update} />}{screen === 'team' && <Team project={project} update={update} setScreen={setScreen} />}{screen === 'settings' && <Settings project={project} update={update} onReset={reset} />}</main></div>;
}
