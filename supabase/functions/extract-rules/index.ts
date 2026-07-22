// 과제온 규정 추출 Edge Function
// 업로드된 공고문·지침 텍스트에서 사업비 집행 규정(비목·상한·금지·재원)을 구조화 추출한다.
// - 로그인 사용자만 호출 가능
// - 같은 문서는 해시 캐시로 LLM 재호출 생략
// - 모든 항목에 원문 인용(quote) 필수 — 인용 없는 값은 스키마상 생성 불가 (환각 방지 1차)
//   클라이언트가 인용을 원문과 대조 검증하고(2차), 사용자가 승인해야 적용된다(3차).
//
// 배포: Supabase 대시보드 → Edge Functions → Deploy new function → 이름 extract-rules → 이 코드 붙여넣기
// 시크릿: Edge Functions → Secrets 에 OPENAI_API_KEY 추가 (SUPABASE_* 는 자동 제공)
// 모델: gpt-5.6-sol (OpenAI Responses API, 구조화 출력 strict 모드)

import OpenAI from 'npm:openai';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// OpenAI 구조화 출력(strict) 권장 방식: anyOf가 아니라 type 배열로 nullable을 표현한다.
const nullable = (type: string) => ({ type: [type, 'null'] });

// ref는 화면에서 "근거 링크"로 쓰이고, 클릭하면 원문 문서의 그 위치를 찾아 하이라이트한다.
// 목차 경로를 통째로 받으면 링크가 길어 본문을 덮고 원문 검색에도 쓸 수 없어서, 조·항·호 번호를 우선한다.
const REF_DESCRIPTION = '근거 위치. 문서에 조·항·호·목 번호가 있으면 그 번호만 그대로 쓴다 (예: "제65조 제7항", "지침 11.다.1)", "Ⅲ-2-나"). 번호가 없으면 표 제목이나 소제목을 20자 이내로 짧게 쓴다 (예: "사업비 구성표", "QnA 사업비 4번"). 목차 경로 전체를 이어붙이지 말 것 (나쁜 예: "붙임2-5 1. 세부 지원내용 - 주요 연구개발비 산정기준"). 지금 추출 중인 문서가 아니라 그 문서가 인용한 다른 규정(통합관리지침·운영요령·세부관리기준 등)의 조문을 가리킬 때는 조문 번호 앞에 그 규정 이름을 반드시 붙인다 (예: "통합관리지침 제36조 <표-10>", "세부관리기준 제21조제2항"). 번호만 쓰면 다른 규정의 같은 번호 조문이 근거로 잘못 붙는다.';

