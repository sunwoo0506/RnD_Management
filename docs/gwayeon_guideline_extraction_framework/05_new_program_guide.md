# 5. 새 사업 규정 DB 추가 절차

새 사업의 지침·공고를 규정 DB로 만들어 예산 편성 화면에 붙이는 실제 순서다.
규격은 `04_mvp_output_spec.md`, 판정 기준은 `02_extraction_policy.md`를 따른다.

---

## 5.1 준비물

**필수**는 원본 파일 하나다. 나머지는 문서에서 읽거나 확인해서 채운다.

| 주는 것 | 왜 필요한가 |
|---|---|
| 지침·공고 원본 (HWP/HWPX/PDF) | 규정 본문 |
| **별지서식 파일** (있으면) | 실제 편성 양식의 비목 구조가 여기 있다 (§5.5) |
| 사업명·주관기관 | 표지에 없는 경우가 있다 |
| 영리/비영리 대상 | 만들 팩 개수가 갈린다 (창업기업 대상이면 영리 하나) |

스캔 PDF는 OCR을 거쳐야 하고 표가 깨지기 쉬우니 미리 확인한다.

---

## 5.2 절차

### 1단계. 텍스트 추출

```bash
node scripts/extract-hwp-text.mjs "<원본.hwp>" "<출력.txt>"
```

HWP 5.0의 본문(PARA_TEXT)만 뽑는다. 한글의 "문단 번호" 기능으로 **자동 매긴 조문 번호는 나오지 않는다** —
직접 타이핑한 번호만 남는다. 추출 결과에 "제1조", "가)" 같은 번호가 안 보이면 이 경우이므로,
근거를 조문 번호 대신 소제목으로 잡아야 한다.

### 2단계. 예산 조항 찾기

```bash
grep -n "연구개발비 산정\|비목별\|인건비\|간접비\|부칙" <출력.txt> | head -30
```

보통 "N. 연구개발비 산정기준 및 조정"과 "N. 연구개발비의 관리 및 사용", 그리고 부칙이 대상이다.
**전체를 다 읽지 않는다.** 선정평가·협약·정산 절차는 예산 편성 규칙이 아니라 추출 범위 밖이다.

### 3단계. 산출물 작성

`docs/extraction_DB/<패키지명>/`에 `04_mvp_output_spec.md` §4.1의 6개 + `manifest.json`을 만든다.
비목 코드는 **기존 패키지와 같은 체계**를 쓴다 (`DIRECT_LABOR`, `ACTIVITY_MEETING`, `INDIRECT` …).
코드가 같아야 사업이 달라도 같은 비목으로 인식되고, 공통 규정 기준을 이름으로 찾아 붙일 수 있다.

모든 규칙에 `source_article`(근거)과 `source_quote`(원문 인용)를 넣는다. 인용이 없으면
검토 시트에서 `NEEDS_QUOTE`로 뜨고, 화면에서 근거 링크를 눌러도 위치를 못 찾는다.

### 4단계. 검토본 생성

```bash
python scripts/make_regulation_review.py docs/extraction_DB/<패키지명>
```

`Review.xlsx` 6시트가 만들어진다. `RuleReview` 시트의 **화면 문구**와 **원문 인용**을 나란히 놓고
"사용자에게 이렇게 보이는데 원문은 이렇다"를 대조한다.

### 5단계. 규정 팩 변환

```bash
node scripts/convert-regulation-db.mjs docs/extraction_DB/<패키지명>
```

`manifest.json`의 `pack_meta.output` 이름으로 `src/rulepacks/`에 팩이 생성된다.

```json
"pack_meta": {
  "guideline": "화면에 표시할 지침명",
  "agency": "주관기관",
  "reference_url": "공식 사이트",
  "output": "somebiz2026.json",
  "scopes": [
    { "scope": "FOR_PROFIT", "id": "somebiz2026", "name": "화면에 뜰 팩 이름", "org_type": "영리기관" }
  ]
}
```

비영리도 대상이면 `scopes`에 `NON_PROFIT` 항목을 추가한다 (팩이 2개 생성된다).

### 6단계. 앱 등록

`src/rules.ts` 상단에 import를 추가하고 `PACKS` 배열에 넣는다.

```ts
import somebizPacks from './rulepacks/somebiz2026.json';
// …
export const PACKS: RulePack[] = [...(packsData as RulePack[]), ..., ...(somebizPacks as RulePack[]), LEGACY_PACK];
```

### 7단계. 검증

```bash
npx vitest run && npm run build
```

