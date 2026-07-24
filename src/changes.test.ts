import { describe, expect, it } from 'vitest';
import { agreementDocsOf, applyTransfer, approveChange, missingAgreementDocs, nextDocumentNo, pendingChanges, projectedBudgets, rejectChange, requestChange, statusOf, typeOf } from './changes';
import { packFor } from './rules';
import { monthSequence, spendingMatrix, validateMonthlyRedistribution } from './spending';
import type { Project, ProjectDocumentLink } from './types';

// 변경은 신청해서 승인을 받아야 효력이 생긴다 — 예산이 언제 움직이는지가 이 파일의 계약이다.

const doc = (over: Partial<ProjectDocumentLink> & { documentType: string }): ProjectDocumentLink => ({
  id: `d-${over.documentType}`, kind: 'upload', fileName: 'file.pdf', title: '문서',
  applicationType: 'AGREEMENT', isConfirmed: true, createdAt: '2026-07-01T00:00:00.000Z', ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: '테스트 과제', totalBudget: 100_000_000,
  startDate: '2026-07-01', endDate: '2027-06-30', settlementDeadline: '2027-07-30',
  agency: '과기정통부', companyName: '테스트랩', packId: 'nrd2026-forprofit',
  members: [], participants: [], expenses: [], changes: [], emailLogs: [],
  budgets: [{ categoryId: 'DIRECT_LABOR', amount: 60_000_000 }, { categoryId: 'DIRECT_ACTIVITY', amount: 40_000_000 }],
  documents: [doc({ documentType: 'AGREEMENT' }), doc({ documentType: 'PLAN' })],
  createdAt: '2026-07-01T00:00:00.000Z', ...over,
});

const NOW = '2026-09-01T00:00:00.000Z';
const transfer = { fromCategoryId: 'DIRECT_LABOR', toCategoryId: 'DIRECT_ACTIVITY', amount: 10_000_000, reasonKey: 'k', reason: '사유' };
const amountOf = (p: Project, id: string) => p.budgets.find((item) => item.categoryId === id)?.amount ?? 0;

describe('협약 문서 보관 (선택)', () => {
  it('아직 안 올린 문서를 짚어준다 — 알려만 주고 막지는 않는다', () => {
    expect(missingAgreementDocs(project())).toEqual([]);
    expect(missingAgreementDocs(project({ documents: [doc({ documentType: 'AGREEMENT' })] }))).toEqual(['PLAN']);
    expect(missingAgreementDocs(project({ documents: [] }))).toEqual(['AGREEMENT', 'PLAN']);
  });

  it('문서가 하나도 없어도 변경은 신청된다 — 기록만 남기려는 경우까지 막을 이유가 없다', () => {
    const bare = project({ documents: [] });
    const after = requestChange(bare, transfer, NOW);
    expect(after.changes).toHaveLength(1);
    expect(statusOf(after.changes[0])).toBe('submitted');
  });

  it('협약 문서만 골라낸다 — 참고자료로 올린 문서는 세지 않는다', () => {
    const mixed = project({ documents: [doc({ documentType: 'AGREEMENT' }), { ...doc({ documentType: 'PLAN' }), applicationType: 'REFERENCE' }] });
    expect(agreementDocsOf(mixed)).toHaveLength(1);
    expect(missingAgreementDocs(mixed)).toEqual(['PLAN']);
  });
});