// 추출 스키마 — 모든 항목에 quote(원문 인용)와 ref(문서 내 위치)가 필수다.
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['programName', 'year', 'programType', 'categories', 'allowedItems', 'articles', 'rules', 'referencedRegulations', 'fundingSchedule', 'uncertain'],
  properties: {
    programName: { type: 'string', description: '사업명 (문서에 명시된 그대로)' },
    year: { type: ['integer', 'null'], description: '사업 연도' },
    programType: { type: 'string', enum: ['startup', 'rnd', 'other', 'unknown'], description: 'startup=창업사업화 지원, rnd=연구개발' },
    categories: {
      type: 'array',
      description: '문서에 명시된 집행 비목 목록. 문서에 비목 목록이 없으면 빈 배열.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'parentName', 'definition', 'allowed', 'limitPct', 'limitBasis', 'requiredDocs', 'quote', 'ref'],
        properties: {
          name: { type: 'string' },
          parentName: { type: ['string', 'null'], description: "이 비목이 다른 비목의 하위면 상위 비목명 (예: '회의비'의 상위는 '연구활동비'). 최상위면 null." },
          definition: nullable('string'),
          allowed: { type: 'boolean' },
          limitPct: { type: ['number', 'null'], description: '이 비목의 상한 %. 문서에 없으면 null — 지어내지 말 것' },
          limitBasis: nullable('string'),
          requiredDocs: { type: 'array', items: { type: 'string' }, description: '문서에 명시된 증빙 서류만' },
          quote: { type: 'string', description: '이 비목의 근거가 되는 원문 문장 그대로' },
          ref: { type: 'string', description: REF_DESCRIPTION },
        },
      },
    },
    allowedItems: {
      type: 'array',
      description: '비목 아래에서 실제로 쓸 수 있는 항목. 문서가 비목별로 인정 항목을 나열한 경우에만 채운다 (예: 인건비 → 참여연구자 급여, 4대보험 기관부담금). 나열이 없으면 빈 배열.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['categoryName', 'name', 'description', 'status', 'condition', 'restriction', 'quote', 'ref'],
        properties: {
          categoryName: { type: 'string', description: '이 항목이 속한 비목명 — categories의 name과 같게 쓴다' },
          name: { type: 'string', description: '항목명 (예: 참여연구자 급여, 회의 다과·식비)' },
          description: nullable('string'),
          status: {
            type: 'string', enum: ['ALLOWED', 'CONDITIONAL', 'NOT_ALLOWED'],
            description: '조건 없이 인정되면 ALLOWED, 조건·승인·기간 제한이 붙으면 CONDITIONAL, 명시적으로 계상 불가면 NOT_ALLOWED',
          },
          condition: { type: ['string', 'null'], description: '인정 조건 요약 (금액 한도·승인 필요·기간 제한 등). 없으면 null' },
          restriction: { type: ['string', 'null'], description: '제한·불인정 요약. 없으면 null' },
          quote: { type: 'string', description: '이 항목의 근거가 되는 원문 문장 그대로' },
          ref: { type: 'string', description: REF_DESCRIPTION },
        },
      },
    },
    articles: {
      type: 'array',
      description: '규칙의 근거가 된 조문·항목의 원문. rules와 allowedItems의 ref에 등장한 위치를 중복 없이 모은다. 사용자가 근거 링크를 누르면 이 원문이 그대로 표시되므로, 요약하지 말고 해당 조문 전체를 옮긴다. 조문 구조가 없는 문서면 빈 배열.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['ref', 'title', 'text'],
        properties: {
          ref: { type: 'string', description: '조문 위치 — rules·allowedItems의 ref와 정확히 같은 표기를 쓴다 (예: 제65조, 지침 11.다.1) 인건비)' },
          title: { type: ['string', 'null'], description: '조문 제목 (예: 영리기관 인건비 사용기준). 없으면 null' },
          text: { type: 'string', description: '조문 원문 전체. 항·호를 포함해 그대로 옮긴다' },
        },
      },
    },
    rules: {
      type: 'array',
      description: '집행 규칙: 상한(ratio), 금지·주의(warning), 재원 규정(funding), 참고(info)',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'limitType', 'approvalStatus', 'requiredDocuments', 'item', 'message', 'limitPct', 'minAmount', 'basis', 'severity', 'quote', 'ref'],
        properties: {
          kind: { type: 'string', enum: ['ratio', 'warning', 'funding', 'info'] },
          limitType: {
            type: ['string', 'null'],
            enum: ['NONE', 'FIXED_AMOUNT', 'PERCENT', 'FORMULA', 'ANNUAL_AVERAGE', 'APPROVAL_THRESHOLD', 'RECOGNITION_LIMIT', null],
            description: "kind가 'ratio'일 때 상한의 종류. 금액을 깎는 상한이면 PERCENT(비율)·FIXED_AMOUNT(고정금액)·FORMULA(계산식)·ANNUAL_AVERAGE(연차평균), 금액을 깎는 게 아니라 그 금액을 넘으면 절차가 발동하는 기준이면 APPROVAL_THRESHOLD(사전승인)·RECOGNITION_LIMIT(기관 인정), 상한이 없으면 NONE. 그 외 kind에서는 null.",
          },
          approvalStatus: {
            type: ['string', 'null'],
            enum: ['PRIOR_APPROVAL_REQUIRED', 'RECOGNITION_REQUIRED', null],
            description: "집행 전에 절차를 밟아야 하는 규칙이면 채운다. 승인권자의 사전 승인이 필요하면 PRIOR_APPROVAL_REQUIRED, 전문기관·중앙행정기관의 인정이 필요하면 RECOGNITION_REQUIRED. 절차가 없으면 null.",
          },
          requiredDocuments: {
            type: 'array', items: { type: 'string' },
            description: '이 규칙이 요구하는 증빙 서류가 문서에 나열된 경우만 채운다 (예: 견적서, 계약서, 검수조서). 없으면 빈 배열.',
          },
          item: {
            type: ['string', 'null'],
            description: "kind가 funding이고 정부지원 비율(예: '연구개발비의 75% 이내')이면 정확히 'subsidy_rate', 민간(기업)부담금 중 현금 최소비율(예: '기업부담금의 10% 이상 현금')이면 정확히 'matching_cash_min'. minAmount를 채우는 경우엔 그 필수 계상 대상 세부항목명(예: '외부전문기술 활용비'). 그 외에는 규칙이 속한 비목명 또는 null.",
          },
          message: { type: 'string', description: '사용자에게 보여줄 한 문장 요약' },
          limitPct: { type: ['number', 'null'], description: "item이 subsidy_rate/matching_cash_min이면 그 비율 숫자를 반드시 채운다 (예: 75, 10). minAmount를 채우는 항목이면 null." },
          minAmount: { type: ['number', 'null'], description: "특정 세부항목에 반드시 계상해야 하는 고정 금액(정액, 원 단위로 환산한 숫자)이 문서에 명시된 경우만 채운다 (예: '2백만원' → 2000000). %가 아니라 구체적 금액이 명시된 필수 계상 요구사항일 때만 사용하고, limitPct와 동시에 채우지 않는다." },
          basis: nullable('string'),
          severity: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
          quote: { type: 'string', description: '근거 원문 문장 그대로' },
          ref: { type: 'string', description: REF_DESCRIPTION },
        },
      },
    },
    referencedRegulations: {
      type: 'array',
      description: '이 공고문 자신이 아니라, 문서가 "준수·참고하라"고 이름을 명시한 별도의 규정·지침·요령·관리기준 문서 목록 (예: 중소기업창업 지원사업 운영요령). 본문에 이름이 명시된 경우만.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'quote', 'ref'],
        properties: {
          name: { type: 'string', description: '규정·지침 문서명 (문서에 쓰인 그대로)' },
          quote: { type: 'string', description: '이 문서명이 언급된 원문 문장' },
          ref: { type: 'string', description: REF_DESCRIPTION },
        },
      },
    },
    fundingSchedule: {
      type: ['object', 'null'],
      description: '"구분 / 정부지원연구개발비 / 기관부담연구개발비(현금·현물) / 연구개발비" 형태의 연차별 사업비 한도 표. 이런 표가 문서에 없으면 null.',
      additionalProperties: false,
      required: ['unit', 'totalSubsidyMax', 'years', 'quote', 'ref'],
      properties: {
        unit: { type: ['string', 'null'], description: "표에 명시된 금액 단위 그대로 (예: '천원', '원'). 절대 환산하지 말 것 — 원문 숫자와 단위를 그대로 옮긴다." },
        totalSubsidyMax: { type: ['number', 'null'], description: '정부지원연구개발비 합계(총 한도). unit 단위 그대로의 숫자.' },
        years: {
          type: 'array',
          description: '연차별 행 (1차년도, 2차년도 ...). 합계 행은 넣지 않는다.',
          items: {
            type: 'object', additionalProperties: false,
            required: ['label', 'subsidy', 'matchingCash', 'matchingInKind'],
            properties: {
              label: { type: 'string', description: "예: '1차년도'" },
              subsidy: { type: ['number', 'null'], description: '해당 연차 정부지원연구개발비 (unit 단위)' },
              matchingCash: { type: ['number', 'null'], description: '해당 연차 기관부담연구개발비 중 현금 (unit 단위)' },
              matchingInKind: { type: ['number', 'null'], description: '해당 연차 기관부담연구개발비 중 현물 (unit 단위)' },
            },
          },
        },
        quote: { type: 'string', description: '이 표의 제목 또는 대표 행 원문' },
        ref: { type: 'string', description: REF_DESCRIPTION },
      },
    },
    uncertain: { type: 'array', items: { type: 'string' }, description: '판단하지 못한 항목과 이유 — 억지로 채우지 말고 여기에 기록' },
  },
};

