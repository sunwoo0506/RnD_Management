import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { saveAs } from 'file-saver';
import writeXlsxFile from 'write-excel-file/browser';
import { capFor, categoryOf, formatWon, fundingBreakdown, packFor } from './rules';
import type { Extraction } from './llmExtract';
import { packageFiles, type RegulationPackage } from './regulationPackage';
import type { BudgetChange, Project } from './types';

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
type BudgetExportRow = { category: string; amount: number; cash: number; inKind: number; rate: number; limit: string; status: string };

export const exportBudgetXlsx = async (project: Project) => {
  const pack = packFor(project);
  const inKind = fundingBreakdown(project).matchingInKind;
  const rows: BudgetExportRow[] = project.budgets.map((budget) => {
    const category = categoryOf(pack, budget.categoryId);
    const cap = capFor(pack, project.budgets, project.totalBudget, budget.categoryId, inKind);
    const itemInKind = Math.min(budget.inKindAmount ?? 0, budget.amount);
    return {
      category: category.name, amount: budget.amount, cash: budget.amount - itemInKind, inKind: itemInKind,
      rate: project.totalBudget ? budget.amount / project.totalBudget : 0,
      limit: cap ? cap.label : '제한 없음',
      status: cap?.amount != null && budget.amount > cap.amount ? '초과' : '정상',
    };
  });
  rows.push({
    category: '합계',
    amount: project.budgets.reduce((sum, item) => sum + item.amount, 0),
    cash: rows.reduce((sum, row) => sum + row.cash, 0),
    inKind: rows.reduce((sum, row) => sum + row.inKind, 0),
    rate: 1, limit: '', status: '',
  });
  const won = (value: number) => ({ value, type: Number, format: '#,##0"원"' });
  const file = writeXlsxFile(rows, {
    columns: [
      { header: '비목', cell: (row: BudgetExportRow) => row.category, width: 22 },
      { header: '편성금액', cell: (row: BudgetExportRow) => won(row.amount), width: 18 },
      { header: '현금(지원금+민간 현금)', cell: (row: BudgetExportRow) => won(row.cash), width: 20 },
      { header: '현물', cell: (row: BudgetExportRow) => won(row.inKind), width: 16 },
      { header: '총사업비 대비 비율', cell: (row: BudgetExportRow) => ({ value: row.rate, type: Number, format: '0.0%' }), width: 22 },
      { header: '허용 상한', cell: (row: BudgetExportRow) => row.limit, width: 28 },
      { header: '상한 초과 여부', cell: (row: BudgetExportRow) => row.status, width: 16 },
    ],
  });
  await file.toFile(`${safeName(project.name)}_예산편성표.xlsx`);
};

const cell = (text: string, bold = false) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
});

const changeRows = (project: Project, change: BudgetChange) => packFor(project).categories.map((category) => {
  const before = change.before.find((item) => item.categoryId === category.id)?.amount ?? 0;
  const after = change.after.find((item) => item.categoryId === category.id)?.amount ?? 0;
  return new TableRow({ children: [cell(category.name), cell(formatWon(before)), cell(formatWon(after)), cell(formatWon(after - before))] });
});

export const exportChangeDocx = async (project: Project, official = false) => {
  const change = project.changes[0];
  if (!change) return;
  const children = official
    ? [
        new Paragraph({ text: '예산 변경 승인 요청', heading: HeadingLevel.TITLE, alignment: 'center' }),
        new Paragraph({ children: [new TextRun({ text: `수신: ${project.agency} 담당자 귀하`, bold: true })] }),
        new Paragraph({ text: `발신: ${project.companyName}` }),
        new Paragraph({ text: `제목: ${project.name} 사업비 비목 간 변경 승인 요청` }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `1. 귀 기관의 무궁한 발전을 기원합니다.` }),
        new Paragraph({ text: `2. 당사가 수행 중인 「${project.name}」 과제의 원활한 수행을 위하여 아래와 같이 사업비 비목 간 변경을 요청드립니다.` }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: '변경 사유', bold: true })] }),
        new Paragraph({ text: change.reason }),
      ]
    : [
        new Paragraph({ text: `${project.name} 예산 변경 비교표`, heading: HeadingLevel.TITLE }),
        new Paragraph({ text: `생성일: ${new Date(change.createdAt).toLocaleDateString('ko-KR')}` }),
        new Paragraph({ text: `변경 사유: ${change.reason}` }),
      ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [cell('비목', true), cell('변경 전', true), cell('변경 후', true), cell('증감', true)] }),
      ...changeRows(project, change),
    ],
  });
  const tail = official
    ? [new Paragraph({ text: '' }), new Paragraph({ text: '첨부  1. 사업비 변경 전·후 비교표 1부.' }), new Paragraph({ text: '      2. 변경 사유서 1부.  끝.' })]
    : [];
  const doc = new Document({ sections: [{ children: [...children, table, ...tail] }] });
  saveAs(await Packer.toBlob(doc), `${safeName(project.name)}_${official ? '예산변경_공문' : '변경비교표'}.docx`);
};

