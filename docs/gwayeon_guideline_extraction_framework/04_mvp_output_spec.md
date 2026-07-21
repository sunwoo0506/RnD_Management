# 4. MVP 산출물 규격

이 문서는 **지금 만들 것**을 정한다. `01_extraction_pipeline.md`와 `02_extraction_policy.md`는
최종적으로 도달할 규격이고, 여기서는 그중 예산 편성 화면이 실제로 소비하는 것만 남긴다.

원칙은 하나다. **화면에 쓰이지 않는 산출물은 만들지 않는다.** 자동 심사 엔진, 조건식 평가,
Supabase 직접 적재는 MVP 범위 밖이므로 그 입력이 되는 산출물도 만들지 않는다.

---

## 4.1 필수 산출물 (6개 + manifest)

사업 종류와 무관하게 **파일명과 시트명을 고정한다.** 사업마다 이름이 다르면 변환 스크립트와
검토 절차를 사업 수만큼 만들어야 한다.

| 파일 | 담는 것 | 화면에서 쓰이는 곳 |
|---|---|---|
| `manifest.json` | 문서명·고시번호·발행기관·시행일·조문별 특례 시행일·건수 | 규정 팩 메타, 화면 상단 출처 표기, `Summary` 시트 |
| `expense_categories.json` | 법정 비목의 계층 구조 | 편성표의 비목 목록, 세목 후보 |
| `budget_screen_guides.json` | 비목별 사용 요약·허용상한 문구 | 편성표 "허용 상한" 칸, 기준 패널 |
| `expense_allowed_items.json` | 비목 아래 실제 사용 가능 항목 | 기준 패널 "인정 항목" |
| `expense_limit_rules.json` | 금액·비율·계산식 상한 | 상한 금액 자동 계산, 초과 경고 |
| `regulation_rules.json` | 승인·인정·증빙·금지 등 판정 규칙 | 기준 패널 "주의 · 절차" |
| `source_text.json` | 조문 원문 | 근거 링크의 조문 원문 팝업 |
| `review_issues.json` | 추출하면서 원문 확인이 필요하다고 표시한 지점 | 편성 화면 "규정 DB 검토 메모" |

`review_issues.json`은 확인할 게 없으면 만들지 않아도 된다. 나머지 6개와 `manifest.json`은 필수다.
여기에 사람이 검토하는 `Review.xlsx` 한 개를 더한다 (§4.3).

### 만들지 않는 것

| 만들지 않음 | 이유 |
|---|---|
| `formula_variables`, `rule_engine_reference.py`, `rule_test_cases`, `evaluation_api_spec` | 자동 심사 엔진용. MVP에는 집행 건을 자동 판정하는 기능이 없다 |
| `supabase_schema.sql`, `supabase_seed*.sql`, `*_view.sql` | 규정을 DB 테이블에 적재하는 구조 전제. 지금은 JSON → 규정 팩 변환 방식 |
| `*.csv` (JSON 사본) | 같은 내용의 중복. 검토는 `Review.xlsx`로 한다 |
| `validation_report.json`, `budget_screen_*_response.json` | 생성 과정 부산물. 검증 결과는 `manifest.json`의 `validation`에 요약만 남긴다 |
| `document.json` | 별도 파일로 만들지 않고 `manifest.json`에 흡수한다 (§4.5) |
| `program_rule_overrides.json` | 공고·협약이 공통 고시를 덮어쓰는 기능을 만들 때 추가한다 |
| `__pycache__` | 파이썬 캐시. 커밋 금지 |

### 이름이 바뀐 것

이전 패키지와의 대응이다. 변환 스크립트는 **둘 다 읽되 새 이름을 우선**한다.

| 이전 | MVP 규격 |
|---|---|
| `legal_budget_tree.json` | `expense_categories.json` |
| `regulation_articles.json` | `source_text.json` |
| `approval_rules` + `evidence_rules` + `expense_applicability_rules` | `regulation_rules.json`로 통합 |

합칠 때 **필드를 잃지 않는지 확인한다.** 이전 NRD 패키지에서 `approval_rules`·`evidence_rules`는
`regulation_rules`와 규칙 코드가 100% 겹쳐 단순 중복처럼 보였지만, `required_documents`(필요 증빙)와
`result_status`(사전승인/인정 구분)는 그 두 파일에만 있었다. 코드가 같다고 지우지 말고 필드를 병합한다.

통합된 `regulation_rules`에서 각 규칙의 역할은 이렇게 구분한다.

- 적용조건: `rule_type: "APPLICABILITY"` + `institution_scope` — 기관 유형별 비목 사용 가부
- 사전승인·인정: `approval_status` (`PRIOR_APPROVAL_REQUIRED` / `RECOGNITION_REQUIRED`)
- 조건부 증빙: `required_documents` 배열
- 금지·자격·기한: `rule_type`이 `DENY`/`DENY_WITH_EXCEPTIONS`/`ELIGIBILITY`/`REQUIRE`/`LIMIT`/`DEADLINE`/`PAYMENT_METHOD`

---

## 4.2 `expense_limit_rules`의 `limit_type` (7종)

`02_extraction_policy.md` §2.3의 10종을 MVP에서는 7종으로 줄인다. **이 테이블은 "허용 상한"
전용이다.** 상한이 아닌 규칙(자격·절차·금지)은 `regulation_rules.json`으로 보낸다.

