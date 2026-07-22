import { describe, expect, it } from 'vitest';
import { sharePackOf } from './SetupWizard';
import { getPack } from './rules';
import type { RulePack } from './types';

// 공유 신청에 담기는 팩 — 실제로 있었던 일: 디딤돌 공고로 식별된 상태에서 글로벌 문서를
// AI로 추출해 공유 신청했더니, 추출 규칙은 빠지고 기준 팩(도약)의 복제본이 대기열에 들어갔다.
describe('공유 신청에 담을 팩 고르기', () => {
  const base = getPack('didimdol2026');
  const extracted: RulePack = {
    ...base,
    id: 'custom-global',
    name: '디딤돌 글로벌 (추출)',
    rules: [...base.rules, {
      id: 'custom_global_cap', kind: 'info', message: '글로벌 전용 규칙',
      source: { doc: '붙임2-1', ref: '지원한도', matchLevel: 'notice' },
    } as RulePack['rules'][number]],
  };
  const registryPick = { id: 'reg-1', programName: '디딤돌 도약', year: 2026, verified: true, pack: base };

  it('추출 팩이 있으면 기준 팩이 아니라 추출 팩을 신청한다', () => {
    const payload = sharePackOf(extracted, null, base);
    expect(payload).toMatchObject({ origin: 'extracted' });
    // 추출로 더해진 규칙이 신청 팩에 살아 있어야 한다 — 기준 팩을 올리면 이 규칙이 사라진다
    expect('pack' in payload && payload.pack.rules.some((rule) => rule.id === 'custom_global_cap')).toBe(true);
  });

  it('공유 DB 팩을 고른 채 추출했으면 그 사업 id를 함께 실어 관리자가 잇게 한다', () => {
    const payload = sharePackOf(extracted, registryPick, base);
    expect(payload).toMatchObject({ origin: 'extracted', programRegistryId: 'reg-1' });
  });

  it('추출 없이 공유 DB 팩을 골랐으면 팩을 다시 신청하지 않는다', () => {
    expect(sharePackOf(null, registryPick, base)).toEqual({});
  });

  it('추출도 선택도 없으면 화면에서 고른 팩을 신청한다', () => {
    const payload = sharePackOf(null, null, base);
    expect(payload).toMatchObject({ origin: 'pack' });
    expect('pack' in payload && payload.pack.id).toBe('didimdol2026');
  });
});
