import { describe, expect, it } from 'vitest';
import { getPack, makeDraftBudgets } from './rules';
import { collectEvidenceIds, parseBackup, parseProject } from './storage';
import type { Project } from './types';

const fixture = (): Project => ({
  id: 'p1', name: '테스트 과제', totalBudget: 100_000_000, startDate: '2026-07-01', endDate: '2027-06-30',
  settlementDeadline: '2027-07-30', agency: '중소벤처기업부', companyName: '테스트랩', packId: 'legacy-rnd',
  members: [{ id: 'm1', name: '김대표', email: 'owner@example.com', role: '대표' }],
  participants: [], budgets: makeDraftBudgets(getPack('legacy-rnd'), 100_000_000),
  expenses: [{
    id: 'e1', date: '2026-07-10', categoryId: 'meeting', amount: 80_000, purpose: '정기 회의', vendor: '회의공간',
    evidence: [{ id: 'ev1', label: '회의록', completed: true }, { id: 'ev2', label: '카드 영수증', completed: false }],
    createdAt: new Date().toISOString(),
  }],
  changes: [], emailLogs: [], createdAt: new Date().toISOString(),
});

describe('저장 데이터 검증', () => {
  it('정상 데이터는 그대로 복원한다', () => {
    const project = parseProject(JSON.stringify(fixture()));
    expect(project?.name).toBe('테스트 과제');
    expect(project?.expenses).toHaveLength(1);
  });

  it('손상된 JSON과 구조가 다른 값은 null을 반환한다', () => {
    expect(parseProject('{broken')).toBeNull();
    expect(parseProject('"문자열"')).toBeNull();
    expect(parseProject(JSON.stringify({ name: '이름만 있음' }))).toBeNull();
    expect(parseProject(JSON.stringify({ ...fixture(), budgets: '배열 아님' }))).toBeNull();
    expect(parseProject(null)).toBeNull();
  });

  it('구버전 데이터의 빠진 emailLogs를 기본값으로 채운다', () => {
    const { emailLogs: _omitted, ...legacy } = fixture();
    const project = parseProject(JSON.stringify(legacy));
    expect(project?.emailLogs).toEqual([]);
  });

  it('팩 도입 이전 데이터에 legacy-rnd 팩을 자동 부여한다', () => {
    const { packId: _omitted, ...legacy } = fixture();
    const project = parseProject(JSON.stringify(legacy));
    expect(project?.packId).toBe('legacy-rnd');
    const kept = parseProject(JSON.stringify({ ...fixture(), packId: 'prestartup' }));
    expect(kept?.packId).toBe('prestartup');
  });

  it('구버전 latestChange 1건을 changes 이력 배열로 옮긴다', () => {
    const { changes: _omitted, ...rest } = fixture();
    const legacyChange = {
      id: 'c1', fromCategoryId: 'outsourcing', toCategoryId: 'personnel', amount: 1_000_000,
      reasonKey: 'price', reason: '단가 변동', before: rest.budgets, after: rest.budgets, createdAt: new Date().toISOString(),
    };
    const project = parseProject(JSON.stringify({ ...rest, latestChange: legacyChange }));
    expect(project?.changes).toHaveLength(1);
    expect(project?.changes[0].id).toBe('c1');
    const withoutChange = parseProject(JSON.stringify(rest));
    expect(withoutChange?.changes).toEqual([]);
  });

  it('백업 파일(래핑 형식)과 원본 JSON을 모두 가져올 수 있다', () => {
    const project = fixture();
    const wrapped = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), project });
    expect(parseBackup(wrapped)?.id).toBe('p1');
    expect(parseBackup(JSON.stringify(project))?.id).toBe('p1');
    expect(parseBackup('잘못된 내용')).toBeNull();
  });

  it('과제의 모든 증빙 파일 ID를 수집한다', () => {
    expect(collectEvidenceIds(fixture())).toEqual(['ev1', 'ev2']);
  });
});
