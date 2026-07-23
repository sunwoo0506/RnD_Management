import { describe, expect, it } from 'vitest';
import { effectiveAnnual, effectiveMonthly, employmentStatus, monthlyOf, parseResearchers, researcherByName, resignationTargets, severanceEligible, tenureText } from './researchers';
import type { Project, Researcher } from './types';

// 연구자 명부는 회사 공통 인사 정보다 — 월급여 자동 계산, 수정연봉 적용일, 퇴직금 계상 가능
// 판정(계속근로 1년), 퇴사일의 참여 과제 반영 대상 찾기가 이 파일의 계약이다.

const researcher = (over: Partial<Researcher>): Researcher => ({
  id: 'r1', name: '김연구', annualSalary: 48_000_000, joinDate: '2025-03-01', createdAt: '2026-01-01', ...over,
});

const project = (over: Partial<Project>): Project => ({
  id: 'p', name: '과제', totalBudget: 100_000_000, startDate: '2026-01-01', endDate: '2026-12-31',
  settlementDeadline: '2027-01-31', agency: '중기부', companyName: '테스트랩', packId: 'legacy-rnd',
  members: [], participants: [], budgets: [], expenses: [], changes: [], emailLogs: [], createdAt: '2026-01-01',
  ...over,
});

const TODAY = '2026-07-23';

describe('월급여 자동 계산', () => {
  it('연봉÷12, 원 단위는 버린다', () => {
    expect(monthlyOf(48_000_000)).toBe(4_000_000);
    expect(monthlyOf(50_000_000)).toBe(4_166_666); // 50,000,000/12 = 4,166,666.66…
    expect(monthlyOf(0)).toBe(0);
  });
});

describe('수정연봉 적용', () => {
  it('적용일이 지나기 전엔 원래 연봉, 지나면 수정연봉', () => {
    const r = researcher({ revisedSalary: 54_000_000, revisedFrom: '2026-08-01' });
    expect(effectiveAnnual(r, '2026-07-23')).toBe(48_000_000);
    expect(effectiveAnnual(r, '2026-08-01')).toBe(54_000_000); // 적용일 당일부터
    expect(effectiveMonthly(r, '2026-08-01')).toBe(4_500_000);
  });
  it('적용일이 없으면 수정연봉을 즉시 적용한다', () => {
    expect(effectiveAnnual(researcher({ revisedSalary: 54_000_000 }), TODAY)).toBe(54_000_000);
  });
  it('수정연봉이 없으면 원래 연봉', () => {
    expect(effectiveAnnual(researcher({}), TODAY)).toBe(48_000_000);
  });
});

describe('퇴직금 계상 가능 (계속근로 1년)', () => {
  it('입사 만 1년이 되는 날부터 가능', () => {
    expect(severanceEligible(researcher({ joinDate: '2025-07-23' }), TODAY)).toBe(true);  // 딱 1년
    expect(severanceEligible(researcher({ joinDate: '2025-07-24' }), TODAY)).toBe(false); // 하루 모자람
    expect(severanceEligible(researcher({ joinDate: '2020-01-01' }), TODAY)).toBe(true);
  });
  it('입사일이 없으면 판정 불가 → 미계상', () => {
    expect(severanceEligible(researcher({ joinDate: '' }), TODAY)).toBe(false);
  });
});

describe('근속·재직 상태', () => {
  it('근속은 같은 일자가 돌아와야 한 달을 채운다', () => {
    expect(tenureText(researcher({ joinDate: '2025-03-01' }), TODAY)).toBe('1년 4개월');
    expect(tenureText(researcher({ joinDate: '2026-07-01' }), TODAY)).toBe('0개월');
    expect(tenureText(researcher({ joinDate: '2025-07-23' }), TODAY)).toBe('1년');
  });
  it('퇴사자는 퇴사일까지로 계산한다', () => {
    expect(tenureText(researcher({ joinDate: '2025-01-01', leaveDate: '2026-01-01' }), TODAY)).toBe('1년');
  });
  it('재직 → 퇴사예정(퇴사일 미래) → 퇴사(퇴사일 경과)', () => {
    expect(employmentStatus(researcher({}), TODAY)).toBe('재직');
    expect(employmentStatus(researcher({ leaveDate: '2026-09-30' }), TODAY)).toBe('퇴사예정');
    expect(employmentStatus(researcher({ leaveDate: '2026-06-30' }), TODAY)).toBe('퇴사');
  });
});

describe('이름으로 명부 찾기', () => {
  it('공백을 무시하고 정확히 같은 이름만 찾는다', () => {
    const list = [researcher({}), researcher({ id: 'r2', name: '이박사' })];
    expect(researcherByName(list, ' 김연구 ')?.id).toBe('r1');
    expect(researcherByName(list, '김연')).toBeUndefined();
    expect(researcherByName(list, '')).toBeUndefined();
  });
});

describe('퇴사일 반영 대상', () => {
  const participant = (over: Partial<Project['participants'][number]>) => ({
    id: 'pp', name: '김연구', projectRate: 50, externalRate: 0, ...over,
  });
  it('참여 종료일이 퇴사일보다 뒤인 과제만 잡는다', () => {
    const r = researcher({ leaveDate: '2026-09-30' });
    const targets = resignationTargets([
      project({ id: 'a', participants: [participant({})] }),                                  // 종료일 12-31 > 퇴사일 → 대상
      project({ id: 'b', participants: [participant({ laborEnd: '2026-08-31' })] }),          // 이미 그 전에 끝남 → 제외
      project({ id: 'c', participants: [participant({ name: '이박사' })] }),                  // 다른 사람 → 제외
    ], r);
    expect(targets.map((t) => t.project.id)).toEqual(['a']);
    expect(targets[0].newEnd).toBe('2026-09-30');
  });
  it('퇴사일이 없으면 빈 배열', () => {
    expect(resignationTargets([project({ participants: [participant({})] })], researcher({}))).toEqual([]);
  });
});

describe('저장 데이터 검증', () => {
  it('배열이 아니면 null, 필수 필드가 빠진 항목은 걸러낸다', () => {
    expect(parseResearchers('x')).toBeNull();
    expect(parseResearchers([researcher({}), { id: 'bad' }])).toHaveLength(1);
  });
});
