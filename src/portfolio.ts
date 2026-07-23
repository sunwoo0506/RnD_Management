// ---- R&D 총괄 대시보드 집계 ----
// 화면(한눈에 보기)은 과제 하나가 아니라 등록된 과제 전체를 본다. 여기의 함수들은
// 과제 배열을 받아 총괄 숫자를 만드는 순수 계산만 담당한다.
// 기획: docs/superpowers/specs/2026-07-23-portfolio-dashboard.md
import { categoryOf, fundingBreakdown, packFor } from './rules';
import { evidenceReadiness, monthSequence, spendingMatrix } from './spending';
import type { BudgetCategoryId, Project } from './types';

// 총괄 화면의 금액은 천원 단위로 줄여 쓴다 — 원 단위는 칸을 너무 차지한다 (사용자 결정).
export const formatThousandWon = (value: number): string => `${Math.round(value / 1000).toLocaleString('ko-KR')}천원`;

// 날짜는 모두 'YYYY-MM-DD' 문자열이라 사전순 비교가 곧 날짜 비교다.
export const isEnded = (project: Project, today: string): boolean =>
  !!project.endDate && project.endDate < today;

export interface PortfolioTotals {
  projects: number;
  active: number;            // 진행 중 (종료일이 지나지 않은 과제)
  totalBudget: number;       // 전체 사업비 (총사업비 합)
  totalSubsidy: number;      // 지원금 합
  matching: number;          // 민간부담금 합
  matchingCash: number;      //   그중 현금 (현금·현물 비율을 안 적은 과제는 나누지 않고 합계에만 잡힌다)
  matchingInKind: number;    //   그중 현물
}

// 종료 과제도 합계에 포함한다 (사용자 결정) — 구분은 목록의 "종료" 배지가 담당한다.
export const portfolioTotals = (projects: Project[], today: string): PortfolioTotals => {
  const fundings = projects.map((project) => fundingBreakdown(project));
  return {
    projects: projects.length,
    active: projects.filter((project) => !isEnded(project, today)).length,
    totalBudget: projects.reduce((sum, project) => sum + project.totalBudget, 0),
    totalSubsidy: projects.reduce((sum, project) => sum + (project.subsidyAmount ?? project.totalBudget), 0),
    matching: fundings.reduce((sum, funding) => sum + funding.matching, 0),
    matchingCash: fundings.reduce((sum, funding) => sum + funding.matchingCash, 0),
    matchingInKind: fundings.reduce((sum, funding) => sum + funding.matchingInKind, 0),
  };
};

// 사업기간 진행률 % (경과일 / 전체일). 기간이 없거나 어긋나면 0.
export const periodProgress = (project: Project, today: string): number => {
  const start = Date.parse(project.startDate);
  const end = Date.parse(project.endDate);
  const now = Date.parse(today);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || end <= start) return 0;
  return Math.min(100, Math.max(0, Math.round((now - start) / (end - start) * 100)));
};

// ---- 재원별 사용액 (② 사업별 사업비 구성) ----
// 집행건의 fundingSource 로 현금/현물 사용액을 가른다 — 정산이 그 두 갈래로 맞춰지기 때문이다.
// 지원금과 민간부담 현금을 따로 묻던 시절의 값(subsidy·matching_cash)은 모두 현금으로 친다.
// 재원을 안 적은 집행건(이 필드가 생기기 전 데이터)은 "미구분"으로 따로 센다 —
// 어림잡아 아무 재원에 넣으면 편성 대비 초과 경고를 믿을 수 없게 된다.
export interface FundingUsage { cash: number; inKind: number; unassigned: number; total: number }

export const fundingUsage = (project: Project): FundingUsage => {
  const usage: FundingUsage = { cash: 0, inKind: 0, unassigned: 0, total: 0 };
  for (const expense of project.expenses) {
    usage.total += expense.amount;
    const source = expense.fundingSource;
    if (source === 'inkind' || source === 'matching_inkind') usage.inKind += expense.amount;
    else if (source === 'cash' || source === 'subsidy' || source === 'matching_cash') usage.cash += expense.amount;
    else usage.unassigned += expense.amount;
  }
  return usage;
};

