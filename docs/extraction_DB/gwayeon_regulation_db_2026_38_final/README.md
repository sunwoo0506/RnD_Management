# 과제온 국가연구개발비 규정 DB

MVP 산출물 규격(`docs/gwayeon_guideline_extraction_framework/04_mvp_output_spec.md`)에 맞춰 정리된 패키지입니다.

## 기준

- 문서: 국가연구개발사업 연구개발비 사용 기준
- 고시: 과학기술정보통신부고시 제2026-38호
- 시행: 2026-05-06
- 제5조·제10조의2·제25조의2: 2026-06-11 시행 (부칙 제1조 단서)

## 파일

| 파일 | 담는 것 | 건수 |
|---|---|---|
| `manifest.json` | 문서 메타·시행일·건수 (이전 `document.json`을 흡수) | — |
| `expense_categories.json` | 법정 비목 계층 (이전 `legal_budget_tree.json`) | 27 |
| `budget_screen_guides.json` | 비목별 사용 요약·허용상한 문구 | 26 |
| `expense_allowed_items.json` | 비목 아래 실제 사용 가능 항목 | 158 |
| `expense_limit_rules.json` | 금액·비율·계산식 상한 | 23 |
| `regulation_rules.json` | 적용조건·승인·증빙·금지 등 판정 규칙 | 87 |
| `source_text.json` | 조문 원문 (이전 `regulation_articles.json`) | 126 |
| `review_issues.json` | 원문 확인이 필요한 지점 | 3 |
| `Review.xlsx` | 사람이 검토하는 6시트 통합본 | — |

## `regulation_rules.json`에서 규칙 역할 구분

이전에 `approval_rules`·`evidence_rules`·`expense_applicability_rules`로 나뉘어 있던 것을 하나로 합쳤습니다.
규칙 코드는 겹쳤지만 필드가 서로 달라서, 합치면서 다음 필드를 보존했습니다.

- `rule_type: "APPLICABILITY"` + `institution_scope` → 기관 유형별 비목 사용 가부 (10건)
- `approval_status` (`PRIOR_APPROVAL_REQUIRED` / `RECOGNITION_REQUIRED`) → 사전승인·인정 절차 (11건)
- `required_documents` → 조건부 추가 증빙 (6건)
- `rule_type`이 `DENY`/`ELIGIBILITY`/`REQUIRE`/`LIMIT`/`DEADLINE` 등 → 금지·자격·기한 주의사항

`condition`·`evaluation_stages`·`automation_level`·`required_inputs`는 자동 심사 엔진용 필드로,
MVP 화면에서는 쓰지 않지만 나중을 위해 그대로 둡니다.

## 화면 표시 원칙

- DB에는 전체 비목을 보관하고, 기관 유형에 맞는 항목만 편성 대상으로 노출합니다.
- `상한 없음`은 조건이 없다는 의미가 아닙니다. 자격·원래계획·증빙·사전승인·인정 조건을 별도로 적용합니다.
- 공고·협약의 사업별 기준이 공통 규정보다 우선합니다 (그 기능은 아직 구현 전).

## `_legacy/`

MVP 규격에서 만들지 않기로 한 산출물을 옮겨둔 폴더입니다. 화면에서 쓰지 않으며 필요 없다고
판단되면 삭제해도 됩니다. 자동 심사 엔진용(`formula_variables`, `rule_engine_reference.py`,
`rule_test_cases`, `evaluation_api_spec`), Supabase 직접 적재용(`*.sql`), JSON 사본(`*.csv`),
생성 부산물(`validation_report`, `budget_screen_*_response`), 그리고 위에서 병합이 끝난
`approval_rules`·`evidence_rules`·`expense_applicability_rules`·`legal_budget_tree`·`regulation_articles`·`document`가 들어 있습니다.

## 갱신 방법

```bash
python scripts/make_regulation_review.py <이 폴더>   # Review.xlsx 재생성
node scripts/convert-regulation-db.mjs              # src/rulepacks/nrd2026.json 재생성
```
