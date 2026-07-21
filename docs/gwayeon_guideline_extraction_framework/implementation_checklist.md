# 구현 체크리스트

## 1차 구현

- [ ] 파일 업로드와 SHA-256 중복 확인
- [ ] HWPX·DOCX·PDF 텍스트 파싱
- [ ] 문서 메타데이터 추출
- [ ] 장·절·조·항·호 구조화
- [ ] 규칙 후보 탐지
- [ ] 표준 JSON Schema 기반 AI 추출
- [ ] 비목 사전 매핑
- [ ] 자동 검증
- [ ] 관리자 검토 화면
- [ ] ACTIVE 규칙만 예산 화면에 적용

## 2차 구현

- [ ] 개정 문서 diff
- [ ] 변경 조항만 재추출
- [ ] 공고·협약 override
- [ ] 기관별 자체규정 연결
- [ ] 표·별표 전용 파서
- [ ] 수식 AST 변환
- [ ] 규칙 테스트 자동 생성
- [ ] 충돌 탐지
- [ ] 규칙 적용 이력 저장

## 관리자 화면에서 반드시 보여줄 것

- 원문
- 추출 규칙
- 비목 매핑
- 조건식
- 상한과 계산식
- 승인·인정 여부
- 예외
- 시행일
- 신뢰도
- 자동 검증 결과
- 이전 버전과 변경점

## 운영 배포 조건

다음 조건을 모두 만족한 규칙만 활성화합니다.

```text
review_status in (ADMIN_REVIEWED, EXPERT_VERIFIED)
AND blocker_count = 0
AND source_text is not null
AND effective_from is not null
AND category mapping is not AMBIGUOUS
```
