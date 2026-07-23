import { describe, expect, it } from 'vitest';
import { budgetComposition, evidenceGaps, fundingUsage, isEnded, overviewOrder, participationTable, periodProgress, planTodos, portfolioTotals, subItemComposition } from './portfolio';
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
    expect(totals).toEqual({ projects: 3, active: 2, totalBudget: 350_000_000, totalSubsidy: 290_000_000 });
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

describe('재원별 사용액 (②)', () => {
  it('집행건의 재원 입력으로 가르고, 안 적은 건은 미구분으로 센다', () => {
    const expense = (amount: number, fundingSource?: 'subsidy' | 'matching_cash' | 'matching_inkind') => ({
      id: `e${amount}`, date: '2026-05-01', categoryId: 'LABOR', amount, purpose: '', vendor: '',
      evidence: [], ...(fundingSource ? { fundingSource } : {}),
    });
    const usage = fundingUsage(project({
      expenses: [expense(100, 'subsidy'), expense(30, 'matching_cash'), expense(20, 'matching_inkind'), expense(7)],
    }));
    expect(usage).toEqual({ subsidy: 100, matchingCash: 30, matchingInKind: 20, unassigned: 7, total: 157 });
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

describe('월별 계획 체크리스트 (④-1)', () => {
  // 2026-01~12 과제, 인건비 1,200만 → 균등분할 월 100만. 1월만 60만 집행 (미달), 7월 120만 (완료).
  const planned = () => project({
    packId: 'nrd2026-forprofit',
    budgets: [{ categoryId: 'DIRECT_LABOR', amount: 12_000_000 }],
    expenses: [
      { id: 'e1', date: '2026-01-15', categoryId: 'DIRECT_LABOR', amount: 600_000, purpose: '', vendor: '', evidence: [], createdAt: '' },
      { id: 'e2', date: '2026-07-10', categoryId: 'DIRECT_LABOR', amount: 1_200_000, purpose: '', vendor: '', evidence: [], createdAt: '' },
    ],
  });

  it('이번 달까지의 미달 칸이 밀린 달부터 나오고, 이번 달 완료는 진행됨으로 담긴다', () => {
    const todos = planTodos([planned()], '2026-07');
    const pendingMonths = todos.filter((item) => !item.done).map((item) => item.month);
    expect(pendingMonths).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);   // 7월은 완료
    expect(todos.find((item) => item.month === '2026-01')).toMatchObject({ planned: 1_000_000, actual: 600_000, remaining: 400_000, nextMonth: '2026-02' });
    expect(todos.filter((item) => item.done).map((item) => item.month)).toEqual(['2026-07']);   // 지난달 완료는 노이즈라 안 담는다
  });

  it('사업기간 마지막 달은 다음 달이 없어 미루기 대상이 아니다', () => {
    const todos = planTodos([planned()], '2026-12');
    const last = todos.find((item) => item.month === '2026-12');
    expect(last?.nextMonth).toBeUndefined();
  });
});

describe('증빙 빠짐 (④-2)', () => {
  it('과제별로 비목·세목 그룹과 빠진 서류 수를 센다', () => {
    const gaps = evidenceGaps([project({
      packId: 'nrd2026-forprofit',
      expenses: [{
        id: 'e1', date: '2026-05-01', categoryId: 'DIRECT_ACTIVITY', subItemName: '회의비', amount: 1, purpose: '정기회의', vendor: '', createdAt: '',
        evidence: [
          { id: 'v1', label: '회의록', completed: false },
          { id: 'v2', label: '영수증', completed: false },
          { id: 'v3', label: '품의서', completed: true },
        ],
      }],
    })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].total).toBe(2);
    expect(gaps[0].groups).toEqual([{ label: '연구활동비 · 회의비', count: 2 }]);
  });
});

describe('연구인력 참여율 현황표 (④-3)', () => {
  it('이름으로 합쳐 총 참여율을 내고, 외부 참여율은 최대값 하나만 쓴다', () => {
    const rows = participationTable([
      project({ id: 'a', name: '과제A', participants: [
        { id: '1', name: '박연구', projectRate: 50, externalRate: 20, isLead: true },
        { id: '2', name: '김개발', projectRate: 30, externalRate: 0 },
      ] }),
      project({ id: 'b', name: '과제B', participants: [
        { id: '3', name: '박연구', projectRate: 40, externalRate: 10 },   // 외부 참여율이 과제마다 다르면 최대값
      ] }),
    ]);
    const park = rows.find((row) => row.name === '박연구')!;
    expect(park.total).toBe(110);      // 50 + 40 + 외부 20 (최대값 — 중복 합산하지 않는다)
    expect(park.external).toBe(20);
    expect(park.leadCount).toBe(1);
    expect(park.projects.map((entry) => entry.name)).toEqual(['과제A', '과제B']);
    expect(rows[0].name).toBe('박연구');   // 총 참여율 큰 순
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
