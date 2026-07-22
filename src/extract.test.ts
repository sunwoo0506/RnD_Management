import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { collectHwpSectionText, collectHwpxSectionContent, collectHwpxSectionText, collectHwpxTable, decodeHwpParagraphText, detectPdfTableRuns, extractDocumentText, groupPdfItemsIntoRows, parseHwpxCell, renderPdfPageText, restoreOverlaidPunctuation, rowToColumns } from './extract';

// UTF-16LE 문자열 + 컨트롤 문자로 PARA_TEXT 페이로드를 만든다.
const paraBytes = (codes: number[]): Uint8Array => {
  const bytes = new Uint8Array(codes.length * 2);
  const view = new DataView(bytes.buffer);
  codes.forEach((code, i) => view.setUint16(i * 2, code, true));
  return bytes;
};

const codesOf = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

describe('HWP PARA_TEXT 디코딩', () => {
  it('일반 텍스트는 그대로, 문단 끝(13)은 줄바꿈으로 디코딩한다', () => {
    const bytes = paraBytes([...codesOf('예비창업패키지'), 13, ...codesOf('모집공고')]);
    expect(decodeHwpParagraphText(bytes)).toBe('예비창업패키지\n모집공고');
  });

  it('확장 컨트롤(8워드)은 통째로 건너뛴다 — 표(11) 안의 더미 7워드가 텍스트로 새지 않는다', () => {
    // 11(그리기 개체/표) + 더미 7워드 + 실제 텍스트
    const bytes = paraBytes([11, 1, 2, 3, 4, 5, 6, 7, ...codesOf('사업비')]);
    expect(decodeHwpParagraphText(bytes)).toBe('사업비');
  });

  it('탭(9)은 탭 문자로 남기고 7워드를 건너뛴다', () => {
    const bytes = paraBytes([...codesOf('비목'), 9, 0, 0, 0, 0, 0, 0, 0, ...codesOf('재료비')]);
    expect(decodeHwpParagraphText(bytes)).toBe('비목\t재료비');
  });
});

describe('HWP 레코드 워커', () => {
  const record = (tag: number, payload: Uint8Array): Uint8Array => {
    const header = new Uint8Array(4 + payload.byteLength);
    new DataView(header.buffer).setUint32(0, (payload.byteLength << 20) | tag, true);
    header.set(payload, 4);
    return header;
  };
  const concat = (...arrays: Uint8Array[]) => {
    const total = arrays.reduce((sum, a) => sum + a.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.byteLength; }
    return out;
  };

  it('PARA_TEXT(67) 레코드만 모으고 다른 태그는 무시한다', () => {
    const section = concat(
      record(66, paraBytes(codesOf('헤더데이터'))),      // PARA_HEADER — 무시
      record(67, paraBytes(codesOf('공고 본문'))),
      record(68, paraBytes(codesOf('문자모양'))),         // 무시
      record(67, paraBytes(codesOf('둘째 문단'))),
    );
    expect(collectHwpSectionText(section)).toBe('공고 본문\n둘째 문단');
  });

  it('깨진 레코드(스트림 밖을 가리킴)는 예외를 던진다', () => {
    const broken = new Uint8Array(4);
    new DataView(broken.buffer).setUint32(0, (100 << 20) | 67, true); // size 100인데 본문 없음
    expect(() => collectHwpSectionText(broken)).toThrow();
  });
});

