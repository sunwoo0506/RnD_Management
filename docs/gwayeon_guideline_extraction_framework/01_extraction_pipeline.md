# 1. 전체 추출 파이프라인

## 단계 0. 업로드 접수

### 저장 항목

- 원본 파일
- 파일명
- MIME 유형
- 파일 크기
- SHA-256 해시
- 업로드 사용자
- 업로드 시각
- 원본 출처 URL
- 사용자가 선택한 사업 또는 기관

### 처리 규칙

1. 동일 SHA-256이 존재하면 기존 문서 버전을 재사용합니다.
2. 파일명은 같지만 해시가 다르면 개정 문서 후보로 처리합니다.
3. HWPX, DOCX, PDF, HTML, XLSX를 지원합니다.
4. PDF가 스캔 문서인 경우에만 OCR을 수행합니다.
5. 원문 파일과 파싱된 텍스트를 별도로 보관합니다.

---

## 단계 1. 문서 메타데이터 판별

AI와 정규식을 함께 사용하여 다음을 추출합니다.

- 문서명
- 문서 유형
- 발행기관
- 고시·공고·훈령 번호
- 제정일
- 개정일
- 공포일
- 시행일
- 유효기간
- 적용 대상
- 폐지·대체 문서
- 상위 근거 규정
- 담당부서
- 연락처

### 문서 유형

- `LAW`
- `DECREE`
- `MINISTERIAL_RULE`
- `NOTICE`
- `GUIDELINE`
- `PROGRAM_ANNOUNCEMENT`
- `AGREEMENT`
- `MANUAL`
- `FAQ`
- `OFFICIAL_INTERPRETATION`
- `INTERNAL_RULE`
- `FORM`
- `ATTACHMENT`

문서 유형이 불명확하면 `UNKNOWN_REVIEW_REQUIRED`로 저장합니다.

---

## 단계 2. 문서 구조 파싱

문서를 다음 노드로 분해합니다.

```text
DOCUMENT
├─ CHAPTER
├─ SECTION
├─ ARTICLE
│  ├─ PARAGRAPH
│  │  ├─ ITEM
│  │  │  ├─ SUBITEM
│  │  │  └─ NOTE
├─ TABLE
├─ APPENDIX
├─ ATTACHMENT
├─ FORM
└─ SUPPLEMENTARY_PROVISION
```

### 노드 공통 필드

- `node_id`
- `parent_node_id`
- `node_type`
- `sequence`
- `heading`
- `original_text`
- `page_number`
- `table_coordinates`
- `source_anchor`
- `text_hash`

### 구조 인식 원칙

1. 조문 번호와 제목을 분리합니다.
2. `①`, `②`, `1.`, `가.`, `1)`의 계층을 보존합니다.
3. 표의 행·열 제목을 각 셀 값과 결합해 의미를 복원합니다.
4. 별표·별지·부칙을 본문과 독립 노드로 저장합니다.
5. 삭제 조항은 삭제 상태를 보존하되 운영 규칙으로 만들지 않습니다.
6. 조문 내부 계산식은 일반 문장과 분리합니다.
7. 각주와 비고를 관련 행 또는 규칙에 연결합니다.

---

## 단계 3. 규칙 후보 탐지

다음 표현이 포함된 문장 또는 표 행을 규칙 후보로 지정합니다.

### 허용

- 사용할 수 있다
- 계상할 수 있다
- 인정한다
- 포함한다
- 지급할 수 있다
- 허용한다

### 금지

- 사용할 수 없다
- 계상하여서는 아니 된다
- 지급하여서는 아니 된다
- 제외한다
- 인정하지 아니한다
- 초과할 수 없다

### 상한·계산

- 이내
- 이하
- 미만
- 이상
- 초과
- 퍼센트
- 원
- 총액
- 한도
- 계산식
- 비율
- 평균

### 승인·인정

- 사전 승인을 받아야 한다
- 승인을 거쳐야 한다
- 인정받아야 한다
- 협약을 변경한 후
- 제출하여야 한다

### 증빙·절차

