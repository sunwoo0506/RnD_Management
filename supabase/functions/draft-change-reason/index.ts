// 과제온 변경 사유 작성 Edge Function
// 사용자가 한두 줄로 적은 변경 사유를, 전문기관에 제출할 공문의 사유란 문장으로 다시 쓴다.
// - 로그인 사용자만 호출 가능
// - 금액·비목 같은 사실은 클라이언트가 신뢰도 태그를 붙여 넘긴 값만 쓴다 (환각 방지)
// - 결과는 사용자가 그대로 고칠 수 있고, 마음에 안 들면 다시 요청한다 — 캐시하지 않는다
//   (같은 입력이라도 다시 눌렀을 때 다른 표현이 나와야 "재작성"이 의미가 있다)
//
// 프롬프트는 docs/ai-admin-writer-prompt.md 의 2층 구조를 따른다.
//   [공용 기반 §1·§2·§4·§5] + [문서별 지시 §8 협약변경] + [출력 형식 §20 발췌]
// 전체(10종 문서·22개 절)를 매번 넣으면 호출마다 4천 토큰이 붙고 정작 필요한 지시가 묻힌다.
// 다른 문서 생성 기능을 만들 때는 그 문서의 절만 바꿔 끼운다.
//
// 배포: Supabase 대시보드 → Edge Functions → Deploy new function → 이름 draft-change-reason → 이 코드 붙여넣기
// 시크릿: Edge Functions → Secrets 의 OPENAI_API_KEY 를 그대로 쓴다 (extract-rules 와 공용)

import OpenAI from 'npm:openai';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// 출력 구조를 스키마로 못박는다. json_object 모드는 "JSON이기만 하면" 통과라 필드가 빠져도 막지 못하고,
// 입력 어딘가에 'json'이라는 낱말을 요구해 프롬프트가 지저분해진다.
// docs/ai-admin-writer-prompt.md §20에서 이 기능에 필요한 필드만 발췌한 것이다.
const REASON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'usage_plan', 'missing_information', 'validation_warnings'],
  properties: {
    status: { type: 'string', enum: ['READY', 'NEEDS_INFORMATION'] },
    reason: { type: 'string', description: '변경 사유 문단 — 문서에 그대로 들어갈 본문' },
    usage_plan: { type: 'string', description: '변경 후 사용계획 한두 문장 — 승인 요청 공문의 별도 항목' },
    missing_information: {
      type: 'array', description: '보완하면 좋은 항목 (검토용, 문서에 넣지 않음)',
      items: { type: 'string' },
    },
    validation_warnings: {
      type: 'array', description: '금액·사실관계에서 확인이 필요한 점 (검토용, 문서에 넣지 않음)',
      items: { type: 'string' },
    },
  },
};

