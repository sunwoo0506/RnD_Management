# 집행·증빙 화면 재설계 Implementation Plan

**Goal:** 집행·증빙 화면(`src/App.tsx`의 `Spending`)에 예산 집행 대시보드와 월별 집행계획을 얹고, 집행건 등록을 "비목·세목 먼저 → 유의사항·증빙 → 상세 입력" 순서로 바꾼다.

**Architecture:** 계산은 전부 화면 없이 테스트되는 순수 함수로 `src/spending.ts`(신설)에 두고, `Spending` 컴포넌트는 그 결과를 그리기만 한다. 세목별 입력 항목·문서 목록은 `src/spendingForms.ts`(신설)의 명세 표 하나로 정의해 새 세목 추가 시 표에 한 줄만 넣으면 되게 한다.

**Tech Stack:** TypeScript, React, Vitest + Testing Library — 신규 의존성 없음.

**참고 스펙:** `docs/superpowers/specs/2026-07-22-spending-screen-redesign.md` (rev.2, 결정 ①=A 반영)

**핵심 불변 원칙 — 어느 Task에서도 깨지 않는다:**
1. **예산·잔액은 `categoryId`(편성 비목)로만 계산한다.** 세목은 집계·계획·규정조회의 단위일 뿐이다. 이걸 어기면 예산 변경 관리(`ChangeManagement`)·정산과 어긋난다.
2. **집행금액 집계 기준은 `expense.amount`(공급가액, 부가세 제외).** 기존 `Spending`의 `spent` 계산과 동일하다.
3. **세목 필수는 조건부다.** 편성된 세목이 있는 비목만 필수, 없으면 세목 칸을 숨긴다.

---

## Phase 1 — 예산 집행 대시보드 (읽기 전용)

### Task 1: 비목·세목 집계 순수 함수

**Files:**
- Create: `src/spending.ts`, `src/spending.test.ts`
- Reference: `src/rules.ts:119` (`visibleCategories`)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/spending.test.ts`에 다음을 검증한다.

```typescript
describe('categorySpending', () => {
  it('비목별 예산·집행·잔액을 집계한다', () => { /* budget 3000만, 집행 850만 → 잔액 2150만 */ });
  it('세목이 편성된 비목은 세목별 하위 행을 만든다', () => { /* 회의비 800만/350만, 출장비 1200만/500만 */ });
  it('세목이 없는 비목은 하위 행이 비어 있다', () => { /* 인건비 subRows: [] */ });
  it('편성에서 사라진 세목의 집행건은 삭제된 세목 행으로 남는다', () => {
    // subItemId가 budgets에 없는 집행건 → orphan: true, 이름은 subItemName 스냅샷
  });
  it('세목이 있는 비목에 세목 없이 등록된 집행건은 미지정 행으로 모은다', () => { /* 방어적 */ });
  it('세목 집행 합계는 비목 집행금액과 항상 같다', () => {
    // orphan·미지정을 포함해도 합이 어긋나면 안 된다
  });
  it('예산을 넘겨 쓰면 잔액이 음수가 된다', () => { /* over: true */ });
  it('예산이 0원이면 소진율은 0으로 두고 나눗셈하지 않는다', () => { /* NaN/Infinity 방지 */ });
});
```

- [ ] **Step 2: 구현**

```typescript
export interface SubSpendRow {
  subItemId?: string;     // 편성 세목이면 있음. 미지정 행은 없음
  name: string;
  budget: number;         // orphan·미지정은 0
  spent: number;
  remaining: number;
  orphan?: boolean;       // 편성에서 사라진 세목
}
export interface SpendRow {
  categoryId: BudgetCategoryId;
  name: string;
  budget: number; spent: number; remaining: number;
  rate: number;           // 소진율 % — budget이 0이면 0
  over: boolean;
  subRows: SubSpendRow[];
}
export const categorySpending = (pack: RulePack, project: Project): SpendRow[]
export const spendingTotals = (rows: SpendRow[]): { budget: number; spent: number; remaining: number; rate: number }
```

비목 목록은 `visibleCategories(pack, project)`를 그대로 쓴다 — 편성 확정 시 0원 비목을 숨기는 기존 규칙을 따라야 한다.

- [ ] **Step 3: 검증** — `npx vitest run src/spending.test.ts`

### Task 2: 대시보드 표 렌더링

**Files:**
- Modify: `src/App.tsx` (`Spending`), `src/styles.css`
- Test: `src/App.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
it('집행 화면 상단에 비목별 예산·집행·잔액 대시보드가 나온다', async () => {
  // 집행건 1건 등록된 fixture → 해당 비목 행에 예산·집행·잔액이 보인다
});
it('세목이 편성된 비목은 펼쳐서 세목별 집행을 볼 수 있다', async () => { /* 펼치기 버튼 → 세목 행 */ });
it('대시보드에서 비목을 누르면 등록 폼이 그 비목으로 맞춰진다', async () => { /* 비목 select 값 확인 */ });
```

- [ ] **Step 2: 구현** — `Spending` 최상단(`page-title` 바로 아래)에 대시보드 섹션 추가. 세목 행은 `useState<Set<string>>`로 펼침 상태 관리(편성 화면 `subOpen` 패턴과 동일).

- [ ] **Step 3: 검증** — `npx vitest run` 전체 통과 + `npm run build`

> **여기서 한 번 멈추고 화면을 확인한다.** Phase 1은 기존 동작을 전혀 건드리지 않는다.

---

## Phase 2 — 월별 집행계획 · 집행금액

### Task 3: 월 시퀀스와 균등분할

**Files:** Modify `src/spending.ts`, `src/spending.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
describe('monthSequence', () => {
  it('시작월부터 종료월까지 YYYY-MM을 만든다', () => {
    expect(monthSequence('2026-07-01', '2027-06-30')).toHaveLength(12);
    expect(monthSequence('2026-07-01', '2027-06-30')[0]).toBe('2026-07');
  });
  it('해를 넘겨도 이어진다', () => { /* 2026-11 → 2027-02 = 4개 */ });
  it('같은 달이면 1개', () => {});
  it('날짜가 없거나 종료가 시작보다 빠르면 빈 배열', () => { /* monthsBetween과 동일한 방어 */ });
});

