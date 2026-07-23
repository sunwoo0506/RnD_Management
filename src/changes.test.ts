import { describe, expect, it } from 'vitest';
import { agreementDocsOf, applyTransfer, approveChange, canRequestChange, missingAgreementDocs, pendingChanges, projectedBudgets, rejectChange, requestChange, statusOf } from './changes';
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

describe('협약 문서 전제조건', () => {
  it('협약서와 사업계획서가 모두 있어야 변경을 신청할 수 있다', () => {
    expect(canRequestChange(project())).toBe(true);
    expect(missingAgreementDocs(project())).toEqual([]);
  });

  it('빠진 문서를 짚어준다 — 무엇을 준비해야 하는지 알려야 한다', () => {
    const onlyAgreement = project({ documents: [doc({ documentType: 'AGREEMENT' })] });
    expect(canRequestChange(onlyAgreement)).toBe(false);
    expect(missingAgreementDocs(onlyAgreement)).toEqual(['PLAN']);
    expect(missingAgreementDocs(project({ documents: [] }))).toEqual(['AGREEMENT', 'PLAN']);
  });

  it('협약 문서만 골라낸다 — 참고자료로 올린 문서는 세지 않는다', () => {
    const mixed = project({ documents: [doc({ documentType: 'AGREEMENT' }), { ...doc({ documentType: 'PLAN' }), applicationType: 'REFERENCE' }] });
    expect(agreementDocsOf(mixed)).toHaveLength(1);
    expect(canRequestChange(mixed)).toBe(false);
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

describe('승인 · 반려', () => {
  it('승인되면 그때 예산이 움직이고 편성 확정이 풀린다', () => {
    const requested = { ...requestChange(project(), transfer, NOW), budgetConfirmed: true };
    const approved = approveChange(requested, requested.changes[0].id, '2026-09-10T00:00:00.000Z');
    expect(amountOf(approved, 'DIRECT_LABOR')).toBe(50_000_000);
    expect(amountOf(approved, 'DIRECT_ACTIVITY')).toBe(50_000_000);
    expect(statusOf(approved.changes[0])).toBe('approved');
    expect(approved.budgetConfirmed).toBe(false);
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
});
