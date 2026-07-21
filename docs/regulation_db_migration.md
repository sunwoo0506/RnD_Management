# 규정DB 중심 구조로 전환 — 진행 상황

**목표.** 예산편성 화면의 비목을 AI 추출 결과(날것)가 아니라 **근거까지 검증된 규정DB**에서 가져온다.
앱의 AI 추출은 (1) 기존 규정DB와 무엇이 달라졌는지 알려주는 **변경 감지기**,
(2) 규정DB가 없는 사업의 **신규 규정DB 생산기**로 역할을 바꾼다.

기준일: 2026-07-22 / 상태: 앱·스크립트 코드는 완료, **Supabase 적용은 미실행**

---

## 무엇이 바뀌었나 — 한 줄 요약

```
전:  packFor = customPack ?? getPack(packId)      // AI 추출 팩이 최우선
후:  packFor = 규정DB팩(있으면) + 승인된 오버레이   // 검증된 비목이 최우선
```

`src/rules.ts:packFor`가 이 전환의 전부다. 나머지는 이 규칙을 지탱하는 배관이다.

---

## 완료

### 1. Supabase 스키마 일원화

- [x] `supabase/reset.sql` — 전체 초기화 (과제 데이터 포함, auth 계정은 유지)
- [x] `supabase/schema.sql` — 전체 스키마 한 파일
- [x] 기존 8개 SQL 파일 삭제 (`setup` / `registry` / `documents` / `document_programs` /
      `document_reviewers` / `program_registry_link` / `user_projects` / `extraction`)

정리한 잔재: `projects`(구버전 단일 과제), `registry_admins`, `registry_documents`, `registry` 버킷.
모두 이미 폐기됐는데 테이블·버킷만 떠 있던 것들이다.

신규:

| 대상 | 내용 |
|---|---|
| `regulation_packages` | 규정DB 패키지 메타 (manifest + 원본 파일 해시 + 건수 + storage 경로) |
| `program_registry` | `pack_id`·`regulation_package_id`·`origin='regulation_db'` 추가 |
| `program_registry_submissions` | `package`(패키지 전체)·`diff`·`base_pack_id` 추가 |
| `regulation-db` 버킷 | 패키지 원본 6개 JSON + manifest + Review.xlsx + README + 변환 팩 |

### 2. 규정DB 적재 경로

- [x] `scripts/upload-regulation-db.mjs` — 패키지 → Storage + 테이블 (`--dry-run` 지원)
- [x] NRD 패키지 manifest에 `pack_meta` 추가 (유일하게 빠져 있었다)
- [x] 4개 패키지 전부에 `pack_meta.program_name` 부여 (검색 키가 공고 제목 전체였던 문제)
- [x] `--dry-run` 검증 완료 — 5개 팩 (nrd 영리/비영리, tips, prestartup, didimdol)

### 3. 앱 — 비목의 출처를 뒤집었다

- [x] `RulePack.origin` 도입 (`regulation_db` / `extracted` / `registry` / `legacy`)
- [x] 변환기가 `origin: 'regulation_db'` + `verified: true` + `packageName` 부여
- [x] `packFor` 재작성 — 규정DB 팩이 있으면 `customPack`을 무시한다
- [x] `applyOverlay` — 승인된 변경사항만 규칙에 얹고 **비목은 건드리지 않는다**
- [x] `setRegulationPacks` / `allPacks` / `selectablePacks` — 서버 팩이 번들 팩을 이긴다
- [x] `src/regulationDb.ts` — 서버에서 팩 로드, localStorage 캐시, 실패 시 번들 폴백
- [x] `Project.packOverlay` + `PackOverlay` 타입
- [x] SetupWizard — 규정DB 팩을 고른 채 추출해도 비목이 덮이지 않는다

### 4. 앱 — 변경 감지

- [x] `src/packDiff.ts` — `changed` / `added` / `missing` / `unchanged` 4분류
- [x] 상한(%)·필수계상(원)·비목·규칙을 각각 비교
- [x] 승인 절차 발동 기준(`APPROVAL_THRESHOLD`·`RECOGNITION_LIMIT`)은 금액 상한에서 제외
- [x] `overlayRulesFrom` — 승인한 변경사항 → 오버레이 규칙 (비목 id로 재연결)
- [x] 변경사항 UI + CSS

`missing`을 자동 반영하지 않는 이유: AI 추출은 누락이 흔해서
"규정DB에 있는데 추출에 없다"를 "삭제됐다"로 볼 수 없다. 확인 대상으로만 남긴다.

### 5. 앱 — 신규 규정DB 생산