describe('변경 신청', () => {
  it('신청해도 예산은 그대로다 — 승인 전에 바꾸면 집행·잔액이 실제와 어긋난다', () => {
    const after = requestChange(project(), transfer, NOW);
    expect(amountOf(after, 'DIRECT_LABOR')).toBe(60_000_000);
    expect(amountOf(after, 'DIRECT_ACTIVITY')).toBe(40_000_000);
    expect(statusOf(after.changes[0])).toBe('submitted');
    expect(after.changes[0].submittedAt).toBe(NOW);
  });

  it('제출한 사업계획서를 신청에 붙여둔다 — 무엇을 근거로 신청했는지 남아야 한다', () => {
    const after = requestChange(project(), { ...transfer, planFileId: 'f1', planFileName: '변경사업계획서.pdf' }, NOW);
    expect(after.changes[0]).toMatchObject({ planFileId: 'f1', planFileName: '변경사업계획서.pdf' });
  });

  it('신청 중인 이동까지 반영한 예상 편성을 보여준다', () => {
    const after = requestChange(project(), transfer, NOW);
    const projected = projectedBudgets(after);
    expect(projected.find((item) => item.categoryId === 'DIRECT_LABOR')?.amount).toBe(50_000_000);
    expect(projected.find((item) => item.categoryId === 'DIRECT_ACTIVITY')?.amount).toBe(50_000_000);
    expect(pendingChanges(after)).toHaveLength(1);
  });
});

describe('공문 문서번호', () => {
  it('기업약칭-연도-일련번호로 만든다 — 법인 형태 표기는 뺀다', () => {
    const p = project({ companyName: '주식회사 테스트랩' });
    expect(nextDocumentNo(p, NOW)).toBe('테스트랩-2026-001');
  });

  it('그 해에 이미 번호를 받은 건수만큼 이어진다', () => {
    const first = requestChange(project({ companyName: '테스트랩' }), transfer, NOW);
    expect(first.changes[0].documentNo).toBe('테스트랩-2026-001');
    const second = requestChange(first, transfer, NOW);
    expect(second.changes[0].documentNo).toBe('테스트랩-2026-002');
  });

  it('해가 바뀌면 번호가 다시 001부터 — 연도별로 센다', () => {
    const y2026 = requestChange(project({ companyName: '테스트랩' }), transfer, NOW);
    const y2027 = requestChange(y2026, transfer, '2027-02-01T00:00:00.000Z');
    expect(y2027.changes[0].documentNo).toBe('테스트랩-2027-001');
  });

  it('한 번 정해진 번호는 승인·반려로 바뀌지 않는다', () => {
    const requested = requestChange(project({ companyName: '테스트랩' }), transfer, NOW);
    const no = requested.changes[0].documentNo;
    const approved = approveChange(requested, requested.changes[0].id, NOW);
    expect(approved.changes[0].documentNo).toBe(no);
  });
});

describe('통보 · 승인 구분', () => {
  it('고른 구분이 기록된다 — 통보와 승인은 효력이 생기는 시점이 다르다', () => {
    const notify = requestChange(project(), { ...transfer, changeType: 'notification' }, NOW);
    expect(typeOf(notify.changes[0])).toBe('notification');
    const approval = requestChange(project(), { ...transfer, changeType: 'approval' }, NOW);
    expect(typeOf(approval.changes[0])).toBe('approval');
  });

  it('구분을 고르지 않으면 승인으로 본다 — 둘 중 엄격한 쪽이라 잘못 봐도 손해가 없다', () => {
    const after = requestChange(project(), transfer, NOW);
    expect(typeOf(after.changes[0])).toBe('approval');
    // 구버전 이력(필드 자체가 없음)도 마찬가지
    const legacy = project({ changes: [{ id: 'old', fromCategoryId: 'A', toCategoryId: 'B', amount: 1, reasonKey: 'k', reason: 'r', before: [], after: [], createdAt: NOW }] });
    expect(typeOf(legacy.changes[0])).toBe('approval');
  });

  it('통보든 승인이든 제출만으로는 예산이 움직이지 않는다', () => {
    // 통보도 실제로 공문을 보내야 효력이 생긴다 — 화면에서 "통보 완료"를 눌러야 반영된다.
    const notify = requestChange(project(), { ...transfer, changeType: 'notification' }, NOW);
    expect(amountOf(notify, 'DIRECT_LABOR')).toBe(60_000_000);
    const settled = approveChange(notify, notify.changes[0].id, NOW);
    expect(amountOf(settled, 'DIRECT_LABOR')).toBe(50_000_000);
  });
});