// ---- 편성 구성 (③ 그래프) ----
// 사업 간 합산은 비목 "이름" 기준이다. 비목 코드는 대체로 통일돼 있지만 예비창업패키지는
// PRE_* 코드를 써서, 코드로 합치면 같은 인건비가 두 조각으로 갈라진다. 이름(인건비·재료비…)이
// 사업을 가로지르는 실제 공통 축이다.
export interface CompositionSlice { name: string; amount: number }

const categoryName = (project: Project, categoryId: string): string =>
  categoryOf(packFor(project), categoryId).name.trim();

// 과제 하나의 비목별 편성 (금액 0원 비목 제외, 큰 순)
export const projectComposition = (project: Project): CompositionSlice[] =>
  project.budgets
    .filter((item) => item.amount > 0)
    .map((item) => ({ name: categoryName(project, item.categoryId), amount: item.amount }))
    .sort((a, b) => b.amount - a.amount);

// 전체 과제의 비목별 편성 합 (큰 순) — 도넛과 색 배정의 기준.
// 색은 이 순서로 고정 배정한다: 필터로 과제가 빠져도 남은 비목의 색이 바뀌지 않아야 한다.
export const budgetComposition = (projects: Project[]): CompositionSlice[] => {
  const sums = new Map<string, number>();
  for (const project of projects) {
    for (const slice of projectComposition(project)) {
      sums.set(slice.name, (sums.get(slice.name) ?? 0) + slice.amount);
    }
  }
  return [...sums].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
};

// 과제 하나의 세목 구성 (드릴다운). 세목을 나누지 않은 비목은 비목 자체가 한 줄이 된다.
export interface SubItemSlice { category: string; name: string; amount: number }
export const subItemComposition = (project: Project): SubItemSlice[] =>
  project.budgets
    .filter((item) => item.amount > 0)
    .flatMap((item) => {
      const category = categoryName(project, item.categoryId);
      const subs = (item.subItems ?? []).filter((sub) => sub.amount > 0);
      return subs.length
        ? subs.map((sub) => ({ category, name: sub.name, amount: sub.amount }))
        : [{ category, name: category, amount: item.amount }];
    })
    .sort((a, b) => b.amount - a.amount);

// ---- 월별 계획 체크리스트 (④-1) ----
// 진행/할 것은 저장하지 않고 금액으로 판정한다: 그 달 집행액이 계획액에 도달하면 진행됨.
// 별도 체크 필드가 없으니 화면은 항상 실제 데이터와 일치한다 (사용자 결정).
export interface PlanTodoItem {
  projectId: string;
  projectName: string;
  month: string;                 // 'YYYY-MM'
  categoryId: BudgetCategoryId;
  subItemId?: string;
  label: string;                 // 비목 또는 "비목 · 세목"
  planned: number;
  actual: number;
  remaining: number;
  done: boolean;
  // 다음달로 미루기에 필요한 값 — 다음 달이 사업기간 밖이면 미룰 수 없다.
  nextMonth?: string;
  nextPlan?: number;
}

const nextMonthOf = (month: string): string => {
  const [year, mm] = month.split('-').map(Number);
  return mm === 12 ? `${year + 1}-01` : `${year}-${String(mm + 1).padStart(2, '0')}`;
};

