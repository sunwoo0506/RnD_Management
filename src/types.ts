// 비목 ID는 규정 팩마다 다르므로 고정 유니언이 아니라 문자열이다.
export type BudgetCategoryId = string;

// ---- 규정 팩 (rulespacks/ 원본에서 변환된 구조) ----

export interface PackSource {
  doc: string;          // 근거 문서명 (공고, 지침 등)
  ref: string;          // 조문·QnA·공고 위치 (예: "제65조 제7항", "QnA 사업비 3번")
  matchLevel: string;   // notice | notice_guideline | guideline | agreement ...
  appDefault?: boolean; // 원본에 없어 앱이 부여한 예시값 (초안 비율, 증빙 기본값 등)
}

// 규정 DB(expense_allowed_items)의 비목별 허용 항목 — "항목별 기준·주의사항"에 근거 조항과 함께 나열한다.
export interface PackAllowedItem {
  name: string;
  description?: string;
  status?: 'CONDITIONAL' | 'INSTITUTION_SPECIFIC'; // 값이 없으면 조건 없이 인정(ALLOWED)
  scope?: string;            // 특정 기관 유형 한정일 때 (ELIGIBLE_INSTITUTION 등)
  condition?: string;        // 인정 조건 요약
  restriction?: string;      // 제한·불인정 요약
  requiresApproval?: boolean; // 사전 승인 필요
  evidence?: string;         // 필요 증빙 요약
  evidenceSource?: PackSource; // 증빙 요약의 근거 (비목 정의 근거와 다른 절에 있는 경우)
  source: PackSource;
}

// 기관 유형별 비목 적용 조건 (expense_applicability_rules)
export interface PackApplicability {
  scopeKo: string;    // 적용 기관 (영리기관, 고시에서 정한 기관 …)
  applies: boolean;   // 이 팩의 기관 유형에 해당하는 조건인지
  condition: string;  // 조건 요약
  result: string;     // 결과 (조건부 사용 가능, 사전승인 필요 …)
  source: PackSource;
}

// 사전승인·인정이 필요한 절차 (approval_rules)
export interface PackApproval { name: string; status: string; source: PackSource }

// 조건이 붙는 추가 증빙 요구 (evidence_rules) — 비목 기본 증빙(requiredDocs)과 별개
export interface PackEvidenceRule { name: string; documents: string[]; source: PackSource }

export interface PackCategory {
  id: string;
  name: string;
  allowed: boolean;
  definition?: string;      // 비목 용도 요약 (규정 DB budget_screen_guides.usage_summary) — "항목별 기준" 섹션에 표시
  subItemOptions?: string[]; // 이 비목에 계상할 수 있는 세목 후보 (규정 DB의 하위 비목 또는 허용 항목) — 편성표에서 클릭해 세목으로 추가
  allowedItems?: PackAllowedItem[]; // 규정 DB의 허용 항목 + 항목별 근거 조항
  applicability?: PackApplicability[]; // 기관 유형별 적용 조건
  approvals?: PackApproval[];          // 사전승인·인정이 필요한 절차
  evidenceRules?: PackEvidenceRule[];  // 조건부 추가 증빙
  limitText?: string;       // 비목별 상한 요약 (규정 DB budget_screen_guides.limit_text) — 계산 불가 상한도 문구로 표시
  limitDetailText?: string; // 상한 세부 조건 (규정 DB limit_detail_text) — 편성 화면 상한 칸의 보조 설명
  limitSource?: PackSource; // 상한 문구의 근거 조항 (비목 정의 근거와 다를 수 있다)
  draftRate: number;        // 초안 배분 % (예시 기준)
  requiredDocs: string[];   // 집행 증빙 기본값
  source: PackSource;
}

export type PackRuleKind = 'ratio' | 'warning' | 'info' | 'evidence' | 'minimum';

