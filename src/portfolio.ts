// ---- R&D 총괄 대시보드 집계 ----
// 화면(한눈에 보기)은 과제 하나가 아니라 등록된 과제 전체를 본다. 여기의 함수들은
// 과제 배열을 받아 총괄 숫자를 만드는 순수 계산만 담당한다.
// 기획: docs/superpowers/specs/2026-07-23-portfolio-dashboard.md
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

// 목록 순서: 진행 중(종료일 가까운 순) → 종료(최근 종료 먼저). 종료 과제는 합계에는 남기고
// 자리만 뒤로 보낸다.
export const overviewOrder = (projects: Project[], today: string): Project[] =>
  [...projects].sort((a, b) => {
    const endedA = isEnded(a, today);
    const endedB = isEnded(b, today);
    if (endedA !== endedB) return Number(endedA) - Number(endedB);
    return endedA ? b.endDate.localeCompare(a.endDate) : a.endDate.localeCompare(b.endDate);
  });