- [x] `src/regulationPackage.ts` — 추출 결과 → 규정DB 패키지 (manifest + 6개 JSON)
- [x] 파일명·필드명을 MVP 산출물 규격에 맞춤 → 기존 스크립트 3종을 그대로 태울 수 있다
- [x] 표준 비목명은 표준 코드(`DIRECT_LABOR` 등), 나머지는 `CAT_n`
- [x] `registry.ts:submitRegulationPackage` — 패키지째 등록 신청
- [x] `exporters.ts:exportRegulationPackage` — 패키지 ZIP 내려받기
- [x] 패키지 미리보기 UI (건수 + 원문 대조 실패 건수 경고)

### 6. 검증

- [x] 테스트 132개 통과 (신규 5건: 비목 출처·오버레이·기준 팩 불일치)
- [x] `npm run build` 통과

---

## 남은 일

### A. Supabase 적용 — **사용자가 직접 실행해야 한다**

1. [ ] 대시보드 → SQL Editor에서 `supabase/reset.sql` 실행 **(과제 데이터가 지워진다)**
2. [ ] 이어서 `supabase/schema.sql` 실행
3. [ ] `schema.sql` 맨 아래 `document_reviewers` UID가 맞는지 확인
4. [ ] `.env.local`에 `SUPABASE_SERVICE_ROLE_KEY=...` 추가 (커밋되지 않음)
5. [ ] `node scripts/upload-regulation-db.mjs` 실행 → 4개 패키지 적재

서비스 롤 키가 없어 4·5번은 아직 실행하지 못했다. 규정DB 쓰기 정책을 일부러 두지 않았기 때문에
익명 키로는 적재할 수 없다.

### B. Edge Function — 배포 필요

6. [ ] `registry-admin`에 **패키지 승인** 경로 추가
   — 승인 시 `regulation_packages` + `program_registry`(origin=`regulation_db`) 기록,
     `regulation-db` 버킷에 패키지 파일 업로드. 지금은 신청이 쌓이기만 하고 승인 경로가 없다.
7. [ ] `extract-rules` 배포 — 확장된 스키마(`allowedItems`·`articles`·`limitType` 등)가
     아직 서버에 반영되지 않았다. 없어도 앱은 동작하지만 추출 품질이 떨어진다.

### C. 앱 마감

8. [ ] `packDiff.ts` / `regulationPackage.ts` 단위 테스트 — 지금은 통합 경로만 검증됨
9. [ ] 예산편성 화면에 **비목 출처 배지** — "규정DB · 근거 검증됨" vs "AI 추출 · 미검증".
      `isRegulationDbPack`은 준비됐고 화면에 아직 안 붙였다
10. [ ] `App.tsx`의 `packStatus`를 설정 화면에 노출 (규정DB 최신본 확인 시각·실패 사유)
11. [ ] `storage.ts` — `packOverlay` 깨진 형태 방어 (`customPack`과 같은 방식)
12. [ ] 관리자 화면(`src/admin/AdminApp.tsx`)에 패키지 신청 검토 UI
13. [ ] 번들 팩 제거 검토 — 지금은 `nrd2026.json` 736KB 포함 약 1MB가 번들에 있다.
      서버 로드가 안정되면 폴백만 남기고 줄일 수 있다

### D. 확인 안 된 것

14. [ ] 실제 Supabase에 붙여 end-to-end 확인 (스키마 → 적재 → 앱 로드 → 변경 감지 → 등록 신청)
15. [ ] 기존 과제 데이터 마이그레이션 — 과제 데이터를 전부 초기화하기로 해서 이번엔 불필요하지만,
      운영 중 스키마를 또 바꾸면 그때는 필요하다

---

## 설계 메모 — 왜 이렇게 했나

**비목은 왜 오버레이로 못 바꾸게 했나.** 화면에 뜬 비목이 어느 문서 몇 조에서 왔는지 되짚을 수
있어야 한다. 최신 공고에서 새 비목이 발견되면 그건 규정DB 자체를 갱신할 사안이지, 과제 하나에
몰래 끼워 넣을 일이 아니다. 그래서 `diff`의 `category` 항목은 승인 대상에서 빼고 알림만 남겼다.

**`verified`의 의미가 바뀌었다.** 예전엔 전부 `false`("예시 기준")였다. 이제 규정DB 패키지에서 온
팩만 `true`다. 테스트도 `isRegulationDbPack(pack)`과 일치하는지로 바꿨다.

**기준 팩이 바뀐 오버레이는 버린다.** `packOverlay.basePackId`가 현재 팩과 다르면 적용하지 않는다.
규정DB가 개정되면 예전 공고 기준으로 승인한 변경사항의 근거가 어긋나기 때문이다.
