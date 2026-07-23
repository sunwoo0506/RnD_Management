// ③ 사업비 편성 구성 — 상단 칩(전체 | 과제…)으로 집계 범위를 고르는 도넛 하나.
// 전체를 보다가 사업 하나를 짚으면 도넛이 그 사업의 구성으로 바뀐다 (파이 그래프만, 세목 막대 없음 — 사용자 결정).
// 색은 전체 편성 큰 순으로 고정 배정한다 — 범위를 바꿔도 비목의 색이 흔들리지 않는다.
// 차트 규칙은 dataviz 스킬을 따른다: 검증된 팔레트, 세그먼트 틈, 호버 툴팁, 범례, 표 뷰.
import { useMemo, useState } from 'react';
import { budgetComposition, formatThousandWon, projectComposition } from './portfolio';
import ThousandWon from './ThousandWon';
import type { Project } from './types';

// 파스텔 톤 팔레트 — validate_palette.js 통과본. 완전히 연한 파스텔은 색약 구분·대비 검사에
// 실패해서, 채도를 조금 남긴 파스텔로 맞췄다. 대비 부족분은 툴팁·범례·표 뷰가 보완한다.
// 1번 슬롯은 DESIGN-slack.md 브랜드 오버진의 파스텔 톤으로 앵커했고, 파랑은 7번에 유지해 인접 구분을 지켰다.
const SERIES = ['#b183bd', '#e0895c', '#4fb98e', '#d4a83c', '#d685aa', '#77a94f', '#6d9bd8', '#d97676'];
const OTHER_COLOR = '#b3bac7';
const OTHER = '기타';

const colorMapOf = (names: string[]): Map<string, string> => {
  const map = new Map<string, string>();
  names.slice(0, SERIES.length).forEach((name, index) => map.set(name, SERIES[index]));
  map.set(OTHER, OTHER_COLOR);
  return map;
};

const foldOthers = (slices: { name: string; amount: number }[], keep: Set<string>): { name: string; amount: number }[] => {
  const kept = slices.filter((slice) => keep.has(slice.name));
  const other = slices.filter((slice) => !keep.has(slice.name)).reduce((sum, slice) => sum + slice.amount, 0);
  return other > 0 ? [...kept, { name: OTHER, amount: other }] : kept;
};

interface TooltipState { x: number; y: number; title: string; detail: string }

// 도넛 한 조각의 SVG 패스. 작은 틈(padAngle)이 세그먼트 사이 표면 간격을 만든다.
const arcPath = (cx: number, cy: number, r0: number, r1: number, start: number, end: number): string => {
  const pad = Math.min(0.035, (end - start) / 4);
  const a0 = start + pad;
  const a1 = end - pad;
  const point = (r: number, angle: number) => `${cx + r * Math.sin(angle)} ${cy - r * Math.cos(angle)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${point(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${point(r1, a1)} L ${point(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${point(r0, a0)} Z`;
};

export default function PortfolioCharts({ projects }: { projects: Project[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [scope, setScope] = useState<string | null>(null);   // null = 전체, 아니면 과제 id

  // 색 배정 기준은 항상 전체 — 고른 범위와 분리해야 색이 흔들리지 않는다.
  const allComposition = useMemo(() => budgetComposition(projects), [projects]);
  const keep = useMemo(() => new Set(allComposition.slice(0, SERIES.length).map((slice) => slice.name)), [allComposition]);
  const colors = useMemo(() => colorMapOf(allComposition.map((slice) => slice.name)), [allComposition]);

  const scoped = scope ? projects.find((project) => project.id === scope) ?? null : null;
  const donut = foldOthers(scoped ? projectComposition(scoped) : allComposition, keep);
  const grand = donut.reduce((sum, slice) => sum + slice.amount, 0);
  if (!allComposition.length) return null;

  const move = (event: React.MouseEvent, title: string, detail: string) => {
    const host = (event.currentTarget as Element).closest('.portfolio-charts')!.getBoundingClientRect();
    setTooltip({ x: event.clientX - host.left, y: event.clientY - host.top, title, detail });
  };

  let angle = 0;
  const arcs = donut.map((slice) => {
    const start = angle;
    angle += slice.amount / (grand || 1) * Math.PI * 2;
    return { ...slice, start, end: angle };
  });

  return <section className="panel portfolio-charts" onMouseLeave={() => setTooltip(null)}>
    <div className="panel-head"><div><span className="section-kicker">COMPOSITION</span>
      <h3>사업비 편성 구성</h3>
      <p>편성 금액이 어느 비목에 쏠려 있는지 봅니다. 사업을 고르면 도넛이 그 사업 기준으로 바뀝니다.</p></div></div>

    {/* 집계 범위 — 전체 또는 사업 하나. 도넛이 이 선택을 따라간다. */}
    <div className="scope-chips">
      <button type="button" className={scope === null ? 'active' : ''} onClick={() => setScope(null)}>전체 사업</button>
      {projects.map((project) => <button type="button" key={project.id} aria-label={`${project.name} 기준으로 보기`}
        className={scope === project.id ? 'active' : ''}
        onClick={() => setScope((prev) => prev === project.id ? null : project.id)}>{project.name}</button>)}
    </div>

    <div className="charts-row">
      <div className="donut-wrap">
        <svg viewBox="0 0 200 200" role="img" aria-label="편성 비목 구성 도넛">
          {arcs.map((arc) => <path key={arc.name} d={arcPath(100, 100, 58, 94, arc.start, arc.end)} fill={colors.get(arc.name)}
            onMouseMove={(event) => move(event, arc.name, `${formatThousandWon(arc.amount)} · ${grand ? (arc.amount / grand * 100).toFixed(1) : 0}%`)}
            onMouseLeave={() => setTooltip(null)} />)}
        </svg>
        <div className="donut-center"><small>{scoped ? scoped.name : '전체 편성'}</small><strong><ThousandWon value={grand} /></strong></div>
      </div>

      <div className="chart-side">
        <div className="chart-legend">{donut.map((slice) => <span key={slice.name}><i style={{ background: colors.get(slice.name) }} />{slice.name} <b>{grand ? (slice.amount / grand * 100).toFixed(0) : 0}%</b></span>)}</div>
      </div>
    </div>

    {/* 표 뷰 — 색을 구분하기 어려운 환경의 안전장치 */}
    <details className="chart-table">
      <summary>표로 보기</summary>
      <div className="log-table">
        <div><strong>비목</strong><strong>편성 합계</strong><strong>비중</strong></div>
        {donut.map((slice) => <div key={slice.name}><span>{slice.name}</span><span><ThousandWon value={slice.amount} /></span><span>{grand ? (slice.amount / grand * 100).toFixed(1) : 0}%</span></div>)}
      </div>
    </details>

    {tooltip && <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
      <strong>{tooltip.title}</strong><span>{tooltip.detail}</span>
    </div>}
  </section>;
}