const SYSTEM_PROMPT = `당신은 정부지원사업·연구개발과제의 행정문서를 작성하는 전문 AI입니다.
지금 맡은 일은 "사업비 변경(협약변경) 신청 공문"의 <변경 사유> 항목에 들어갈 문단을 쓰는 것입니다.

당신의 역할은 새로운 사실을 만들어내는 것이 아니라, 제공된 사실을 행정문서에 맞는 표현으로 정리하는 것입니다.

[입력정보 신뢰도]
입력의 각 사실에는 시스템이 신뢰도 태그를 붙여 보냅니다. 태그는 당신이 판단하지 않고 그대로 따릅니다.
- VERIFIED: 시스템 데이터로 확인된 값 (과제명·비목명·금액 등)
- USER_PROVIDED: 사용자가 직접 적은 내용
- MISSING: 문서에 필요하지만 제공되지 않은 것
VERIFIED와 USER_PROVIDED만 확정 사실로 씁니다. MISSING은 지어내지 말고,
문단에서는 일반적인 표현으로 넘기거나 [확인 필요: 항목명]으로 표시하고 missing_information에 적습니다.

[절대 금지]
- 입력에 없는 날짜·금액·기관·업체·수치를 만들어내지 않습니다 ("약 30% 절감" 같은 추정치 금지).
- 제공되지 않은 성과나 기대효과를 임의로 추가하지 않습니다.
- 규정명·조항을 만들어내지 않습니다. 이 기능에는 규정 원문이 제공되지 않으므로 조문을 인용하지 않습니다.
- 총사업비 변동 여부가 입력에 없으면 "총사업비 변동 없음"이라고 쓰지 않습니다.
- 제공된 자료보다 강한 의미로 확대해 표현하지 않습니다.

[작성 원칙]
- 협약변경 사유는 다음 흐름을 지킵니다.
  ① 변경이 필요해진 사정(연구 수행 과정에서 무엇이 달라졌는지)
  ② 어느 비목에서 어느 비목으로 얼마를 조정하려는지
  ③ 변경 후 사용계획 또는 연구 목표 달성에 미치는 영향(지장이 없다는 점 포함)
- 종결어미는 사유·검토 의견 문체를 씁니다: "~함", "~하고자 함", "~필요함".
  "~합니다"체와 섞지 않습니다.
- 공식적이고 간결하게 씁니다. 미사여구와 같은 설명의 반복을 넣지 않습니다.
- 한 문단으로 3~5문장, 400자 안팎. 제목·항목 기호·머리말을 붙이지 않습니다.
- 금액은 입력값과 정확히 일치시키고, 병기가 필요하면 금 2,400,000원(금이백사십만원정) 형식을 씁니다.
- 사용자가 적은 구어체 메모는 의미를 바꾸지 않는 범위에서 행정문서 표현으로 다듬습니다.

[출력]
정해진 스키마의 다섯 항목을 채웁니다.
- reason: 변경 사유 문단. 문서에 그대로 들어갈 본문입니다.
- usage_plan: 변경 후 사용계획. 승인 요청 공문의 별도 항목이라 사유와 겹치지 않게 한두 문장으로
  "받는 비목을 무엇에 쓸 것인지"만 씁니다. 입력에 쓸 곳이 안 적혀 있으면 지어내지 말고
  받는 비목의 일반적 용도 범위에서 서술하되, missing_information에 그 사실을 적습니다.
- missing_information: 보완하면 좋은 항목 (사용자 검토용, 문서에는 넣지 않음)
- validation_warnings: 금액·사실관계에서 확인이 필요한 점 (사용자 검토용)
status는 핵심 사실(변경 대상 비목·금액·사정)이 갖춰졌으면 READY,
그중 빠진 것이 있으면 NEEDS_INFORMATION으로 합니다.
NEEDS_INFORMATION이어도 reason은 반드시 채웁니다 — 빠진 자리는 [확인 필요: 항목명]으로 표시하고
지어내지 않습니다. 사용자를 빈손으로 돌려보내지 않습니다.
missing_information과 validation_warnings는 문서 본문에 넣지 않습니다 (검토 화면에만 표시됨).`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { summary, projectName, fromCategory, toCategory, amount, reasonTemplate, totalBudgetChanged, previous, feedback } = await req.json();
    if (typeof summary !== 'string' || summary.trim().length < 2) {
      return json({ error: '변경 사유를 한 줄이라도 입력해주세요.' }, 400);
    }

    // 인증 확인 — 호출자의 JWT로 사용자 조회
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401);

    // 신뢰도 태그를 붙여 넘긴다 — 모델이 스스로 "이건 확인된 값"이라고 판단하면 그 판단 자체가 환각이다.
    const fact = (tag: string, label: string, value: unknown) =>
      value === undefined || value === null || value === '' ? null : `[${tag}] ${label}: ${value}`;
    const facts = [
      fact('VERIFIED', '과제명', projectName),
      fact('VERIFIED', '보내는 비목', fromCategory),
      fact('VERIFIED', '받는 비목', toCategory),
      fact('VERIFIED', '이동 금액', typeof amount === 'number' && amount > 0 ? `${amount.toLocaleString('ko-KR')}원` : null),
      fact('USER_PROVIDED', '변경 유형', reasonTemplate),
      // 총사업비 변동 여부는 화면이 알 수 없으면 넘기지 않는다 — 모르면 MISSING으로 둔다.
      totalBudgetChanged === undefined ? '[MISSING] 총사업비 변동 여부: 제공되지 않음' : fact('VERIFIED', '총사업비 변동 여부', totalBudgetChanged ? '변동 있음' : '변동 없음'),
      '[MISSING] 변경 후 사용계획 상세: 제공되지 않음',
    ].filter(Boolean).join('\n');

    // 재작성이면 앞서 쓴 글과 주문을 함께 넘겨 "무엇을 고쳐야 하는지" 알게 한다.
    const rewrite = typeof previous === 'string' && previous.trim()
      ? `\n\n<이전 초안>\n${previous.slice(0, 2000)}\n</이전 초안>\n주문: ${typeof feedback === 'string' && feedback.trim() ? feedback.slice(0, 500) : '같은 내용을 다른 표현과 구성으로 다시 써줘. 이전 초안을 그대로 반복하지 말 것.'}`
      : '';

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });
    const response = await openai.responses.create({
      model: 'gpt-5.6-sol',
      max_output_tokens: 3000,
      instructions: SYSTEM_PROMPT,
      input: `아래 사정으로 사업비 비목 간 조정을 신청한다. 공문의 <변경 사유> 문단을 작성해줘.\n\n<사실>\n${facts}\n</사실>\n\n<연구책임자가 적은 사정 (USER_PROVIDED)>\n${summary.slice(0, 2000)}\n</연구책임자가 적은 사정>${rewrite}`,
      text: { format: { type: 'json_schema', name: 'change_reason', schema: REASON_SCHEMA, strict: true } },
    });

    const raw = response.output_text?.trim();
    if (!raw) return json({ error: '작성 결과가 비어 있습니다. 다시 시도해주세요.' }, 502);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw); }
    catch { return json({ error: '작성 결과를 읽지 못했습니다. 다시 시도해주세요.' }, 502); }

    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    if (!reason) return json({ error: '작성 결과가 비어 있습니다. 다시 시도해주세요.' }, 502);
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
    return json({
      reason,
      status: parsed.status === 'NEEDS_INFORMATION' ? 'NEEDS_INFORMATION' : 'READY',
      usagePlan: typeof parsed.usage_plan === 'string' ? parsed.usage_plan.trim() : '',
      missingInformation: list(parsed.missing_information),
      validationWarnings: list(parsed.validation_warnings),
    });
  } catch (error) {
    console.error('draft-change-reason 실패:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return json({ error: `사유 작성에 실패했습니다: ${message}` }, 500);
  }
});
