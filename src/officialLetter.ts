import { categoryOf, formatWon, packFor } from './rules';
import { CHANGE_TYPE_LABEL, statusOf, typeOf } from './changes';
import type { BudgetChange, Project } from './types';

// ---- 협약변경 공문 값 채우기 ----
// docs/템플릿/공문_표준시행문_이미지참고_최종템플릿.docx 의 {{치환자}}에 넣을 값을 만든다.
// 항목별 한글명과 출처는 docs/템플릿_항목매핑.md 참조.
//
// 원칙: 없는 값은 지어내지 않는다. 과제 설정에 안 적힌 값(협약번호·대표자명 등)은
// [확인 필요: 항목명]으로 남겨, 사용자가 문서를 열었을 때 무엇을 채워야 하는지 보이게 한다.
// 빈칸으로 두면 빠진 줄 모르고 그대로 제출하게 된다.

export const MISSING = (label: string) => `[확인 필요: ${label}]`;

// 숫자를 한글 금액으로 — 공문은 위·변조를 막으려 숫자와 한글을 병기한다.
// 예: 1000000 → "일백만"
const 한글숫자 = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const 자리 = ['', '십', '백', '천'];
const 큰자리 = ['', '만', '억', '조'];

export const toKoreanAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) return '영';
  let rest = Math.floor(amount);
  const 묶음: string[] = [];
  let 큰 = 0;
  while (rest > 0 && 큰 < 큰자리.length) {
    const 네자리 = rest % 10000;
    if (네자리 > 0) {
      let 조각 = '';
      for (let i = 0; i < 4; i += 1) {
        const 숫자 = Math.floor(네자리 / 10 ** i) % 10;
        // 1도 "일"을 살려 적는다 (십만 → 일십만). 앞에 숫자를 덧붙여 고치지 못하게 하는
        // 위·변조 방지 표기라, 일상 표기보다 이쪽이 공문 관행이다.
        if (숫자 > 0) 조각 = `${한글숫자[숫자]}${자리[i]}${조각}`;
      }
      묶음.unshift(`${조각}${큰자리[큰]}`);
    }
    rest = Math.floor(rest / 10000);
    큰 += 1;
  }
  return 묶음.join('');
};

// 공문 관행: 금 1,000,000원(금일백만원정)
export const moneyPhrase = (amount: number): string =>
  `금 ${amount.toLocaleString('ko-KR')}원(금${toKoreanAmount(amount)}원정)`;

const dateText = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
};

// 변경 전·후 대비표의 행. 금액이 바뀐 비목만 담고 마지막에 합계 — 안 바뀐 비목까지 넣으면
// 검토자가 어디가 달라졌는지 찾아야 한다. 감액은 행정문서 관행대로 △로 적는다.
export interface ComparisonRow { category: string; before: string; after: string; delta: string; total?: boolean }

export const comparisonRows = (project: Project, change: BudgetChange): ComparisonRow[] => {
  const pack = packFor(project);
  const rows: ComparisonRow[] = [];
  const ids = new Set([...change.before.map((item) => item.categoryId), ...change.after.map((item) => item.categoryId)]);
  let beforeSum = 0;
  let afterSum = 0;
  const deltaText = (before: number, after: number) => `${after < before ? '△' : after > before ? '' : ''}${formatWon(Math.abs(after - before))}`;
  for (const id of ids) {
    const before = change.before.find((item) => item.categoryId === id)?.amount ?? 0;
    const after = change.after.find((item) => item.categoryId === id)?.amount ?? 0;
    beforeSum += before;
    afterSum += after;
    if (before === after) continue;
    rows.push({ category: categoryOf(pack, id).name, before: formatWon(before), after: formatWon(after), delta: deltaText(before, after) });
  }
  rows.push({ category: '합계', before: formatWon(beforeSum), after: formatWon(afterSum), delta: beforeSum === afterSum ? '변동 없음' : deltaText(beforeSum, afterSum), total: true });
  return rows;
};

