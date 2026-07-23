// ④ 지금 확인할 일 — 사업별 요약(미집행 N건 / 증빙 미완료 M건)과 14일 넘게 밀린 것의
// 텍스트 알림만 낸다. 상세 집행건·증빙 관리는 각 과제의 집행·증빙 화면이 담당하고,
// 연구인력 참여율은 별도 섹션(PortfolioPeople)이다 (사용자 결정).
import { AlertCircle, ArrowRight } from 'lucide-react';
import { actionSummary, overdueAlerts } from './portfolio';
import type { Project, Screen } from './types';

export default function PortfolioTodos({ projects, today, onGo }: {
  projects: Project[];
  today: string;                     // 'YYYY-MM-DD' — 테스트에서 고정할 수 있게 밖에서 받는다
  onGo: (projectId: string, screen: Screen) => void;
}) {
  const summaries = actionSummary(projects, today.slice(0, 7));
  const totalPlans = summaries.reduce((sum, entry) => sum + entry.pendingPlans, 0);
  const totalEvidence = summaries.reduce((sum, entry) => sum + entry.missingEvidence, 0);
  const alerts = overdueAlerts(projects, today);

  return <section className="panel portfolio-todos">
    <div className="panel-head"><div><span className="section-kicker">NEXT ACTION</span>
      <h3>지금 확인할 일 <em className="scope-badge">전체 미집행 {totalPlans}건 · 증빙 미완료 {totalEvidence}건</em></h3>
      <p>사업을 누르면 그 과제의 집행·증빙 화면에서 상세를 관리합니다.</p></div></div>

    {/* 사업별 요약 — 행 하나가 과제 하나 */}
    <div className="action-list">
      {summaries.map((entry) => <button type="button" key={entry.projectId} className="action-row" onClick={() => onGo(entry.projectId, 'spending')}>
        <strong>{entry.projectName}</strong>
        <span className={entry.pendingPlans ? 'count warn' : 'count'}>미집행 {entry.pendingPlans}건</span>
        <span className={entry.missingEvidence ? 'count warn' : 'count'}>증빙 미완료 {entry.missingEvidence}건</span>
        <ArrowRight />
      </button>)}
    </div>

    {/* 14일 넘게 밀린 것만 텍스트로 — 전부 나열하면 급한 것이 묻힌다 */}
    {alerts.length > 0 && <div className="overdue-alerts">
      {alerts.map((alert, index) => <p key={`${alert.projectId}-${alert.kind}-${index}`}>
        <AlertCircle /> <b>{alert.projectName}</b> · {alert.label}{alert.count ? ` ${alert.count}건` : ''} — <em>{alert.days}일 경과</em>
      </p>)}
    </div>}

  </section>;
}