export interface PackRule {
  id: string;
  kind: PackRuleKind;
  item?: string;
  message: string;
  limitPct?: number;        // ratio: 상한 %
  minAmount?: number;       // minimum: 비목에 반드시 편성해야 하는 최소 고정 금액(원) — 공고문에서 온 정액 필수 계상 요구사항
  // 사업 전체의 금액 한도 (예비창업패키지 1단계 2천만원 등). 사용자가 입력한 지원금·총사업비와
  // 대조해 잘못 입력한 금액을 잡아낸다. 투자금·기관부담처럼 사업비가 아닌 기준에는 붙이지 않는다.
  fundingCap?: number;
  fundingCapTarget?: 'subsidy' | 'total'; // 지원금과 견줄지, 총사업비와 견줄지
  fundingCapBasis?: string;               // 한도의 기준 이름 (정부지원연구개발비 총액 등)
  // 총액과 함께 연 한도를 둔 사업이 있다 (디딤돌 "최대 2억원 이내(연 1억원 이내)").
  // 사업기간이 짧으면 총액을 다 쓸 수 없으므로 연차 수를 곱해 실제 한도를 정한다.
  fundingCapPerYear?: number;
  // 재원 구성 비율 규정 (정부지원 75% 이내, 기관부담 현금 10% 이상 …) — 과제 설정의 비율 입력과 대조한다.
  fundingRole?: 'subsidy_max' | 'matching_min' | 'matching_cash_min';
  fundingPct?: number;
  basis?: string;           // ratio: 상한의 기준 (총액, 직접비, 수정인건비, 구입가...)
  formula?: string;
  trigger?: string;         // warning: 발동 조건 설명
  severity?: 'high' | 'medium' | 'low';
  appliesScope?: string;
  requiredDocs?: string[];
  condition?: string;
  required?: boolean;
  submitTiming?: string;    // 신청 시 / 서류평가 통과 후 (신청서류용)
  note?: string;
  quote?: string;           // 근거 원문 인용 (LLM 추출 규칙) — 팝업 미리보기 하이라이트에 사용
  categoryIds?: string[];   // 연관 비목 (없으면 과제 공통 규칙)
  source: PackSource;
}

// 규정 조문 원문 (regulation_articles) — 근거 링크를 눌렀을 때 원본 파일 없이도 그 조문을 바로 보여준다.
export interface PackArticle {
  key: string;
  ref: string;    // 조문 번호·위치 (제25조, 지침 11.다.1) 인건비)
  title?: string; // 조문 제목
  text: string;   // 조문 원문
}

// 규정 DB 구축 시 남긴 검토 이슈 — 원문 확인이 필요한 지점을 사용자에게 알린다.
export interface PackReviewIssue {
  code: string;
  severity: 'warning' | 'info';
  description: string;
  handling: string;
  ref: string;
}

// 팩이 어디서 왔는지 — 예산편성 화면이 어느 팩의 비목을 쓸지 정하는 기준이다.
//   regulation_db : 규정DB 패키지(docs/extraction_DB)에서 변환된 것. 비목·상한·규칙에 근거 조문이
//                   붙어 있고 사람이 검토를 마쳤다. 예산편성 화면의 비목은 항상 이것에서 온다.
//   extracted     : 앱에서 공고문을 AI 추출한 것. 대응하는 규정DB가 아직 없을 때만 비목으로 쓴다.
//   registry      : 공유 레지스트리에서 불러온 스냅샷
//   legacy        : 동적 구조 도입 이전의 예시 팩
export type PackOrigin = 'regulation_db' | 'extracted' | 'registry' | 'legacy';

export interface RulePack {
  id: string;               // 'didimdol2026' | 'nrd2026-forprofit' | 'legacy-rnd' | ...
  name: string;
  orgType: string;
  guideline: string;        // 상위 지침명
  agency: string;
  origin?: PackOrigin;      // 미지정이면 legacy로 취급
  packageName?: string;     // origin='regulation_db' — 출처 규정DB 패키지 폴더명
  // 이 사업이 따르는 상위 규정 팩. 공고·지침은 "그 밖의 사항은 국가연구개발사업 연구개발비 사용
  // 기준에 따른다"처럼 자기가 따로 정한 것만 담기 때문에, 인정 항목·세목은 여기서 마저 가져온다.
  basePackId?: string;
  hasRatioLimits: boolean;  // false면 상한 UI 대신 금지 경고 중심으로 표시
  effectiveFrom?: string | null; // 규정 자체의 시행일 (규정DB 팩) — 화면의 "언제 기준" 표시에 쓴다
  generatedAt?: string | null;   // 이 팩을 만든 날
  verified: boolean;        // 원문 대조 검증 여부
  referenceUrl?: string;    // 규정 원문을 확인할 수 있는 공식 사이트
  categories: PackCategory[];
  rules: PackRule[];
  applicationDocs: PackRule[]; // 신청·선정 단계 제출 서류 (집행 증빙과 별개)
  articles?: PackArticle[];        // 조문 원문 (근거 링크에서 바로 열람)
  reviewIssues?: PackReviewIssue[]; // 규정 DB 검토 이슈
  // 편성 비목은 아니지만 기준은 있는 세부 비목 (연구활동비 아래 출장비·회의비 등).
  // 다른 팩(공고문 AI 추출 등)의 비목 이름으로 규정 기준을 찾을 때 쓴다.
  referenceCategories?: PackCategory[];
}

