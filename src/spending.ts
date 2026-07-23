// ---- 집행 현황 집계 ----
// 집행 화면이 보여주던 것은 "지금 고른 비목의 잔액" 하나뿐이라 전체 그림이 없었다.
// 편성에서 확정한 예산을 비목·세목별로 갈라 얼마를 쓰고 얼마가 남았는지 한자리에 모은다.
//
// 예산과 잔액은 언제나 편성 비목(categoryId) 기준으로 계산한다. 세목은 집계·계획·규정 조회의
// 단위일 뿐, 예산 변경 관리와 정산이 보는 돈의 단위는 비목이기 때문이다.
import { categoryOf, visibleCategories } from './rules';
import type { BudgetCategoryId, Expense, Project, RulePack } from './types';

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const spentOf = (expenses: Expense[]): number => sum(expenses.map((expense) => expense.amount));
// 예산이 0원인 비목에서 0으로 나누지 않는다.
const rateOf = (spent: number, budget: number): number => budget > 0 ? spent / budget * 100 : 0;

export interface SubSpendRow {
  subItemId?: string;   // 편성된 세목이면 있다. 세목 미지정 행은 없다
  name: string;
  budget: number;       // 편성에서 사라진 세목·미지정 행은 0
  spent: number;
  remaining: number;
  orphan?: boolean;     // 편성에서 지워졌지만 집행 이력이 남은 세목
}

export interface SpendRow {
  categoryId: BudgetCategoryId;
  name: string;
  budget: number;
  spent: number;
  remaining: number;
  rate: number;         // 소진율 %
  over: boolean;        // 예산 초과
  subRows: SubSpendRow[];
}

// 세목 하위 행. 편성된 세목 → 편성에서 사라진 세목 → 세목 미지정 순으로 쌓는다.
// 세목을 나누지 않은 비목은 빈 배열을 준다 (하위 행 자체를 만들지 않는다).
const subRowsOf = (expenses: Expense[], subItems: { id: string; name: string; amount: number }[]): SubSpendRow[] => {
  const subdivided = subItems.length > 0 || expenses.some((expense) => expense.subItemId);
  if (!subdivided) return [];

  const rows: SubSpendRow[] = subItems.map((sub) => {
    const spent = spentOf(expenses.filter((expense) => expense.subItemId === sub.id));
    return { subItemId: sub.id, name: sub.name, budget: sub.amount, spent, remaining: sub.amount - spent };
  });

  // 편성에서 지워진 세목 — 이름 스냅샷(subItemName)이 남아 있으므로 무엇이었는지 보여줄 수 있다.
  const known = new Set(subItems.map((sub) => sub.id));
  const orphans = new Map<string, SubSpendRow>();
  let unassigned = 0;
  for (const expense of expenses) {
    if (expense.subItemId && known.has(expense.subItemId)) continue;
    if (!expense.subItemId) { unassigned += expense.amount; continue; }
    const found = orphans.get(expense.subItemId);
    if (found) { found.spent += expense.amount; found.remaining = -found.spent; continue; }
    orphans.set(expense.subItemId, {
      subItemId: expense.subItemId, name: expense.subItemName ?? '삭제된 세목',
      budget: 0, spent: expense.amount, remaining: -expense.amount, orphan: true,
    });
  }
  rows.push(...orphans.values());
  if (unassigned) rows.push({ name: '세목 미지정', budget: 0, spent: unassigned, remaining: -unassigned });
  return rows;
};

export const categorySpending = (pack: RulePack, project: Project): SpendRow[] =>
  visibleCategories(pack, project).map((category) => {
    const item = project.budgets.find((budget) => budget.categoryId === category.id);
    const budget = item?.amount ?? 0;
    const expenses = project.expenses.filter((expense) => expense.categoryId === category.id);
    const spent = spentOf(expenses);
    return {
      categoryId: category.id, name: category.name,
      budget, spent, remaining: budget - spent,
      rate: rateOf(spent, budget), over: spent > budget,
      subRows: subRowsOf(expenses, item?.subItems ?? []),
    };
  });

export const spendingTotals = (rows: SpendRow[]): { budget: number; spent: number; remaining: number; rate: number } => {
  const budget = sum(rows.map((row) => row.budget));
  const spent = sum(rows.map((row) => row.spent));
  return { budget, spent, remaining: budget - spent, rate: rateOf(spent, budget) };
};