// 총사업비 변동 여부 — 대비표 합계가 같으면 "변동 없음"이라고 단정할 수 있다.
// 합계가 다르면 총사업비가 바뀐 것이므로 그렇게 적는다. 모를 때 임의로 "변동 없음"이라 쓰지 않는다.
export const totalBudgetChangeText = (change: BudgetChange): string => {
  const before = change.before.reduce((sum, item) => sum + item.amount, 0);
  const after = change.after.reduce((sum, item) => sum + item.amount, 0);
  if (before === after) return '변동 없음';
  return `변동 있음 (${formatWon(before)} → ${formatWon(after)})`;
};

export interface LetterValues { [key: string]: string }

export const changeLetterValues = (project: Project, change: BudgetChange, today: string): LetterValues => {
  const pack = packFor(project);
  const approval = typeOf(change) === 'approval';
  const from = categoryOf(pack, change.fromCategoryId).name;
  const to = categoryOf(pack, change.toCategoryId).name;
  const 기간 = `${project.startDate} ~ ${project.endDate}`;

  const 본문 = [
    `가. 변경 구분: 사업비 비목 간 변경 (${CHANGE_TYPE_LABEL[typeOf(change)]})`,
    `나. 변경 금액: ${from} → ${to}  ${moneyPhrase(change.amount)}`,
    `다. 총사업비 변동 여부: ${totalBudgetChangeText(change)}`,
    '라. 변경 전·후 대비: 아래 표와 같음',
    `마. 변경 사유: ${change.reason.trim() || MISSING('변경 사유')}`,
    ...(approval ? [`바. 변경 후 사용계획: ${change.usagePlan?.trim() || MISSING('변경 후 사용계획')}`] : []),
  ].join('\n');

  return {
    company_name: project.companyName || MISSING('기업명'),
    recipient: project.agency ? `${project.agency}장` : MISSING('수신기관'),
    reference: '',   // 참조부서는 쓰지 않기로 함 (대부분 비워둔다)
    subject: `「${project.name}」 사업비 비목 간 변경 ${approval ? '승인 요청' : '통보'}`,
    background_and_purpose:
      `당사가 수행 중인 「${project.name}」(협약번호: ${project.agreementNo || MISSING('협약번호')}, 연구기간: ${기간}) `
      + `과제와 관련하여, 연구 수행 과정에서 발생한 사정으로 사업비 비목 간 변경이 `
      + `${approval ? '필요하여 아래와 같이 승인을 요청드립니다.' : '있어 아래와 같이 통보드립니다.'}`,
    business_name: project.programName || pack.name,
    project_name: project.name,
    request_details: 본문,
    // 통보는 회신을 기다리는 문서가 아니라 기한을 두지 않는다.
    due_date: approval ? '' : '해당 없음',
    closing_sentence: approval
      ? '상기 변경사항에 대하여 검토 후 승인하여 주시기 바랍니다.'
      : '상기 변경사항을 통보하오니 참고하여 주시기 바랍니다.',
    // 템플릿이 "1부."·"끝."을 붙여주므로 서류 이름만 넣는다.
    attachment_1: '사업비 변경 전·후 대비표',
    attachment_2: change.planFileName ? '변경 반영 사업계획서' : '',
    signature_text: `${project.companyName} 대표 ${project.representative || MISSING('대표자명')}`,
    drafter_name: project.members[0]?.name ?? '',
    reviewer_name: project.members[1]?.name ?? '',
    approver_name: project.representative ?? '',
    document_number: change.documentNo || MISSING('문서번호'),
    issue_date: dateText(today),
    receipt_information: '',   // 접수란은 받는 기관이 채운다
    postal_code: '', address: '', website: '', phone: '', fax: '',
    email: project.members[0]?.email ?? '',
    disclosure_status: '',
  };
};

// 파일 이름 — 어떤 변경의 공문인지 나중에 봐도 알아야 한다.
export const letterFileName = (project: Project, change: BudgetChange): string => {
  const kind = typeOf(change) === 'approval' ? '승인요청' : '통보';
  const safe = (text: string) => text.replace(/[\\/:*?"<>|]/g, '_');
  return `${safe(project.name)}_사업비변경_${kind}_${change.documentNo ?? statusOf(change)}.docx`;
};
