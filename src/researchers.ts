import type { Participant, Project, Researcher } from './types';

// ---- 연구자 명부 계산 (연구자 관리 화면 + 예산 편성 인건비 산정 연동) ----
// 명부는 회사 공통이고 과제는 이름으로 참조한다 — 타 과제 참여율(otherProjectsRate)과 같은 방식.

// 월급여 = 연봉 ÷ 12. 원 단위 꼬리는 버린다 (편성 단계에서 다시 천원 미만을 버리므로 과대계상만 막으면 된다).
export const monthlyOf = (annualSalary: number): number => Math.floor(Math.max(0, annualSalary) / 12);

// 기준일에 적용되는 연봉 — 수정연봉이 있고 적용일이 지났으면(적용일 미입력 시 즉시) 수정연봉을 쓴다.
export const effectiveAnnual = (researcher: Researcher, todayStr: string): number => {
  if (researcher.revisedSalary && (!researcher.revisedFrom || researcher.revisedFrom <= todayStr)) return researcher.revisedSalary;
  return researcher.annualSalary;
};

export const effectiveMonthly = (researcher: Researcher, todayStr: string): number =>
  monthlyOf(effectiveAnnual(researcher, todayStr));

// 입사일에 n년을 더한 날짜 문자열. 윤년 2/29 입사는 평년에 3/1로 넘어간다 (Date의 자동 이월 그대로).
const addYears = (dateStr: string, years: number): string => {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setFullYear(date.getFullYear() + years);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const EMPLOYMENT_LABEL: Record<NonNullable<Researcher['employmentType']>, string> = {
  fulltime: '정규직', contract: '계약직', external: '외부인력',
};

// 퇴직급여충당금 계상 가능 여부 — 입사일부터 기준일까지 계속근로 1년(만 1년)이 지났는지.
// 외부인력(용역·자문)은 근로자가 아니라 근속과 무관하게 계상 대상이 아니다.
// 예산 편성에서 이름으로 인력을 불러올 때 "퇴직금 포함" 체크의 자동 판정 기준이다.
export const severanceEligible = (researcher: Researcher, todayStr: string): boolean => {
  if (researcher.employmentType === 'external') return false;
  if (!researcher.joinDate) return false;
  const oneYear = addYears(researcher.joinDate, 1);
  return !!oneYear && oneYear <= todayStr;
};

// 근속 기간 표시 ("1년 3개월", "7개월"). 퇴사자는 퇴사일까지로 계산한다.
export const tenureText = (researcher: Researcher, todayStr: string): string => {
  const until = researcher.leaveDate && researcher.leaveDate < todayStr ? researcher.leaveDate : todayStr;
  const start = new Date(`${researcher.joinDate}T00:00:00`);
  const end = new Date(`${until}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '-';
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1; // 같은 일자가 돌아와야 한 달을 채운 것
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}개월`;
  return rest === 0 ? `${years}년` : `${years}년 ${rest}개월`;
};

export type EmploymentStatus = '재직' | '퇴사예정' | '퇴사';

export const employmentStatus = (researcher: Researcher, todayStr: string): EmploymentStatus => {
  if (!researcher.leaveDate) return '재직';
  return researcher.leaveDate < todayStr ? '퇴사' : '퇴사예정';
};

// 이름으로 명부에서 찾는다 — 과제 참여인력과 명부의 연결 고리는 이름이다 (otherProjectsRate와 동일 규칙).
export const researcherByName = (researchers: Researcher[], name: string): Researcher | undefined => {
  const target = name.trim();
  if (!target) return undefined;
  return researchers.find((r) => r.name.trim() === target);
};

// 퇴사일 반영 대상 — 이름이 같은 참여인력 중 참여 종료일(미입력 시 과제 종료일)이 퇴사일보다 뒤인 과제.
// 이미 퇴사일 이전에 참여가 끝난 과제는 손댈 것이 없다.
export interface ResignationTarget {
  project: Project;
  participant: Participant;
  newEnd: string; // 반영될 참여 종료일 = min(퇴사일, 기존 종료일) — 결과적으로 퇴사일
}

export const resignationTargets = (projects: Project[], researcher: Researcher): ResignationTarget[] => {
  const leave = researcher.leaveDate;
  if (!leave) return [];
  const name = researcher.name.trim();
  const targets: ResignationTarget[] = [];
  for (const project of projects) {
    for (const participant of project.participants) {
      if (participant.name.trim() !== name) continue;
      const currentEnd = participant.laborEnd ?? project.endDate;
      if (currentEnd <= leave) continue;
      targets.push({ project, participant, newEnd: leave });
    }
  }
  return targets;
};

// 저장된 JSON이 연구자 명부 형태인지 검증한다 (storage·cloud 공용).
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const parseResearchers = (value: unknown): Researcher[] | null => {
  if (!Array.isArray(value)) return null;
  const valid = value.filter((item): item is Researcher =>
    isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
    && typeof item.annualSalary === 'number' && typeof item.joinDate === 'string');
  return valid;
};