// ---- 과제 데이터 ----

// 비목 안의 세목 — "외부 전문기술 활용비" 안의 기술도입비·전문가활용비처럼 나눠 편성할 때 쓴다.
export interface BudgetSubItem {
  id: string;
  name: string;
  amount: number;
}

export interface BudgetItem {
  categoryId: BudgetCategoryId;
  amount: number;               // 세목이 있으면 세목 합계로 자동 계산된다
  inKindAmount?: number;        // 편성 금액 중 현물 계상액 — 나머지가 현금(지원금+민간부담 현금)
  subItems?: BudgetSubItem[];
}

export interface Participant {
  id: string;
  name: string;
  projectRate: number;
  externalRate: number;
  // ---- 인건비 관리 (인력·담당자 화면) ----
  laborType?: 'existing' | 'new'; // 기존/신규 인력 (미입력 시 기존)
  laborStart?: string;            // 참여 시작일 (미입력 시 과제 시작일)
  laborEnd?: string;              // 참여 종료일 (미입력 시 과제 종료일)
  monthlyPay?: number;            // 월급여(원)
  includeSeverance?: boolean;     // 퇴직급여충당금 계상 여부 — 1년 이상 근무자만 가능하므로 개인별로 정한다 (미지정 시 과제 기본값)
  laborFunding?: 'cash' | 'inkind' | 'mixed'; // 인건비 계상 구분 — 현금 전액 / 현물 전액(합계 자동) / 혼합(laborInKind 사용)
  laborInKind?: number;           // 혼합일 때: 합계 인건비 중 현물 계상액(원) — 나머지는 현금
}

export interface Evidence {
  id: string;
  label: string;
  completed: boolean;
  fileName?: string;
  fileSize?: number;
}

export type PaymentMethod = 'card' | 'transfer';

export interface Expense {
  id: string;
  date: string;
  categoryId: BudgetCategoryId;   // 편성 비목 — 예산 차감·잔액 계산은 언제나 이 기준이다
  // 편성 화면에서 나눠둔 세목(BudgetSubItem). 집계·월별 계획·규정 조회의 단위이지 돈의 단위는 아니다.
  // id는 연결용, name은 스냅샷 — 편성에서 세목을 지워도 이 집행이 무엇이었는지 남아야 한다.
  subItemId?: string;
  subItemName?: string;
  amount: number;
  supplyAmount?: number;
  vatAmount?: number;
  paymentMethod?: PaymentMethod;
  purpose: string;
  vendor: string;
  // 세목별 추가 입력 (회의 목적·출장자 등). 키는 src/spendingForms.ts의 DETAIL_FIELDS 정의를 따른다.
  details?: Record<string, string>;
  evidence: Evidence[];
  createdAt: string;
}

// 월별 집행계획에서 사용자가 직접 고친 칸만 저장한다. 저장되지 않은 달은
// (예산 ÷ 사업기간 월수) 자동 계산값을 쓰므로, 예산이 바뀌면 알아서 따라간다.
export interface MonthlyPlanEntry {
  categoryId: BudgetCategoryId;
  subItemId?: string;   // 없으면 비목 전체 기준
  month: string;        // 'YYYY-MM'
  amount: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: '대표' | '담당자';
}

export interface BudgetChange {
  id: string;
  fromCategoryId: BudgetCategoryId;
  toCategoryId: BudgetCategoryId;
  amount: number;
  reasonKey: string;
  reason: string;
  before: BudgetItem[];
  after: BudgetItem[];
  createdAt: string;
}

export interface EmailLog {
  id: string;
  sentAt: string;
  recipient: string;
  milestone: 30 | 14 | 7;
  status: '발송 완료' | '재시도 완료' | '제품 내 알림';
  incompleteCount: number;
}

export type DocumentApplicationType = 'COMMON' | 'MINISTRY' | 'AGENCY' | 'PROGRAM' | 'AGREEMENT' | 'INTERNAL' | 'REFERENCE';

// 과제 전용 문서함 항목 — 공유 문서고의 특정 버전을 연결(link)했거나, 이 과제만의 비공개 파일을 올린(upload) 것.
export interface ProjectDocumentLink {
  id: string;
  kind: 'link' | 'upload';
  documentVersionId?: string; // kind='link' — 공유 문서고 document_versions.id 참조
  storagePath?: string;       // kind='link' — 연결 시점의 파일 위치 스냅샷(승인된 버전 파일은 불변이라 안전)
  fileId?: string;            // kind='upload' — project-documents 버킷의 파일 id
  fileName: string;
  documentType?: string;      // kind='upload'일 때 사용자가 고른 문서유형 (DocumentType 코드)
  title: string;
  applicationType: DocumentApplicationType;
  isConfirmed: boolean;
  createdAt: string;
}

