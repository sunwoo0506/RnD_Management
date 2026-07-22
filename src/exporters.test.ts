import { describe, expect, it, vi } from 'vitest';
import { buildReviewSheets } from './exporters';
import { buildRegulationPackage } from './regulationPackage';
import type { Extraction } from './llmExtract';

// 검토본 엑셀은 개별 다운로드와 ZIP 안의 Review.xlsx가 같은 함수를 쓴다.
// 시트 이름·순서는 scripts/make_regulation_review.py와 맞춰야 한다 (04_mvp_output_spec.md §4.3).
const extraction: Extraction = {
  programName: '테스트 사업', year: 2026, programType: 'rnd',
  categories: [{ name: '인건비', parentName: null, definition: '급여', allowed: true, limitPct: null, limitBasis: null, requiredDocs: [], quote: '', ref: '제6조', verified: true }],
  allowedItems: [{ categoryName: '인건비', name: '참여연구자 급여', description: '급여', status: 'ALLOWED', condition: null, restriction: null, quote: '', ref: '제6조', verified: false }],
  articles: [{ ref: '제6조', title: '인건비', text: '제6조(인건비) 인건비는 참여연구자에게 지급하는 급여로 한다.', verified: true }],
  rules: [
    { kind: 'ratio', limitType: 'PERCENT', item: '연구수당', message: '인건비의 20% 이내', limitPct: 20, minAmount: null, basis: '인건비', severity: null, quote: '20% 이내', ref: '제11조', verified: true },
    { kind: 'warning', approvalStatus: 'PRIOR_APPROVAL_REQUIRED', requiredDocuments: ['견적서', '계약서'], item: '연구시설·장비비', message: '3천만원 이상 사전승인', limitPct: null, minAmount: null, basis: null, severity: 'high', quote: '', ref: '제8조', verified: false },
  ],
  referencedRegulations: [], fundingSchedule: null, uncertain: ['현금 비율 불명확'],
};

const sheets = () => buildReviewSheets(buildRegulationPackage(extraction));
const sheetNamed = (name: string) => sheets().find((sheet) => sheet.sheet === name)!;
const cellText = (row: { value: string | number }[], index: number) => String(row[index].value);

describe('검토본 엑셀 시트', () => {
  it('파이썬 스크립트와 같은 6시트를 같은 순서로 만든다', () => {
    expect(sheets().map((sheet) => sheet.sheet)).toEqual([
      'Summary', 'BudgetTree', 'BudgetGuides', 'AllowedItems', 'LimitRules', 'RuleReview',
    ]);
  });

  it('Summary에 문서 메타와 원문 대조 실패 건수가 들어간다', () => {
    const rows = sheetNamed('Summary').data.map((row) => row.map((cell) => String(cell.value)));
    expect(rows.find((row) => row[0] === '문서')?.[1]).toBe('테스트 사업');
    // 규칙 1건·인정항목 1건이 verified:false
    expect(rows.find((row) => row[0] === '원문 대조 실패 — 규칙')?.[1]).toBe('1');
    expect(rows.find((row) => row[0] === '원문 대조 실패 — 인정 항목')?.[1]).toBe('1');
    expect(rows.find((row) => row[0] === 'AI 판단 보류')?.[1]).toBe('현금 비율 불명확');
  });

  it('인용이 없는 규칙은 근거 조문 원문으로 채우고 검토 상태를 남긴다', () => {
    const rules = sheetNamed('RuleReview').data;
    const approval = rules.find((row) => cellText(row, 1).includes('3천만원'))!;
    // quote가 비었지만 제8조 조문이 패키지에 없으므로 인용은 비고 상태는 NEEDS_QUOTE
    expect(cellText(approval, 9)).toBe('');
    expect(cellText(approval, 10)).toBe('NEEDS_QUOTE');
    expect(cellText(approval, 6)).toBe('견적서 · 계약서');
  });

  it('인용이 없어도 근거 조문이 패키지에 있으면 원문으로 채우고 ARTICLE_LINKED로 표시한다', () => {
    const items = sheetNamed('AllowedItems').data;
    const item = items[1]; // 헤더 다음 첫 행 — quote 없음, ref는 제6조(조문 있음)
    expect(cellText(item, 11)).toContain('제6조(인건비)');
    expect(cellText(item, 12)).toBe('ARTICLE_LINKED');
  });

  it('상한 시트에는 금액 상한만 담고 승인 기준은 담지 않는다', () => {
    const limits = sheetNamed('LimitRules').data.slice(1);
    expect(limits).toHaveLength(1);
    expect(cellText(limits[0], 3)).toBe('PERCENT');
    expect(cellText(limits[0], 4)).toBe('20');
  });

  it('추출 결과가 비어도 헤더만 있는 시트를 만든다', () => {
    const empty = buildReviewSheets(buildRegulationPackage({
      ...extraction, categories: [], allowedItems: [], articles: [], rules: [], uncertain: [],
    }));
    expect(empty).toHaveLength(6);
    for (const sheet of empty.slice(1)) expect(sheet.data.length, sheet.sheet).toBe(1);
  });
});

describe('패키지 ZIP', () => {
  it('JSON·README와 함께 Review.xlsx를 같은 폴더에 담는다', async () => {
    // saveAs(브라우저 다운로드)만 막고 실제 ZIP·xlsx 생성은 그대로 돌린다
    const saved: Blob[] = [];
    vi.doMock('file-saver', () => ({ saveAs: (blob: Blob) => { saved.push(blob); } }));
    vi.resetModules();
    const { exportRegulationPackage } = await import('./exporters');
    const pkg = buildRegulationPackage(extraction);
    await exportRegulationPackage(pkg);

    expect(saved).toHaveLength(1);
    const { unzipSync } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await saved[0].arrayBuffer()));
    const entries = Object.keys(zip);
    expect(entries).toContain(`${pkg.package_name}/Review.xlsx`);
    expect(entries).toContain(`${pkg.package_name}/README.md`);
    expect(entries).toContain(`${pkg.package_name}/manifest.json`);
    // 빈 파일이 아니라 실제 엑셀이어야 한다 — xlsx도 zip이라 PK 시그니처로 시작한다
    const review = zip[`${pkg.package_name}/Review.xlsx`];
    expect(review.length).toBeGreaterThan(1000);
    expect([review[0], review[1]]).toEqual([0x50, 0x4b]);
    // README의 파일 목록과 ZIP 실물이 어긋나지 않아야 한다 (README 자신은 목록에 없다)
    const readme = new TextDecoder().decode(zip[`${pkg.package_name}/README.md`]);
    const listed = entries.map((entry) => entry.split('/')[1]).filter((name) => name !== 'README.md');
    for (const name of listed) expect(readme, name).toContain(name);
    vi.doUnmock('file-saver');
  });
});
