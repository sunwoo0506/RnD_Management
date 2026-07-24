// 협약변경 공문 샘플(.docx) 생성 — 검토용
//
// docs/공문템플릿_협약변경.md 의 문안을 실제 Word 파일로 뽑아 눈으로 확인하기 위한 스크립트다.
// 문안이 확정되면 이 레이아웃을 src/exporters.ts 로 옮겨 앱에서 바로 내려받게 한다.
//
//   node scripts/make-official-letter-sample.mjs
//
// 결과: docs/samples/협약변경_승인요청_샘플.docx, docs/samples/협약변경_통보_샘플.docx

import { mkdirSync, writeFileSync } from 'node:fs';
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

// 공문은 본문 글자가 크고 줄 간격이 넓다 — 결재란에 손글씨가 들어가고 출력해서 읽기 때문이다.
const FONT = '맑은 고딕';
const BODY = 22;      // half-point (11pt)
const TITLE = 32;     // 16pt

const text = (value, opts = {}) => new TextRun({ text: value, font: FONT, size: opts.size ?? BODY, bold: opts.bold });
const line = (value = '', opts = {}) => new Paragraph({
  children: Array.isArray(value) ? value : [text(value, opts)],
  alignment: opts.align,
  spacing: { line: opts.line ?? 320, before: opts.before ?? 0, after: opts.after ?? 0 },
  indent: opts.indent,
});
const blank = () => line('');

// 수신·참조·제목은 라벨 폭을 맞춰야 읽기 쉽다 (공문 관행: 두 글자를 벌려 씀).
const header = (label, value) => line(`${label}: ${value}`, { line: 300 });

const cell = (value, { bold = false, align = AlignmentType.RIGHT, shade } = {}) => new TableCell({
  children: [new Paragraph({ children: [text(value, { bold })], alignment: align, spacing: { line: 260 } })],
  shading: shade ? { fill: shade } : undefined,
  margins: { top: 60, bottom: 60, left: 120, right: 120 },
});

// 변경 전·후 대비표 — 금액이 바뀐 비목만. 감액은 △로 적는다.
const comparisonTable = () => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 6 }, bottom: { style: BorderStyle.SINGLE, size: 6 },
    left: { style: BorderStyle.SINGLE, size: 6 }, right: { style: BorderStyle.SINGLE, size: 6 },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4 }, insideVertical: { style: BorderStyle.SINGLE, size: 4 },
  },
  rows: [
    new TableRow({
      children: [
        cell('비목', { bold: true, align: AlignmentType.CENTER, shade: 'F2F2F2' }),
        cell('변경 전', { bold: true, align: AlignmentType.CENTER, shade: 'F2F2F2' }),
        cell('변경 후', { bold: true, align: AlignmentType.CENTER, shade: 'F2F2F2' }),
        cell('증감', { bold: true, align: AlignmentType.CENTER, shade: 'F2F2F2' }),
      ],
      tableHeader: true,
    }),
    new TableRow({ children: [cell('인건비', { align: AlignmentType.LEFT }), cell('60,000,000원'), cell('59,000,000원'), cell('△1,000,000원')] }),
    new TableRow({ children: [cell('연구재료비', { align: AlignmentType.LEFT }), cell('20,000,000원'), cell('21,000,000원'), cell('1,000,000원')] }),
    new TableRow({
      children: [
        cell('합계', { bold: true, align: AlignmentType.CENTER, shade: 'FAFAFA' }),
        cell('100,000,000원', { bold: true, shade: 'FAFAFA' }),
        cell('100,000,000원', { bold: true, shade: 'FAFAFA' }),
        cell('0원', { bold: true, shade: 'FAFAFA' }),
      ],
    }),
  ],
});

