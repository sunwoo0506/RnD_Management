// 과제온 규정 추출 Edge Function
// 업로드된 공고문·지침 텍스트에서 사업비 집행 규정(비목·상한·금지·재원)을 구조화 추출한다.
// - 로그인 사용자만 호출 가능
// - 같은 문서는 해시 캐시로 LLM 재호출 생략
// - 모든 항목에 원문 인용(quote) 필수 — 인용 없는 값은 스키마상 생성 불가 (환각 방지 1차)
//   클라이언트가 인용을 원문과 대조 검증하고(2차), 사용자가 승인해야 적용된다(3차).
//
// 배포: Supabase 대시보드 → Edge Functions → Deploy new function → 이름 extract-rules → 이 코드 붙여넣기
// 시크릿: Edge Functions → Secrets 에 ANTHROPIC_API_KEY 추가 (SUPABASE_* 는 자동 제공)

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

// 추출 스키마 — 모든 항목에 quote(원문 인용)와 ref(문서 내 위치)가 필수다.
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['programName', 'year', 'programType', 'categories', 'rules', 'uncertain'],
  properties: {
    programName: { type: 'string', description: '사업명 (문서에 명시된 그대로)' },
    year: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: '사업 연도' },
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
          limitPct: { anyOf: [{ type: 'number' }, { type: 'null' }], description: '이 비목의 상한 %. 문서에 없으면 null — 지어내지 말 것' },
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
        required: ['kind', 'item', 'message', 'limitPct', 'basis', 'severity', 'quote', 'ref'],
        properties: {
          kind: { type: 'string', enum: ['ratio', 'warning', 'funding', 'info'] },
          item: nullable('string'),
          message: { type: 'string', description: '사용자에게 보여줄 한 문장 요약' },
          limitPct: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          basis: nullable('string'),
          severity: { anyOf: [{ type: 'string', enum: ['high', 'medium', 'low'] }, { type: 'null' }] },
          quote: { type: 'string', description: '근거 원문 문장 그대로' },
          ref: { type: 'string' },
        },
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
6. 금지·주의(warning) 규칙은 사용자가 실수하기 쉬운 것 위주로: 집행 불가 항목, 사전 승인 필요, 기간 제한, 소급 불인정 등.`;

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

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `다음 문서에서 사업비 집행 규정을 추출해줘.${packId ? ` (예상 사업 유형: ${packId})` : ''}\n\n<document>\n${clipped}\n</document>`,
      }],
    });

    if (response.stop_reason === 'max_tokens') return json({ error: '문서가 너무 커서 추출이 잘렸습니다. 규정 부분만 잘라 다시 시도해주세요.' }, 422);
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return json({ error: '추출 결과가 비어 있습니다.' }, 502);
    const extraction = JSON.parse(textBlock.text);

    await service.from('extraction_cache').upsert({ hash, result: extraction, model: response.model, created_by: user.id });
    return json({ extraction, cached: false });
  } catch (error) {
    console.error('extract-rules 실패:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return json({ error: `규정 추출에 실패했습니다: ${message}` }, 500);
  }
});