- 증명자료
- 영수증
- 계약서
- 계획서
- 결과보고서
- 회의록
- 내부결재
- 보관하여야 한다
- 등록하여야 한다

### 기한

- 종료일 이전
- 개월 전
- 일 이내
- 회계연도 종료일까지
- 사용실적 보고일까지

### 예외

- 다만
- 제외한다
- 예외로 한다
- 그럼에도 불구하고
- 해당하지 아니한다
- 인정하는 경우
- 불가피한 사유

후보 탐지는 문장 단위가 아니라 `조문 + 항 + 호 + 단서` 묶음으로 수행합니다.

---

## 단계 4. 규칙 의미 분류

각 후보를 하나 이상의 유형으로 분류합니다.

- `CATEGORY_DEFINE`
- `ALLOWED_ITEM`
- `PROHIBITED_ITEM`
- `LIMIT`
- `FORMULA`
- `APPROVAL_REQUIRED`
- `RECOGNITION_REQUIRED`
- `EVIDENCE_REQUIRED`
- `DEADLINE`
- `PROCEDURE`
- `ELIGIBILITY`
- `PAYMENT_METHOD`
- `REPORTING`
- `RETENTION`
- `EXCEPTION`
- `SCOPE`
- `VERSION_EFFECTIVE`
- `REFERENCE_ONLY`

문장 하나가 두 가지 이상을 포함하면 규칙을 분리합니다.

예시:

```text
원래계획보다 20% 이상 증액하려는 경우 사전승인을 받아야 한다.
```

분리 결과:

1. 변화율 계산 규칙
2. 20% 이상 조건
3. 사전승인 필요 결과

---

## 단계 5. 표준 비목 정규화

### 1차 매핑

문서 표현을 과제온 표준 코드에 매핑합니다.

```text
회의비 → ACTIVITY_MEETING
자문료 → ACTIVITY_EXTERNAL_TECH / EXPERT_CONSULTING
장비 구입비 → DIRECT_EQUIPMENT / EQUIPMENT_PURCHASE
인건비 → DIRECT_LABOR
```

### 매핑 결과 상태

- `EXACT_MATCH`
- `SYNONYM_MATCH`
- `PARENT_MATCH`
- `NEW_CATEGORY_CANDIDATE`
- `AMBIGUOUS`

### 원칙

1. 원문 명칭을 반드시 보존합니다.
2. 표준 코드와 원문 용어를 분리 저장합니다.
3. 하나의 용어가 문서마다 의미가 다르면 기관·사업별 별칭으로 저장합니다.
4. 신규 비목은 자동 생성하지 않고 후보 상태로 저장합니다.
5. 상위 비목과 세부 사용 항목을 혼동하지 않습니다.

---

## 단계 6. 조건식 정규화

자연어 조건을 AST 형태로 변환합니다.

```json
{
  "op": "AND",
  "clauses": [
    {
      "field": "expense.amount",
      "operator": "GTE",
      "value": 30000000,
      "unit": "KRW"
    },
    {
      "field": "expense.in_original_plan",
      "operator": "EQ",
      "value": false
    }
  ]
}
```

### 연산자

- `EQ`
- `NE`
- `GT`
- `GTE`
- `LT`
- `LTE`
- `IN`
- `NOT_IN`
- `BETWEEN`
- `EXISTS`
- `NOT_EXISTS`
- `CONTAINS`
- `DATE_BEFORE`
- `DATE_AFTER`
- `WITHIN_DAYS`
- `WITHIN_MONTHS`
- `FORMULA_TRUE`

### 논리 연산

- `AND`
- `OR`
- `NOT`

조건을 구조화할 수 없으면 `MANUAL_CONDITION`으로 저장합니다.

---

## 단계 7. 금액·비율·계산식 추출

### 반드시 분리할 항목

- 한도 값
- 단위
- 기준금액
- 계산식
- 반올림 방식
- 초과 시 결과
- 예외 조건
- 승인 또는 인정 여부

예시:

```text
직접비의 40퍼센트 범위
```