// 샘플에 넣을 예시 값 — 실제로는 과제·변경 신청에서 채워진다.
const SAMPLE = {
  문서번호: '테스트랩-2026-014',
  작성일: '2026. 7. 24.',
  수신기관: '중소기업기술정보진흥원',
  참조부서: '사업비관리팀',
  과제명: '스마트 물류 자동화 시스템 개발',
  협약번호: 'S2026-1234',
  연구기간: '2026. 7. 1. ~ 2027. 6. 30.',
  보내는비목: '인건비',
  받는비목: '연구재료비',
  이동금액한글: '금 1,000,000원(금일백만원정)',
  총사업비변동: '변동 없음',
  변경사유:
    '당초 계획한 제어 알고리즘 검증을 내부 인력으로 수행하기로 하여 인건비 소요가 당초 대비 감소하였음. '
    + '반면 시제품 성능 검증 과정에서 추가 계측 자재가 필요해져 연구재료비 소요가 증가하였음. '
    + '이에 인건비 1,000,000원을 연구재료비로 조정하고자 하며, 총사업비 변동은 없음. '
    + '본 변경은 당초 연구개발 목표 및 수행 범위에 영향을 주지 아니함.',
  사용계획: '조정된 연구재료비는 시제품 성능 검증용 계측 자재 구입에 사용할 예정임.',
  발신기관: '주식회사 테스트랩',
  대표자명: '김대표',
  담당자: '박연구',
  연락처: '02-1234-5678 / research@testlab.co.kr',
};

const buildLetter = (kind) => {
  const approval = kind === 'approval';
  const S = SAMPLE;
  const children = [
    header('문서번호', S.문서번호),
    header('시행일자', S.작성일),
    blank(),
    header('수    신', `${S.수신기관}장`),
    header('참    조', S.참조부서),
    header('제    목', `「${S.과제명}」 사업비 비목 간 변경 ${approval ? '승인 요청' : '통보'}`),
    blank(),
    line('1. 귀 기관의 무궁한 발전을 기원합니다.'),
    blank(),
    line(`2. 당사가 수행 중인 「${S.과제명}」(협약번호: ${S.협약번호}, 연구기간: ${S.연구기간}) 과제와 관련하여, `
      + `연구 수행 과정에서 발생한 사정으로 사업비 비목 간 변경이 ${approval ? '필요하여 아래와 같이 승인을 요청드립니다.' : '있어 아래와 같이 통보드립니다.'}`),
    blank(),
    line('- 다  음 -', { align: AlignmentType.CENTER, bold: true }),
    blank(),
    line('가. 변경 개요'),
    line(`○ 변경 구분: 사업비 비목 간 변경 (${approval ? '승인' : '통보'} 사항)`, { indent: { left: 400 } }),
    line(`○ 변경 금액: ${S.보내는비목} → ${S.받는비목}  ${S.이동금액한글}`, { indent: { left: 400 } }),
    line(`○ 총사업비 변동 여부: ${S.총사업비변동}`, { indent: { left: 400 } }),
    blank(),
    line('나. 변경 전·후 대비'),
    blank(),
    comparisonTable(),
    blank(),
    line('다. 변경 사유'),
    line(S.변경사유, { indent: { left: 400 } }),
    blank(),
  ];

  // 사용계획은 승인 요청에만 넣는다 — 통보는 이미 정해진 것을 알리는 문서다.
  if (approval) {
    children.push(line('라. 변경 후 사용계획'), line(S.사용계획, { indent: { left: 400 } }), blank());
  }

  children.push(
    line(approval ? '3. 상기 변경사항에 대하여 검토 후 승인하여 주시기 바랍니다.' : '3. 상기 변경사항을 통보하오니 참고하여 주시기 바랍니다.'),
    blank(),
    // 붙임은 마지막 항목 뒤에 "끝."을 붙인다 (행정문서 규칙)
    ...(approval
      ? [line('붙임  1. 사업비 변경 신청서 1부.'),
         line('      2. 사업비 변경 전·후 대비표 1부.'),
         line('      3. 변경 반영 사업계획서 1부.  끝.')]
      : [line('붙임  1. 사업비 변경 전·후 대비표 1부.'),
         line('      2. 변경 반영 사업계획서 1부.  끝.')]),
    blank(), blank(),
    line(`${S.발신기관}  대표  ${S.대표자명}  (직인)`, { align: AlignmentType.CENTER, bold: true, size: 26 }),
    blank(), blank(),
    line(`담당자: ${S.담당자}    연락처: ${S.연락처}`, { size: 20 }),
  );

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },  // 2cm
      children: [
        line(`사업비 변경 ${approval ? '승인 요청' : '통보'}`, { align: AlignmentType.CENTER, bold: true, size: TITLE, after: 240 }),
        ...children,
      ],
    }],
  });
};

const outDir = new URL('../docs/samples/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [kind, name] of [['approval', '협약변경_승인요청_샘플'], ['notification', '협약변경_통보_샘플']]) {
  const blob = await Packer.toBuffer(buildLetter(kind));
  writeFileSync(new URL(`${name}.docx`, outDir), blob);
  console.log(`만듦: docs/samples/${name}.docx`);
}