// PDF 내보내기는 한글 폰트 미포함으로 문서 품질이 확보되지 않아 제거했다.
// 한글 폰트를 임베드해 한글 제목·비목명·사유가 정상 출력될 때까지 Word 내보내기만 제공한다.

export const downloadTemplate = async (type: '품의서' | '회의록' | '출장보고서') => {
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: type, heading: HeadingLevel.TITLE, alignment: 'center' }),
    new Paragraph({ text: '과제명:' }),
    new Paragraph({ text: '작성일:' }),
    new Paragraph({ text: '작성자:' }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: type === '회의록' ? '회의 목적 / 일시 / 장소 / 참석자 / 주요 논의 / 결정 사항' : type === '출장보고서' ? '출장 목적 / 기간 / 장소 / 수행 내용 / 결과' : '집행 목적 / 필요성 / 금액 / 거래처 / 기대 효과' }),
  ] }] });
  saveAs(await Packer.toBlob(doc), `${type}_템플릿.docx`);
};

// ---- AI 추출 결과 검토본 (Review.xlsx) ----
// 로컬 파이프라인의 scripts/make_regulation_review.py와 같은 6시트 구성으로 내보낸다
// (docs/gwayeon_guideline_extraction_framework/04_mvp_output_spec.md §4.3).
// 사람이 엑셀에서 검토·보강한 뒤 관리자가 공유 DB에 올리는 흐름을 위한 것이다.
// write-excel-file의 셀 형식에 맞춘다 — value에 null을 넣을 수 없어 빈 값은 빈 문자열로 둔다.
type Cell = { value: string | number; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold'; backgroundColor?: string; color?: string; wrap?: boolean };

const HEAD_BG = '#1F3864';
const head = (labels: string[]): Cell[] =>
  labels.map((value) => ({ value, type: String, fontWeight: 'bold' as const, backgroundColor: HEAD_BG, color: '#FFFFFF' }));
const text = (value: string | number | null | undefined): Cell =>
  typeof value === 'number' ? { value, type: Number, wrap: true } : { value: value ?? '', type: String, wrap: true };

export const exportExtractionReview = async (extraction: Extraction, meta: { documentTitle?: string; sourceFiles?: string[] }) => {
  const articleByRef = new Map((extraction.articles ?? []).map((article) => [article.ref.replace(/\s/g, ''), article]));
  // 규칙에 인용이 없으면 근거 조문 원문으로 채우고, 그 차이를 검토 상태로 남긴다 (로컬 파이프라인과 같은 규칙).
  const quoteOf = (quote: string | undefined, ref: string) =>
    quote || articleByRef.get(ref.replace(/\s/g, ''))?.text || '';
  const statusOf = (quote: string | undefined, ref: string) =>
    quote ? 'SOURCE_VERIFIED' : articleByRef.has(ref.replace(/\s/g, '')) ? 'ARTICLE_LINKED' : 'NEEDS_QUOTE';

  const summary: Cell[][] = [
    [{ value: `과제온 규정 추출 검토본 — ${meta.documentTitle ?? extraction.programName ?? '업로드 문서'}`, type: String, fontWeight: 'bold' }],
    [text('')],
    ...[
      ['문서', meta.documentTitle ?? extraction.programName ?? ''],
      ['사업명', extraction.programName ?? ''],
      ['연도', extraction.year != null ? String(extraction.year) : ''],
      ['사업 유형', extraction.programType ?? ''],
      ['원본 파일', (meta.sourceFiles ?? []).join(' / ')],
      ['생성일', new Date().toISOString().slice(0, 10)],
      [' ', ''],
      ['비목', String(extraction.categories.length)],
      ['인정 항목', String((extraction.allowedItems ?? []).length)],
      ['규칙', String(extraction.rules.length)],
      ['조문 원문', String((extraction.articles ?? []).length)],
      ['AI 판단 보류', (extraction.uncertain ?? []).join(' / ')],
    ].map(([key, value]) => [{ value: key, fontWeight: 'bold' as const }, text(value)]),
  ];

  const budgetTree: Cell[][] = [
    head(['비목명', '상위 비목', '사용 가능', '정의', '상한 %', '상한 기준', '근거', '원문 확인']),
    ...extraction.categories.map((category) => [
      text(category.name), text(category.parentName ?? ''), text(category.allowed ? 'Y' : 'N'),
      text(category.definition), text(category.limitPct), text(category.limitBasis),
      text(category.ref), text(category.verified ? 'SOURCE_VERIFIED' : 'NEEDS_QUOTE'),
    ]),
  ];

  const budgetGuides: Cell[][] = [
    head(['비목명', '사용 요약', '허용 상한', '근거']),
    ...extraction.categories.map((category) => [
      text(category.name), text(category.definition),
      text(category.limitPct != null ? `${category.limitBasis ?? '기준'}의 ${category.limitPct}% 이내` : '별도 상한 없음'),
      text(category.ref),
    ]),
  ];

  const allowedItems: Cell[][] = [
    head(['비목', '사용 가능 항목', '설명', '상태', '조건', '제한', '근거', '원문 인용', '검토 상태']),
    ...(extraction.allowedItems ?? []).map((item) => [
      text(item.categoryName), text(item.name), text(item.description), text(item.status),
      text(item.condition), text(item.restriction), text(item.ref),
      text(quoteOf(item.quote, item.ref)), text(statusOf(item.quote, item.ref)),
    ]),
  ];

  const limitRules: Cell[][] = [
    head(['비목·항목', '규칙명', 'MVP 유형', '값', '산정 기준', '화면 문구', '근거', '원문 인용']),
    ...extraction.rules.filter((rule) => rule.kind === 'ratio' || rule.minAmount != null).map((rule) => [
      text(rule.item), text(rule.message), text(rule.limitType ?? (rule.minAmount != null ? 'FIXED_AMOUNT' : 'PERCENT')),
      text(rule.minAmount ?? rule.limitPct), text(rule.basis), text(rule.message),
      text(rule.ref), text(quoteOf(rule.quote, rule.ref)),
    ]),
  ];

  const ruleReview: Cell[][] = [
    head(['비목·항목', '규칙 구분', '판정 결과', '승인·인정', '요구 증빙', '화면 문구', '원문 인용', '근거', '검토 상태']),
    ...extraction.rules.map((rule) => [
      text(rule.item), text(rule.minAmount != null ? '필수계상' : RULE_KIND_KO[rule.kind] ?? rule.kind),
      text(rule.severity === 'high' ? 'BLOCKING' : 'WARNING'),
      text(rule.approvalStatus === 'PRIOR_APPROVAL_REQUIRED' ? '사전승인 필요' : rule.approvalStatus === 'RECOGNITION_REQUIRED' ? '전문기관 인정 필요' : ''),
      text((rule.requiredDocuments ?? []).join(' · ')),
      text(rule.message), text(quoteOf(rule.quote, rule.ref)), text(rule.ref), text(statusOf(rule.quote, rule.ref)),
    ]),
  ];

  // 시트마다 이름·열 너비를 각자 갖는다 (write-excel-file의 multi-sheet 형식).
  const sheet = (name: string, data: Cell[][], widths: number[]) =>
    ({ sheet: name, data, columns: widths.map((width) => ({ width })) });

  const file = writeXlsxFile([
    sheet('Summary', summary, [26, 90]),
    sheet('BudgetTree', budgetTree, [24, 18, 10, 48, 10, 24, 24, 16]),
    sheet('BudgetGuides', budgetGuides, [24, 48, 32, 24]),
    sheet('AllowedItems', allowedItems, [20, 26, 44, 12, 32, 32, 22, 56, 16]),
    sheet('LimitRules', limitRules, [22, 34, 18, 12, 24, 44, 22, 56]),
    sheet('RuleReview', ruleReview, [20, 14, 14, 18, 30, 46, 56, 22, 16]),
  ]);
  await file.toFile(`Review_${safeName(extraction.programName || '추출결과')}.xlsx`);
};

const RULE_KIND_KO: Record<string, string> = { ratio: '상한', warning: '금지·주의', funding: '재원', info: '참고' };

// 규정DB 패키지를 ZIP으로 내려받는다 — docs/extraction_DB/<폴더>/ 와 같은 구성이라, 받은 그대로
// 폴더에 풀면 make_regulation_review.py · convert-regulation-db.mjs · upload-regulation-db.mjs 를
// 태울 수 있다. 앱에서 신청하는 경로와 별개로, 손으로 검토·보강하고 싶을 때 쓰는 출구다.
export const exportRegulationPackage = async (pkg: RegulationPackage) => {
  const { strToU8, zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const file of packageFiles(pkg)) files[`${pkg.package_name}/${file.name}`] = strToU8(file.content);
  saveAs(new Blob([zipSync(files)], { type: 'application/zip' }), `${safeName(pkg.package_name)}.zip`);
};
