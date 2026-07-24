import { describe, expect, it } from 'vitest';
import { extractAgreementBudgets } from './agreementBudget';

const categories = [
  { id: 'LABOR', name: '인건비' },
  { id: 'ACTIVITY', name: '연구활동비' },
];

describe('협약서 최초예산 추출', () => {
  it('비목명과 같은 줄의 금액을 읽고 가장 큰 수를 예산으로 사용한다', () => {
    const result = extractAgreementBudgets(
      '인건비 60,000,000원 60%\n연구활동비 40,000,000원 40%',
      categories,
      [],
    );
    expect(result.matched).toBe(2);
    expect(result.budgets).toEqual([
      { categoryId: 'LABOR', amount: 60_000_000 },
      { categoryId: 'ACTIVITY', amount: 40_000_000 },
    ]);
  });

  it('문서에서 찾지 못한 비목은 현재 예산을 확인용 기본값으로 사용한다', () => {
    const result = extractAgreementBudgets(
      '인건비 60,000,000원',
      categories,
      [{ categoryId: 'ACTIVITY', amount: 35_000_000 }],
    );
    expect(result.matched).toBe(1);
    expect(result.budgets.find((item) => item.categoryId === 'ACTIVITY')?.amount).toBe(35_000_000);
  });
});
