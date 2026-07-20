// rulespacks/의 JSONL(structured[] 규칙)을 앱이 로드하는 표준 RulePack JSON으로 변환한다.
// 사용법: node scripts/convert-rulepacks.mjs
// 출력: src/rulepacks/packs.json
//
// 원본 JSONL은 진실의 원천으로 보존한다. 이 스크립트는 두 가지를 더한다:
//  1) 편성용 비목 목록 — 예창패는 원본의 expense_category를 그대로 쓰고,
//     R&D 두 편은 사용 기준 조문 체계(직접비 하위 비목 + 간접비)로 이 스크립트에서 정의한다.
//  2) 초안 배분율·집행 증빙 기본값 — 원본에 없는 앱 편의 데이터. 전부 "예시 기준(검증 전)"이다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packsDir = join(root, 'rulespacks');

const readJsonl = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// ---- 집행 증빙 기본값 (예시 기준 — 원본 지침에 집행증빙 목록이 없어 앱이 부여) ----
const DOCS = {
  personnel: ['근로계약서', '급여대장', '계좌이체 확인증', '참여율 확인자료'],
  equipment: ['견적서', '비교견적서', '세금계산서', '검수조서', '계좌이체 확인증'],
  material: ['견적서', '세금계산서', '거래명세서', '검수조서(사진)', '계좌이체 확인증'],
  activity: ['내부품의서', '영수증', '결과보고서'],
  allowance: ['지급기준표', '지급대장', '계좌이체 확인증'],
  outsourcing: ['위탁(용역)계약서', '과업지시서', '세금계산서', '결과보고서'],
  indirect: ['간접비 산출내역서', '내부 결재 문서'],
  fee: ['계약서 또는 신청서', '세금계산서', '계좌이체 확인증'],
  travel: ['내부품의서', '출장보고서', '교통·숙박 영수증'],
  training: ['수료증', '영수증', '계좌이체 확인증'],
  ad: ['광고 계약서 또는 게재 증빙', '세금계산서', '결과물 캡처'],
  ip: ['출원서 또는 등록증', '수수료 영수증'],
};

// ---- R&D 표준 비목 (사용 기준 제2장 비목 체계 기준, draftRate 합계 100) ----
const rndCategories = (orgType, guidelineDoc) => [
  { id: 'personnel', name: '인건비', draftRate: 40, docs: DOCS.personnel, def: '참여연구자 인건비 (인건비계상률에 따라 계상)' },
  { id: 'facility', name: '연구시설·장비비', draftRate: 10, docs: DOCS.equipment, def: '연구 수행에 직접 필요한 시설·장비의 구입·임차 비용' },
  { id: 'material', name: '연구재료비', draftRate: 15, docs: DOCS.material, def: '시약·재료·시제품 제작 등 연구에 직접 소요되는 재료 비용' },
  { id: 'activity', name: '연구활동비', draftRate: 10, docs: DOCS.activity, def: '출장·회의·인쇄·기술정보활동 등 연구 관련 활동 비용' },
  { id: 'allowance', name: '연구수당', draftRate: 5, docs: DOCS.allowance, def: '연구 기여도에 따른 수당 (수정인건비의 20% 이내)' },
  { id: 'outsourcing', name: '위탁연구개발비', draftRate: 10, docs: DOCS.outsourcing, def: '연구 일부를 외부에 위탁하는 비용' },
  { id: 'indirect', name: '간접비', draftRate: 10, docs: DOCS.indirect, def: '기관 공통 지원 비용 (기관별 간접비고시비율 적용)' },
].map((c) => ({
  id: c.id, name: c.name, allowed: true, definition: c.def, draftRate: c.draftRate, requiredDocs: c.docs,
  source: { doc: guidelineDoc, ref: `${orgType} 계상기준 (비목 체계)`, matchLevel: 'guideline', appDefault: true },
}));

// 예창패 비목 draftRate/증빙 매핑 (id는 원본 rule_id 재사용)
const prestartupExtras = {
  cat_material: { draftRate: 20, docs: DOCS.material },
  cat_outsourcing: { draftRate: 15, docs: DOCS.outsourcing },
  cat_equipment: { draftRate: 15, docs: DOCS.equipment },
  cat_ip: { draftRate: 5, docs: DOCS.ip },
  cat_personnel: { draftRate: 15, docs: DOCS.personnel },
  cat_fee: { draftRate: 10, docs: DOCS.fee },
  cat_travel: { draftRate: 5, docs: DOCS.travel },
  cat_training: { draftRate: 5, docs: DOCS.training },
  cat_ad: { draftRate: 10, docs: DOCS.ad },
};

// 규칙 ↔ 비목 연결: item/trigger/message에 비목 이름(또는 별칭)이 나오면 해당 비목에 붙인다.
const CATEGORY_ALIASES = {
  personnel: ['인건비'], facility: ['시설', '장비'], material: ['재료'], activity: ['연구활동', '소프트웨어', '기술도입', '연구실운영'],
  allowance: ['연구수당'], outsourcing: ['위탁', '외주'], indirect: ['간접비', '성과급'],
  cat_material: ['재료'], cat_outsourcing: ['외주', '위탁'], cat_equipment: ['기계장치', '기구', '비품'], cat_ip: ['특허', '무형자산'],
  cat_personnel: ['인건비'], cat_fee: ['수수료'], cat_travel: ['여비', '출장'], cat_training: ['교육'], cat_ad: ['광고', '홍보'],
};

