import { describe, expect, it } from 'vitest';
import { agencyCounts, budgetComposition, isEnded, overviewOrder, periodProgress, portfolioTotals, subItemComposition } from './portfolio';
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

describe('편성 구성 (③ 그래프)', () => {
  it('사업 간 합산은 비목 이름 기준이다 — 코드가 다른 팩(PRE_*)도 같은 이름이면 합쳐진다', () => {
    const composition = budgetComposition([
      project({ id: 'a', budgets: [
        { categoryId: 'DIRECT_LABOR', amount: 50_000_000 },
        { categoryId: 'DIRECT_ACTIVITY', amount: 20_000_000 },
      ], packId: 'nrd2026-forprofit' }),
      project({ id: 'b', budgets: [
        { categoryId: 'PRE_LABOR', amount: 30_000_000 },
        { categoryId: 'PRE_MATERIAL', amount: 10_000_000 },
      ], packId: 'prestartup2026' }),
    ]);
    expect(composition[0]).toEqual({ name: '인건비', amount: 80_000_000 });   // 두 팩의 인건비가 하나로
    expect(composition.map((slice) => slice.name)).toContain('재료비');
    // 0원 비목은 나오지 않고 큰 순으로 정렬된다
    expect(composition.every((slice) => slice.amount > 0)).toBe(true);
  });

  it('세목 드릴다운 — 세목이 있으면 세목으로, 없으면 비목 자체로 편다', () => {
    const subs = subItemComposition(project({
      packId: 'nrd2026-forprofit',
      budgets: [
        { categoryId: 'DIRECT_ACTIVITY', amount: 30_000_000, subItems: [
          { id: 's1', name: '회의비', amount: 10_000_000 },
          { id: 's2', name: '출장비', amount: 20_000_000 },
        ] },
        { categoryId: 'DIRECT_LABOR', amount: 40_000_000 },
      ],
    }));
    expect(subs.map((slice) => slice.name)).toEqual(['인건비', '출장비', '회의비']);
    expect(subs.find((slice) => slice.name === '출장비')?.category).toBe('연구활동비');
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
