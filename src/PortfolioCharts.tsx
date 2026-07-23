// ③ 사업비 편성 구성 그래프 — 전체 도넛(비목) + 사업별 100% 누적막대, 막대 클릭 시 세목 드릴다운.
// 항상 전체 과제 기준으로 고정한다 (기획 결정) — 라벨이 그 사실을 화면에서 말한다.
// 차트 규칙은 dataviz 스킬을 따른다: 검증된 카테고리 팔레트를 고정 순서로 배정하고(순환 금지),
// 세그먼트 사이 2px 표면 간격, 큰 조각만 직접 라벨, 나머지는 호버 툴팁, 표 뷰 제공.
import { useMemo, useState } from 'react';
import { budgetComposition, projectComposition, subItemComposition } from './portfolio';
import { formatWon } from './rules';
import type { Project } from './types';

// dataviz 검증 팔레트 (light, 인접쌍 기준 통과 — validate_palette.js 실행 확인).
// 8개를 넘는 비목은 '기타'로 접는다 — 9번째 색을 만들지 않는다.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#98a1b3';
const OTHER = '기타';

// 색은 전체 편성 큰 순으로 고정 배정한다. 과제가 늘거나 필터돼도 비목의 색은 변하지 않는다.
const colorMapOf = (names: string[]): Map<string, string> => {
  const map = new Map<string, string>();
  names.slice(0, SERIES.length).forEach((name, index) => map.set(name, SERIES[index]));
  map.set(OTHER, OTHER_COLOR);
  return map;
};

// 8개를 넘는 꼬리 비목을 '기타' 한 조각으로 접는다.
const foldOthers = (slices: { name: string; amount: number }[], keep: Set<string>): { name: string; amount: number }[] => {
  const kept = slices.filter((slice) => keep.has(slice.name));
  const other = slices.filter((slice) => !keep.has(slice.name)).reduce((sum, slice) => sum + slice.amount, 0);
  return other > 0 ? [...kept, { name: OTHER, amount: other }] : kept;
};

interface TooltipState { x: number; y: number; title: string; detail: string }

// 도넛 한 조각의 SVG 패스. 2도 남짓의 틈(padAngle)으로 세그먼트 사이 표면 간격을 만든다.
const arcPath = (cx: number, cy: number, r0: number, r1: number, start: number, end: number): string => {
  const pad = Math.min(0.035, (end - start) / 4);   // 아주 작은 조각은 틈을 줄여 사라지지 않게
  const a0 = start + pad;
  const a1 = end - pad;
  const point = (r: number, angle: number) => `${cx + r * Math.sin(angle)} ${cy - r * Math.cos(angle)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${point(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${point(r1, a1)} L ${point(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${point(r0, a0)} Z`;
};

