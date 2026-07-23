// ② 사업별 사업비 구성 — 과제를 체크박스로 켜고 끄면 합계가 따라 바뀌는 재원 표.
// 편성(fundingBreakdown)과 사용(fundingUsage · 집행건의 재원 입력)을 나란히 놓아
// "지원금을 얼마나 받고, 민간 현금·현물을 얼마나 썼는지"를 대조한다.
// 재원을 안 적은 옛 집행건은 미구분 열에 모아 소급 입력을 유도한다.
import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { fundingBreakdown, formatWon } from './rules';
import { fundingUsage } from './portfolio';
import type { Project } from './types';

interface Row {
  project: Project;
  planned: ReturnType<typeof fundingBreakdown>;
  used: ReturnType<typeof fundingUsage>;
}

// 사용액이 편성액을 넘으면 정산 때 문제가 된다 — 셀 단위로 경고한다.
function UseCell({ used, planned, plannedKnown = true }: { used: number; planned: number; plannedKnown?: boolean }) {
  const over = plannedKnown && used > planned;
  return <span className={`fund-cell ${over ? 'over' : ''}`}>
    <strong>{formatWon(used)}</strong>
    <small>{plannedKnown ? `편성 ${formatWon(planned)}` : '편성 비율 미입력'}{over ? ' 초과!' : ''}</small>
  </span>;
}

export default function PortfolioFunding({ projects }: { projects: Project[] }) {
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setUnchecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rows: Row[] = projects.map((project) => ({ project, planned: fundingBreakdown(project), used: fundingUsage(project) }));
  const picked = rows.filter((row) => !unchecked.has(row.project.id));
  const sum = (of: (row: Row) => number) => picked.reduce((acc, row) => acc + of(row), 0);
  const totals = {
    budget: sum((row) => row.project.totalBudget),
    subsidyPlan: sum((row) => row.planned.subsidy), subsidyUse: sum((row) => row.used.subsidy),
    cashPlan: sum((row) => row.planned.matchingCash), cashUse: sum((row) => row.used.matchingCash),
    inKindPlan: sum((row) => row.planned.matchingInKind), inKindUse: sum((row) => row.used.matchingInKind),
    unassigned: sum((row) => row.used.unassigned),
    spent: sum((row) => row.used.total),
  };
  if (!rows.length) return null;

  return <section className="panel portfolio-funding">
    <div className="panel-head"><div><span className="section-kicker">FUNDING</span><h3>사업별 사업비 구성</h3>
      <p>체크한 과제만 합계에 들어갑니다. 사용액은 집행 등록의 재원 입력 기준이고, 재원을 안 적은 집행은 미구분으로 셉니다.</p></div></div>
    <div className="fund-table">
      <div className="fund-row head"><span /><span>과제</span><span>총사업비</span><span>지원금 사용</span><span>민간 현금 사용</span><span>민간 현물 사용</span><span>미구분</span><span>집행률</span></div>
      <div className="fund-row total">
        <span /><span><strong>합계 ({picked.length}개 선택)</strong></span>
        <span className="fund-cell"><strong>{formatWon(totals.budget)}</strong></span>
        <UseCell used={totals.subsidyUse} planned={totals.subsidyPlan} />
        <UseCell used={totals.cashUse} planned={totals.cashPlan} />
        <UseCell used={totals.inKindUse} planned={totals.inKindPlan} />
        <span className={`fund-cell ${totals.unassigned ? 'warn' : ''}`}><strong>{formatWon(totals.unassigned)}</strong>{totals.unassigned > 0 && <small>재원 소급 입력 필요</small>}</span>
        <span className="fund-cell"><strong>{totals.budget ? (totals.spent / totals.budget * 100).toFixed(1) : 0}%</strong></span>
      </div>
      {rows.map(({ project, planned, used }) => <div key={project.id} className={`fund-row ${unchecked.has(project.id) ? 'off' : ''}`}>
        <span><input type="checkbox" aria-label={`${project.name} 합계 포함`} checked={!unchecked.has(project.id)} onChange={() => toggle(project.id)} /></span>
        <span className="fund-name"><strong>{project.name}</strong><small>{project.agency}</small></span>
        <span className="fund-cell"><strong>{formatWon(project.totalBudget)}</strong></span>
        <UseCell used={used.subsidy} planned={planned.subsidy} />
        <UseCell used={used.matchingCash} planned={planned.matchingCash} plannedKnown={planned.matching === 0 || planned.matchingCashRateKnown} />
        <UseCell used={used.matchingInKind} planned={planned.matchingInKind} plannedKnown={planned.matching === 0 || planned.matchingCashRateKnown} />
        <span className={`fund-cell ${used.unassigned ? 'warn' : ''}`}><strong>{formatWon(used.unassigned)}</strong></span>
        <span className="fund-cell"><strong>{project.totalBudget ? (used.total / project.totalBudget * 100).toFixed(1) : 0}%</strong></span>
      </div>)}
    </div>
    {totals.unassigned > 0 && <p className="field-hint"><AlertCircle style={{ width: 13, verticalAlign: -2 }} /> 미구분 {formatWon(totals.unassigned)} — 재원 입력이 생기기 전의 집행건입니다. 집행·증빙 화면에서 집행건을 수정해 재원(지원금/민간 현금/현물)을 골라주면 이 열이 줄어듭니다.</p>}
  </section>;
}
