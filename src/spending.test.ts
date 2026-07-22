import { describe, expect, it } from 'vitest';
import { categorySpending, evidenceReadiness, monthSequence, spendingMatrix, splitEvenly, spendingTotals } from './spending';
import { getPack } from './rules';
import type { Expense, Project } from './types';

const pack = getPack('nrd2026-forprofit');
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const expense = (over: Partial<Expense> & { categoryId: string; amount: number }): Expense => ({
  id: `e${Math.random()}`, date: '2026-08-10', purpose: '집행', vendor: '거래처',
  evidence: [], createdAt: '2026-08-10T00:00:00.000Z', ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: '테스트 과제', totalBudget: 100_000_000,
  startDate: '2026-07-01', endDate: '2027-06-30', settlementDeadline: '2027-07-30',
  agency: '과기정통부', companyName: '테스트랩', packId: 'nrd2026-forprofit',
  members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [],
  createdAt: '2026-07-01T00:00:00.000Z', ...over,
});

describe('categorySpending', () => {
  it('비목별 예산·집행·잔액을 집계한다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 30_000_000 }],
      expenses: [expense({ categoryId: 'DIRECT_ACTIVITY', amount: 8_500_000 })],
    }));
    const activity = rows.find((row) => row.categoryId === 'DIRECT_ACTIVITY')!;
    expect(activity.budget).toBe(30_000_000);
    expect(activity.spent).toBe(8_500_000);
    expect(activity.remaining).toBe(21_500_000);
    expect(Math.round(activity.rate)).toBe(28);
    expect(activity.over).toBe(false);
  });

  it('세목이 편성된 비목은 세목별 하위 행을 만든다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 20_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }, { id: 's2', name: '출장비', amount: 12_000_000 }],
      }],
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', subItemName: '회의비', amount: 3_500_000 }),
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 's2', subItemName: '출장비', amount: 5_000_000 }),
      ],
    }));
    const subRows = rows.find((row) => row.categoryId === 'DIRECT_ACTIVITY')!.subRows;
    expect(subRows).toHaveLength(2);
    expect(subRows[0]).toMatchObject({ name: '회의비', budget: 8_000_000, spent: 3_500_000, remaining: 4_500_000 });
    expect(subRows[1]).toMatchObject({ name: '출장비', budget: 12_000_000, spent: 5_000_000, remaining: 7_000_000 });
  });

  it('세목을 나누지 않은 비목은 하위 행이 비어 있다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{ categoryId: 'DIRECT_LABOR', amount: 50_000_000 }],
      expenses: [expense({ categoryId: 'DIRECT_LABOR', amount: 12_000_000 })],
    }));
    expect(rows.find((row) => row.categoryId === 'DIRECT_LABOR')!.subRows).toEqual([]);
  });

  it('편성에서 사라진 세목의 집행건은 삭제된 세목 행으로 남는다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 8_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }],
      }],
      // s2(출장비)는 편성에서 지워졌지만 집행 이력은 남아 있다
      expenses: [expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 's2', subItemName: '출장비', amount: 2_000_000 })],
    }));
    const orphan = rows.find((row) => row.categoryId === 'DIRECT_ACTIVITY')!.subRows.find((sub) => sub.orphan);
    expect(orphan).toMatchObject({ name: '출장비', budget: 0, spent: 2_000_000, remaining: -2_000_000 });
  });

  it('세목이 나뉜 비목에 세목 없이 등록된 집행건은 미지정 행으로 모은다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 8_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }],
      }],
      expenses: [expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1_000_000 })],
    }));
    const subRows = rows.find((row) => row.categoryId === 'DIRECT_ACTIVITY')!.subRows;
    expect(subRows.find((sub) => !sub.subItemId && !sub.orphan)).toMatchObject({ spent: 1_000_000 });
  });

  it('세목이 나뉜 비목에서 세목 집행 합계는 비목 집행금액과 같다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 8_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 8_000_000 }],
      }],
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', subItemName: '회의비', amount: 3_000_000 }),
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 'gone', subItemName: '출장비', amount: 2_000_000 }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1_000_000 }),
      ],
    }));
    const row = rows.find((r) => r.categoryId === 'DIRECT_ACTIVITY')!;
    expect(row.subRows.reduce((sum, sub) => sum + sub.spent, 0)).toBe(row.spent);
    expect(row.spent).toBe(6_000_000);
  });

  it('예산을 넘겨 쓰면 잔액이 음수가 되고 초과로 표시한다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 1_000_000 }],
      expenses: [expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1_500_000 })],
    }));
    const row = rows.find((r) => r.categoryId === 'DIRECT_ACTIVITY')!;
    expect(row.remaining).toBe(-500_000);
    expect(row.over).toBe(true);
  });

  it('예산이 0원이면 소진율은 0으로 두고 나눗셈하지 않는다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 0 }],
      expenses: [expense({ categoryId: 'DIRECT_ACTIVITY', amount: 500_000 })],
    }));
    const row = rows.find((r) => r.categoryId === 'DIRECT_ACTIVITY')!;
    expect(row.rate).toBe(0);
    expect(Number.isFinite(row.rate)).toBe(true);
  });

  it('편성 확정 후에는 0원이고 집행도 없는 비목을 빼고 집계한다', () => {
    const confirmed = project({
      budgetConfirmed: true,
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 30_000_000 }, { categoryId: 'DIRECT_LABOR', amount: 0 }],
    });
    const ids = categorySpending(pack, confirmed).map((row) => row.categoryId);
    expect(ids).toContain('DIRECT_ACTIVITY');
    expect(ids).not.toContain('DIRECT_LABOR');
  });
});

