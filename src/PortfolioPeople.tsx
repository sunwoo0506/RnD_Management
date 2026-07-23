// 연구인력 참여율 현황 — 사업 하나가 열 하나인 사람×사업 매트릭스.
// 총 참여율 100% 초과와 3책 5공(책임 3건·전체 5건 초과)을 경고한다.
// 확인할 일(④)과는 성격이 달라 별도 섹션이다 (사용자 결정).
import { AlertCircle, ShieldCheck, Users } from 'lucide-react';
import { participationTable } from './portfolio';
import type { Project } from './types';

export default function PortfolioPeople({ projects }: { projects: Project[] }) {
  const people = participationTable(projects);
  if (!people.length) return null;
  const columns = { gridTemplateColumns: `0.9fr 0.7fr repeat(${projects.length}, 0.8fr) 1fr` };

  return <section className="panel portfolio-people">
    <div className="panel-head"><div><span className="section-kicker">PEOPLE</span>
      <h3><Users style={{ width: 15, verticalAlign: -2 }} /> 연구인력 참여율</h3>
      <p>같은 사람은 과제마다 이름이 똑같아야 합쳐집니다. 연구책임자는 예산 편성의 인건비 산정에서 지정합니다.</p></div></div>
    <div className="people-table">
      <div className="people-row head" style={columns}><span>연구자</span><span>총 참여율</span>{projects.map((project) => <span key={project.id}>{project.name}</span>)}<span>과제 수 (3책 5공)</span></div>
      {people.map((person) => {
        const overRate = person.total > 100;
        const overLead = person.leadCount > 3;
        const overCount = person.projects.length > 5;
        const byProject = new Map(person.projects.map((entry) => [entry.id, entry]));
        return <div className={`people-row ${overRate ? 'over' : ''}`} style={columns} key={person.name}>
          <span className="person-name">{person.name}</span>
          <span className={`person-total ${overRate ? 'over' : ''}`}>{person.total}%{overRate && <AlertCircle />}</span>
          {projects.map((project) => {
            const entry = byProject.get(project.id);
            return <span key={project.id} className="person-rate">{entry ? <>{entry.rate}%{entry.isLead && <b title="연구책임자">책임</b>}</> : '—'}</span>;
          })}
          <span className={overLead || overCount ? 'person-count over' : 'person-count'}>
            책임 {person.leadCount} / 전체 {person.projects.length}
            {(overLead || overCount) && <small>{overLead ? '3책 초과' : '5공 초과'}</small>}
          </span>
        </div>;
      })}
    </div>
    <p className="field-hint"><ShieldCheck style={{ width: 13, verticalAlign: -2 }} /> 총 참여율 100% 초과, 연구책임자 3건 초과(3책), 참여 과제 5건 초과(5공)를 경고합니다.</p>
  </section>;
}