describe('HWPX 섹션 XML 텍스트 추출', () => {
  it('문단별 hp:t 텍스트를 모으고 엔티티를 복원한다', () => {
    const xml = `<hs:sec xmlns:hp="x">
      <hp:p id="1"><hp:run><hp:t>2026년 예비창업패키지</hp:t></hp:run><hp:run><hp:t> 모집공고</hp:t></hp:run></hp:p>
      <hp:p id="2"><hp:run><hp:t>사업비 상한은 40% &lt;예시&gt; &amp; 안내</hp:t></hp:run></hp:p>
    </hs:sec>`;
    expect(collectHwpxSectionText(xml)).toBe('2026년 예비창업패키지 모집공고\n사업비 상한은 40% <예시> & 안내');
  });

  it('collectHwpxSectionText는 표 태그를 특수 취급하지 않고 안의 텍스트만 모은다 (구조 보존은 collectHwpxSectionContent 담당)', () => {
    const xml = `<hp:p a="1"><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>비목</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl><hp:run><hp:t>재료비</hp:t></hp:run></hp:p>`;
    const text = collectHwpxSectionText(xml);
    expect(text).toContain('비목');
    expect(text).toContain('재료비');
  });
});

describe('HWPX 셀 파싱', () => {
  it('cellAddr·cellSpan 속성과 텍스트를 읽는다', () => {
    const cellXml = `<hp:tc name="A" header="0">
      <hp:cellAddr colAddr="1" rowAddr="0"/>
      <hp:cellSpan colSpan="3" rowSpan="1"/>
      <hp:subList><hp:p><hp:run><hp:t>기관부담연구개발비</hp:t></hp:run></hp:p></hp:subList>
    </hp:tc>`;
    expect(parseHwpxCell(cellXml)).toEqual({
      rowAddr: 0, colAddr: 1, rowSpan: 1, colSpan: 3, text: '기관부담연구개발비',
    });
  });

  it('cellAddr·cellSpan이 없으면 0행0열·병합없음으로 취급한다', () => {
    const cellXml = `<hp:tc><hp:subList><hp:p><hp:run><hp:t>단순셀</hp:t></hp:run></hp:p></hp:subList></hp:tc>`;
    expect(parseHwpxCell(cellXml)).toEqual({ rowAddr: 0, colAddr: 0, rowSpan: 1, colSpan: 1, text: '단순셀' });
  });

  it('셀 안에 문단이 여러 개면 공백으로 이어붙인다 (표 셀 안에 줄바꿈을 넣지 않음)', () => {
    const cellXml = `<hp:tc><hp:subList><hp:p><hp:run><hp:t>1줄</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>2줄</hp:t></hp:run></hp:p></hp:subList></hp:tc>`;
    expect(parseHwpxCell(cellXml).text).toBe('1줄 2줄');
  });
});

describe('HWPX 표 블록 → 마크다운', () => {
  it('행·열을 순서대로 읽어 마크다운 표로 만든다', () => {
    const tblXml = `<hp:tbl rowCnt="2" colCnt="2">
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>금액</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>1차년도</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>66,500</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
    </hp:tbl>`;
    expect(collectHwpxTable(tblXml)).toBe(
      '| 구분 | 금액 |\n| --- | --- |\n| 1차년도 | 66,500 |'
    );
  });

  it('가로 병합 헤더가 있어도 값이 모든 열에 복제되어 나온다', () => {
    const tblXml = `<hp:tbl>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="3"/><hp:subList><hp:p><hp:run><hp:t>기관부담연구개발비</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>현금</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>현물</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="2"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>합계</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
    </hp:tbl>`;
    const md = collectHwpxTable(tblXml);
    expect(md).toContain('| 기관부담연구개발비 | 기관부담연구개발비 | 기관부담연구개발비 |');
    expect(md).toContain('| 현금 | 현물 | 합계 |');
  });
});

