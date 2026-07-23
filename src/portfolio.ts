// ---- R&D 총괄 대시보드 집계 ----
// 화면(한눈에 보기)은 과제 하나가 아니라 등록된 과제 전체를 본다. 여기의 함수들은
// 과제 배열을 받아 총괄 숫자를 만드는 순수 계산만 담당한다.
// 기획: docs/superpowers/specs/2026-07-23-portfolio-dashboard.md
import { categoryOf, packFor } from './rules';
import { evidenceReadiness, monthSequence, spendingMatrix } from './spending';
import type { BudgetCategoryId, Project } from './types';

// 날짜는 모두 'YYYY-MM-DD' 문자열이라 사전순 비교가 곧 날짜 비교다.
export const isEnded = (project: Project, today: string): boolean =>
  !!project.endDate && project.endDate < today;

export interface PortfolioTotals {
  projects: number;
  active: number;            // 진행 중 (종료일이 지나지 않은 과제)
  totalBudget: number;       // 전체 사업비 (총사업비 합)
  totalSubsidy: number;      // 지원금 합
  missingEvidence: number;   // 미완료 증빙 총 건수
}

// 종료 과제도 합계에 포함한다 (사용자 결정) — 구분은 목록의 "종료" 배지가 담당한다.
export const portfolioTotals = (projects: Project[], today: string): PortfolioTotals => ({
  projects: projects.length,
  active: projects.filter((project) => !isEnded(project, today)).length,
  totalBudget: projects.reduce((sum, project) => sum + project.totalBudget, 0),
  totalSubsidy: projects.reduce((sum, project) => sum + (project.subsidyAmount ?? project.totalBudget), 0),
  missingEvidence: projects.reduce((sum, project) =>
    sum + project.expenses.reduce((count, expense) => count + expense.evidence.filter((item) => !item.completed).length, 0), 0),
});

// 주관기관(부처·전문기관)별 과제 수 — 3책 5공 확인은 부처별로 몇 건을 수행 중인지에서 시작한다.
export const agencyCounts = (projects: Project[]): { agency: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const agency = project.agency.trim() || '기관 미입력';
    counts.set(agency, (counts.get(agency) ?? 0) + 1);
  }
  return [...counts].map(([agency, count]) => ({ agency, count }))
    .sort((a, b) => b.count - a.count || a.agency.localeCompare(b.agency));
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
// 집행건의 fundingSource 로 지원금/민간 현금/민간 현물 사용액을 가른다.
// 재원을 안 적은 집행건(이 필드가 생기기 전 데이터)은 "미구분"으로 따로 센다 —
// 어림잡아 아무 재원에 넣으면 편성 대비 초과 경고를 믿을 수 없게 된다.
export interface FundingUsage { subsidy: number; matchingCash: number; matchingInKind: number; unassigned: number; total: number }

export const fundingUsage = (project: Project): FundingUsage => {
  const usage: FundingUsage = { subsidy: 0, matchingCash: 0, matchingInKind: 0, unassigned: 0, total: 0 };
  for (const expense of project.expenses) {
    usage.total += expense.amount;
    if (expense.fundingSource === 'subsidy') usage.subsidy += expense.amount;
    else if (expense.fundingSource === 'matching_cash') usage.matchingCash += expense.amount;
    else if (expense.fundingSource === 'matching_inkind') usage.matchingInKind += expense.amount;
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

// ---- 연구인력 참여율 현황표 (④-3) ----
// 사람 합치기는 이름 기준이다 — 과제마다 따로 입력되고 공통 인물 ID가 없다.
// 표기가 다르면("박연구"/"박연구원") 다른 사람으로 집계되므로 화면이 그 사실을 안내한다.
export interface PersonRow {
  name: string;
  total: number;        // 등록 과제 참여율 합 + 외부 참여율
  external: number;     // 외부(미등록) 과제 참여율 — 과제마다 다르게 적혔으면 최대값 (중복 합산 방지)
  leadCount: number;    // 연구책임자 수 (3책)
  projects: { id: string; name: string; rate: number; isLead: boolean }[];
}

export const participationTable = (projects: Project[]): PersonRow[] => {
  const people = new Map<string, PersonRow>();
  for (const project of projects) {
    for (const participant of project.participants) {
      const name = participant.name.trim();
      if (!name) continue;
      const row = people.get(name) ?? { name, total: 0, external: 0, leadCount: 0, projects: [] };
      row.projects.push({ id: project.id, name: project.name, rate: participant.projectRate, isLead: !!participant.isLead });
      row.external = Math.max(row.external, participant.externalRate || 0);
      if (participant.isLead) row.leadCount += 1;
      people.set(name, row);
    }
  }
  return [...people.values()]
    .map((row) => ({ ...row, total: row.projects.reduce((sum, entry) => sum + entry.rate, 0) + row.external }))
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