describe('spendingTotals', () => {
  it('비목 행들을 합쳐 전체 예산·집행·잔액을 낸다', () => {
    const rows = categorySpending(pack, project({
      budgets: [{ categoryId: 'DIRECT_LABOR', amount: 50_000_000 }, { categoryId: 'DIRECT_ACTIVITY', amount: 30_000_000 }],
      expenses: [
        expense({ categoryId: 'DIRECT_LABOR', amount: 12_000_000 }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 8_500_000 }),
      ],
    }));
    expect(spendingTotals(rows)).toMatchObject({ budget: 80_000_000, spent: 20_500_000, remaining: 59_500_000 });
  });

  it('예산이 하나도 없으면 소진율은 0이다', () => {
    expect(spendingTotals([])).toMatchObject({ budget: 0, spent: 0, remaining: 0, rate: 0 });
  });
});

describe('evidenceReadiness', () => {
  const evidence = (label: string, completed = false) => ({ id: `${label}-${Math.random()}`, label, completed });

  it('집행건별로 무엇이 빠졌는지 알려준다', () => {
    const readiness = evidenceReadiness(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 10_000_000 }],
      expenses: [expense({
        categoryId: 'DIRECT_ACTIVITY', subItemName: '회의비', amount: 80_000, purpose: '정기 회의', date: '2026-08-10',
        evidence: [evidence('품의서', true), evidence('지출결의서'), evidence('회의록')],
      })],
    }));
    expect(readiness.todos).toHaveLength(1);
    expect(readiness.todos[0]).toMatchObject({
      purpose: '정기 회의', categoryName: '연구활동비', subItemName: '회의비',
      done: 1, total: 3, missing: ['지출결의서', '회의록'],
    });
  });

  it('증빙이 다 준비된 집행건은 할 일에서 빠진다', () => {
    const readiness = evidenceReadiness(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 10_000_000 }],
      expenses: [expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1000, evidence: [evidence('품의서', true)] })],
    }));
    expect(readiness.todos).toEqual([]);
    expect(readiness.readyExpenses).toBe(1);
    expect(readiness.rate).toBe(100);
  });

  it('서류 종류별로 모아 세고, 많이 밀린 것부터 준다', () => {
    const readiness = evidenceReadiness(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 10_000_000 }],
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1000, evidence: [evidence('품의서', true), evidence('지출결의서')] }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1000, evidence: [evidence('품의서', true), evidence('지출결의서')] }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1000, evidence: [evidence('품의서', true), evidence('회의록')] }),
      ],
    }));
    expect(readiness.byDocument[0]).toMatchObject({ label: '지출결의서', done: 0, total: 2 });
    expect(readiness.byDocument.find((entry) => entry.label === '품의서')).toMatchObject({ done: 3, total: 3 });
  });

  it('집행일이 오래된 것부터 세운다 — 정산이 급한 순서다', () => {
    const readiness = evidenceReadiness(pack, project({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 10_000_000 }],
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1000, purpose: '나중', date: '2026-11-01', evidence: [evidence('품의서')] }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1000, purpose: '먼저', date: '2026-07-05', evidence: [evidence('품의서')] }),
      ],
    }));
    expect(readiness.todos.map((todo) => todo.purpose)).toEqual(['먼저', '나중']);
  });

  it('집행건이 없으면 0으로 나누지 않는다', () => {
    const readiness = evidenceReadiness(pack, project());
    expect(readiness).toMatchObject({ done: 0, total: 0, rate: 0, readyExpenses: 0 });
    expect(Number.isFinite(readiness.rate)).toBe(true);
  });
});

