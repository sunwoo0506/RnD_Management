import { describe, expect, it } from 'vitest';
import { changeLetterValues, comparisonRows, letterFileName, moneyPhrase, toKoreanAmount, totalBudgetChangeText } from './officialLetter';
import { requestChange } from './changes';
import type { BudgetChange, Project } from './types';

// 공문은 그대로 기관에 나가는 문서라, 값이 틀리거나 없는 것을 지어내면 사고가 된다.
// "없는 값은 [확인 필요]로 남긴다"가 이 파일의 핵심 계약이다.

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: '스마트 물류 자동화 시스템 개발', totalBudget: 100_000_000,
  startDate: '2026-07-01', endDate: '2027-06-30', settlementDeadline: '2027-07-30',
  agency: '중소기업기술정보진흥원', companyName: '주식회사 테스트랩', packId: 'nrd2026-forprofit',
  members: [{ id: 'm1', name: '박연구', email: 'research@testlab.co.kr', role: '담당자' }],
  participants: [], expenses: [], changes: [], emailLogs: [],
  budgets: [{ categoryId: 'DIRECT_LABOR', amount: 60_000_000 }, { categoryId: 'DIRECT_ACTIVITY', amount: 40_000_000 }],
  createdAt: '2026-07-01T00:00:00.000Z', ...over,
});

const NOW = '2026-09-01T00:00:00.000Z';
const changeOf = (p: Project, over: Partial<BudgetChange> = {}): BudgetChange => {
  const after = requestChange(p, {
    fromCategoryId: 'DIRECT_LABOR', toCategoryId: 'DIRECT_ACTIVITY', amount: 1_000_000,
    reasonKey: 'k', reason: '내부 인력으로 수행하게 되어 인건비 소요가 감소함.', changeType: 'approval',
  }, NOW);
  return { ...after.changes[0], ...over };
};

describe('한글 금액', () => {
  it('공문 관행대로 숫자와 한글을 병기한다', () => {
    expect(moneyPhrase(1_000_000)).toBe('금 1,000,000원(금일백만원정)');
    expect(moneyPhrase(2_400_000)).toBe('금 2,400,000원(금이백사십만원정)');
  });

  it('1도 "일"을 살려 적는다 — 앞에 숫자를 덧붙여 고치지 못하게 하는 위·변조 방지 표기', () => {
    expect(toKoreanAmount(100_000)).toBe('일십만');
    expect(toKoreanAmount(110_000)).toBe('일십일만');
    expect(toKoreanAmount(1_234_567)).toBe('일백이십삼만사천오백육십칠');
    expect(toKoreanAmount(100_000_000)).toBe('일억');
  });
});

describe('변경 전·후 대비', () => {
  it('금액이 바뀐 비목만 적고 합계로 마무리한다', () => {
    const p = project();
    const rows = comparisonRows(p, changeOf(p));
    expect(rows).toHaveLength(3);   // 바뀐 비목 2 + 합계
    expect(rows.some((row) => row.delta.includes('△'))).toBe(true);  // 감액은 △
    const last = rows.at(-1)!;
    expect(last.category).toBe('합계');
    expect(last.total).toBe(true);
    expect(last.delta).toBe('변동 없음');
  });

  it('합계가 같으면 총사업비 변동 없음으로 단정할 수 있다', () => {
    const p = project();
    expect(totalBudgetChangeText(changeOf(p))).toBe('변동 없음');
  });

  it('합계가 다르면 변동 있음으로 적는다 — 임의로 "없음"이라 쓰지 않는다', () => {
    const p = project();
    const change = changeOf(p, { after: [{ categoryId: 'DIRECT_LABOR', amount: 70_000_000 }] });
    expect(totalBudgetChangeText(change)).toContain('변동 있음');
  });
});

describe('공문 값 채우기', () => {
  it('과제 정보를 공문 항목에 넣는다', () => {
    const p = project({ agreementNo: 'S2026-1234', representative: '김대표' });
    const values = changeLetterValues(p, changeOf(p), NOW);
    expect(values.recipient).toBe('중소기업기술정보진흥원장');
    expect(values.subject).toContain('승인 요청');
    expect(values.background_and_purpose).toContain('S2026-1234');
    expect(values.signature_text).toBe('주식회사 테스트랩 대표 김대표');
    expect(values.request_details).toContain('금 1,000,000원(금일백만원정)');
    expect(values.request_details).toContain('아래 표와 같음');   // 대비는 표로 넣는다
    expect(values.reference).toBe('');   // 참조부서는 쓰지 않기로 함
  });

  it('없는 값은 지어내지 않고 [확인 필요]로 남긴다', () => {
    // 빈칸으로 두면 빠진 줄 모르고 그대로 제출하게 된다.
    const p = project();   // 협약번호·대표자명 미입력
    const values = changeLetterValues(p, changeOf(p), NOW);
    expect(values.background_and_purpose).toContain('[확인 필요: 협약번호]');
    expect(values.signature_text).toContain('[확인 필요: 대표자명]');
  });

  it('통보 공문은 승인 문구와 사용계획을 넣지 않는다', () => {
    const p = project();
    const notify = changeOf(p, { changeType: 'notification' });
    const values = changeLetterValues(p, notify, NOW);
    expect(values.subject).toContain('통보');
    expect(values.closing_sentence).toContain('통보하오니');
    expect(values.request_details).not.toContain('사용계획');
    expect(values.due_date).toBe('해당 없음');
  });

  it('승인 공문에 사용계획이 없으면 [확인 필요]로 남긴다', () => {
    const p = project();
    const values = changeLetterValues(p, changeOf(p), NOW);
    expect(values.request_details).toContain('[확인 필요: 변경 후 사용계획]');
  });

  it('사업계획서를 붙이지 않았으면 붙임 2번을 비운다', () => {
    const p = project();
    expect(changeLetterValues(p, changeOf(p), NOW).attachment_2).toBe('');
    expect(changeLetterValues(p, changeOf(p, { planFileName: '계획서.pdf' }), NOW).attachment_2).toBe('변경 반영 사업계획서');
  });
});

describe('파일 이름', () => {
  it('어떤 변경의 공문인지 알 수 있게 짓는다', () => {
    const p = project();
    const name = letterFileName(p, changeOf(p, { documentNo: '테스트랩-2026-001' }));
    expect(name).toBe('스마트 물류 자동화 시스템 개발_사업비변경_승인요청_테스트랩-2026-001.docx');
  });

  it('파일 이름에 쓸 수 없는 글자는 바꾼다', () => {
    const p = project({ name: 'A/B:테스트' });
    expect(letterFileName(p, changeOf(p))).not.toMatch(/[\\/:*?"<>|]/);
  });
});
