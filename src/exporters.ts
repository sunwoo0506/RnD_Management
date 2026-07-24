import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from 'docx';
import { saveAs } from 'file-saver';
import writeXlsxFile from 'write-excel-file/browser';
import { capFor, categoryOf, formatWon, fundingBreakdown, packFor } from './rules';
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

// 비교표 열 너비(twips) — 지정하지 않으면 Word가 셀 내용 길이에 맞춰 열을 제멋대로 늘려 표가 틀어진다.
// 비목명은 넓게, 금액 3칸은 같은 폭으로 고정한다. 합 9360 ≒ A4 기본 여백 기준 본문 폭.
const CHANGE_COL_WIDTHS = [3360, 2000, 2000, 2000];

const cell = (text: string, width: number, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  margins: { top: 40, bottom: 40, left: 80, right: 80 },
  children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold })] })],
});

const changeRows = (project: Project, change: BudgetChange) => packFor(project).categories.map((category) => {
  const before = change.before.find((item) => item.categoryId === category.id)?.amount ?? 0;
  const after = change.after.find((item) => item.categoryId === category.id)?.amount ?? 0;
  const [wName, wBefore, wAfter, wDelta] = CHANGE_COL_WIDTHS;
  return new TableRow({ children: [
    cell(category.name, wName),
    cell(formatWon(before), wBefore, { align: AlignmentType.RIGHT }),
    cell(formatWon(after), wAfter, { align: AlignmentType.RIGHT }),
    cell(formatWon(after - before), wDelta, { align: AlignmentType.RIGHT }),
  ] });
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

  const [wName, wBefore, wAfter, wDelta] = CHANGE_COL_WIDTHS;
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
  const table = new Table({
    // 고정 레이아웃 + 명시적 열 너비로 모든 행의 열이 정확히 정렬되게 한다.
    width: { size: CHANGE_COL_WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: CHANGE_COL_WIDTHS,
    layout: TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: [
        cell('비목', wName, { bold: true }),
        cell('변경 전', wBefore, { bold: true, align: AlignmentType.RIGHT }),
        cell('변경 후', wAfter, { bold: true, align: AlignmentType.RIGHT }),
        cell('증감', wDelta, { bold: true, align: AlignmentType.RIGHT }),
      ] }),
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

// ---- 규정DB 패키지 검토본 (Review.xlsx) ----
// 로컬 파이프라인의 scripts/make_regulation_review.py와 같은 6시트 구성으로 내보낸다
// (docs/gwayeon_guideline_extraction_framework/04_mvp_output_spec.md §4.3).
// 패키지 JSON에서 만들기 때문에, 이 폴더를 그대로 파이썬 스크립트에 태워도 같은 시트가 나온다.
// 사람이 엑셀에서 검토·보강한 뒤 관리자가 공유 DB에 올리는 흐름을 위한 것이다.
// write-excel-file의 셀 형식에 맞춘다 — value에 null을 넣을 수 없어 빈 값은 빈 문자열로 둔다.
type Cell = { value: string | number; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold'; backgroundColor?: string; color?: string; wrap?: boolean };

const HEAD_BG = '#1F3864';
const head = (labels: string[]): Cell[] =>
  labels.map((value) => ({ value, type: String, fontWeight: 'bold' as const, backgroundColor: HEAD_BG, color: '#FFFFFF' }));
const text = (value: string | number | null | undefined): Cell =>
  typeof value === 'number' ? { value, type: Number, wrap: true } : { value: value ?? '', type: String, wrap: true };

type Row = Record<string, unknown>;
const str = (value: unknown): string => value == null ? '' : String(value);
const normRef = (ref: string) => ref.replace(/\s/g, '');

// 시트마다 이름·열 너비를 각자 갖는다 (write-excel-file의 multi-sheet 형식).
const sheetOf = (name: string, data: Cell[][], widths: number[]) =>
  ({ sheet: name, data, columns: widths.map((width) => ({ width })) });

// 패키지(manifest + 6 JSON)에서 검토용 6시트를 만든다.
// 개별 다운로드와 ZIP 안의 Review.xlsx가 같은 함수를 쓰므로 둘의 내용이 어긋날 수 없다.
export const buildReviewSheets = (pkg: RegulationPackage) => {
  const m = pkg.manifest as Row & {
    counts?: Record<string, number>;
    validation?: { unverified_rules: number; unverified_items: number; unverified_articles: number; uncertain: string[] };
  };
  const articleByRef = new Map(pkg.source_text.map((article) => [normRef(str(article.source_article)), article]));
  // 인용이 없으면 근거 조문 원문으로 채우고, 그 차이를 검토 상태로 남긴다 (파이썬 스크립트와 같은 규칙).
  const quoteOf = (row: Row) => str(row.source_quote) || str(articleByRef.get(normRef(str(row.source_article)))?.original_text);
  const statusOf = (row: Row) => row.verified ? 'SOURCE_VERIFIED'
    : row.source_quote ? 'QUOTE_UNVERIFIED'
    : articleByRef.has(normRef(str(row.source_article))) ? 'ARTICLE_LINKED'
    : 'NEEDS_QUOTE';

  const counts = m.counts ?? {};
  const v = m.validation;
  const summary: Cell[][] = [
    [{ value: `과제온 규정 DB 검토본 — ${str(m.title) || pkg.package_name}`, type: String, fontWeight: 'bold' }],
    [text('')],
    ...[
      ['문서', str(m.title)],
      ['고시·공고 번호', str(m.notice_number)],
      ['발행기관', str(m.issuer)],
      ['문서 유형', str(m.document_type)],
      ['시행', str(m.effective_from)],
      ['생성일', `${str(m.generated_at)}${m.generated_by ? ` (${str(m.generated_by)})` : ''}`],
      ['원본 파일', ((m.source_files as string[]) ?? []).join(' / ')],
      ['비고', str(m.notes)],
      [' ', ''],
      ['비목', str(counts.categories ?? pkg.expense_categories.length)],
      ['화면 가이드', str(counts.budget_guides ?? pkg.budget_screen_guides.length)],
      ['사용 가능 항목', str(counts.allowed_items ?? pkg.expense_allowed_items.length)],
      ['허용상한 규칙', str(counts.limit_rules ?? pkg.expense_limit_rules.length)],
      ['판정 규칙', str(counts.regulation_rules ?? pkg.regulation_rules.length)],
      ['조문 원문', str(counts.source_text ?? pkg.source_text.length)],
      ...(v ? [
        [' ', ''],
        ['원문 대조 실패 — 규칙', str(v.unverified_rules)],
        ['원문 대조 실패 — 인정 항목', str(v.unverified_items)],
        ['원문 대조 실패 — 조문', str(v.unverified_articles)],
        ['AI 판단 보류', (v.uncertain ?? []).join(' / ')],
      ] : []),
    ].map(([key, value]) => [{ value: key, fontWeight: 'bold' as const }, text(value)]),
  ];

  const budgetTree: Cell[][] = [
    head(['비목 코드', '비목명', '상위 비목', '구분', '레벨', '최하위', '하위 수', '사용 항목 수', '정렬', '근거']),
    ...pkg.expense_categories.map((c) => [
      text(str(c.category_code)), text(str(c.category_name)), text(str(c.parent_code)), text(str(c.cost_class)),
      text(c.level as number), text(str(c.is_leaf_category)), text(c.child_category_count as number),
      text(c.allowed_item_count as number), text(c.display_order as number), text(str(c.source_article)),
    ]),
  ];

  const budgetGuides: Cell[][] = [
    head(['비목 코드', '화면명', '사용 요약', '허용 상한', '상세 기준', '근거', '시행일']),
    ...pkg.budget_screen_guides.map((g) => [
      text(str(g.category_code)), text(str(g.display_name)), text(str(g.usage_summary)),
      text(str(g.limit_text)), text(str(g.limit_detail_text)),
      text(((g.source_articles as string[]) ?? []).join(', ')), text(str(g.effective_from)),
    ]),
  ];

  const allowedItems: Cell[][] = [
    head(['항목 코드', '비목 코드', '사용 가능 항목', '설명', '적용 기관', '가용 상태', '조건', '제한', '사전승인', '증빙', '근거', '원문 인용', '검토 상태']),
    ...pkg.expense_allowed_items.map((i) => [
      text(str(i.item_code)), text(str(i.category_code)), text(str(i.item_name)), text(str(i.description)),
      text(str(i.institution_scope)), text(str(i.availability_status)), text(str(i.condition_summary)),
      text(str(i.restriction_summary)), text(i.requires_approval ? 'Y' : ''), text(str(i.evidence_summary)),
      text(str(i.source_article)), text(quoteOf(i)), text(statusOf(i)),
    ]),
  ];

  const limitRules: Cell[][] = [
    head(['규칙 코드', '비목 코드', '규칙명', 'MVP 유형', '값', '단위', '산정 기준', '화면 문구', '초과 처리', '적용 기관', '근거', '원문 인용', '검토 상태']),
    ...pkg.expense_limit_rules.map((r) => [
      text(str(r.limit_code)), text(str(r.category_code)), text(str(r.limit_name)), text(str(r.limit_type)),
      text(r.limit_value as number), text(str(r.limit_unit)), text(str(r.basis_ko ?? r.basis_code)),
      text(str(r.ui_summary)), text(str(r.over_limit_action)), text(str(r.institution_scope)),
      text(str(r.source_article)), text(quoteOf(r)), text(statusOf(r)),
    ]),
  ];

  const ruleReview: Cell[][] = [
    head(['규칙 코드', '규칙명', '비목', '규칙 구분', '판정 결과', '승인·인정', '요구 증빙', '근거', '시행일', '원문 인용', '검토 상태']),
    ...pkg.regulation_rules.map((r) => {
      const result = (r.result ?? {}) as { status?: string; message?: string };
      return [
        text(str(r.rule_code)), text(str(r.rule_name)), text(str(r.expense_category_code)), text(str(r.rule_type)),
        text(str(result.status)), text(str(r.approval_status)),
        text(((r.required_documents as string[]) ?? []).join(' · ')),
        text(str(r.source_article)), text(str(r.effective_from)), text(quoteOf(r)), text(statusOf(r)),
      ];
    }),
  ];

  return [
    sheetOf('Summary', summary, [26, 90]),
    sheetOf('BudgetTree', budgetTree, [24, 22, 18, 10, 6, 8, 8, 12, 6, 24]),
    sheetOf('BudgetGuides', budgetGuides, [22, 18, 48, 28, 44, 26, 11]),
    sheetOf('AllowedItems', allowedItems, [22, 22, 26, 44, 12, 14, 32, 32, 9, 26, 24, 56, 16]),
    sheetOf('LimitRules', limitRules, [22, 20, 26, 16, 10, 9, 24, 44, 18, 12, 24, 56, 16]),
    sheetOf('RuleReview', ruleReview, [20, 40, 20, 18, 22, 18, 30, 24, 11, 56, 16]),
  ];
};

// 검토본 엑셀 한 개만 내려받는다 (ZIP 안의 Review.xlsx와 같은 내용).
export const exportExtractionReview = async (pkg: RegulationPackage) => {
  const file = writeXlsxFile(buildReviewSheets(pkg));
  await file.toFile(`Review_${safeName(pkg.package_name)}.xlsx`);
};

// 규정DB 패키지를 ZIP으로 내려받는다 — docs/extraction_DB/<폴더>/ 와 같은 구성이라, 받은 그대로
// 폴더에 풀면 make_regulation_review.py · convert-regulation-db.mjs · upload-regulation-db.mjs 를
// 태울 수 있다. 앱에서 신청하는 경로와 별개로, 손으로 검토·보강하고 싶을 때 쓰는 출구다.
export const exportRegulationPackage = async (pkg: RegulationPackage) => {
  const { strToU8, zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const file of packageFiles(pkg)) files[`${pkg.package_name}/${file.name}`] = strToU8(file.content);
  // Review.xlsx는 바이너리라 packageFiles(문자열 목록)에 못 넣는다 — 여기서 구워 같은 폴더에 담는다.
  // README의 파일 목록이 이 파일을 안내하므로 빠지면 목록과 실물이 어긋난다.
  const review = await writeXlsxFile(buildReviewSheets(pkg)).toBlob();
  files[`${pkg.package_name}/Review.xlsx`] = new Uint8Array(await review.arrayBuffer());
  saveAs(new Blob([zipSync(files)], { type: 'application/zip' }), `${safeName(pkg.package_name)}.zip`);
};