describe('splitEvenly', () => {
  it('나누어떨어지면 균등 분할한다', () => {
    expect(splitEvenly(12_000_000, 12)).toEqual(Array(12).fill(1_000_000));
  });
  it('나머지는 마지막 달에 몰아준다', () => {
    const parts = splitEvenly(10_000_000, 12);
    expect(parts.slice(0, 11)).toEqual(Array(11).fill(833_333));
    expect(parts.at(-1)).toBe(10_000_000 - 833_333 * 11);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000_000);  // 합계가 예산과 정확히 일치
  });
  it('월수가 0이면 빈 배열', () => {});
});
```

- [ ] **Step 2: 구현** — `monthSequence`는 `monthsBetween`(`src/rules.ts:781`)과 같은 방어 규칙을 따른다.

### Task 4: 월별 계획·집행 표 데이터

**Files:** Modify `src/types.ts`, `src/spending.ts`, `src/spending.test.ts`

- [ ] **Step 1: 타입 추가** (`src/types.ts`)

```typescript
export interface MonthlyPlanEntry {
  categoryId: BudgetCategoryId;
  subItemId?: string;   // 없으면 비목 전체 기준
  month: string;        // 'YYYY-MM'
  amount: number;
}
// Project에 monthlyPlan?: MonthlyPlanEntry[] 추가
```

- [ ] **Step 2: 실패하는 테스트 작성**

```typescript
describe('monthlyPlan', () => {
  it('저장된 계획이 없으면 예산을 월수로 균등분할한 값을 쓴다', () => {});
  it('사용자가 고친 달은 그 값을, 나머지는 자동 계산값을 쓴다', () => {});
  it('예산이 바뀌면 고치지 않은 달만 따라 움직인다', () => {
    // 고친 달의 금액은 그대로 유지된다
  });
  it('집행금액은 집행일이 속한 달에 잡힌다', () => {});
  it('사업기간 밖 집행은 기간 외 행으로 따로 모은다', () => {
    // 숨기면 안 된다 — 정산 때 문제가 되는 건이다
  });
  it('기간 외 행을 포함한 집행 합계는 대시보드 집행금액과 같다', () => {});
  it('세목을 고르면 그 세목의 예산·집행만 잡는다', () => {});
  it('계획 합계가 예산과 어긋나면 차이를 돌려준다 (막지는 않는다)', () => {});
});
```

- [ ] **Step 3: 구현**

```typescript
export interface MonthRow { month: string; plan: number; actual: number; diff: number; edited: boolean }
export interface MonthlyPlanView {
  rows: MonthRow[];
  outOfRange: { actual: number; count: number } | null;  // 기간 외
  totals: { plan: number; actual: number; budget: number; planGap: number };
}
export const monthlyPlan = (
  pack: RulePack, project: Project,
  sel: { categoryId?: BudgetCategoryId; subItemId?: string },
): MonthlyPlanView
```

### Task 5: 월별 표 토글 UI + 계획 수정

**Files:** Modify `src/App.tsx`, `src/styles.css`, `src/App.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
it('월별 집행계획은 접혀 있다가 펼치면 월별 계획·집행이 나온다', async () => {});
it('계획 금액을 고치면 저장되고 합계가 다시 계산된다', async () => {});
it('계획 합계가 예산과 다르면 차이를 표시한다', async () => {});
it('사업기간 밖 집행이 있으면 기간 외 행으로 보인다', async () => {});
```

- [ ] **Step 2: 구현** — 대시보드 오른편에 `<details>`. 계획 칸은 `withCommas`/`digitsOnly`를 쓰는 숫자 입력(기존 금액 입력 패턴과 동일). 수정 시 `project.monthlyPlan`에 해당 칸만 upsert.

- [ ] **Step 3: 검증** — 전체 테스트 + 빌드

---

## Phase 3 — 비목·세목 선택과 폼 순서 (위험도 높음)

> 등록 흐름 전체가 바뀐다. `src/App.test.tsx`의 집행 관련 테스트를 다시 써야 한다.

### Task 6: 세목 → 규정 기준 해석

**Files:** Modify `src/spending.ts`, `src/spending.test.ts`
**Reference:** `src/rules.ts:499` (`referenceStandardFor`), `:533` (`matchingCategory`)

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
describe('resolveSubItemStandard', () => {
  it('세목 이름이 referenceCategories에 있으면 그 기준을 준다', () => {
    // '회의비' → evidenceRules 3건 (10만원 초과/이하, 사용 입증자료)
    // '출장비' → 국외출장 계획서·결과보고서
  });
  it('세목 이름이 인정 항목 수준이면 그것을 포함하는 상위 세목을 찾는다', () => {
    // '회의 식비' → '회의비'  (subItemOptions 없는 팩 대응)
  });
  it('어디에도 없는 이름이면 null을 준다', () => { /* 비목 기준으로 폴백 */ });
});
```

