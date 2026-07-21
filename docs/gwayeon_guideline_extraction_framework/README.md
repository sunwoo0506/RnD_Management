# 과제온 사업지침 자동 DB화 프레임워크

이 패키지는 정부지원사업 공고·지침·협약·FAQ·매뉴얼을 업로드했을 때,
예산 비목, 사용 가능 항목, 금지 항목, 허용상한, 계산식, 승인·인정,
증빙, 기한, 적용대상, 예외를 일관된 형태로 추출하기 위한 표준 규격입니다.

## 설계 원칙

1. 원문을 삭제하거나 요약문으로 대체하지 않습니다.
2. AI 추출 결과를 곧바로 운영 규칙으로 사용하지 않습니다.
3. 규칙마다 반드시 근거 조문과 원문을 연결합니다.
4. 금액 상한과 사전승인 기준을 구분합니다.
5. `불가`, `승인 후 가능`, `인정 후 가능`, `정보 부족`을 구분합니다.
6. 공통 지침과 사업별 예외를 덮어쓰지 않고 버전과 우선순위로 관리합니다.
7. 기존 비목 체계에 억지로 끼워 넣지 않고 신규 비목 후보를 별도로 관리합니다.
8. 문장 하나가 여러 규칙을 포함하면 규칙을 분리합니다.
9. 단서·예외·경과조치가 본문 규칙보다 누락되지 않도록 별도 추출합니다.
10. AI는 규칙 후보를 만들고, 최종 활성화는 검증 절차를 거칩니다.

## 전체 처리 흐름

```text
파일 업로드
→ 원본 해시 및 메타데이터 저장
→ 문서 유형·발행기관·시행일 판별
→ 장/절/조/항/호/목/표/별지 구조화
→ 규칙 후보 문장 탐지
→ 예산 비목·사용항목·조건·결과 추출
→ 표준 코드로 정규화
→ 예외·단서·상호참조 연결
→ 자동 검증
→ 관리자 또는 전문가 검토
→ 버전형 규칙 DB 활성화
→ 사업별 공고·협약 override 적용
```

## 지금 만들 것 (MVP)

이 패키지 전체는 최종 도달 규격입니다. **당장 무엇을 만들지는 `04_mvp_output_spec.md`를 보세요.**
필수 산출물 6개(+manifest)와 `Review.xlsx` 6시트만 만들고, 자동 심사 엔진·DB 적재용 산출물은
만들지 않습니다.

## 핵심 파일

- `04_mvp_output_spec.md`: **MVP 필수 산출물과 Review.xlsx 시트 규격 (먼저 읽을 것)**
- `05_new_program_guide.md`: **새 사업 규정 DB를 추가하는 실제 순서와 함정**
- `01_extraction_pipeline.md`: 전체 추출 단계
- `02_extraction_policy.md`: 추출 규칙과 판정 기준
- `03_database_schema.sql`: 운영 DB 구조
- `schemas/document_metadata.schema.json`: 문서 메타데이터 스키마
- `schemas/normalized_rule.schema.json`: 최종 규칙 스키마
- `schemas/extraction_job.schema.json`: 추출 작업 스키마
- `taxonomy.json`: 규칙·문서·상태 분류
- `validation_rules.json`: 자동 검증 규칙
- `merge_precedence.md`: 규정 병합과 충돌 처리
- `prompts/*.md`: AI 단계별 프롬프트
- `reference_extractor.py`: 참조 구현
- `examples/sample_normalized_rules.json`: 규칙 예시
- `tests/extraction_test_cases.json`: 테스트 사례

## 권장 운영 상태

```text
UPLOADED
→ PARSED
→ AI_EXTRACTED
→ AUTO_VALIDATED
→ ADMIN_REVIEWED
→ EXPERT_VERIFIED
→ ACTIVE
```

다음 상황은 자동 활성화하지 않습니다.

- 조문 참조 불일치
- 계산식 변수 미확정
- 본문과 별표의 기준 충돌
- 금액·비율의 기준금액 불명확
- 단서 또는 예외가 연결되지 않음
- 공고와 협약의 우선 적용 여부 불명확
- 스캔 품질이 낮거나 표가 깨짐
