// ---- R&D 총괄 대시보드 집계 ----
// 화면(한눈에 보기)은 과제 하나가 아니라 등록된 과제 전체를 본다. 여기의 함수들은
// 과제 배열을 받아 총괄 숫자를 만드는 순수 계산만 담당한다.
// 기획: docs/superpowers/specs/2026-07-23-portfolio-dashboard.md
import { categoryOf, packFor } from './rules';
import type { Project } from './types';

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

// 목록 순서: 진행 중(종료일 가까운 순) → 종료(최근 종료 먼저). 종료 과제는 합계에는 남기고
// 자리만 뒤로 보낸다.
export const overviewOrder = (projects: Project[], today: string): Project[] =>
  [...projects].sort((a, b) => {
    const endedA = isEnded(a, today);
    const endedB = isEnded(b, today);
    if (endedA !== endedB) return Number(endedA) - Number(endedB);
    return endedA ? b.endDate.localeCompare(a.endDate) : a.endDate.localeCompare(b.endDate);
  });
