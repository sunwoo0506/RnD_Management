// ④ 지금 확인할 일 — 과제 전체를 가로지르는 세 가지 체크:
//   1) 월별 계획 체크리스트 (금액 자동 판정 · 다음달로 미루기)
//   2) 증빙 빠짐 (사업별 ▸ 세목별)
//   3) 연구인력 참여율 현황표 (총 참여율 100% · 3책 5공)
// 기획: docs/superpowers/specs/2026-07-23-portfolio-dashboard.md
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, FileClock, ShieldCheck, Users } from 'lucide-react';
import { evidenceGaps, participationTable, planTodos } from './portfolio';
import { formatWon } from './rules';
import { setMonthlyPlan } from './spending';
import type { Project, Screen } from './types';

export default function PortfolioTodos({ projects, currentMonth, onUpdate, onGo }: {
  projects: Project[];
  currentMonth: string;              // 'YYYY-MM' — 테스트에서 고정할 수 있게 밖에서 받는다
  onUpdate: (project: Project) => void;
  onGo: (projectId: string, screen: Screen) => void;
}) {
  const todos = planTodos(projects, currentMonth);
  const pending = todos.filter((item) => !item.done);
  const doneNow = todos.filter((item) => item.done);
  const gaps = evidenceGaps(projects);
  const people = participationTable(projects);

  // 남은 계획액을 다음 달로 옮긴다: 이번 달 계획은 집행액으로 줄이고, 다음 달 계획에 남은 만큼 더한다.
  const defer = (item: (typeof todos)[number]) => {
    const project = projects.find((entry) => entry.id === item.projectId);
    if (!project || item.nextMonth == null) return;
    const leaf = { categoryId: item.categoryId, subItemId: item.subItemId };
    let next = setMonthlyPlan(project, leaf, item.month, item.actual);
    next = setMonthlyPlan(next, leaf, item.nextMonth, (item.nextPlan ?? 0) + item.remaining);
    onUpdate(next);
  };

  return <section className="panel portfolio-todos">
    <div className="panel-head"><div><span className="section-kicker">NEXT ACTION</span><h3>지금 확인할 일</h3>
      <p>전체 과제의 월별 계획·증빙·참여율을 한자리에서 점검합니다.</p></div></div>

    {/* ④-1 월별 계획 체크리스트 */}
    <div className="todo-block">
      <h4><CalendarDays /> 월별 계획 ({currentMonth}) <em>집행액이 계획액에 도달하면 자동으로 완료됩니다</em></h4>
      {pending.length === 0 && <p className="field-hint">이번 달까지의 계획이 모두 집행됐습니다.</p>}
      {pending.map((item) => <div className="plan-todo" key={`${item.projectId}-${item.categoryId}-${item.subItemId ?? ''}-${item.month}`}>
        <span className={`plan-month ${item.month < currentMonth ? 'late' : ''}`}>{item.month}{item.month < currentMonth ? ' 밀림' : ''}</span>
        <div className="plan-what"><strong>{item.projectName}</strong><span>{item.label}</span></div>
        <div className="plan-amount"><small>계획 {formatWon(item.planned)} · 집행 {formatWon(item.actual)}</small><strong>남은 {formatWon(item.remaining)}</strong></div>
        <div className="plan-actions">
          {item.nextMonth != null && <button type="button" className="secondary" onClick={() => defer(item)}>다음달로 미루기</button>}
          <button type="button" className="secondary" onClick={() => onGo(item.projectId, 'spending')}>집행 등록 <ArrowRight /></button>
        </div>
      </div>)}
      {doneNow.length > 0 && <div className="plan-done">{doneNow.map((item) => <span key={`${item.projectId}-${item.categoryId}-${item.subItemId ?? ''}`}><CheckCircle2 /> {item.projectName} · {item.label}</span>)}</div>}
    </div>

    {/* ④-2 증빙 빠짐 */}
    <div className="todo-block">
      <h4><FileClock /> 증빙 빠짐 <em>{gaps.reduce((sum, gap) => sum + gap.total, 0)}건</em></h4>
      {gaps.length === 0 && <p className="field-hint">모든 과제의 증빙이 준비됐습니다.</p>}
      {gaps.map((gap) => <button type="button" className="gap-row" key={gap.projectId} onClick={() => onGo(gap.projectId, 'spending')}>
        <strong>{gap.projectName}</strong>
        <span className="gap-groups">{gap.groups.map((group) => <em key={group.label}>{group.label} <b>{group.count}건</b></em>)}</span>
        <ArrowRight />
      </button>)}
    </div>

    {/* ④-3 연구인력 참여율 현황표 */}
    {people.length > 0 && <div className="todo-block">
      <h4><Users /> 연구인력 참여율 <em>같은 사람은 이름이 똑같아야 합쳐집니다</em></h4>
      <div className="people-table">
        <div className="people-row head"><span>연구자</span><span>총 참여율</span><span>과제별</span><span>외부</span><span>과제 수 (3책 5공)</span></div>
        {people.map((person) => {
          const overRate = person.total > 100;
          const overLead = person.leadCount > 3;
          const overCount = person.projects.length > 5;
          return <div className={`people-row ${overRate ? 'over' : ''}`} key={person.name}>
            <span className="person-name">{person.name}</span>
            <span className={`person-total ${overRate ? 'over' : ''}`}>{person.total}%{overRate && <AlertCircle />}</span>
            <span className="person-projects">{person.projects.map((entry) => <em key={entry.id}>{entry.name} {entry.rate}%{entry.isLead && <b title="연구책임자">책임</b>}</em>)}</span>
            <span>{person.external ? `${person.external}%` : '—'}</span>
            <span className={overLead || overCount ? 'person-count over' : 'person-count'}>
              책임 {person.leadCount} / 전체 {person.projects.length}
              {(overLead || overCount) && <small>{overLead ? '3책 초과' : '5공 초과'}</small>}
            </span>
          </div>;
        })}
      </div>
      <p className="field-hint"><ShieldCheck style={{ width: 13, verticalAlign: -2 }} /> 총 참여율 100% 초과, 연구책임자 3건 초과(3책), 참여 과제 5건 초과(5공)를 경고합니다. 연구책임자는 예산 편성의 인건비 산정에서 지정합니다.</p>
    </div>}
  </section>;
}
