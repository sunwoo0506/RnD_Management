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

// 추출 스키마 — 모든 항목에 quote(원문 인용)와 ref(문서 내 위치)가 필수다.
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['programName', 'year', 'programType', 'categories', 'rules', 'referencedRegulations', 'fundingSchedule', 'uncertain'],
  properties: {
    programName: { type: 'string', description: '사업명 (문서에 명시된 그대로)' },
    year: { type: ['integer', 'null'], description: '사업 연도' },
    programType: { type: 'string', enum: ['startup', 'rnd', 'other', 'unknown'], description: 'startup=창업사업화 지원, rnd=연구개발' },
    categories: {
      type: 'array',
      description: '문서에 명시된 집행 비목 목록. 문서에 비목 목록이 없으면 빈 배열.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'definition', 'allowed', 'limitPct', 'limitBasis', 'requiredDocs', 'quote', 'ref'],
        properties: {
          name: { type: 'string' },
          definition: nullable('string'),
          allowed: { type: 'boolean' },
          limitPct: { type: ['number', 'null'], description: '이 비목의 상한 %. 문서에 없으면 null — 지어내지 말 것' },
          limitBasis: nullable('string'),
          requiredDocs: { type: 'array', items: { type: 'string' }, description: '문서에 명시된 증빙 서류만' },
          quote: { type: 'string', description: '이 비목의 근거가 되는 원문 문장 그대로' },
          ref: { type: 'string', description: '문서 내 위치 (예: 공고 3쪽 사업화 자금, QnA 사업비 4번)' },
        },
      },
    },
    rules: {
      type: 'array',
      description: '집행 규칙: 상한(ratio), 금지·주의(warning), 재원 규정(funding), 참고(info)',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'item', 'message', 'limitPct', 'minAmount', 'basis', 'severity', 'quote', 'ref'],
        properties: {
          kind: { type: 'string', enum: ['ratio', 'warning', 'funding', 'info'] },
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
          ref: { type: 'string' },
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
          ref: { type: 'string' },
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
        ref: { type: 'string' },
      },
    },
    uncertain: { type: 'array', items: { type: 'string' }, description: '판단하지 못한 항목과 이유 — 억지로 채우지 말고 여기에 기록' },
  },
};

const SYSTEM_PROMPT = `당신은 한국 정부지원사업(창업지원·R&D)의 사업비 집행 규정을 공고문·지침에서 추출하는 전문가다.

원칙:
1. 문서에 명시된 내용만 추출한다. 일반 상식이나 다른 사업의 규정으로 보충하지 않는다.
2. 모든 항목의 quote에는 근거가 되는 원문 문장을 그대로 옮긴다 (요약·의역 금지). quote가 없으면 그 항목을 만들지 않는다.
3. 상한 비율(limitPct)은 문서에 숫자가 명시된 경우에만 넣는다. 없으면 null.
4. 확신이 없는 내용은 uncertain 배열에 "무엇을 왜 판단하지 못했는지" 기록한다.
5. 비목 목록(categories)은 문서가 집행 비목을 명시적으로 나열한 경우에만 채운다.
6. 금지·주의(warning) 규칙은 사용자가 실수하기 쉬운 것 위주로: 집행 불가 항목, 사전 승인 필요, 기간 제한, 소급 불인정 등.
7. 정부지원 비율(총사업비 대비, 예: "연구개발비의 75% 이내")이 문서에 있으면 kind:'funding', item:'subsidy_rate', limitPct에 그 숫자(예: 75)를 넣은 규칙을 반드시 만든다.
8. 민간(기업)부담금 중 현금 최소비율(민간부담금 대비, 예: "기업부담금의 10% 이상은 현금으로 부담")이 문서에 있으면 kind:'funding', item:'matching_cash_min', limitPct에 그 숫자(예: 10)를 넣은 규칙을 반드시 만든다. 총사업비 대비 비율로 적혀 있으면 그대로 두고 uncertain에 "현금 최소비율 기준(총사업비/민간부담금 대비 불명확)"이라고 남긴다.
9. referencedRegulations는 이 공고문 자신을 가리키는 게 아니라, 문서가 이름으로 지목하며 "준수·참고하라"고 명시한 별도의 상위 규정·통합관리지침·운영요령·세부관리기준만 담는다. 본문에 이름이 없으면 만들지 않는다.
10. "구분 / 정부지원연구개발비 / 기관부담연구개발비(현금·현물) / 연구개발비" 같은 연차별 사업비 표가 있으면 fundingSchedule에 옮긴다. 금액은 표에 적힌 숫자와 단위(천원/원 등)를 그대로 쓰고 절대 환산하지 않는다. 합계 행은 totalSubsidyMax에, 연차별 행만 years 배열에 넣는다 (합계 행 자체는 years에 넣지 않음). 이런 표가 없으면 fundingSchedule은 null.
11. 이 사업(공고)만의 특수 요구사항으로, 비목 내 특정 세부항목에 반드시 계상해야 하는 고정 금액(정액)이 문서에 있으면(예: "OO 프로그램 수행을 위해 과제당 연구활동비 내 외부전문기술 활용비로 2백만 원 필수 계상") kind:'ratio', item에 그 세부항목명, minAmount에 그 금액을 원 단위 숫자로 환산해(예: "2백만 원"→2000000) 넣은 규칙을 만든다. 이런 필수 계상 요구사항은 일반적인 법령이 아니라 이 공고 특유의 조건일 수 있으므로 반드시 quote로 원문을 남긴다.`;

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
