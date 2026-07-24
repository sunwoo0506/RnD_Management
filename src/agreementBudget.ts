import type { BudgetItem, PackCategory } from './types';

export interface AgreementBudgetDraft {
  budgets: BudgetItem[];
  matched: number;
}

// 협약서 표의 비목명과 같은 줄에 있는 금액을 우선 읽는다.
// 문서 서식마다 표 구조가 달라 완전 자동 확정하지 않고, 결과는 반드시 확인 팝업에서 검토한다.
export const extractAgreementBudgets = (
  text: string,
  categories: Pick<PackCategory, 'id' | 'name'>[],
  fallback: BudgetItem[],
): AgreementBudgetDraft => {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let matched = 0;
  const budgets = categories.map((category) => {
    const line = lines.find((candidate) => candidate.replace(/\s/g, '').includes(category.name.replace(/\s/g, '')));
    const amounts = line?.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
    const parsed = amounts
      .map((value) => Number(value.replace(/,/g, '')))
      .filter((value) => Number.isSafeInteger(value) && value >= 0);
    if (parsed.length) {
      matched += 1;
      return { categoryId: category.id, amount: Math.max(...parsed) };
    }
    const current = fallback.find((item) => item.categoryId === category.id);
    return current ? { ...current, subItems: current.subItems?.map((sub) => ({ ...sub })) } : { categoryId: category.id, amount: 0 };
  });
  return { budgets, matched };
};
