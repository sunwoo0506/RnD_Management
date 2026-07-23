import { describe, expect, it } from 'vitest';
import { sharePackOf } from './SetupWizard';
import { buildPackageReadme, buildRegulationPackage } from './regulationPackage';
import { getPack } from './rules';
import type { Extraction } from './llmExtract';

// 실제로 있었던 일: 디딤돌 공고로 식별된 상태에서 글로벌 문서를 AI로 추출해 공유 신청했더니,
// 추출 규칙·조문 원문이 다 빠진 기준 팩(도약)의 복제본이 대기열에 들어갔다.
// 추출 팩은 sharePackOf(팩만 신청)로 가지 않고 규정DB 패키지 신청으로 올라간다 —
// 조문 원문(source_text)이 함께 담겨야 관리자가 공통 포맷으로 검토할 수 있다.
describe('공유 신청에 담을 팩 고르기 (추출 없음)', () => {
  const base = getPack('didimdol2026');
  const registryPick = { id: 'reg-1', programName: '디딤돌 도약', year: 2026, verified: true, pack: base };

  it('공유 DB 팩을 골랐으면 팩을 다시 신청하지 않는다', () => {
    expect(sharePackOf(registryPick, base)).toEqual({});
  });

  it('직접 고른 팩은 그대로 신청한다', () => {
    const payload = sharePackOf(null, base);
    expect(payload).toMatchObject({ origin: 'pack' });
    expect('pack' in payload && payload.pack.id).toBe('didimdol2026');
  });
});

describe('추출 팩의 규정DB 패키지 — 조문 원문을 반드시 담는다', () => {
  const extraction: Extraction = {
    programName: '디딤돌(도약_글로벌 R&D)', year: 2026, programType: 'startup',
    categories: [], allowedItems: [],
    articles: [
      { ref: '지원기간 및 한도', title: '지원기간 및 한도', text: '□ 지원기간 및 한도 : 최대 1년 6개월, 최대 2억 원 이내', verified: true },
      { ref: '주요 연구개발비 산정기준', title: '주요 연구개발비 산정기준', text: '위탁연구개발비는 40% 이내…', verified: false },
    ],
    rules: [{ kind: 'ratio', limitType: 'PERCENT', item: '위탁연구개발비', message: '위탁 40% 이내', limitPct: 40, minAmount: null, basis: '직접비', severity: null, quote: '40% 이내에서 계상', ref: '주요 연구개발비 산정기준', verified: true }],
    referencedRegulations: [], fundingSchedule: null, uncertain: [],
  };

  it('추출된 조문이 source_text로 원문 그대로 실린다', () => {
    const pkg = buildRegulationPackage(extraction);
    expect(pkg.source_text).toHaveLength(2);
    expect(pkg.source_text[0]).toMatchObject({
      source_article: '지원기간 및 한도',
      original_text: '□ 지원기간 및 한도 : 최대 1년 6개월, 최대 2억 원 이내',
      verified: true,
    });
    // 원문 대조에 실패한 조문은 verified=false로 남아 검토자가 먼저 본다
    expect(pkg.source_text[1]).toMatchObject({ verified: false });
  });

  it('조문이 하나도 없으면 README가 검토 불가를 경고한다', () => {
    const readme = buildPackageReadme(buildRegulationPackage({ ...extraction, articles: [] }));
    expect(readme).toContain('조문 원문(source_text)이 한 건도 없습니다');
  });
});