그리고 **편성 화면을 실제로 띄워 본다.** 상한 계산식이 말이 되는지, 기준 패널의 인정 항목과
주의·절차가 제대로 나오는지는 화면에서만 드러난다.

---

## 5.3 상한인가, 절차 조건인가

가장 자주 틀리는 지점이다. `expense_limit_rules`는 **비목 편성 금액의 상한** 전용이다.

TIPS에서 "각 사업별 인건비 계상률 100% 이내"를 상한 테이블에 넣었더니 화면에
`인건비 19,200,000원 × 100% = 19,200,000원`이라는 무의미한 상한이 계산됐다. 이건 **참여율** 기준이지
금액 상한이 아니다. `regulation_rules`로 옮기니 "별도 총액 상한 없음 + 주의사항"으로 올바르게 표시됐다.

판별 기준은 하나다. **"편성 금액을 이 숫자로 깎는 게 맞는가?"** 아니라면 `regulation_rules`로 보낸다.

- 상한 (`expense_limit_rules`): 연구수당 20%, 위탁 40%, 간접비 10%, 회의 식비 5만원
- 절차·자격 (`regulation_rules`): 참여율 100%, 사전승인 임계값, 기관 자격, 증빙 요구, 금지 항목

`APPROVAL_THRESHOLD`와 `RECOGNITION_LIMIT`는 상한 테이블에 두되 **절차 발동 기준**이라
편성 금액을 깎지 않는다 (예: "3천만원 이상이면 승인 필요"는 3천만원이 상한이라는 뜻이 아니다).

---

## 5.4 시행일은 부칙에서 확인한다

표지의 발행 시점과 실제 시행일이 다르다. TIPS 2차 개정안은 표지가 "2026. 5"인데 부칙 1항은
"2026년 3월 3일부터 시행한다"였다.

조문마다 시행일이 다른 경우(부칙 단서)를 `manifest.json`의 `special_effective_dates`에 반드시 적는다.
놓치면 **아직 시행되지 않은 규정을 현재 기준으로 안내하게 된다.**

```json
"special_effective_dates": [
  { "articles": ["제5조", "제10조의2"], "effective_from": "2026-06-11", "reason": "부칙 제1조 단서" }
]
```

---

## 5.5 별지서식을 버리지 않는다

"별지서식은 협약·보고 양식이라 규칙이 없다"고 넘기기 쉽지만, **실제 편성 양식**이 거기 있다.

TIPS 별지 제1-③호 부록2의 "연구개발비 비목별 총괄표"에서 인건비가 내부(기존 / 신규-일반 /
신규-청년 의무채용)와 외부로, 위탁연구개발비가 직접비·간접비로 나뉜 걸 확인했다. 지침 본문에는
"인건비" 하나로만 나온다. 사용자가 실제로 편성하는 단위는 별지서식 쪽이다.

재원 구성 조건(기관부담 25% 이상, 현물 미집행분 현금 반납 등)도 별지서식 각주에만 있었다.

---

## 5.6 기존 패키지를 정리할 때

파일을 합치기 전에 **필드가 겹치는지 확인한다.** 코드가 같다고 중복이 아니다.

NRD 패키지에서 `approval_rules`(11건)·`evidence_rules`(6건)는 `regulation_rules`(77건)와 규칙 코드가
100% 겹쳐 중복으로 보였다. 합치고 나니 화면의 조건부증빙이 5건→0건, 사전승인이 11건→9건으로 줄었다.
`required_documents`와 `result_status`가 그 두 파일에만 있는 필드였기 때문이다.

지우기 전에 이렇게 확인한다.

```bash
node -e "const a=require('./A.json'),b=require('./B.json');
console.log('A 전용 필드:', Object.keys(a[0]).filter(k=>!Object.keys(b[0]).includes(k)));"
```

되돌릴 수 없는 삭제 대신 `_legacy/`로 옮겨두면 나중에 확인할 수 있다.

---

## 5.7 체크리스트

- [ ] 부칙에서 시행일과 조문별 특례를 확인했다
- [ ] 별지서식의 편성 양식을 확인했다
- [ ] 비목 코드가 기존 패키지와 같은 체계다
- [ ] 모든 규칙에 `source_article`과 `source_quote`가 있다
- [ ] 상한 테이블에 참여율·절차 조건이 섞이지 않았다
- [ ] `Review.xlsx`의 `RuleReview`에서 화면 문구와 원문을 대조했다
- [ ] `src/rules.ts`의 `PACKS`에 등록했다
- [ ] 테스트·빌드 통과, 편성 화면에서 눈으로 확인했다