// ---- 증빙 준비 현황 ----
// 한눈에 보기에는 "증빙 12개가 비어 있어요"라는 숫자 하나뿐이라, 무엇을 준비해야 하는지 알 수 없었다.
// 집행건별로 무엇이 빠졌는지, 서류 종류별로 얼마나 밀렸는지 나눠서 보여준다.
export interface EvidenceTodo {
  expenseId: string;
  purpose: string;
  date: string;
  categoryName: string;
  subItemName?: string;
  done: number;
  total: number;
  missing: string[];    // 아직 안 올린 증빙 이름
}
export interface DocumentTally { label: string; done: number; total: number }
export interface EvidenceReadiness {
  todos: EvidenceTodo[];          // 빠진 증빙이 있는 집행건 (집행일 오래된 순 — 정산이 급한 것부터)
  byDocument: DocumentTally[];    // 서류 종류별 집계 (밀린 것부터)
  done: number;
  total: number;
  rate: number;                   // 준비율 %
  readyExpenses: number;          // 증빙이 다 준비된 집행건 수
}

export const evidenceReadiness = (pack: RulePack, project: Project): EvidenceReadiness => {
  const todos: EvidenceTodo[] = [];
  const tally = new Map<string, DocumentTally>();
  let done = 0;
  let total = 0;
  let readyExpenses = 0;

  for (const expense of project.expenses) {
    const finished = expense.evidence.filter((item) => item.completed).length;
    done += finished;
    total += expense.evidence.length;
    if (expense.evidence.length && finished === expense.evidence.length) readyExpenses += 1;
    for (const item of expense.evidence) {
      const entry = tally.get(item.label) ?? { label: item.label, done: 0, total: 0 };
      entry.total += 1;
      if (item.completed) entry.done += 1;
      tally.set(item.label, entry);
    }
    const missing = expense.evidence.filter((item) => !item.completed).map((item) => item.label);
    if (!missing.length) continue;
    todos.push({
      expenseId: expense.id, purpose: expense.purpose, date: expense.date,
      categoryName: categoryOf(pack, expense.categoryId).name, subItemName: expense.subItemName,
      done: finished, total: expense.evidence.length, missing,
    });
  }

  return {
    todos: todos.sort((a, b) => a.date.localeCompare(b.date)),
    // 많이 밀린 서류부터 — 같은 서류를 몰아서 만들 수 있게 한다
    byDocument: [...tally.values()].sort((a, b) => (b.total - b.done) - (a.total - a.done) || a.label.localeCompare(b.label)),
    done, total, rate: total > 0 ? done / total * 100 : 0, readyExpenses,
  };
};

// ---- 월별 집행계획 ----
// 사업기간 중 언제 얼마를 써야 하는지 보여준다. 계획은 예산을 월수로 균등분할한 값이 기본이고,
// 사용자가 고친 달만 저장한다(project.monthlyPlan). 안 고친 달은 "예산 − 수기 입력 합"을
// 다시 나눠 가진다 — 한 달을 늘리면 나머지 달이 자동으로 줄어, 계획 합계가 예산과 맞아떨어진다.

// 날짜 문자열에서 'YYYY-MM'만 떼어낸다. Date로 파싱하면 표준시 차이로 달이 하루 밀릴 수 있어
// 문자열을 그대로 자른다 (집행일·과제 기간은 모두 'YYYY-MM-DD' 형식이다).
const monthKey = (date?: string): string | null => {
  const key = (date ?? '').slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : null;
};

export const monthSequence = (start?: string, end?: string): string[] => {
  const from = monthKey(start);
  const to = monthKey(end);
  if (!from || !to || to < from) return [];
  const months: string[] = [];
  let [year, month] = from.split('-').map(Number);
  // 사업기간이 비정상적으로 길어도 멈추도록 상한을 둔다 (50년).
  for (let guard = 0; guard < 600; guard++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key === to) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
};

// 예산을 월수로 나눈다. 나머지는 마지막 달에 몰아주어 합계가 예산과 정확히 일치하게 한다.
export const splitEvenly = (total: number, count: number): number[] => {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? total - base * (count - 1) : base);
};

// 한 달의 계획과 집행. 표에서 두 칸이 나란히 붙는다.
export interface MonthCell { month: string; plan: number; actual: number }

