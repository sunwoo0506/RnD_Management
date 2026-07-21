// 비목 ID는 규정 팩마다 다르므로 고정 유니언이 아니라 문자열이다.
export type BudgetCategoryId = string;

// ---- 규정 팩 (rulespacks/ 원본에서 변환된 구조) ----

export interface PackSource {
  doc: string;          // 근거 문서명 (공고, 지침 등)
  ref: string;          // 조문·QnA·공고 위치 (예: "제65조 제7항", "QnA 사업비 3번")
  matchLevel: string;   // notice | notice_guideline | guideline | agreement ...
  appDefault?: boolean; // 원본에 없어 앱이 부여한 예시값 (초안 비율, 증빙 기본값 등)
}

export interface PackCategory {
  id: string;
  name: string;
  allowed: boolean;
  definition?: string;      // 사용 예시 — 편성 화면에 표시
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

export interface RulePack {
  id: string;               // 'prestartup' | 'rnd-forprofit' | 'rnd-govt' | 'legacy-rnd' | ...
  name: string;
  orgType: string;
  guideline: string;        // 상위 지침명
  agency: string;
  hasRatioLimits: boolean;  // false면 상한 UI 대신 금지 경고 중심으로 표시
  verified: boolean;        // 원문 대조 검증 여부 (현재 전부 false — 예시 기준)
  referenceUrl?: string;    // 규정 원문을 확인할 수 있는 공식 사이트
  categories: PackCategory[];
  rules: PackRule[];
  applicationDocs: PackRule[]; // 신청·선정 단계 제출 서류 (집행 증빙과 별개)
}

// ---- 과제 데이터 ----

export interface BudgetItem {
  categoryId: BudgetCategoryId;
  amount: number;
}

export interface Participant {
  id: string;
  name: string;
  projectRate: number;
  externalRate: number;
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
  categoryId: BudgetCategoryId;
  amount: number;
  supplyAmount?: number;
  vatAmount?: number;
  paymentMethod?: PaymentMethod;
  purpose: string;
  vendor: string;
  evidence: Evidence[];
  createdAt: string;
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

export interface Project {
  id: string;
  name: string;
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
  customPack?: RulePack;        // 공유 레지스트리에서 불러온 팩 스냅샷 (있으면 내장 팩보다 우선)
  budgetConfirmed?: boolean;    // 편성 확정 시 미사용(0원) 비목을 화면에서 숨긴다
  members: Member[];
  participants: Participant[];
  budgets: BudgetItem[];
  expenses: Expense[];
  changes: BudgetChange[];
  emailLogs: EmailLog[];
  documents?: ProjectDocumentLink[];
  createdAt: string;
}

export type Screen = 'overview' | 'budget' | 'spending' | 'change' | 'team' | 'settings';