// 이번 달까지의 계획 칸을 체크리스트로 편다. 지난달 미달분도 함께 나와 밀린 것이 사라지지 않는다.
// 진행됨(done)은 이번 달 것만 담는다 — 지난달 완료까지 쌓으면 목록이 소음이 된다.
export const planTodos = (projects: Project[], currentMonth: string): PlanTodoItem[] => {
  const items: PlanTodoItem[] = [];
  for (const project of projects) {
    const allMonths = monthSequence(project.startDate, project.endDate);
    const shown = allMonths.filter((month) => month <= currentMonth);
    if (!shown.length) continue;
    // 다음 달 계획(미루기 대상 값)까지 한 번에 읽는다
    const withNext = allMonths.filter((month) => month <= nextMonthOf(currentMonth));
    const matrix = spendingMatrix(packFor(project), project, withNext);
    for (const row of matrix.rows) {
      const leaves = row.planEditable
        ? [{ label: row.name, categoryId: row.categoryId, subItemId: undefined as string | undefined, cells: row.cells }]
        : row.subRows.filter((sub) => sub.planEditable).map((sub) => ({ label: `${row.name} · ${sub.name}`, categoryId: row.categoryId, subItemId: sub.subItemId, cells: sub.cells }));
      for (const leaf of leaves) {
        for (const cell of leaf.cells) {
          if (cell.month > currentMonth || cell.plan <= 0) continue;
          const done = cell.actual >= cell.plan;
          if (done && cell.month !== currentMonth) continue;
          const next = nextMonthOf(cell.month);
          const nextCell = allMonths.includes(next) ? leaf.cells.find((entry) => entry.month === next) : undefined;
          items.push({
            projectId: project.id, projectName: project.name, month: cell.month,
            categoryId: leaf.categoryId, subItemId: leaf.subItemId, label: leaf.label,
            planned: cell.plan, actual: cell.actual, remaining: cell.plan - cell.actual, done,
            ...(nextCell ? { nextMonth: next, nextPlan: nextCell.plan } : {}),
          });
        }
      }
    }
  }
  // 밀린 것(오래된 달)부터, 같은 달 안에서는 남은 금액 큰 순
  return items.sort((a, b) => Number(a.done) - Number(b.done) || a.month.localeCompare(b.month) || b.remaining - a.remaining);
};

// ---- 증빙 빠짐 (④-2) ----
// 과제마다 evidenceReadiness를 돌려 사업별 ▸ 세목별로 묶는다.
export interface EvidenceGap {
  projectId: string;
  projectName: string;
  total: number;                                  // 빠진 서류 수
  groups: { label: string; count: number }[];     // 비목(·세목)별
}

export const evidenceGaps = (projects: Project[]): EvidenceGap[] =>
  projects.map((project) => {
    const readiness = evidenceReadiness(packFor(project), project);
    const groups = new Map<string, number>();
    for (const todo of readiness.todos) {
      const label = todo.subItemName ? `${todo.categoryName} · ${todo.subItemName}` : todo.categoryName;
      groups.set(label, (groups.get(label) ?? 0) + todo.missing.length);
    }
    return {
      projectId: project.id, projectName: project.name,
      total: readiness.total - readiness.done,
      groups: [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    };
  }).filter((gap) => gap.total > 0);

// ---- 지금 확인할 일 요약 (④) ----
// 상세(집행건별 목록·계획 수정)는 각 과제의 집행·증빙 화면이 담당한다 (사용자 결정).
// 총괄은 사업별 건수 요약과, 14일 넘게 밀린 것의 텍스트 알림만 낸다.
export interface ProjectActionSummary {
  projectId: string;
  projectName: string;
  pendingPlans: number;      // 미집행 — 이번 달까지 계획액에 못 미친 칸 수
  missingEvidence: number;   // 증빙 미완료 서류 수
}

export const actionSummary = (projects: Project[], currentMonth: string): ProjectActionSummary[] => {
  const pending = planTodos(projects, currentMonth).filter((item) => !item.done);
  return projects.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    pendingPlans: pending.filter((item) => item.projectId === project.id).length,
    missingEvidence: project.expenses.reduce((sum, expense) => sum + expense.evidence.filter((item) => !item.completed).length, 0),
  }));
};

// 14일 넘게 밀린 것만 텍스트로 알린다 — 목록 전체를 되풀이하면 급한 것이 묻힌다.
export interface OverdueAlert {
  projectId: string;
  projectName: string;
  kind: 'plan' | 'evidence';
  label: string;    // 무엇이 밀렸는지 (계획: "6월 인건비 계획", 증빙: 집행 용도)
  days: number;     // 기준일(계획은 그 달의 말일, 증빙은 집행일)로부터 지난 일수
  count?: number;   // 증빙: 빠진 서류 수
}