describe('승인 · 반려', () => {
  it('승인되면 그때 예산이 움직이고 기존 편성 확정 상태를 유지한다', () => {
    const requested = { ...requestChange(project(), transfer, NOW), budgetConfirmed: true };
    const approved = approveChange(requested, requested.changes[0].id, '2026-09-10T00:00:00.000Z');
    expect(amountOf(approved, 'DIRECT_LABOR')).toBe(50_000_000);
    expect(amountOf(approved, 'DIRECT_ACTIVITY')).toBe(50_000_000);
    expect(statusOf(approved.changes[0])).toBe('approved');
    expect(approved.budgetConfirmed).toBe(true);
    expect(pendingChanges(approved)).toHaveLength(0);
  });

  it('반려되면 예산은 그대로 두고 회신 내용을 남긴다', () => {
    const requested = requestChange(project(), transfer, NOW);
    const rejected = rejectChange(requested, requested.changes[0].id, '2026-09-10T00:00:00.000Z', '증빙 부족');
    expect(amountOf(rejected, 'DIRECT_LABOR')).toBe(60_000_000);
    expect(statusOf(rejected.changes[0])).toBe('rejected');
    expect(rejected.changes[0].decisionNote).toBe('증빙 부족');
  });

  it('신청 상태가 아닌 변경은 다시 승인·반려되지 않는다', () => {
    const requested = requestChange(project(), transfer, NOW);
    const id = requested.changes[0].id;
    const once = approveChange(requested, id, NOW);
    const twice = approveChange(once, id, NOW);
    expect(amountOf(twice, 'DIRECT_LABOR')).toBe(50_000_000);   // 두 번 빠지지 않는다
    expect(rejectChange(once, id, NOW, '늦은 반려')).toBe(once);
  });

  it('신청과 승인 사이에 다른 변경이 승인되면 그때의 예산에서 계산한다', () => {
    // 두 건을 함께 신청해두고 순서대로 승인한다 — 나중 건이 앞 건의 결과 위에 얹혀야 한다.
    const first = requestChange(project(), transfer, NOW);
    const both = requestChange(first, { ...transfer, amount: 5_000_000 }, NOW);
    const [second, firstChange] = both.changes;
    const afterFirst = approveChange(both, firstChange.id, NOW);
    const afterSecond = approveChange(afterFirst, second.id, NOW);
    expect(amountOf(afterSecond, 'DIRECT_LABOR')).toBe(45_000_000);   // 60 - 10 - 5
    expect(amountOf(afterSecond, 'DIRECT_ACTIVITY')).toBe(55_000_000);
  });
});

describe('구버전 이력', () => {
  it('status가 없는 이력은 승인된 것으로 읽는다 — 그때는 저장 즉시 반영됐다', () => {
    const legacy = project({ changes: [{ id: 'old', fromCategoryId: 'A', toCategoryId: 'B', amount: 1, reasonKey: 'k', reason: 'r', before: [], after: [], createdAt: NOW }] });
    expect(statusOf(legacy.changes[0])).toBe('approved');
    expect(pendingChanges(legacy)).toHaveLength(0);
  });
});

