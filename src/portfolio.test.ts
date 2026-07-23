import { describe, expect, it } from 'vitest';
import { agencyCounts, isEnded, overviewOrder, periodProgress, portfolioTotals } from './portfolio';
import type { Project } from './types';

// 총괄 대시보드는 과제 전체를 합쳐 보여준다 — 합계·부처별 수·진행률·정렬이 이 파일의 계약이다.
const project = (over: Partial<Project>): Project => ({
  id: 'p', name: '과제', totalBudget: 100_000_000, startDate: '2026-01-01', endDate: '2026-12-31',
  settlementDeadline: '2027-01-31', agency: '중소벤처기업부', companyName: '테스트랩', packId: 'legacy-rnd',
  members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [], createdAt: '2026-01-01',
  ...over,
});

const TODAY = '2026-07-23';

describe('총괄 합계', () => {
  it('전체 사업비·지원금·미완료 증빙을 과제 전체로 합친다 (종료 과제 포함)', () => {
    const totals = portfolioTotals([
      project({ id: 'a', totalBudget: 200_000_000, subsidyAmount: 150_000_000 }),
      project({ id: 'b', totalBudget: 100_000_000 }),   // 지원금 미입력 → 전액 지원으로 취급
      project({
        id: 'c', totalBudget: 50_000_000, subsidyAmount: 40_000_000, endDate: '2026-06-30',   // 종료됨
        expenses: [{
          id: 'e1', date: '2026-05-01', categoryId: 'LABOR', amount: 1, purpose: '', vendor: '',
          evidence: [{ id: 'v1', label: '영수증', completed: false }, { id: 'v2', label: '품의서', completed: true }],
        }],
      }),
    ], TODAY);
    expect(totals).toEqual({ projects: 3, active: 2, totalBudget: 350_000_000, totalSubsidy: 290_000_000, missingEvidence: 1 });
  });
});

describe('부처별 과제 수 (3책 5공 확인용)', () => {
  it('주관기관별로 세고 많은 순으로 정렬한다', () => {
    const counts = agencyCounts([
      project({ id: 'a', agency: '중소벤처기업부' }),
      project({ id: 'b', agency: '중소벤처기업부' }),
      project({ id: 'c', agency: '산업통상자원부' }),
      project({ id: 'd', agency: '  ' }),   // 빈 기관명
    ]);
    expect(counts).toEqual([
      { agency: '중소벤처기업부', count: 2 },
      { agency: '기관 미입력', count: 1 },
      { agency: '산업통상자원부', count: 1 },
    ]);
  });
});

describe('기간 진행률', () => {
  it('경과일 비율로 계산하고 0~100으로 자른다', () => {
    expect(periodProgress(project({ startDate: '2026-01-01', endDate: '2026-12-31' }), '2026-07-02')).toBe(50);
    expect(periodProgress(project({}), '2025-01-01')).toBe(0);     // 시작 전
    expect(periodProgress(project({}), '2027-06-01')).toBe(100);   // 종료 후
    expect(periodProgress(project({ startDate: '', endDate: '' }), TODAY)).toBe(0);   // 기간 없음
  });
});

describe('목록 정렬', () => {
  it('진행 중(마감 가까운 순)이 앞, 종료가 뒤로 간다', () => {
    const ordered = overviewOrder([
      project({ id: 'ended-old', endDate: '2025-12-31' }),
      project({ id: 'due-late', endDate: '2027-06-30' }),
      project({ id: 'ended-recent', endDate: '2026-06-30' }),
      project({ id: 'due-soon', endDate: '2026-09-30' }),
    ], TODAY);
    expect(ordered.map((p) => p.id)).toEqual(['due-soon', 'due-late', 'ended-recent', 'ended-old']);
    expect(isEnded(ordered[2], TODAY)).toBe(true);
  });
});
