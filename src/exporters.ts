import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { saveAs } from 'file-saver';
import writeXlsxFile from 'write-excel-file/browser';
import { capFor, categoryOf, formatWon, packFor } from './rules';
import type { BudgetChange, Project } from './types';

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_');
type BudgetExportRow = { category: string; amount: number; rate: number; limit: string; status: string };

export const exportBudgetXlsx = async (project: Project) => {
  const pack = packFor(project);
  const rows: BudgetExportRow[] = project.budgets.map((budget) => {
    const category = categoryOf(pack, budget.categoryId);
    const cap = capFor(pack, project.budgets, project.totalBudget, budget.categoryId);
    return {
      category: category.name, amount: budget.amount,
      rate: project.totalBudget ? budget.amount / project.totalBudget : 0,
      limit: cap ? cap.label : '제한 없음',
      status: cap?.amount != null && budget.amount > cap.amount ? '초과' : '정상',
    };
  });
  rows.push({ category: '합계', amount: project.budgets.reduce((sum, item) => sum + item.amount, 0), rate: 1, limit: '', status: '' });
  const file = writeXlsxFile(rows, {
    columns: [
      { header: '비목', cell: (row: BudgetExportRow) => row.category, width: 22 },
      { header: '편성금액', cell: (row: BudgetExportRow) => ({ value: row.amount, type: Number, format: '#,##0"원"' }), width: 18 },
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