describe('금액 이동 계산', () => {
  it('받는 비목이 아직 없으면 만들어 넣는다', () => {
    const moved = applyTransfer([{ categoryId: 'A', amount: 100 }], 'A', 'B', 30);
    expect(moved).toEqual([{ categoryId: 'A', amount: 70 }, { categoryId: 'B', amount: 30 }]);
  });

  it('세목이 있는 비목은 변경 후 금액에 맞춰 세목도 같은 비율로 조정한다', () => {
    const moved = applyTransfer([
      { categoryId: 'A', amount: 20, subItems: [{ id: 'a1', name: '회의비', amount: 8 }, { id: 'a2', name: '출장비', amount: 12 }] },
      { categoryId: 'B', amount: 10, subItems: [{ id: 'b1', name: '재료비', amount: 10 }] },
    ], 'A', 'B', 5);
    const from = moved.find((item) => item.categoryId === 'A')!;
    const to = moved.find((item) => item.categoryId === 'B')!;
    expect(from.subItems?.reduce((sum, sub) => sum + sub.amount, 0)).toBe(from.amount);
    expect(to.subItems?.reduce((sum, sub) => sum + sub.amount, 0)).toBe(to.amount);
    expect(from.subItems?.map((sub) => sub.amount)).toEqual([6, 9]);
    expect(to.subItems?.map((sub) => sub.amount)).toEqual([15]);
  });

  it('비목이 줄어들면 현물 계상액도 새 비목 금액을 넘지 않게 제한한다', () => {
    const moved = applyTransfer([
      { categoryId: 'A', amount: 20, inKindAmount: 15 },
      { categoryId: 'B', amount: 10 },
    ], 'A', 'B', 10);
    expect(moved.find((item) => item.categoryId === 'A')?.inKindAmount).toBe(10);
  });
});