const SYSTEM_PROMPT = `당신은 한국 정부지원사업(창업지원·R&D)의 사업비 집행 규정을 공고문·지침에서 추출하는 전문가다.

원칙:
1. 문서에 명시된 내용만 추출한다. 일반 상식이나 다른 사업의 규정으로 보충하지 않는다.
2. 모든 항목의 quote에는 근거가 되는 원문 문장을 그대로 옮긴다 (요약·의역 금지). quote가 없으면 그 항목을 만들지 않는다. quote는 사용자가 원문에서 그 위치를 찾는 검색어로도 쓰이므로, 표 머리글이나 목차 줄이 아니라 규정 내용이 담긴 완결된 문장 한두 개를 옮긴다.
2-1. ref는 근거 위치를 가리키는 짧은 라벨이다. 조·항·호 번호가 문서에 있으면 그 번호만 쓰고(예: "제65조 제7항"), 없을 때만 20자 이내 소제목을 쓴다. 목차 경로를 이어붙이지 않는다.
3. 상한 비율(limitPct)은 문서에 숫자가 명시된 경우에만 넣는다. 없으면 null.
4. 확신이 없는 내용은 uncertain 배열에 "무엇을 왜 판단하지 못했는지" 기록한다.
5. 비목 목록(categories)은 문서가 집행 비목을 명시적으로 나열한 경우에만 채운다.
6. 금지·주의(warning) 규칙은 사용자가 실수하기 쉬운 것 위주로: 집행 불가 항목, 사전 승인 필요, 기간 제한, 소급 불인정 등.
7. 정부지원 비율(총사업비 대비, 예: "연구개발비의 75% 이내")이 문서에 있으면 kind:'funding', item:'subsidy_rate', limitPct에 그 숫자(예: 75)를 넣은 규칙을 반드시 만든다.
8. 민간(기업)부담금 중 현금 최소비율(민간부담금 대비, 예: "기업부담금의 10% 이상은 현금으로 부담")이 문서에 있으면 kind:'funding', item:'matching_cash_min', limitPct에 그 숫자(예: 10)를 넣은 규칙을 반드시 만든다. 총사업비 대비 비율로 적혀 있으면 그대로 두고 uncertain에 "현금 최소비율 기준(총사업비/민간부담금 대비 불명확)"이라고 남긴다.
9. referencedRegulations는 이 공고문 자신을 가리키는 게 아니라, 문서가 이름으로 지목하며 "준수·참고하라"고 명시한 별도의 상위 규정·통합관리지침·운영요령·세부관리기준만 담는다. 본문에 이름이 없으면 만들지 않는다.
10. "구분 / 정부지원연구개발비 / 기관부담연구개발비(현금·현물) / 연구개발비" 같은 연차별 사업비 표가 있으면 fundingSchedule에 옮긴다. 금액은 표에 적힌 숫자와 단위(천원/원 등)를 그대로 쓰고 절대 환산하지 않는다. 합계 행은 totalSubsidyMax에, 연차별 행만 years 배열에 넣는다 (합계 행 자체는 years에 넣지 않음). 이런 표가 없으면 fundingSchedule은 null.
11-1. allowedItems는 "이 비목으로 무엇을 살 수 있나"를 사용자에게 보여주는 목록이다. 문서가 비목별 인정 항목을 나열했을 때만 채우고, 각 항목이 어느 비목에 속하는지 categoryName에 비목명을 그대로 적는다. 조건이 붙은 항목(금액 한도·사전승인·기간 제한)은 status를 CONDITIONAL로 하고 condition에 그 조건을 적는다. 명시적으로 계상할 수 없다고 한 항목은 NOT_ALLOWED로 남긴다 — 빼지 말 것.
11-2. articles는 근거 조문의 원문 보관소다. rules와 allowedItems에서 쓴 ref마다 그 조문의 원문을 한 번씩 담는다. 같은 조문을 여러 규칙이 참조하면 articles에는 한 번만 넣는다. ref 표기는 rules·allowedItems와 글자 그대로 같아야 한다 — 다르면 화면에서 근거를 찾지 못한다. 원문은 요약·발췌하지 말고 조문 전체를 옮긴다.
11-2-1. 근거가 조문이 아니라 표일 때도 articles에 넣는다. "비목별 증빙서류", "사업비 비목(정의·증빙서류)"처럼 비목마다 필요한 서류를 늘어놓은 표가 특히 그렇다 — 이 표는 allowedItems의 requiredDocs가 나온 유일한 출처인데, 표라는 이유로 articles에서 빠뜨리면 화면에서 근거를 열었을 때 "원문 미수록"이 된다. 표는 한 비목(행)을 한 줄로 만들어 "비목 세목 — 서류1, 서류2" 형태로 옮기고, 표 전체를 조문 하나로 담는다.
11-3. 상한 규칙(kind:'ratio')에는 limitType을 반드시 채운다. "3천만원 이상이면 승인"처럼 금액을 깎는 게 아니라 절차가 발동하는 기준은 APPROVAL_THRESHOLD·RECOGNITION_LIMIT로 구분한다 — 이걸 PERCENT나 FIXED_AMOUNT로 넣으면 화면이 편성 금액을 잘못 깎는다.
11-4. 집행 전에 승인·인정을 받아야 하는 규칙은 approvalStatus를, 서류를 요구하는 규칙은 requiredDocuments를 채운다. 두 필드는 kind와 무관하게 해당하면 채운다 (금지 규칙에도 승인 예외가 붙을 수 있다).
11-5. 비목이 계층을 이루면 parentName에 상위 비목명을 적는다. 세부 비목(회의비·출장비 등)을 상위 비목(연구활동비)과 같은 층으로 나열하지 말 것.
12. 이 사업(공고)만의 특수 요구사항으로, 비목 내 특정 세부항목에 반드시 계상해야 하는 고정 금액(정액)이 문서에 있으면(예: "OO 프로그램 수행을 위해 과제당 연구활동비 내 외부전문기술 활용비로 2백만 원 필수 계상") kind:'ratio', item에 그 세부항목명, minAmount에 그 금액을 원 단위 숫자로 환산해(예: "2백만 원"→2000000) 넣은 규칙을 만든다. 이런 필수 계상 요구사항은 일반적인 법령이 아니라 이 공고 특유의 조건일 수 있으므로 반드시 quote로 원문을 남긴다.`;

