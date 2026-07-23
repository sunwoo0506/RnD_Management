import { describe, expect, it } from 'vitest';
import { sharePackOf } from './SetupWizard';
import { buildPackageReadme, buildRegulationPackage, validateRegulationPackage } from './regulationPackage';
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

// 관리자 승인 화면의 규격 검사 — AI 추출 패키지가 사람이 만든 규정DB와 같은 규격이어야
// 검토·변환·적재를 그대로 태우고, 서비스가 규정DB 데이터를 일괄 규칙으로 읽을 수 있다.
describe('승인 전 패키지 규격 검사', () => {
  const extraction: Extraction = {
    programName: '검사 대상 사업', year: 2026, programType: 'startup',
    categories: [], allowedItems: [],
    articles: [{ ref: '제10조', title: '지원한도', text: '제10조(지원한도) …', verified: true }],
    rules: [{ kind: 'ratio', limitType: 'PERCENT', item: null, message: '간접비 10% 이내', limitPct: 10, minAmount: null, basis: '직접비', severity: null, quote: '10% 이내', ref: '제10조', verified: true }],
    referencedRegulations: [], fundingSchedule: null, uncertain: [],
  };

  it('앱이 만든 패키지는 모든 검사를 통과한다', () => {
    const checks = validateRegulationPackage(buildRegulationPackage(extraction));
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    expect(checks.map((check) => check.label)).toEqual(
      ['manifest', '데이터 파일 6종', 'manifest 건수 일치', '조문 원문(source_text)', '근거가 원문에서 열림', '원문 인용 대조']);
  });

  it('조문 원문이 없으면 그 검사와 근거 연결 검사가 함께 실패한다', () => {
    const checks = validateRegulationPackage(buildRegulationPackage({ ...extraction, articles: [] }));
    expect(checks.find((check) => check.label === '조문 원문(source_text)')?.ok).toBe(false);
    expect(checks.find((check) => check.label === '근거가 원문에서 열림')?.ok).toBe(false);
  });

  it('manifest 건수가 실제와 다르면 잡아낸다', () => {
    const pkg = buildRegulationPackage(extraction);
    (pkg.manifest as { counts: Record<string, number> }).counts.source_text = 99;
    expect(validateRegulationPackage(pkg).find((check) => check.label === 'manifest 건수 일치')?.ok).toBe(false);
  });

  it('원문 대조에 실패한 항목이 있으면 알려준다', () => {
    const checks = validateRegulationPackage(buildRegulationPackage({
      ...extraction,
      rules: [{ ...extraction.rules[0], verified: false }],
    }));
    const check = checks.find((entry) => entry.label === '원문 인용 대조');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('1건');
  });

  it('패키지가 아예 없거나 형식이 다르면 첫 검사부터 실패한다', () => {
    expect(validateRegulationPackage(null)[0].ok).toBe(false);
    expect(validateRegulationPackage({ pack: '엉뚱한 형식' }).find((check) => check.label === '데이터 파일 6종')?.ok).toBe(false);
  });
});
