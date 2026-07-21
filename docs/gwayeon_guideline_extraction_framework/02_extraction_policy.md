# 2. 세부 추출 규정

## 2.1 비목과 사용 가능 항목 구분

### 비목

예산의 상위 분류입니다.

예:

- 인건비
- 연구활동비
- 회의비
- 출장비

### 사용 가능 항목

해당 비목으로 집행할 수 있는 실제 비용입니다.

예:

- 회의장 임차료
- 통역료
- 전문가 자문료
- 소프트웨어 구독료

### 추출 규칙

- `A의 사용용도는 다음과 같다`의 A는 비목 후보입니다.
- 뒤따르는 각 호는 사용 가능 항목 후보입니다.
- 각 호 설명에 여러 비용이 나열되면 별도 세부 항목으로 분리할 수 있습니다.
- 화면용 편의를 위한 구분은 `UI_PROFILE`로 저장하고 법정 비목과 분리합니다.

---

## 2.2 금지 규칙

### 명시적 금지

다음 표현은 `PROHIBITED_ITEM` 또는 `NOT_ALLOWED`로 추출합니다.

- 계상하여서는 아니 된다
- 사용할 수 없다
- 제외한다
- 지급하여서는 아니 된다

### 제한적 금지

다음은 조건부 금지입니다.

```text
참여연구자만 참석하는 회의의 식비는 계상할 수 없다.
```

조건 없이 회의비 전체를 금지하면 안 됩니다.

---

## 2.3 허용상한 규칙

상한은 다음 유형으로 분류합니다.

- `FIXED_AMOUNT`
- `PERCENT`
- `FORMULA`
- `ANNUAL_AVERAGE`
- `PER_TRANSACTION`
- `PER_PERSON`
- `PER_PERIOD`
- `APPROVAL_THRESHOLD`
- `PLAN_BASED`
- `NO_FIXED_CAP`

`NO_FIXED_CAP`은 조건이 없다는 뜻이 아닙니다.

> **MVP에서는 7종만 씁니다.** `NONE`(= `NO_FIXED_CAP`), `FIXED_AMOUNT`, `PERCENT`, `FORMULA`,
> `ANNUAL_AVERAGE`, `APPROVAL_THRESHOLD`, `RECOGNITION_LIMIT`.
> 나머지는 `04_mvp_output_spec.md` §4.2의 변환표대로 옮기고, 상한이 아닌 규칙(자격·절차·금지)은
> `expense_limit_rules`가 아니라 `regulation_rules`에 넣습니다.

---

## 2.4 승인과 인정 구분

### 사전승인

사용 전에 승인 절차를 완료해야 합니다.

```json
{
  "result_status": "PRIOR_APPROVAL_REQUIRED",
  "approval_timing": "BEFORE_EXPENSE",
  "approval_authority": "CENTRAL_ADMINISTRATIVE_AGENCY"
}
```

### 인정

기본 한도를 넘거나 특수한 비용을 계상하기 위한 기관 판단입니다.

```json
{
  "result_status": "RECOGNITION_REQUIRED",
  "recognition_authority": "CENTRAL_ADMINISTRATIVE_AGENCY"
}
```

### 협약변경

승인만으로 끝나는지, 협약변경 후 사용할 수 있는지 분리합니다.

---

## 2.5 증빙 규칙

증빙은 다음 구조로 추출합니다.

```json
{
  "required_documents": [
    {
      "group": "MEETING_RECORD",
      "requirement": "ONE_OF",
      "documents": ["INTERNAL_APPROVAL", "MEETING_MINUTES"]
    },
    {
      "group": "PAYMENT",
      "requirement": "ALL",
      "documents": ["RECEIPT"]
    }
  ]
}
```

간소화 증빙은 별도 예외 규칙으로 저장합니다.

---

## 2.6 기한 규칙

기준일과 상대기간을 분리합니다.

```json
{
  "deadline": {
    "base_date_field": "project.end_date",
    "offset": {
      "months": -2
    },
    "event": "CONTRACT_SIGNED"
  }
}
```

`종료일 2개월 전`을 단순 문자열로만 저장하지 않습니다.

---

## 2.7 기관별 적용조건

다음 기관 유형을 표준화합니다.

- `FOR_PROFIT`
- `NON_PROFIT`
- `UNIVERSITY`
- `GOV_FUNDED`
- `SME`
- `MID_SIZED`
- `LARGE_ENTERPRISE`
- `PUBLIC_ENTERPRISE`
- `DIRECTLY_ESTABLISHED`
- `STUDENT_LABOR_INTEGRATED`
- `EQUIPMENT_INTEGRATED`

한 규칙이 기관에 따라 달라지면 규칙을 분리합니다.

---

## 2.8 사업별 적용조건

- 사업 유형
- 연구개발사업 여부
- 기본사업 여부
- 보안과제 여부
- 연구인프라 조성 목적 여부
- 인력양성 목적 여부
- 재난·긴급사업 여부
- 단계 구분 여부

조건이 문서에 명확하지 않으면 `program_attribute_required`로 표시합니다.

---

## 2.9 표 추출 규칙

표는 셀만 개별 추출하면 의미가 손실됩니다.

다음 컨텍스트를 결합합니다.

```text
표 제목
+ 상위 행 제목
+ 상위 열 제목
+ 현재 셀
+ 각주
+ 비고
```

예:

| 비목 | 영리기관 | 비영리기관 |
|---|---|---|
| 간접비 | 10% | 고시비율 |

각 셀은 독립 규칙으로 생성합니다.

---

## 2.10 별표·별지·서식

- 별표의 금액표는 규칙 데이터로 추출합니다.
- 별지 서식의 입력 항목은 `required_form_fields`로 추출합니다.
- 서식 자체가 제출 의무를 의미하지는 않습니다.
- 본문에서 서식 제출을 요구하는 조문이 있을 때만 의무 규칙으로 연결합니다.

---

## 2.11 부칙과 경과조치

부칙에서 다음을 추출합니다.

- 시행일
- 조문별 별도 시행일
- 기존 과제 적용 여부
- 소급 적용 여부
- 경과조치
- 폐지 문서

부칙은 일반 조문보다 버전 적용 판단에서 우선 확인합니다.

---

## 2.12 신뢰도 계산

권장 신뢰도 구성:

```text
구조 인식 정확도       20%
비목 매핑 정확도       15%
조건식 완전성          20%
수치·계산식 정확도     20%
예외 연결 정확도       15%
상호참조 검증          10%
```

다음은 신뢰도를 강제로 낮춥니다.

- OCR 사용
- 표 셀 병합 복원 실패
- 단서가 다른 페이지에 있음
- 조문 번호 불일치
- 수식 이미지
- 기관 자체규정 참조
- 상위 규정 확인 필요
