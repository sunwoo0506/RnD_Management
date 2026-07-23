import { supabase } from './supabase';

// ---- 변경 사유 AI 작성 ----
// 공문 사유란은 "왜 필요한가 → 어디서 어디로 얼마 → 변경 후 사용계획"을 갖춘 문단이어야 하는데,
// 매번 격식에 맞춰 쓰는 것이 부담이라 한두 줄만 적으면 행정문서 문체로 늘려 쓴다.
// 사실(금액·비목·과제명)은 화면이 이미 알고 있으므로 신뢰도 태그를 붙여 넘겨,
// 모델이 "확인된 값"을 스스로 판단하지 않게 한다 (그 판단 자체가 환각이 된다).
//
// 프롬프트 원본과 설계 근거: docs/ai-admin-writer-prompt.md

export interface ReasonDraftInput {
  summary: string;          // 사용자가 한두 줄로 적은 사정
  projectName?: string;
  fromCategory?: string;
  toCategory?: string;
  amount?: number;
  reasonTemplate?: string;  // 고른 변경 유형 (장비 사양 변경 등)
  // 총사업비가 함께 바뀌는지 — 모르면 넘기지 않는다. 모델이 "변동 없음"으로 단정하면 안 되기 때문이다.
  totalBudgetChanged?: boolean;
  previous?: string;        // 재작성일 때 이전 초안
  feedback?: string;        // 재작성 주문 ("더 짧게", "장비 필요성을 강조")
}

export interface ReasonDraft {
  reason: string;                  // 문서에 그대로 들어갈 본문
  status: 'READY' | 'NEEDS_INFORMATION';
  // 아래 둘은 문서에 넣지 않는다 — 사용자 검토 화면에만 띄운다 (본문/검토정보 분리).
  missingInformation: string[];    // 보완하면 좋은 항목
  validationWarnings: string[];    // 금액·사실관계에서 확인이 필요한 점
}

// FunctionsHttpError는 message가 고정 문구라, 실제 원인은 함수가 응답한 JSON body에 있다.
const describeError = async (error: { message: string; context?: unknown }): Promise<string> => {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch { /* JSON이 아니면 기본 메시지로 */ }
  }
  return error.message;
};

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

export const draftChangeReason = async (input: ReasonDraftInput): Promise<ReasonDraft> => {
  if (!supabase) throw new Error('AI 작성은 로그인 상태에서만 쓸 수 있어요.');
  if (!input.summary.trim()) throw new Error('변경 사유를 한 줄이라도 적어주세요.');
  const { data, error } = await supabase.functions.invoke('draft-change-reason', { body: input });
  if (error) throw new Error(await describeError(error));
  if (data?.error) throw new Error(data.error);
  const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';
  if (!reason) throw new Error('작성 결과가 비어 있습니다. 다시 시도해주세요.');
  return {
    reason,
    status: data?.status === 'NEEDS_INFORMATION' ? 'NEEDS_INFORMATION' : 'READY',
    missingInformation: asList(data?.missingInformation),
    validationWarnings: asList(data?.validationWarnings),
  };
};