describe('monthSequence', () => {
  it('시작월부터 종료월까지 YYYY-MM을 만든다', () => {
    const months = monthSequence('2026-07-01', '2027-06-30');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-07');
    expect(months.at(-1)).toBe('2027-06');
  });

  it('해를 넘겨도 이어진다', () => {
    expect(monthSequence('2026-11-01', '2027-02-28')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('같은 달이면 1개다', () => {
    expect(monthSequence('2026-07-01', '2026-07-31')).toEqual(['2026-07']);
  });

  it('날짜가 없거나 종료가 시작보다 빠르면 빈 배열이다', () => {
    expect(monthSequence(undefined, '2027-06-30')).toEqual([]);
    expect(monthSequence('2026-07-01', undefined)).toEqual([]);
    expect(monthSequence('2027-06-30', '2026-07-01')).toEqual([]);
    expect(monthSequence('알 수 없음', '2027-06-30')).toEqual([]);
  });
});

describe('splitEvenly', () => {
  it('나누어떨어지면 균등 분할한다', () => {
    expect(splitEvenly(12_000_000, 12)).toEqual(Array(12).fill(1_000_000));
  });

  it('나머지는 마지막 달에 몰아주고 합계는 예산과 정확히 같다', () => {
    const parts = splitEvenly(10_000_000, 12);
    expect(parts.slice(0, 11)).toEqual(Array(11).fill(833_333));
    expect(parts.at(-1)).toBe(10_000_000 - 833_333 * 11);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000_000);
  });

  it('월수가 0이면 빈 배열이다', () => {
    expect(splitEvenly(10_000_000, 0)).toEqual([]);
  });
});

describe('spendingMatrix', () => {
  const ALL = monthSequence('2026-07-01', '2027-06-30');   // 12개월
  // 연구활동비 1,200만 원 · 12개월 → 매달 100만 원
  const simple = (over: Partial<Project> = {}) => project({
    budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 12_000_000 }],
    budgetConfirmed: true, ...over,
  });
  const activityOf = (matrix: { rows: { categoryId: string }[] }) =>
    matrix.rows.find((row) => row.categoryId === 'DIRECT_ACTIVITY')!;

  it('비목을 행으로, 고른 달을 열로 펼친다', () => {
    const matrix = spendingMatrix(pack, simple(), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.cells).toHaveLength(12);
    expect(row.cells[0]).toMatchObject({ month: '2026-07', plan: 1_000_000, actual: 0 });
    expect(row.planEditable).toBe(true);
  });

  it('달을 숨겨도 각 달의 계획 금액은 달라지지 않는다', () => {
    // 균등분할은 언제나 사업기간 전체 월수 기준이다
    const shown = ['2026-09', '2027-01'];
    const matrix = spendingMatrix(pack, simple(), shown);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.cells.map((cell) => cell.month)).toEqual(shown);
    expect(row.cells.every((cell) => cell.plan === 1_000_000)).toBe(true);
  });

  it('사용자가 고친 달은 그 값을, 나머지는 자동 계산값을 쓴다', () => {
    const matrix = spendingMatrix(pack, simple({
      monthlyPlan: [{ categoryId: 'DIRECT_ACTIVITY', month: '2026-07', amount: 5_000_000 }],
    }), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.cells[0].plan).toBe(5_000_000);
    expect(row.cells[1].plan).toBe(1_000_000);
  });

  it('예산이 바뀌면 고치지 않은 달만 따라 움직인다', () => {
    const matrix = spendingMatrix(pack, simple({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 24_000_000 }],
      monthlyPlan: [{ categoryId: 'DIRECT_ACTIVITY', month: '2026-07', amount: 5_000_000 }],
    }), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.cells[0].plan).toBe(5_000_000);
    expect(row.cells[1].plan).toBe(2_000_000);
  });

  it('집행금액은 집행일이 속한 달에 잡힌다', () => {
    const matrix = spendingMatrix(pack, simple({
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 4_200_000, date: '2026-07-15' }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 900_000, date: '2026-08-02' }),
      ],
    }), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.cells[0].actual).toBe(4_200_000);
    expect(row.cells[1].actual).toBe(900_000);
  });

  it('세목이 나뉜 비목은 세목마다 행이 생기고, 비목 계획은 세목 합계가 된다', () => {
    const matrix = spendingMatrix(pack, simple({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 12_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 6_000_000 }, { id: 's2', name: '출장비', amount: 6_000_000 }],
      }],
      monthlyPlan: [{ categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', month: '2026-07', amount: 2_000_000 }],
    }), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.planEditable).toBe(false);                       // 세목 합계라 직접 고칠 수 없다
    expect(row.subRows.map((sub) => sub.name)).toEqual(['회의비', '출장비']);
    expect(row.subRows[0].planEditable).toBe(true);
    expect(row.subRows[0].cells[0].plan).toBe(2_000_000);       // 고친 회의비
    expect(row.subRows[1].cells[0].plan).toBe(500_000);         // 자동 출장비
    expect(row.cells[0].plan).toBe(2_500_000);                  // 비목 = 세목 합계
  });

  it('세목 집행은 세목 행에, 비목 행에는 합계로 잡힌다', () => {
    const matrix = spendingMatrix(pack, simple({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 12_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 6_000_000 }, { id: 's2', name: '출장비', amount: 6_000_000 }],
      }],
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 's1', amount: 700_000, date: '2026-07-15' }),
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 's2', amount: 300_000, date: '2026-07-20' }),
      ],
    }), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    expect(row.subRows[0].cells[0].actual).toBe(700_000);
    expect(row.subRows[1].cells[0].actual).toBe(300_000);
    expect(row.cells[0].actual).toBe(1_000_000);
  });

  it('삭제된 세목·미지정 행은 계획을 고칠 수 없다', () => {
    const matrix = spendingMatrix(pack, simple({
      budgets: [{
        categoryId: 'DIRECT_ACTIVITY', amount: 6_000_000,
        subItems: [{ id: 's1', name: '회의비', amount: 6_000_000 }],
      }],
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', subItemId: 'gone', subItemName: '출장비', amount: 200_000, date: '2026-07-15' }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 100_000, date: '2026-07-15' }),
      ],
    }), ALL);
    const row = activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number];
    for (const sub of row.subRows.filter((s) => s.orphan || !s.subItemId)) {
      expect(sub.planEditable).toBe(false);
      expect(sub.cells[0].plan).toBe(0);
    }
    // 집행은 그대로 잡혀서 비목 합계에 들어간다
    expect(row.cells[0].actual).toBe(300_000);
  });

  it('사업기간 밖 집행은 어느 달에도 넣지 않고 따로 센다', () => {
    const matrix = spendingMatrix(pack, simple({
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1_000_000, date: '2026-07-15' }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 300_000, date: '2026-05-01' }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 200_000, date: '2027-09-01' }),
      ],
    }), ALL);
    expect(matrix.outOfRange).toMatchObject({ actual: 500_000, count: 2 });
    expect(sum(matrix.totals.cells.map((cell) => cell.actual))).toBe(1_000_000);
  });

  it('월별 집행 합계에 기간 외를 더하면 대시보드 집행금액과 같다', () => {
    const withOutside = simple({
      expenses: [
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 1_000_000, date: '2026-07-15' }),
        expense({ categoryId: 'DIRECT_ACTIVITY', amount: 500_000, date: '2027-09-01' }),
      ],
    });
    const matrix = spendingMatrix(pack, withOutside, ALL);
    const dashboard = spendingTotals(categorySpending(pack, withOutside));
    expect(sum(matrix.totals.cells.map((c) => c.actual)) + (matrix.outOfRange?.actual ?? 0)).toBe(dashboard.spent);
    expect(matrix.totals).toMatchObject({ budget: dashboard.budget, spent: dashboard.spent });
  });

  it('전체 행의 계획 합계는 예산과 같다', () => {
    const matrix = spendingMatrix(pack, simple({
      budgets: [{ categoryId: 'DIRECT_ACTIVITY', amount: 10_000_000 }, { categoryId: 'DIRECT_LABOR', amount: 24_000_000 }],
    }), ALL);
    // 나머지를 마지막 달에 몰아주므로 원 단위까지 정확히 맞는다
    expect(sum(matrix.totals.cells.map((cell) => cell.plan))).toBe(34_000_000);
  });

  it('달을 하나도 안 고르면 월 열 없이 예산·집행·잔액만 남는다', () => {
    const matrix = spendingMatrix(pack, simple(), []);
    expect(activityOf(matrix)).toMatchObject({ budget: 12_000_000 });
    expect((activityOf(matrix) as ReturnType<typeof spendingMatrix>['rows'][number]).cells).toEqual([]);
    expect(matrix.totals.cells).toEqual([]);
    expect(matrix.totals.budget).toBe(12_000_000);
  });

  it('사업기간이 없으면 월 열도 없다', () => {
    const matrix = spendingMatrix(pack, simple({ startDate: '', endDate: '' }), []);
    expect(matrix.totals.cells).toEqual([]);
    expect(matrix.totals.budget).toBe(12_000_000);
  });
});