- [ ] **Step 2: 구현** — 이름 정규화는 `rules.ts`의 `normCategoryName`과 같은 규칙을 쓴다. 역방향 색인(인정 항목명 → 상위 세목)은 팩 단위로 한 번만 만든다.

### Task 7: 비목·세목 2단 선택 + 폼 재배치

**Files:** Modify `src/types.ts`, `src/App.tsx`, `src/App.test.tsx`

- [ ] **Step 1: 타입 추가** — `Expense`에 `subItemId?`, `subItemName?` (둘 다 optional)

- [ ] **Step 2: 실패하는 테스트 작성**

```typescript
it('비목을 고르면 그 비목의 유의사항과 필요한 증빙이 금액 입력보다 먼저 나온다', async () => {});
it('세목이 편성된 비목은 세목을 골라야 등록할 수 있다', async () => {});
it('세목이 없는 비목은 세목 칸이 아예 안 나온다', async () => {});   // 결정 ①=A
it('세목을 고르면 그 세목의 증빙 규칙이 나온다', async () => {
  // 연구활동비 > 출장비 → '국외출장 집행 전 출장계획서 구비'
});
it('세목을 바꾸면 골라둔 증빙 선택이 초기화된다', async () => {
  // 회의비 증빙을 담아둔 채 출장비로 바꾸면 안 맞는 서류가 남는다
});
it('등록하면 집행건에 비목과 세목이 함께 저장된다', async () => {});
```

- [ ] **Step 3: 구현**