// 승인되면 예산이 바뀐다 — 월별 집행계획도 새 예산에 맞춰야 한다.
// 손대지 않은 비목은 균등분할이라 자동으로 따라가지만, 월별로 손대 둔 비목은 옛 배분에 갇힌다.
// 적용월(변경시작월)을 받아 그 달 이전은 유지하고, 그 달부터 남은 예산을 다시 나눈다.
describe('승인 시 월별 집행계획 재배분 (적용월 기준)', () => {
  const pack = packFor(project());
  const planOf = (p: Project, categoryId: string) => {
    const months = monthSequence(p.startDate, p.endDate);
    const row = spendingMatrix(pack, p, months).rows.find((r) => r.categoryId === categoryId)!;
    const at = (month: string) => row.cells[months.indexOf(month)]?.plan ?? 0;
    return { at, planTotal: row.planTotal };
  };

  it('적용월 이전 달은 그대로 두고, 적용월부터 남은 예산을 새 예산에 맞춰 다시 나눈다', () => {
    // 받는 비목(ACTIVITY, 40M)을 7월에 손대 둔 상태 — 그대로면 예산이 바뀌어도 옛 배분에 갇힌다.
    const edited = project({ monthlyPlan: [{ categoryId: 'DIRECT_ACTIVITY', month: '2026-07', amount: 5_000_000 }] });
    const before = planOf(edited, 'DIRECT_ACTIVITY');

    // LABOR → ACTIVITY 12M 이동, 적용월 2026-10 (기간의 4번째 달)
    const requested = requestChange(edited, { ...transfer, amount: 12_000_000, effectiveMonth: '2026-10' }, NOW);
    const approved = approveChange(requested, requested.changes[0].id, NOW, undefined, pack);
    const after = planOf(approved, 'DIRECT_ACTIVITY');

    // 적용월 이전(7·8·9월)은 승인 전 값 그대로
    for (const m of ['2026-07', '2026-08', '2026-09']) expect(after.at(m)).toBe(before.at(m));
    // 계획 합계가 새 예산(52M)과 맞는다 — 이게 핵심 수정(월 배분이 편성을 따라간다)
    expect(after.planTotal).toBe(52_000_000);
    expect(amountOf(approved, 'DIRECT_ACTIVITY')).toBe(52_000_000);
    // 늘어난 예산은 적용월(10월) 이후로 몰린다 — 10월이 직전 달(9월)보다 커진다
    expect(after.at('2026-10')).toBeGreaterThan(after.at('2026-09'));
  });

  it('보내는 비목도 적용월 이전은 유지하고 합계가 새 예산과 맞는다', () => {
    const before = planOf(project(), 'DIRECT_LABOR');   // 60M 균등분할 = 월 5,000,000
    const requested = requestChange(project(), { ...transfer, amount: 12_000_000, effectiveMonth: '2026-10' }, NOW);
    const approved = approveChange(requested, requested.changes[0].id, NOW, undefined, pack);
    const after = planOf(approved, 'DIRECT_LABOR');

    for (const m of ['2026-07', '2026-08', '2026-09']) expect(after.at(m)).toBe(before.at(m));
    expect(after.planTotal).toBe(48_000_000);
    // 줄어든 예산은 적용월 이후에서 빠진다 — 10월이 직전 달보다 작아진다
    expect(after.at('2026-10')).toBeLessThan(after.at('2026-09'));
  });

  it('적용월이 첫 달이면 이전 달이 없어 전체를 균등 재배분한다', () => {
    const requested = requestChange(project(), { ...transfer, amount: 12_000_000, effectiveMonth: '2026-07' }, NOW);
    const approved = approveChange(requested, requested.changes[0].id, NOW, undefined, pack);
    const after = planOf(approved, 'DIRECT_ACTIVITY');
    expect(after.planTotal).toBe(52_000_000);
    expect(after.at('2026-07')).toBe(after.at('2026-08'));   // 전 기간 균등이라 앞 두 달이 같다
  });

  it('pack 없이 승인하면(구버전 호출) 월별 계획을 건드리지 않는다', () => {
    const edited = project({ monthlyPlan: [{ categoryId: 'DIRECT_ACTIVITY', month: '2026-07', amount: 5_000_000 }] });
    const requested = requestChange(edited, { ...transfer, effectiveMonth: '2026-10' }, NOW);
    const approved = approveChange(requested, requested.changes[0].id, NOW);
    expect(approved.monthlyPlan).toEqual(edited.monthlyPlan);
  });

  it('적용월 이전 계획 합계보다 새 예산이 작아지는 승인은 거부한다', () => {
    const requested = requestChange(project(), { ...transfer, amount: 50_000_000, effectiveMonth: '2026-10' }, NOW);
    const nextBudgets = applyTransfer(requested.budgets, transfer.fromCategoryId, transfer.toCategoryId, 50_000_000);
    const invalid = validateMonthlyRedistribution(pack, requested, { ...requested, budgets: nextBudgets }, [transfer.fromCategoryId, transfer.toCategoryId], '2026-10');
    expect(invalid).toMatchObject({ categoryId: 'DIRECT_LABOR', fixedPlan: 15_000_000, nextBudget: 10_000_000 });

    const approved = approveChange(requested, requested.changes[0].id, NOW, undefined, pack);
    expect(approved).toBe(requested);
    expect(amountOf(approved, 'DIRECT_LABOR')).toBe(60_000_000);
    expect(statusOf(approved.changes[0])).toBe('submitted');
  });

  it('적용월이 첫 달이면 이전 계획이 없어 큰 폭의 예산 축소도 허용한다', () => {
    const requested = requestChange(project(), { ...transfer, amount: 50_000_000, effectiveMonth: '2026-07' }, NOW);
    const approved = approveChange(requested, requested.changes[0].id, NOW, undefined, pack);
    expect(amountOf(approved, 'DIRECT_LABOR')).toBe(10_000_000);
    expect(statusOf(approved.changes[0])).toBe('approved');
  });

  it('적용월부터 새로 계산을 고르면 이전 달은 0원이고 전체 예산이 적용월 이후에 배분된다', () => {
    const requested = requestChange(project(), {
      ...transfer, amount: 12_000_000, effectiveMonth: '2026-08', monthlyPlanChangeMode: 'restart',
    }, NOW);
    const approved = approveChange(requested, requested.changes[0].id, NOW, undefined, pack);
    const after = planOf(approved, 'DIRECT_ACTIVITY');
    expect(after.at('2026-07')).toBe(0);
    expect(after.at('2026-08')).toBeGreaterThan(0);
    expect(after.planTotal).toBe(52_000_000);
    expect(approved.changes[0].monthlyPlanChangeMode).toBe('restart');
  });
});