describe('HWPX 섹션 — 표와 본문을 문서 순서대로', () => {
  it('표 앞뒤 일반 문단과 표를 순서대로 이어붙인다', () => {
    const xml = `<hs:sec xmlns:hp="x">
      <hp:p><hp:run><hp:t>아래 표를 참고하세요.</hp:t></hp:run></hp:p>
      <hp:tbl>
        <hp:tr><hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>
      </hp:tbl>
      <hp:p><hp:run><hp:t>표 끝.</hp:t></hp:run></hp:p>
    </hs:sec>`;
    const result = collectHwpxSectionContent(xml);
    const lines = result.split('\n');
    expect(lines[0]).toBe('아래 표를 참고하세요.');
    expect(result).toContain('| 구분 |');
    expect(result.trim().endsWith('표 끝.')).toBe(true);
  });

  it('표가 없는 섹션은 기존 collectHwpxSectionText와 동일하게 동작한다', () => {
    const xml = `<hp:p><hp:run><hp:t>표 없는 문서</hp:t></hp:run></hp:p>`;
    expect(collectHwpxSectionContent(xml)).toBe(collectHwpxSectionText(xml));
  });

  it('표 하나의 구조 파싱이 실패해도(예: 잘못된 좌표) 그 표만 구조 없이 폴백하고 문서 전체는 실패하지 않는다', () => {
    const xml = `<hp:p><hp:run><hp:t>앞 문단</hp:t></hp:run></hp:p><hp:tbl><hp:tr><hp:tc><hp:cellAddr rowAddr="-5" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>깨진표셀</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl><hp:p><hp:run><hp:t>뒤 문단</hp:t></hp:run></hp:p>`;
    expect(() => collectHwpxSectionContent(xml)).not.toThrow();
    expect(collectHwpxSectionContent(xml)).toContain('앞 문단');
    expect(collectHwpxSectionContent(xml)).toContain('뒤 문단');
  });
});

describe('extractDocumentText — 실제 HWPX zip으로 전체 배선 확인 (end-to-end)', () => {
  it('실제 zip 파일을 만들어 extractDocumentText를 호출하면 표가 마크다운으로 나온다', async () => {
    const sectionXml = `<hs:sec xmlns:hp="x"><hp:tbl>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="0" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>금액</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
      <hp:tr>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="0"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>1차년도</hp:t></hp:run></hp:p></hp:subList></hp:tc>
        <hp:tc><hp:cellAddr rowAddr="1" colAddr="1"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:subList><hp:p><hp:run><hp:t>66500</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      </hp:tr>
    </hp:tbl></hs:sec>`;
    const zipped = zipSync({ 'Contents/section0.xml': strToU8(sectionXml) });
    const file = new File([zipped], 'test.hwpx');
    const result = await extractDocumentText(file);
    expect(result.method).toBe('hwpx');
    expect(result.text).toContain('| 구분 | 금액 |');
  });
});

describe('PDF 텍스트 조각 → 행 묶기', () => {
  it('y좌표가 비슷한 조각을 같은 행으로 묶고, 행은 위에서 아래로 정렬한다', () => {
    const items = [
      { str: '금액', x: 100, y: 700, width: 20 },
      { str: '구분', x: 0, y: 700, width: 20 },
      { str: '1차년도', x: 0, y: 680, width: 30 },
    ];
    const rows = groupPdfItemsIntoRows(items);
    expect(rows.length).toBe(2);
    expect(rows[0].map((i) => i.str)).toEqual(['구분', '금액']);
    expect(rows[1].map((i) => i.str)).toEqual(['1차년도']);
  });

  it('y좌표 오차 3 이내는 같은 행으로 취급한다', () => {
    const items = [
      { str: 'a', x: 0, y: 700, width: 10 },
      { str: 'b', x: 20, y: 701.5, width: 10 },
    ];
    expect(groupPdfItemsIntoRows(items).length).toBe(1);
  });
});

describe('PDF 행 → 열 나누기', () => {
  it('조각 사이 간격이 넓으면 다른 열로 나눈다', () => {
    const row = [
      { str: '1차년도', x: 0, y: 0, width: 40 },
      { str: '66,500', x: 120, y: 0, width: 30 },
      { str: '2,250', x: 200, y: 0, width: 25 },
    ];
    expect(rowToColumns(row)).toEqual(['1차년도', '66,500', '2,250']);
  });

  it('간격이 좁으면 같은 열(한 단어)로 합친다', () => {
    const row = [
      { str: '정부', x: 0, y: 0, width: 20 },
      { str: '지원금', x: 20, y: 0, width: 30 },
    ];
    expect(rowToColumns(row)).toEqual(['정부지원금']);
  });
});