폼 구조를 다음 순서로 재배치한다.
1. 비목 `select` → 세목 `select`(편성 세목이 있을 때만)
2. 유의사항(`rulesFor(pack, id, 'warning')`) + 증빙(`primaryEvidence`) + 잔액·이번 달 계획
3. 집행일 · 결제수단 · 공급가액 · 부가세액 · 합계 · 용도 · 거래처

증빙은 **세목 기준을 우선 적용**한다 — `resolveSubItemStandard`로 찾은 세목 기준이 있으면 그것으로 `evidenceGuide`를 만들고, 없으면 지금처럼 비목 기준을 쓴다.

- [ ] **Step 4: 기존 테스트 갱신** — `App.test.tsx`의 집행 관련 테스트 3건(회의비 등록 / 규정DB 증빙 / 집행건 수정)이 새 순서·세목 필수 규칙에 맞게 동작하는지 다시 쓴다.

- [ ] **Step 5: 검증** — 전체 테스트 + 빌드 + 화면 확인

---

## Phase 4 — 세목별 추가 입력

### Task 8: 입력 항목 명세 표

**Files:** Create `src/spendingForms.ts`; Modify `src/types.ts`

- [ ] **Step 1: 구현**

```typescript
export interface DetailField {
  key: string; label: string; required?: boolean;
  type?: 'text' | 'date' | 'textarea'; hint?: string;
}
// 세목명(규정 기준으로 해석한 것) → 추가 입력 항목
export const DETAIL_FIELDS: Record<string, DetailField[]> = { 회의비: [...], 출장비: [...] };

// 세목 → 이 집행건에서 만들 수 있는 문서. 지금은 목록만 쓰고,
// 실제 생성(fill)은 Phase 5에서 exporters.ts에 붙인다.
export const DETAIL_DOCUMENTS: Record<string, string[]> = {
  회의비: ['회의록'],
  출장비: ['출장신청서', '출장보고서'],
};
```

필드 목록은 스펙 §4를 그대로 옮긴다. **`key`는 문서 서식의 칸 이름과 1:1로 대응하도록 지금 정한다** — Phase 5에서 `fillTemplate(type, expense.details)` 한 줄로 붙어야 한다.

- [ ] **Step 2: 타입 추가** — `Expense`에 `details?: Record<string, string>`

### Task 9: 추가 입력 렌더링

**Files:** Modify `src/App.tsx`, `src/App.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
it('세목이 회의비면 회의 목적·장소·참석자 칸이 나온다', async () => {});
it('세목이 출장비면 출장자·출장지·출장 기간 칸이 나온다', async () => {});
it('세목이 회의비가 아니면 회의 전용 칸이 안 나온다', async () => {});
it('필수 추가 항목을 비우면 등록되지 않는다', async () => {});
it('입력한 추가 항목이 집행건에 저장되고 수정 화면에서 다시 보인다', async () => {});
it('세목을 바꾸면 이전 세목의 추가 입력이 남지 않는다', async () => {});
```

- [ ] **Step 2: 구현** — `DETAIL_FIELDS[해석된 세목명]`을 돌며 칸을 그린다. 명세 표에 없는 세목은 추가 칸 없음.

- [ ] **Step 3: 검증** — 전체 테스트 + 빌드

---

## Phase 5 — (다음 단계, 이번 범위 아님)

입력값으로 채워진 회의록·출장신청서·출장보고서 Word 생성. `src/exporters.ts:96` `downloadTemplate`을 `fillTemplate(type, details)`로 확장하고 집행건 카드에 버튼을 붙인다.

---

## 완료 기준

- [ ] `npx vitest run` 전체 통과 (기존 183개 + 신규)
- [ ] `npm run build` (타입 검사 포함) 통과
- [ ] 대시보드 집행금액 합계 == 월별 표 집행 합계(기간 외 포함) — 테스트로 고정
- [ ] 세목 집행 합계 == 비목 집행금액 — 테스트로 고정
- [ ] 예산·잔액이 `categoryId` 기준으로만 계산됨 (세목이 예산을 건드리지 않음)
- [ ] 기존 저장 데이터(`gwajeon.project.v1`)를 열어도 화면이 깨지지 않음 — 신규 필드 전부 optional