const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { text, packId } = await req.json();
    if (typeof text !== 'string' || text.trim().length < 200) return json({ error: '분석할 텍스트가 너무 짧습니다 (200자 이상 필요).' }, 400);

    // 인증 확인 — 호출자의 JWT로 사용자 조회
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401);

    // Edge Function 실행 시간 제한을 고려해 입력을 자른다 (공고 앞부분에 핵심 규정이 몰려 있다)
    const clipped = text.slice(0, 60_000);
    const hash = await sha256(`${clipped}|${packId ?? ''}`);

    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: cached } = await service.from('extraction_cache').select('result').eq('hash', hash).maybeSingle();
    if (cached) return json({ extraction: cached.result, cached: true });

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });
    const response = await openai.responses.create({
      model: 'gpt-5.6-sol',
      max_output_tokens: 16000,
      instructions: SYSTEM_PROMPT,
      input: `다음 문서에서 사업비 집행 규정을 추출해줘.${packId ? ` (예상 사업 유형: ${packId})` : ''}\n\n<document>\n${clipped}\n</document>`,
      text: { format: { type: 'json_schema', name: 'extraction', schema: EXTRACTION_SCHEMA, strict: true } },
    });

    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
      return json({ error: '문서가 너무 커서 추출이 잘렸습니다. 규정 부분만 잘라 다시 시도해주세요.' }, 422);
    }
    if (!response.output_text) return json({ error: '추출 결과가 비어 있습니다.' }, 502);
    const extraction = JSON.parse(response.output_text);

    await service.from('extraction_cache').upsert({ hash, result: extraction, model: response.model, created_by: user.id });
    return json({ extraction, cached: false });
  } catch (error) {
    console.error('extract-rules 실패:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return json({ error: `규정 추출에 실패했습니다: ${message}` }, 500);
  }
});