// 한글에서 내보낸 PDF는 본문을 부호 없이 한 조각으로 그리고 괄호·쉼표를 그 위에 덧그린다.
// 실제로 통합관리지침 표-10의 증빙서류 칸이 이 때문에 통째로 읽을 수 없는 줄이 됐었다.
describe('PDF 덧그린 문장부호 되돌리기', () => {
  // 통합관리지침 제14차 17쪽 실제 좌표 — 본문 조각 하나에 부호 셋이 얹혀 있다.
  const row = [
    { str: '세금계산서 신용카드 영수증', x: 154.2, y: 353, width: 143.1 },
    { str: '(', x: 209.2, y: 353, width: 5.5 },
    { str: '),', x: 297.3, y: 353, width: 8.7 },
    { str: '견적서', x: 311.4, y: 353, width: 33.0 },
    { str: ',', x: 344.4, y: 353, width: 3.2 },
  ];

  it('본문 위에 겹친 여는 괄호를 덮인 공백 자리로 되돌린다', () => {
    // 되돌리기 전에는 "세금계산서 신용카드 영수증( ),"처럼 부호가 줄 끝으로 밀렸다.
    expect(restoreOverlaidPunctuation(row)[0].str).toBe('세금계산서(신용카드 영수증');
  });

  it('열로 이어 붙여도 부호가 제자리에 남는다', () => {
    // 조각 사이 공백은 예전부터 열을 합치면서 사라진다 (인용 대조는 공백을 무시하므로 무해하다).
    expect(rowToColumns(restoreOverlaidPunctuation(row))).toEqual(['세금계산서(신용카드 영수증),견적서,']);
  });

  it('x 좌표와 폭은 그대로 둬 열 나누기가 흔들리지 않는다', () => {
    const [first] = restoreOverlaidPunctuation(row);
    expect([first.x, first.width]).toEqual([154.2, 143.1]);
  });

  it('제 자리를 가진 부호 칸은 앞 칸에 붙이지 않는다', () => {
    // 표의 '-' 칸을 부호로 보고 합치면 열이 하나 사라진다
    const table = [
      { str: '1차년도', x: 0, y: 0, width: 40 },
      { str: '66,500', x: 120, y: 0, width: 30 },
      { str: '-', x: 200, y: 0, width: 5 },
    ];
    expect(rowToColumns(restoreOverlaidPunctuation(table))).toEqual(['1차년도', '66,500', '-']);
  });

  it('부호를 덧그리지 않는 PDF는 조각을 그대로 둔다', () => {
    const plain = [
      { str: '견적서', x: 0, y: 0, width: 30 },
      { str: ',', x: 30, y: 0, width: 3 },
      { str: '계약서', x: 40, y: 0, width: 30 },
    ];
    expect(restoreOverlaidPunctuation(plain).map((item) => item.str)).toEqual(['견적서', ',', '계약서']);
  });
});

