import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { changeLetterValues, comparisonRows } from './officialLetter';
import { requestChange } from './changes';
import type { Project } from './types';

// letterDocx.ts는 브라우저 전용(fetch·saveAs)이라 여기서 직접 부르지 못한다.
// 대신 같은 치환 로직으로 실제 템플릿을 채워, 완성된 .docx가 온전한지(치환자 0, 서식 유지) 확인한다.

const escapeXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (xml: string, values: Record<string, string>) =>
  xml.replace(/\{\{([a-z0-9_]+)\}\}/g, (whole, key: string) =>
    values[key] === undefined ? '' : escapeXml(values[key]).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">'));

const project: Project = {
  id: 'p1', name: '스마트 물류 자동화 시스템 개발', totalBudget: 100_000_000,
  startDate: '2026-07-01', endDate: '2027-06-30', settlementDeadline: '2027-07-30',
  agency: '중소기업기술정보진흥원', companyName: '주식회사 테스트랩', packId: 'nrd2026-forprofit',
  agreementNo: 'S2026-1234', representative: '김대표',
  members: [{ id: 'm1', name: '박연구', email: 'research@testlab.co.kr', role: '담당자' }],
  participants: [], expenses: [], changes: [], emailLogs: [],
  budgets: [{ categoryId: 'DIRECT_LABOR', amount: 60_000_000 }, { categoryId: 'DIRECT_ACTIVITY', amount: 40_000_000 }],
  createdAt: '2026-07-01T00:00:00.000Z',
};

// 실제 생성 순서(표 삽입 → 치환)를 그대로 따라 만든다.
const insertTable = (xml: string, rows: { category: string; before: string; after: string; delta: string; total?: boolean }[]) => {
  const marker = xml.indexOf('{{request_details}}');
  const cut = xml.indexOf('</w:p>', marker) + 6;
  const cells = (r: typeof rows[number]) => `<w:tc><w:p>${r.category}</w:p></w:tc><w:tc><w:p>${r.before}</w:p></w:tc><w:tc><w:p>${r.after}</w:p></w:tc><w:tc><w:p>${r.delta}</w:p></w:tc>`;
  const tbl = `<w:tbl><w:tr><w:tc><w:p>비목</w:p></w:tc></w:tr>${rows.map((r) => `<w:tr>${cells(r)}</w:tr>`).join('')}</w:tbl><w:p></w:p>`;
  return xml.slice(0, cut) + tbl + xml.slice(cut);
};

const buildDocxText = (values: Record<string, string>, rows?: { category: string; before: string; after: string; delta: string; total?: boolean }[]) => {
  const files = unzipSync(new Uint8Array(readFileSync('public/templates/official-letter.docx')));
  let doc = strFromU8(files['word/document.xml']);
  if (rows) doc = insertTable(doc, rows);
  files['word/document.xml'] = strToU8(fill(doc, values));
  // 다시 zip으로 묶었다가 풀어 — 실제 저장/열기 과정을 거쳐도 깨지지 않는지 본다.
  const roundTrip = unzipSync(zipSync(files));
  const xml = strFromU8(roundTrip['word/document.xml']);
  return { xml, text: xml.replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '') };
};

describe('공문 템플릿 채우기', () => {
  const change = requestChange(project, {
    fromCategoryId: 'DIRECT_LABOR', toCategoryId: 'DIRECT_ACTIVITY', amount: 1_000_000,
    reasonKey: 'k', reason: '내부 인력으로 수행하게 되어 인건비 소요가 감소하였음.',
    changeType: 'approval', usagePlan: '계측 자재 구입에 사용할 예정임.',
  }, '2026-09-01T00:00:00.000Z').changes[0];

  it('채운 뒤 남는 치환자가 없다 — 하나라도 남으면 문서에 {{...}}가 찍혀 나간다', () => {
    const { xml } = buildDocxText(changeLetterValues(project, change, '2026-09-01T00:00:00.000Z'));
    expect(xml).not.toMatch(/\{\{[a-z0-9_]+\}\}/);
  });

  it('과제 값이 실제로 문서에 들어간다', () => {
    const { text } = buildDocxText(changeLetterValues(project, change, '2026-09-01T00:00:00.000Z'));
    expect(text).toContain('스마트 물류 자동화 시스템 개발');
    expect(text).toContain('S2026-1234');
    expect(text).toContain('금 1,000,000원(금일백만원정)');
    expect(text).toContain('대표 김대표');
  });

  it('여러 줄 항목(변경 내용)이 문단 줄바꿈으로 들어간다', () => {
    const { xml } = buildDocxText(changeLetterValues(project, change, '2026-09-01T00:00:00.000Z'));
    expect(xml).toContain('<w:br/>');   // 줄바꿈이 살아 있어야 "가. 나. 다."가 한 줄로 붙지 않는다
  });

  it('서식(결재란·표)이 그대로 남는다 — 새로 그리지 않고 템플릿을 채운다', () => {
    const before = strFromU8(unzipSync(new Uint8Array(readFileSync('public/templates/official-letter.docx')))['word/document.xml']);
    const tableCount = (xml: string) => (xml.match(/<w:tbl\b/g) ?? []).length;
    const { xml } = buildDocxText(changeLetterValues(project, change, '2026-09-01T00:00:00.000Z'));
    expect(tableCount(xml)).toBe(tableCount(before));   // 표 개수가 그대로
  });
});