// AI 규정 추출로 만들어 "적용"까지 마친 규정 팩의 보관 이력 — 설정 화면에서 언제든 다시 열람하거나 재적용한다.
export interface SavedRulePack {
  id: string;
  savedAt: string;
  sourceDocTitles: string[]; // 추출에 사용한 문서 제목 (마법사에서 추출했으면 업로드 파일명)
  pack: RulePack;
}

// 최신 공고에서 확인한 "이 과제에만 해당하는" 변경사항 — 검증된 규정DB 팩 위에 얹는다.
// 비목(categories)은 절대 바꾸지 않는다. 규정DB의 비목이 기준이고, 오버레이는 그 위의 상한·주의
// 문구만 갈아끼운다. 그래야 화면에 뜬 비목이 언제나 근거가 검증된 것으로 남는다.
export interface PackOverlay {
  basePackId: string;          // 어느 규정DB 팩 위에 얹었는지 — 기준 팩이 바뀌면 다시 검토해야 한다
  appliedAt: string;
  sourceDocTitles: string[];   // 변경사항을 확인한 문서 (최신 공고·사업계획서 등)
  rules: PackRule[];           // 사용자가 승인한 규칙만. 같은 id면 기준 팩의 규칙을 대체한다
  supersededRuleIds?: string[]; // 최신 공고에서 바뀐 것으로 확인돼 가려둔 기준 팩 규칙
}

export interface Project {
  id: string;
  name: string;
  summary?: string;             // 이 과제가 무엇을 개발하는지 한두 문장 — 총괄 대시보드 목록에 표시
  totalBudget: number;
  startDate: string;
  endDate: string;
  settlementDeadline: string;
  agency: string;
  companyName: string;
  packId: string;               // 적용 규정 팩 (내장 팩 ID 또는 'registry:<uuid>')
  subsidyAmount?: number;       // 지원금(정부지원금) 실입력액 — 공고문·협약 기준. 미입력 시 totalBudget과 동일(자기부담 없음)으로 취급
  subsidyRate?: number;         // 총사업비 중 지원금 비율 % (공고문 기준) — 지원금으로 총사업비를 역산할 때 사용. 미입력 시 100 = 전액 지원(자기부담 없음)
  matchingCashRate?: number;    // 민간부담금 중 현금 비율 % (공고문 기준). 미입력 시 100 = 전액 현금
  programName?: string;         // 사업명 — 공유 DB에서 근거 원본 문서를 찾는 검색 키
  programRegistryId?: string;   // program_registry.id 수동 연결 — packId가 공유 팩이 아닐 때(내장·AI추출 팩)만 사용
  // 대응하는 규정DB 팩이 없는 사업에서만 비목의 출처가 된다 — packId가 규정DB 팩을 가리키면
  // 이 값이 있어도 무시된다(packFor 참조). 공유 레지스트리 스냅샷과 AI 추출 팩이 여기 들어온다.
  customPack?: RulePack;
  packOverlay?: PackOverlay;    // 최신 공고에서 확인해 승인한 변경사항 (검증된 팩 위에 얹는다)
  extractedPacks?: SavedRulePack[]; // AI 추출로 적용했던 규정팩 이력 (최신순, 최대 20개)
  insuranceRate?: number;       // 4대보험 사업자부담 요율 % (인건비 계산용, 기본 11)
  laborIncludeInsurance?: boolean; // 인건비에 4대보험 포함 여부 — 사업별로 다름 (기본 true)
  laborIncludeSeverance?: boolean; // 인건비에 퇴직금 포함 여부 — 사업별로 다름 (기본 true)
  budgetConfirmed?: boolean;    // 편성 확정 시 미사용(0원) 비목을 화면에서 숨긴다
  // 사업비 한도 경고 중 사용자가 "현재 금액 유지"를 고른 규칙 id — 판단을 기억해 매번 다시 묻지 않는다.
  fundingCapAck?: string[];
  members: Member[];
  participants: Participant[];
  budgets: BudgetItem[];
  monthlyPlan?: MonthlyPlanEntry[]; // 사용자가 고친 월별 계획 칸만 (나머지는 균등분할 자동값)
  expenses: Expense[];
  changes: BudgetChange[];
  emailLogs: EmailLog[];
  documents?: ProjectDocumentLink[];
  createdAt: string;
}

export type Screen = 'overview' | 'budget' | 'spending' | 'change' | 'team' | 'settings';