export interface MatrixSubRow extends SubSpendRow {
  cells: MonthCell[];
  planEditable: boolean;   // 편성된 세목만 계획을 고칠 수 있다 (삭제된 세목·미지정은 예산이 없다)
  planTotal: number;       // 사업기간 전체의 계획 합 — 예산과 다르면 검증에서 알린다
}
export interface MatrixRow {
  categoryId: BudgetCategoryId;
  name: string;
  budget: number; spent: number; remaining: number; rate: number; over: boolean;
  cells: MonthCell[];
  planEditable: boolean;   // 세목이 나뉜 비목은 세목 합계가 계획이므로 직접 고칠 수 없다
  planTotal: number;       // 사업기간 전체의 계획 합 (세목이 나뉘면 세목 합계)
  subRows: MatrixSubRow[];
}
export interface SpendingMatrix {
  rows: MatrixRow[];
  totals: { budget: number; spent: number; remaining: number; rate: number; cells: MonthCell[] };
  outOfRange: { actual: number; count: number } | null;  // 사업기간 밖 집행 — 정산 때 문제가 되므로 숨기지 않는다
}
export interface PlanSelection { categoryId?: BudgetCategoryId; subItemId?: string }

const addCells = (rows: { cells: MonthCell[] }[], months: string[]): MonthCell[] =>
  months.map((month, index) => ({
    month,
    plan: sum(rows.map((row) => row.cells[index]?.plan ?? 0)),
    actual: sum(rows.map((row) => row.cells[index]?.actual ?? 0)),
  }));

// 비목·세목을 행으로, 월을 열로 펼친다. 계획은 예산을 사업기간 월수로 균등분할한 값이 기본이고,
// 사용자가 고친 달만 저장한다(project.monthlyPlan). 안 고친 달은 계속 자동값을 따라가므로
// 예산이 바뀌면 알아서 재조정된다.
//
// months는 화면에서 보기로 한 달만 넘어온다. 균등분할은 언제나 사업기간 전체 월수 기준이라
// 몇 달을 숨겨도 각 달의 계획 금액은 달라지지 않는다.
export const spendingMatrix = (pack: RulePack, project: Project, months: string[]): SpendingMatrix => {
  const allMonths = monthSequence(project.startDate, project.endDate);
  const indexOf = new Map(allMonths.map((month, index) => [month, index]));
  const inPeriod = new Set(allMonths);

  const overrideOf = (categoryId: BudgetCategoryId, subItemId: string | undefined, month: string): number | undefined =>
    project.monthlyPlan?.find((entry) =>
      entry.categoryId === categoryId && entry.subItemId === subItemId && entry.month === month)?.amount;

  const actualByMonth = (expenses: Expense[]): Map<string, number> => {
    const byMonth = new Map<string, number>();
    for (const expense of expenses) {
      const key = monthKey(expense.date);
      if (!key || !inPeriod.has(key)) continue;   // 기간 밖 집행은 아래에서 따로 센다
      byMonth.set(key, (byMonth.get(key) ?? 0) + expense.amount);
    }
    return byMonth;
  };

  // 계획을 저장하는 최소 단위의 칸. 세목이 나뉜 비목은 세목이, 아니면 비목 자체가 단위다.
  // 수기로 고친 달을 뺀 나머지 달이 "예산 − 수기 합"을 균등하게 나눠 가진다 — 한 달을 고치면
  // 안 고친 달들이 자동으로 재조정돼 계획 합계가 예산과 맞는다. 수기 합이 예산을 넘으면
  // 남은 달은 0이 되고, planTotal이 예산과 어긋나 검증에서 드러난다.
  const leafCells = (categoryId: BudgetCategoryId, subItemId: string | undefined, budget: number, expenses: Expense[]): { cells: MonthCell[]; planTotal: number } => {
    const overrides = new Map<string, number>();
    for (const month of allMonths) {
      const value = overrideOf(categoryId, subItemId, month);
      if (value != null) overrides.set(month, value);
    }
    const fixed = sum([...overrides.values()]);
    const autoMonths = allMonths.filter((month) => !overrides.has(month));
    const autoSplit = splitEvenly(Math.max(0, budget - fixed), autoMonths.length);
    const autoByMonth = new Map(autoMonths.map((month, index) => [month, autoSplit[index] ?? 0]));
    const actual = actualByMonth(expenses);
    const cells = months.map((month) => ({
      month,
      plan: overrides.get(month) ?? autoByMonth.get(month) ?? 0,
      actual: actual.get(month) ?? 0,
    }));
    return { cells, planTotal: fixed + sum(autoSplit) };
  };

  const rows: MatrixRow[] = categorySpending(pack, project).map((row) => {
    const expenses = project.expenses.filter((expense) => expense.categoryId === row.categoryId);
    const subRows: MatrixSubRow[] = row.subRows.map((sub) => {
      const leaf = leafCells(row.categoryId, sub.subItemId, sub.budget,
        expenses.filter((expense) => sub.subItemId ? expense.subItemId === sub.subItemId : !expense.subItemId));
      return { ...sub, planEditable: !!sub.subItemId && !sub.orphan, cells: leaf.cells, planTotal: leaf.planTotal };
    });
    // 세목이 나뉜 비목의 계획은 세목 합계다 — 편성 화면의 "세목이 있으면 비목 금액은 세목 합계" 규칙과 같다.
    const divided = subRows.some((sub) => sub.planEditable);
    const leaf = divided ? null : leafCells(row.categoryId, undefined, row.budget, expenses);
    return {
      ...row,
      planEditable: !divided,
      cells: leaf ? leaf.cells : addCells(subRows, months),
      planTotal: leaf ? leaf.planTotal : sum(subRows.map((sub) => sub.planTotal)),
      subRows,
    };
  });

  const visibleIds = new Set(rows.map((row) => row.categoryId));
  const outside = project.expenses.filter((expense) => {
    if (!visibleIds.has(expense.categoryId)) return false;
    const key = monthKey(expense.date);
    return !key || !inPeriod.has(key);
  });

  const budget = sum(rows.map((row) => row.budget));
  const spent = sum(rows.map((row) => row.spent));
  return {
    rows,
    totals: { budget, spent, remaining: budget - spent, rate: rateOf(spent, budget), cells: addCells(rows, months) },
    outOfRange: outside.length ? { actual: spentOf(outside), count: outside.length } : null,
  };
};

