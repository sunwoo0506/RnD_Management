// ---- 세목별 추가 입력 항목 ----
// 회의비인데 회의 목적·장소·참석자를 적을 칸이 없어, 회의록·출장보고서를 매번 손으로 다시 썼다.
// 세목마다 필요한 항목이 다르므로 타입을 늘리지 않고 이 표 하나로 정의한다.
// 새 세목이 생기면 여기에 한 줄만 넣으면 된다.
export interface DetailField {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'date' | 'textarea';
  hint?: string;
}

// 키는 문서 서식의 칸 이름과 1:1로 맞춰 둔다 — 나중에 입력값으로 문서를 채울 때
// fillTemplate(type, expense.details) 한 번으로 붙어야 한다.
export const DETAIL_FIELDS: Record<string, DetailField[]> = {
  회의비: [
    { key: 'meetingPurpose', label: '회의 목적', required: true, hint: '예: 2차년도 개발 범위 확정' },
    { key: 'meetingAt', label: '회의 일시', required: true, type: 'date' },
    { key: 'meetingPlace', label: '회의 장소', required: true, hint: '예: 본사 3층 회의실' },
    { key: 'attendees', label: '참석자', required: true, hint: '쉼표로 구분' },
    { key: 'meetingNotes', label: '주요 논의·결정사항', type: 'textarea' },
  ],
  출장비: [
    { key: 'traveler', label: '출장자', required: true, hint: '쉼표로 구분' },
    { key: 'tripPurpose', label: '출장 목적', required: true },
    { key: 'tripPlace', label: '출장지', required: true, hint: '예: 대전 한국전자통신연구원' },
    { key: 'tripFrom', label: '출장 시작', required: true, type: 'date' },
    { key: 'tripTo', label: '출장 종료', required: true, type: 'date' },
    { key: 'transport', label: '교통수단', hint: '예: KTX 왕복' },
    { key: 'tripResult', label: '수행 내용·결과', type: 'textarea' },
  ],
};

// 이 세목에서 만들 수 있는 문서. 지금은 목록만 쓰고, 실제 생성은 exporters.ts에 붙인다.
export const DETAIL_DOCUMENTS: Record<string, string[]> = {
  회의비: ['회의록'],
  출장비: ['출장신청서', '출장보고서'],
};

// 세목 이름으로 추가 입력 항목을 찾는다. 규정 기준으로 해석한 이름(회의비·출장비)을 넣는다.
export const detailFieldsFor = (subItemName?: string): DetailField[] =>
  subItemName ? DETAIL_FIELDS[subItemName] ?? [] : [];

export const detailDocumentsFor = (subItemName?: string): string[] =>
  subItemName ? DETAIL_DOCUMENTS[subItemName] ?? [] : [];