describe('PDF 표 영역 감지', () => {
  it('열 개수가 3개 이상이고 3행 이상 이어지면 표로 판단한다', () => {
    const rowsAsColumns = [
      ['구분', '금액', '비고'],
      ['1차년도', '66,500', ''],
      ['2차년도', '133,500', ''],
      ['합계', '200,000', ''],
    ];
    expect(detectPdfTableRuns(rowsAsColumns)).toEqual([{ start: 0, end: 3 }]);
  });

  it('열이 2개 이하로 흐르는 일반 문단은 표로 판단하지 않는다', () => {
    const rowsAsColumns = [['이 사업은 다음과 같이 지원합니다.'], ['자세한 내용은 붙임을 참고하세요.']];
    expect(detectPdfTableRuns(rowsAsColumns)).toEqual([]);
  });

  // 알려진 한계(설계 문서 "리스크 / 알려진 한계" 참고): 열 개수만으로 판단하므로 번호·기호가
  // 일정한 간격으로 나열된 목록도 열이 3개로 갈라지면 표로 오판할 수 있다. 여기서는 그 동작을
  // "버그"로 취급해 고치는 대신, 회귀 방지를 위해 현재 동작을 명시적으로 고정해둔다.
  it('번호 매긴 목록(1. 가. 나.)처럼 표처럼 보이는 일반 문단은 현재 알고리즘 한계상 표로 오판된다 (알려진 한계, 회귀 고정용)', () => {
    const rowsAsColumns = [
      ['1.', '가.', '연구개발계획서를 작성한다'],
      ['2.', '나.', '예산 편성 근거를 첨부한다'],
      ['3.', '다.', '참여 인력 현황을 제출한다'],
    ];
    expect(detectPdfTableRuns(rowsAsColumns)).toEqual([{ start: 0, end: 2 }]);
  });

  // 서명란처럼 열이 많이 갈라져도(성명/값/직위/값/날짜/값 = 6열) 반복 행이 3행 미만이면
  // "3행 이상 이어짐" 조건에서 걸러져 표로 판단하지 않는다 — 행 수 조건이 만드는 안전장치.
  it('서명란처럼 열이 많아도 반복이 3행 미만이면 표로 판단하지 않는다', () => {
    const rowsAsColumns = [
      ['성명', '홍길동', '직위', '팀장', '날짜', '2026-07-20'],
      ['성명', '김철수', '직위', '연구원', '날짜', '2026-07-20'],
    ];
    expect(detectPdfTableRuns(rowsAsColumns)).toEqual([]);
  });
});

describe('PDF 페이지 렌더링 (표 + 일반 문단 혼합)', () => {
  it('표 영역은 마크다운 표로, 표 앞뒤 문단은 공백으로 이어붙인 기존 방식으로 낸다', () => {
    const items = [
      { str: '아래', x: 0, y: 800, width: 20 },
      { str: '표를', x: 25, y: 800, width: 20 },
      { str: '참고', x: 50, y: 800, width: 20 },

      { str: '구분', x: 0, y: 700, width: 20 },
      { str: '금액', x: 100, y: 700, width: 20 },
      { str: '비고', x: 200, y: 700, width: 20 },

      { str: '1차년도', x: 0, y: 680, width: 30 },
      { str: '66,500', x: 100, y: 680, width: 30 },
      { str: '-', x: 200, y: 680, width: 5 },

      { str: '2차년도', x: 0, y: 660, width: 30 },
      { str: '133,500', x: 100, y: 660, width: 30 },
      { str: '-', x: 200, y: 660, width: 5 },
    ];
    const text = renderPdfPageText(items);
    expect(text.split('\n')[0]).toBe('아래 표를 참고');
    expect(text).toContain('| 구분 | 금액 | 비고 |');
    expect(text).toContain('| 1차년도 | 66,500 | - |');
  });

  it('한 행짜리 페이지는 기존과 동일하게 공백으로 이어붙인 한 줄을 낸다', () => {
    const items = [
      { str: '일반', x: 0, y: 800, width: 20 },
      { str: '문서', x: 25, y: 800, width: 20 },
    ];
    expect(renderPdfPageText(items)).toBe('일반 문서');
  });

  it('표가 없는 여러 줄짜리 페이지는 줄바꿈을 보존한다 (기존엔 페이지 전체가 한 줄로 뭉개졌음 — 의도된 개선)', () => {
    const items = [
      { str: '첫째', x: 0, y: 800, width: 20 },
      { str: '줄입니다', x: 25, y: 800, width: 40 },
      { str: '둘째', x: 0, y: 780, width: 20 },
      { str: '줄입니다', x: 25, y: 780, width: 40 },
    ];
    expect(renderPdfPageText(items)).toBe('첫째 줄입니다\n둘째 줄입니다');
  });
});