// 월별 계획 칸 하나를 고쳐 넣는다. 같은 칸이 이미 있으면 갈아끼운다.
export const setMonthlyPlan = (project: Project, leaf: PlanSelection, month: string, amount: number): Project => {
  if (!leaf.categoryId) return project;
  const rest = (project.monthlyPlan ?? []).filter((entry) =>
    !(entry.categoryId === leaf.categoryId && entry.subItemId === leaf.subItemId && entry.month === month));
  return { ...project, monthlyPlan: [...rest, { categoryId: leaf.categoryId, subItemId: leaf.subItemId, month, amount }] };
};

// ---- 증빙 누락 알림 (집행일 경과 기준) ----
// 정산 마감 D-30·14·7이 아니라 집행일로부터의 경과일이 기준이다 (사용자 결정).
// 증빙은 집행 직후가 가장 모으기 쉽고 오래될수록 어려워진다 — 3·7·14·30일에 단계적으로 알린다.
// 한 집행건은 지금까지 지난 단계 중 가장 높은 단계 하나로만 센다.
export const EVIDENCE_ALARM_STAGES = [30, 14, 7, 3] as const;
export type EvidenceAlarmStage = (typeof EVIDENCE_ALARM_STAGES)[number];
export interface EvidenceAlarm { stage: EvidenceAlarmStage; expenses: number; missingDocs: number }

export const evidenceAlarms = (project: Project, today: string): EvidenceAlarm[] => {
  const stages = new Map<EvidenceAlarmStage, { expenses: number; missingDocs: number }>();
  for (const expense of project.expenses) {
    const missing = expense.evidence.filter((item) => !item.completed).length;
    if (!missing) continue;
    const days = Math.floor((Date.parse(today) - Date.parse(expense.date)) / 86_400_000);
    const stage = EVIDENCE_ALARM_STAGES.find((threshold) => days >= threshold);
    if (!stage) continue;
    const entry = stages.get(stage) ?? { expenses: 0, missingDocs: 0 };
    entry.expenses += 1;
    entry.missingDocs += missing;
    stages.set(stage, entry);
  }
  return [...stages].map(([stage, counts]) => ({ stage, ...counts })).sort((a, b) => b.stage - a.stage);
};