| 값 | 뜻 | 화면 처리 |
|---|---|---|
| `NONE` | 별도 상한 없음 | "규정 상한 없음" 표시. 조건이 없다는 뜻은 아니다 |
| `FIXED_AMOUNT` | 고정 금액 | 그 금액을 상한으로 |
| `PERCENT` | 기준금액의 비율 | `basis_code` × `limit_value`%로 계산 |
| `FORMULA` | 계산식 | `formula_expression`을 근거로 표시, 자동 계산은 기준이 편성표 안에 있을 때만 |
| `ANNUAL_AVERAGE` | 연차별 평균 한도 | 안내 문구로 표시 |
| `APPROVAL_THRESHOLD` | 초과 시 사전승인 | 금액을 넘으면 "사전승인 필요" 경고 |
| `RECOGNITION_LIMIT` | 초과 시 기관 인정 필요 | 금액을 넘으면 "전문기관 인정 필요" 경고 |

이전 값에서 옮기는 방법:

- `PLAN_BASED` → `NONE` (계획 범위 내 사용은 상한이 아니다)
- `CHANGE_RATE` → `PERCENT`
- `PROCEDURE_THRESHOLD` → `APPROVAL_THRESHOLD`
- `PER_TRANSACTION`·`PER_PERSON`·`PER_PERIOD` → `FIXED_AMOUNT`로 두고 `limit_scope`에 단위를 적는다
  (건당·1인당·기간당). MVP는 이 단위로 자동 계산하지 않고 문구로만 안내한다
- `ELIGIBILITY`·`APPROVAL` → 상한이 아니므로 `regulation_rules.json`으로 이동

`APPROVAL_THRESHOLD`와 `RECOGNITION_LIMIT`는 **금액 상한이 아니라 절차 발동 기준**이다.
편성 금액을 깎는 데 쓰지 않는다.

---

## 4.3 `Review.xlsx` 시트 구성 (고정 6시트)

사람이 추출 결과를 검증하는 유일한 창구다. **모든 사업이 같은 시트명·같은 순서**를 쓴다.

| # | 시트 | 담는 것 |
|---|---|---|
| 1 | `Summary` | 문서·고시번호·시행일·조문별 별도 시행일·건수 요약 |
| 2 | `BudgetTree` | 법정 비목 계층 (코드·이름·상위·레벨·구분) |
| 3 | `BudgetGuides` | 화면에 표시할 비목별 사용 요약과 허용상한 (검토용 한글 헤더) |
| 4 | `AllowedItems` | 비목 아래 실제 사용 가능 항목 (설명·조건·근거) |
| 5 | `LimitRules` | 금액·비율·계산식·승인·인정 규칙 (`limit_type` 7종) |
| 6 | `RuleReview` | 자동판정 가능 여부와 검토 상태 (근거 원문 유무로 판정) |


`Summary` 시트에는 시행일이 조문마다 다른 경우를 반드시 적는다. 예:

```text
문서: 국가연구개발사업 연구개발비 사용 기준
고시: 과학기술정보통신부고시 제2026-38호
시행: 2026-05-06
제5조·제10조의2·제25조의2: 2026-06-11 시행
```

생성: `python scripts/make_regulation_review.py <패키지 폴더>`

---

## 4.4 모든 산출물의 공통 필수 필드

규격을 줄여도 이 세 가지는 빠뜨리지 않는다. 근거 없는 규칙은 화면에 띄울 수 없다.

- `source_article`: 근거 조문 위치 (제25조제5항). 조문 번호가 있으면 번호를 쓴다
- `source_quote` 또는 `source_text.json`으로 연결되는 원문
- `effective_from`: 시행일. 조문별로 다르면 그 조문의 날짜를 쓴다

`02_extraction_policy.md`의 판정 기준(금지 조건 분리, 승인·인정 구분, 예외 별도 추출)은
그대로 적용한다. 줄인 것은 **산출물의 개수**이지 추출의 정확도가 아니다.

---

## 4.5 `manifest.json` 필수 필드

이전 패키지에서 `document.json`으로 분리했던 문서 메타를 여기에 합친다.
`Summary` 시트가 이 값을 그대로 읽는다.

```json
{
  "package_name": "gwayeon_tips_guideline_2026_r2",
  "document_version": "TIPS_OPERATION_GUIDELINE_2026_R2",
  "title": "팁스(TIPS) 총괄 운영지침",
  "notice_number": "중소벤처기업부 공고 제2026-000호",
  "issuer": "중소벤처기업부",
  "document_type": "GUIDELINE",
  "revision_type": "2차 개정",
  "effective_from": "2026-05-01",
  "special_effective_dates": [
    { "articles": ["제5조", "제10조의2"], "effective_from": "2026-06-11", "reason": "부칙 제1조 단서" }
  ],
  "base_document_version": "NRD_COST_STANDARD_2026_38",
  "generated_at": "2026-07-22",
  "source_files": ["붙임1. 2026년 팁스 총괄 운영지침 2차 개정안 본문.hwp"],
  "source_file_sha256": "…",
  "counts": { "categories": 20, "limit_rules": 28, "allowed_items": 34, "budget_guides": 9 },
  "pack_meta": { "guideline": "…", "agency": "…", "reference_url": "…", "output": "tips2026.json", "scopes": [] }
}
```

`special_effective_dates`는 **부칙에서 직접 뽑는다.** 조문마다 시행일이 다른데 이걸 놓치면
아직 시행되지 않은 규정을 현재 기준으로 안내하게 된다. 해당 조문이 없으면 빈 배열로 둔다.

`pack_meta`는 규정 팩 변환 스크립트(`scripts/convert-regulation-db.mjs`)가 읽는 앱 전용 설정이라
추출 단계에서는 비워도 된다.
