# 과제온 팁스(TIPS) 운영지침 규정 DB

MVP 산출물 규격(`docs/gwayeon_guideline_extraction_framework/04_mvp_output_spec.md`)에 맞춰 만든 패키지입니다.

## 기준

- 문서: 팁스(TIPS) 총괄 운영지침 (2026 · 2차 개정)
- 발행: 중소벤처기업부
- 시행: 2026-03-03 (부칙 1.)
- 18. 연구개발비 사용실적 보고 및 정산 중 회의비 관련 개정사항: 2024-12-01부터 적용 (부칙 4. 단서)

상위 기준은 「국가연구개발사업 연구개발비 사용 기준」(`gwayeon_regulation_db_2026_38_final`)입니다.
지침 11.가에 따라 그 기준을 따르되 이 지침이 별도로 정한 사항이 우선하며, 이 패키지는 **지침이
별도로 정했거나 명시한 규칙만** 담습니다.

## 원본

| 파일 | 뽑은 범위 |
|---|---|
| 붙임1 … 2차 개정안 본문.hwp | 11. 연구개발비 산정기준 및 조정 / 16. 연구개발비의 관리 및 사용 / 붙임 비목별 증빙자료 / 부칙 |
| 붙임2 … 2차 개정안 별지서식.hwp | 별지 제1-③호 부록2 연구개발비 사용계획 (비목별 총괄표) |

본문 SHA-256은 `manifest.json`의 `source_file_sha256`에 있습니다.
텍스트 추출: `node scripts/extract-hwp-text.mjs <파일.hwp> <출력.txt>`

## 파일

| 파일 | 담는 것 | 건수 |
|---|---|---|
| `manifest.json` | 문서 메타·시행일·건수 | — |
| `expense_categories.json` | 법정 비목 계층 | 26 |
| `budget_screen_guides.json` | 비목별 사용 요약·허용상한 문구 | 8 |
| `expense_allowed_items.json` | 비목 아래 실제 사용 가능 항목 | 36 |
| `expense_limit_rules.json` | 금액·비율·계산식 상한 | 23 |
| `regulation_rules.json` | 승인·인정·증빙·금지 등 판정 규칙 | 25 |
| `source_text.json` | 조문 원문 | 15 |
| `Review.xlsx` | 사람이 검토하는 6시트 통합본 | — |

## 비목 체계에서 유의할 점

인건비의 **내부(기존 / 신규-일반 / 신규-청년 의무채용) · 외부** 구분과 위탁연구개발비의
**직접비 · 간접비** 구분은 지침 본문이 아니라 **별지서식의 편성 양식**에서 왔습니다.
실무에서 실제로 편성하는 단위라서 세부 비목으로 넣었고, 근거는 `별지 제1-③호 부록2`로 적어뒀습니다.

"인건비 계상률 100%"는 참여율 기준이지 비목 금액 상한이 아니라서 `expense_limit_rules`가 아니라
`regulation_rules`에 있습니다. 상한 테이블에 두면 편성 금액을 깎는 기준으로 잘못 계산됩니다.

## 갱신 방법

```bash
python scripts/make_regulation_review.py docs/extraction_DB/gwayeon_tips_guideline_2026_r2
node scripts/convert-regulation-db.mjs docs/extraction_DB/gwayeon_tips_guideline_2026_r2
```