export default function PortfolioCharts({ projects }: { projects: Project[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [drill, setDrill] = useState<string | null>(null);   // 세목 드릴다운으로 펼친 과제 id

  const total = useMemo(() => budgetComposition(projects), [projects]);
  const keep = useMemo(() => new Set(total.slice(0, SERIES.length).map((slice) => slice.name)), [total]);
  const colors = useMemo(() => colorMapOf(total.map((slice) => slice.name)), [total]);
  const donut = foldOthers(total, keep);
  const grand = donut.reduce((sum, slice) => sum + slice.amount, 0);
  if (!grand) return null;

  const move = (event: React.MouseEvent, title: string, detail: string) => {
    const host = (event.currentTarget as Element).closest('.portfolio-charts')!.getBoundingClientRect();
    setTooltip({ x: event.clientX - host.left, y: event.clientY - host.top, title, detail });
  };

  let angle = 0;
  const arcs = donut.map((slice) => {
    const start = angle;
    angle += slice.amount / grand * Math.PI * 2;
    return { ...slice, start, end: angle };
  });

  const drillProject = drill ? projects.find((project) => project.id === drill) : null;

  return <section className="panel portfolio-charts" onMouseLeave={() => setTooltip(null)}>
    <div className="panel-head"><div><span className="section-kicker">COMPOSITION</span>
      <h3>사업비 편성 구성 <em className="scope-badge">전체 사업 기준</em></h3>
      <p>편성 금액이 어느 비목에 쏠려 있는지 봅니다. 아래 과제 막대를 누르면 그 과제의 세목 구성이 열립니다.</p></div></div>

    {/* 범례 — 색과 이름의 대응은 여기 한 곳에서 고정된다 */}
    <div className="chart-legend">{donut.map((slice) => <span key={slice.name}><i style={{ background: colors.get(slice.name) }} />{slice.name}</span>)}</div>

    <div className="charts-row">
      <div className="donut-wrap">
        <svg viewBox="0 0 180 180" role="img" aria-label="전체 편성 비목 구성 도넛">
          {arcs.map((arc) => <path key={arc.name} d={arcPath(90, 90, 52, 84, arc.start, arc.end)} fill={colors.get(arc.name)}
            onMouseMove={(event) => move(event, arc.name, `${formatWon(arc.amount)} · ${(arc.amount / grand * 100).toFixed(1)}%`)}
            onMouseLeave={() => setTooltip(null)} />)}
        </svg>
        <div className="donut-center"><small>전체 편성</small><strong>{formatWon(grand)}</strong></div>
      </div>

      <div className="stack-list">
        {projects.map((project) => {
          const slices = foldOthers(projectComposition(project), keep);
          const sum = slices.reduce((acc, slice) => acc + slice.amount, 0);
          if (!sum) return null;
          return <div key={project.id} className="stack-row">
            <button type="button" className={`stack-name ${drill === project.id ? 'open' : ''}`}
              onClick={() => setDrill((prev) => prev === project.id ? null : project.id)}>
              {project.name}<small>{drill === project.id ? '세목 접기 ▴' : '세목 보기 ▾'}</small>
            </button>
            <div className="stack-bar" role="img" aria-label={`${project.name} 비목 구성`}>
              {slices.map((slice) => {
                const ratio = slice.amount / sum * 100;
                return <i key={slice.name} style={{ width: `${ratio}%`, background: colors.get(slice.name) }}
                  onMouseMove={(event) => move(event, `${project.name} · ${slice.name}`, `${formatWon(slice.amount)} · ${ratio.toFixed(1)}%`)}
                  onMouseLeave={() => setTooltip(null)}>
                  {/* 큰 조각만 직접 라벨 — 대비가 약한 색의 안전장치이기도 하다 (relief rule) */}
                  {ratio >= 18 && <span>{slice.name} {ratio.toFixed(0)}%</span>}
                </i>;
              })}
            </div>
          </div>;
        })}
      </div>
    </div>

    {/* 드릴다운 — 고른 과제의 세목 구성. 색은 그 세목이 속한 비목의 색을 따른다. */}
    {drillProject && (() => {
      const subs = subItemComposition(drillProject);
      const subTotal = subs.reduce((sum, slice) => sum + slice.amount, 0);
      return <div className="drill-panel">
        <strong>{drillProject.name} — 세목 구성</strong>
        <div className="drill-list">{subs.map((slice, index) => <div key={`${slice.category}-${slice.name}-${index}`} className="drill-row">
          <span className="drill-name">{slice.name}{slice.name !== slice.category && <small>{slice.category}</small>}</span>
          <span className="drill-track"><i style={{ width: `${slice.amount / subTotal * 100}%`, background: colors.get(keep.has(slice.category) ? slice.category : OTHER) }} /></span>
          <b>{formatWon(slice.amount)}</b>
        </div>)}</div>
      </div>;
    })()}

    {/* 표 뷰 — 색을 구분하기 어려운 환경의 안전장치 */}
    <details className="chart-table">
      <summary>표로 보기</summary>
      <div className="log-table">
        <div><strong>비목</strong><strong>편성 합계</strong><strong>비중</strong></div>
        {donut.map((slice) => <div key={slice.name}><span>{slice.name}</span><span>{formatWon(slice.amount)}</span><span>{(slice.amount / grand * 100).toFixed(1)}%</span></div>)}
      </div>
    </details>

    {tooltip && <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
      <strong>{tooltip.title}</strong><span>{tooltip.detail}</span>
    </div>}
  </section>;
}