// item(적용 대상)과 trigger(발동 조건)만으로 비목을 연결한다.
// message 전문으로 매칭하면 "인건비·위탁비 상한이 없다" 같은 공통 안내가 비목에 잘못 붙는다.
const linkCategories = (rule, categories) => {
  const text = [rule.item, rule.trigger].filter(Boolean).join(' ');
  if (!text) return undefined;
  const ids = categories.filter((c) => (CATEGORY_ALIASES[c.id] ?? [c.name]).some((alias) => text.includes(alias))).map((c) => c.id);
  return ids.length ? ids : undefined;
};

const normalizeRule = (s, record) => ({
  id: s.rule_id,
  kind: s.kind === 'ratio_rule' ? 'ratio' : s.kind, // warning | info | evidence 는 그대로
  quote: (record.content ?? '').trim() || undefined, // 원문 문장 — 팝업 미리보기 하이라이트에 사용
  item: s.item ?? undefined,
  message: s.message ?? s.definition ?? s.note ?? s.item ?? '',
  limitPct: s.limit_pct ?? undefined,
  basis: s.basis ?? undefined,
  formula: s.formula ?? undefined,
  trigger: s.trigger ?? undefined,
  severity: s.severity ?? undefined,
  appliesScope: s.applies_scope ?? undefined,
  requiredDocs: s.required_docs ?? undefined,
  condition: s.condition ?? undefined,
  required: s.required ?? undefined,
  submitTiming: s.submit_timing ?? record.submit_timing ?? undefined,
  note: s.note ?? undefined,
  source: {
    doc: record.source_doc ?? record.title ?? '',
    ref: s.source_ref ?? s.evidence_ref ?? record.article_ref ?? '',
    matchLevel: record.matchLevel ?? 'guideline',
  },
});

const convertRnd = (dirName, packId, packName, orgType, chunkFile, extraRecords = []) => {
  const records = [...readJsonl(join(packsDir, dirName, chunkFile)), ...extraRecords];
  const guidelineDoc = '국가연구개발사업 연구개발비 사용 기준(개정안)';
  const categories = rndCategories(orgType, guidelineDoc);
  const rules = [];
  const seen = new Set();
  for (const record of records) {
    for (const s of record.structured ?? []) {
      if (s.kind === 'expense_category') continue; // R&D 청크에는 없음(방어)
      if (seen.has(s.rule_id)) continue;
      seen.add(s.rule_id);
      const rule = normalizeRule(s, { ...record, source_doc: guidelineDoc });
      rule.categoryIds = linkCategories(rule, categories);
      rules.push(rule);
    }
  }
  return {
    id: packId, name: packName, orgType,
    guideline: guidelineDoc,
    agency: '과학기술정보통신부 (국가연구개발혁신법)',
    hasRatioLimits: true,
    verified: false,
    referenceUrl: 'https://www.law.go.kr', // 국가법령정보센터 — "국가연구개발사업 연구개발비 사용 기준" 검색
    categories, rules, applicationDocs: [],
  };
};

const convertPrestartup = () => {
  const dir = join(packsDir, '예창패');
  const noticeRecords = readJsonl(join(dir, 'notice_rules.jsonl'));
  const evidenceRecords = readJsonl(join(dir, 'evidence_docs.jsonl'));
  const categories = [];
  const rules = [];
  for (const record of noticeRecords) {
    for (const s of record.structured ?? []) {
      if (s.kind === 'expense_category') {
        const extra = prestartupExtras[s.rule_id] ?? { draftRate: 0, docs: [] };
        categories.push({
          id: s.rule_id, name: s.item, allowed: s.allowed !== false, definition: s.definition,
          draftRate: extra.draftRate, requiredDocs: extra.docs,
          source: { doc: record.source_doc, ref: s.evidence_ref ?? '', matchLevel: record.matchLevel ?? 'notice' },
        });
      } else {
        rules.push(normalizeRule(s, record));
      }
    }
  }
  for (const rule of rules) rule.categoryIds = linkCategories(rule, categories);
  const applicationDocs = [];
  for (const record of evidenceRecords) {
    for (const s of record.structured ?? []) applicationDocs.push(normalizeRule(s, record));
  }
  return {
    id: 'prestartup', name: '예비창업패키지', orgType: '예비창업자',
    guideline: '중소기업창업 지원사업 통합관리지침(제14차)',
    agency: '중소벤처기업부 (2026 예비창업패키지 모집공고 2026-207호)',
    hasRatioLimits: false,
    verified: false,
    referenceUrl: 'https://www.k-startup.go.kr', // K-스타트업 — 공고 원문·QnA 확인
    categories, rules, applicationDocs,
  };
};

// 공통 조문(연구수당·위탁비 등, org_type '공통')은 정부출연기관 청크에만 수록되어 있다 — 영리기관 팩에도 포함시킨다.
const commonRecords = readJsonl(join(packsDir, '정부출연기관', 'rd_cost_chunks_govt.jsonl')).filter((record) => record.org_type === '공통');

const packs = [
  convertPrestartup(),
  convertRnd('영리기관', 'rnd-forprofit', 'R&D (영리기관)', '영리기관', 'rd_cost_chunks_forprofit.jsonl', commonRecords),
  convertRnd('정부출연기관', 'rnd-govt', 'R&D (정부출연기관)', '정부출연기관', 'rd_cost_chunks_govt.jsonl'),
];

// 검증: 초안 배분 합계 100
for (const pack of packs) {
  const sum = pack.categories.reduce((total, c) => total + c.draftRate, 0);
  if (sum !== 100) throw new Error(`${pack.id}: draftRate 합계 ${sum} (100이어야 함)`);
}

const outDir = join(root, 'src', 'rulepacks');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'packs.json'), JSON.stringify(packs, null, 2), 'utf8');
console.log(`OK: ${packs.map((p) => `${p.id}(비목 ${p.categories.length}, 규칙 ${p.rules.length}, 신청서류 ${p.applicationDocs.length})`).join(', ')}`);