const daysSince = (date: string, today: string): number =>
  Math.floor((Date.parse(today) - Date.parse(date)) / 86_400_000);

const monthEnd = (month: string): string => {
  const [year, mm] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mm, 0)).toISOString().slice(0, 10);
};

export const overdueAlerts = (projects: Project[], today: string, limitDays = 14): OverdueAlert[] => {
  const alerts: OverdueAlert[] = [];
  // 미집행 계획 — 그 달이 끝나고도 limitDays 넘게 지난 것
  for (const item of planTodos(projects, today.slice(0, 7)).filter((entry) => !entry.done)) {
    const days = daysSince(monthEnd(item.month), today);
    if (days > limitDays) {
      alerts.push({ projectId: item.projectId, projectName: item.projectName, kind: 'plan', label: `${Number(item.month.slice(5, 7))}월 ${item.label} 계획 미집행`, days });
    }
  }
  // 증빙 미완료 — 집행일로부터 limitDays 넘게 지난 것
  for (const project of projects) {
    for (const expense of project.expenses) {
      const missing = expense.evidence.filter((item) => !item.completed).length;
      if (!missing) continue;
      const days = daysSince(expense.date, today);
      if (days > limitDays) {
        alerts.push({ projectId: project.id, projectName: project.name, kind: 'evidence', label: `"${expense.purpose}" 증빙 미완료`, days, count: missing });
      }
    }
  }
  return alerts.sort((a, b) => b.days - a.days);
};

// 같은 이름이 "다른" 등록 과제들에서 갖는 참여율 합 — 인건비 화면의 타 과제 칸을 자동으로 채운다.
// 다른 과제 어디에도 없는 이름이면 null — 그때는 수동 입력을 유지한다 (앱 밖 과제일 수 있다).
export const otherProjectsRate = (projects: Project[], currentProjectId: string, name: string): number | null => {
  const target = name.trim();
  if (!target) return null;
  let found = false;
  let sum = 0;
  for (const project of projects) {
    if (project.id === currentProjectId) continue;
    for (const participant of project.participants) {
      if (participant.name.trim() !== target) continue;
      found = true;
      sum += participant.projectRate;
    }
  }
  return found ? sum : null;
};

// ---- 연구인력 참여율 현황표 (④-3) ----
// 사람 합치기는 이름 기준이다 — 과제마다 따로 입력되고 공통 인물 ID가 없다.
// 표기가 다르면("박연구"/"박연구원") 다른 사람으로 집계되므로 화면이 그 사실을 안내한다.
// 외부(타 과제) 참여율은 세지 않는다 — 모든 과제를 앱에서 관리하면 중복이다 (사용자 결정).
export interface PersonRow {
  name: string;
  total: number;        // 등록 과제 참여율 합
  leadCount: number;    // 연구책임자 수 (3책)
  projects: { id: string; name: string; rate: number; isLead: boolean }[];
}

export const participationTable = (projects: Project[]): PersonRow[] => {
  const people = new Map<string, PersonRow>();
  for (const project of projects) {
    for (const participant of project.participants) {
      const name = participant.name.trim();
      if (!name) continue;
      const row = people.get(name) ?? { name, total: 0, leadCount: 0, projects: [] };
      row.projects.push({ id: project.id, name: project.name, rate: participant.projectRate, isLead: !!participant.isLead });
      if (participant.isLead) row.leadCount += 1;
      people.set(name, row);
    }
  }
  return [...people.values()]
    .map((row) => ({ ...row, total: row.projects.reduce((sum, entry) => sum + entry.rate, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
};

// 목록 순서: 진행 중(종료일 가까운 순) → 종료(최근 종료 먼저). 종료 과제는 합계에는 남기고
// 자리만 뒤로 보낸다.
export const overviewOrder = (projects: Project[], today: string): Project[] =>
  [...projects].sort((a, b) => {
    const endedA = isEnded(a, today);
    const endedB = isEnded(b, today);
    if (endedA !== endedB) return Number(endedA) - Number(endedB);
    return endedA ? b.endDate.localeCompare(a.endDate) : a.endDate.localeCompare(b.endDate);
  });