```json
{
  "limit_type": "PERCENT",
  "limit_value": 40,
  "limit_unit": "PERCENT",
  "basis_code": "DIRECT_COST",
  "formula_expression": "direct_cost * 0.40"
}
```

예시:

```text
직접비에서 위탁연구개발비 등을 제외한 금액의 40퍼센트
```

단순히 `직접비 40%`로 저장하면 안 됩니다. 제외 항목을 계산식에 포함해야 합니다.

---

## 단계 8. 결과 상태 결정

규칙 결과를 다음 중 하나로 정규화합니다.

- `ALLOWED`
- `NOT_ALLOWED`
- `LIMIT_EXCEEDED`
- `PRIOR_APPROVAL_REQUIRED`
- `RECOGNITION_REQUIRED`
- `AGREEMENT_CHANGE_REQUIRED`
- `EVIDENCE_REQUIRED`
- `PROCEDURE_REQUIRED`
- `REPORTING_REQUIRED`
- `INFORMATION_REQUIRED`
- `MANUAL_REVIEW_REQUIRED`

### 핵심 판정 원칙

- `초과 가능하나 인정 필요`는 `NOT_ALLOWED`가 아닙니다.
- `승인 후 사용`은 `PRIOR_APPROVAL_REQUIRED`입니다.
- 정보가 부족하면 임의 추정하지 않고 `INFORMATION_REQUIRED`를 반환합니다.
- 기관 자체규정을 따르는 경우 해당 자체규정 존재 여부를 추가 입력으로 요구합니다.

---

## 단계 9. 예외와 단서 연결

본문 규칙과 다음 표현을 별도 연결합니다.

- 다만
- 제외한다
- 그럼에도 불구하고
- 인정하는 경우
- 불가피한 사유
- 기본사업의 경우
- 영리기관의 경우
- 비영리기관의 경우

예외는 독립 규칙으로 저장하되 `overrides_rule_id`로 본문 규칙과 연결합니다.

---

## 단계 10. 자동 검증

다음 검사를 통과해야 `AUTO_VALIDATED`가 됩니다.

1. 근거 조문 존재
2. 원문 존재
3. 비목 코드 존재
4. 결과 상태 존재
5. 금액에는 통화 단위 존재
6. 비율에는 기준금액 존재
7. 계산식 변수 정의
8. 승인 규칙에 승인권자 존재
9. 증빙 규칙에 문서 종류 존재
10. 시행일 존재
11. 예외 규칙에 본문 규칙 연결
12. 조문 상호참조 존재 여부
13. 동일 조건의 상충 규칙 탐지
14. 삭제 조항 활성화 방지
15. 개정 전·후 버전 중복 활성화 방지

---

## 단계 11. 검토 등급

### 자동 활성화 가능

- 신뢰도 0.92 이상
- 구조 검증 통과
- 상호참조 정상
- 예외 없음 또는 정확히 연결
- 계산식 검증 통과
- 기존 표준 코드와 정확히 매핑

### 관리자 검토

- 신뢰도 0.75 이상 0.92 미만
- 신규 용어 또는 별칭
- 자체규정 참조
- 표 기반 규칙
- 여러 문장에 걸친 조건

### 전문가 검토

- 신뢰도 0.75 미만
- 법적 효력 또는 우선순위 불명확
- 조문 번호 불일치
- 본문과 별표 충돌
- 예외가 본문 전체를 뒤집는 경우
- 계산식이 이미지 또는 수식 객체로만 존재

---

## 단계 12. 버전 관리

1. 기존 버전을 수정하지 않습니다.
2. 개정 문서는 신규 `regulation_version`으로 저장합니다.
3. 이전 버전의 `effective_to`를 설정합니다.
4. 경과조치에 따라 구버전과 신버전이 동시에 적용될 수 있습니다.
5. 사업 협약일, 집행일, 사업 시작일 중 어떤 날짜를 기준으로 적용하는지 저장합니다.
6. 문서 해시와 조문별 텍스트 해시를 사용해 변경 조항만 다시 추출합니다.
