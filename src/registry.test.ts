import { describe, expect, it } from 'vitest';
import { guessDocRole, matchDocToSource, type RegistryDocEntry } from './registry';

const doc = (id: string, fileName: string, role: RegistryDocEntry['role']): RegistryDocEntry =>
  ({ id, fileName, role, storagePath: `${id}.bin`, year: 2026 });

const docs = [
  doc('a', '2026 예비창업패키지 모집공고.hwp', 'notice'),
  doc('b', '예비창업패키지 주요 질의응답(QnA).hwp', 'notice'),
  doc('c', '중소기업창업 지원사업 통합관리지침 제14차.pdf', 'guideline'),
  doc('d', '별첨2 증빙서류 제출목록.hwp', 'form'),
];

describe('근거 → 원본 문서 매칭', () => {
  it('QnA 근거는 질의응답 파일로 연결된다', () => {
    const picked = matchDocToSource(docs, { doc: '2026 예비창업패키지 주요 질의응답 (사업비 3번)', ref: 'QnA 사업비 3번', matchLevel: 'notice_guideline' });
    expect(picked?.id).toBe('b');
  });

  it('공고 본문 근거는 공고문 파일로 연결된다', () => {
    const picked = matchDocToSource(docs, { doc: '2026 예비창업패키지 예비창업자 모집공고 (2026-207호)', ref: '공고 사업화 자금 집행 비목', matchLevel: 'notice' });
    expect(picked?.id).toBe('a');
  });

  it('조문 근거는 지침 파일로 연결된다', () => {
    const picked = matchDocToSource(docs, { doc: '국가연구개발사업 연구개발비 사용 기준(개정안)', ref: '제65조 제7항', matchLevel: 'guideline' });
    expect(picked?.id).toBe('c');
  });

  it('별첨 근거는 별첨 파일로 연결된다', () => {
    const picked = matchDocToSource(docs, { doc: '증빙서류 제출목록 안내 (별첨2)', ref: '별첨2 신청자격 증빙서류', matchLevel: 'notice' });
    expect(picked?.id).toBe('d');
  });
});

describe('문서 역할 추정', () => {
  it('질의응답·QnA 파일은 공고 계열로 분류한다', () => {
    expect(guessDocRole('주요 질의응답.hwp')).toBe('notice');
    expect(guessDocRole('사업 QnA 모음.pdf')).toBe('notice');
    expect(guessDocRole('집행 교육 매뉴얼.pdf')).toBe('manual');
  });
});
