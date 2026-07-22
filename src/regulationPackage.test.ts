import { describe, expect, it } from 'vitest';
import { buildPackageReadme, buildRegulationPackage, packageFiles } from './regulationPackage';
import type { Extraction } from './llmExtract';

// 앱에서 추출한 결과를 사람이 만든 패키지와 같은 구성(manifest + 6 JSON + README)으로 내보내는지 확인한다.
// 이 폴더를 그대로 make_regulation_review.py · convert-regulation-db.mjs에 태울 수 있어야 한다.
const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  programName: '테스트 창업지원사업',
  year: 2026,
  programType: 'startup',
  categories: [
    { name: '인건비', parentName: null, definition: '참여연구자 급여', allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: '인건비는…', ref: '제6조', verified: true },
    { name: '재료비', parentName: null, definition: '시약·재료 구입비', allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: '재료비는…', ref: '제9조', verified: true },
  ],
  allowedItems: [
    { categoryName: '인건비', name: '참여연구자 급여', description: '급여와 4대보험', status: 'ALLOWED', condition: null, restriction: null, quote: '급여를 지급한다', ref: '제6조', verified: true },
  ],
  articles: [
    { ref: '제6조', title: '인건비 사용용도', text: '제6조(인건비 사용용도) 인건비는 …', verified: true },
  ],
  rules: [
    { kind: 'ratio', limitType: 'PERCENT', item: '연구수당', message: '연구수당은 인건비의 20% 이내', limitPct: 20, minAmount: null, basis: '인건비', severity: null, quote: '20% 이내에서 계상한다', ref: '제11조', verified: true },
    { kind: 'warning', approvalStatus: 'PRIOR_APPROVAL_REQUIRED', requiredDocuments: ['견적서'], item: '연구시설·장비비', message: '3천만원 이상 장비는 사전승인', limitPct: null, minAmount: null, basis: null, severity: 'high', quote: '', ref: '제8조', verified: false },
  ],
  referencedRegulations: [],
  fundingSchedule: null,
  uncertain: [],
  ...over,
});

describe('규정DB 패키지 만들기', () => {
  it('MVP 규격의 파일 7개와 README를 만든다 — 폴더째 스크립트에 태울 수 있어야 한다', () => {
    const files = packageFiles(buildRegulationPackage(extraction()));
    expect(files.map((file) => file.name).sort()).toEqual([
      'README.md', 'budget_screen_guides.json', 'expense_allowed_items.json', 'expense_categories.json',
      'expense_limit_rules.json', 'manifest.json', 'regulation_rules.json', 'source_text.json',
    ]);
    // 모든 JSON이 파싱 가능해야 한다 (스크립트가 그대로 읽는다)
    for (const file of files.filter((f) => f.name.endsWith('.json'))) {
      expect(() => JSON.parse(file.content), file.name).not.toThrow();
    }
  });

  it('금액 상한과 절차 규칙을 다른 파일로 나눈다 — 승인 기준은 편성 금액을 깎지 않는다', () => {
    const pkg = buildRegulationPackage(extraction());
    expect(pkg.expense_limit_rules).toHaveLength(1);
    expect(pkg.expense_limit_rules[0].limit_value).toBe(20);
    expect(pkg.regulation_rules).toHaveLength(1);
    expect(pkg.regulation_rules[0].rule_type).toBe('APPROVAL_REQUIRED');
  });

  it('README에 상한 표와 미검증 건수가 들어간다', () => {
    const readme = buildPackageReadme(buildRegulationPackage(extraction()));
    expect(readme).toContain('연구수당 상한');
    expect(readme).toContain('20%');
    // 규칙 1건·조문 0건이 원문 대조에 실패했다 (verified: false)
    expect(readme).toMatch(/원문 대조에 실패한 항목이 1건/);
  });

  it('상한도 공고번호도 없는 추출에서 README가 깨지지 않는다', () => {
    const readme = buildPackageReadme(buildRegulationPackage(extraction({ rules: [], articles: [], allowedItems: [] })));
    expect(readme).toContain('(미확인)');            // notice_number가 null일 때
    expect(readme).toContain('금액·비율 상한이 추출되지 않았습니다');
    expect(readme).toContain('모두 원문에서 확인됐습니다'); // 미검증 0건
  });

  it('사업명이 비어도 패키지 이름을 만든다', () => {
    const pkg = buildRegulationPackage(extraction({ programName: '' }), {});
    expect(pkg.package_name).toMatch(/^gwayeon_/);
    expect(pkg.manifest.title).toBe('이름 미확인 사업');
  });
});
