import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, ProgressBar, PrjTypeBadge } from '../components/ui';
import { qs } from '../lib/api';
import { ASG_ROLE, EMPLOY_TYPE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label, num } from '../lib/format';
import { addMonths, today } from '../lib/dates';
import { useFetch } from '../lib/hooks';
import { useAuth, useShowHr } from '../lib/auth';

export interface Member {
  asgId: number;
  empId: string;
  name: string;
  gradeCd: string;
  skillLevel: string;
  employType: string;
  roleCd: string;
  allocRate: number;
  startDt: string;
  endDt: string;
  active: boolean;
  planMd: number;
  actualMd: number;
}
export interface Prj {
  prjCd: string;
  prjNm: string;
  prjType: string;
  statusCd: string;
  customerNm: string | null;
  pmName: string | null;
  startDt: string | null;
  endDt: string | null;
  contractMm: number | null;
  headcount: number;
  allocTotal: number;
  cumMd: number;
  planMd: number;
  actualMd: number;
  planMm: number;
  actualMm: number;
  members: Member[];
}
interface Person {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  skillLevel: string;
  employType: string;
  currentAlloc: number;
  overAlloc: number;
  inWorkforce: boolean; // 대상 인원 (휴직·투입 대상 아님 제외)
  plannedAlloc: number;
  plannedStartDt: string | null;
  projectCount: number;
  assignments: { asgId: number; prjCd: string; prjNm: string; roleCd: string; allocRate: number; startDt: string; endDt: string; planMd: number; actualMd: number }[];
  timeline: { ym: string; total: number; items: { prjCd: string; prjNm?: string; pct: number }[] }[];
  weekly: { week: string; total: number; items: { prjCd: string; prjNm?: string; pct: number }[] }[];
}
export interface StaffingResp {
  ym: string;
  months: string[];
  weeks: WeekCol[];
  projects: Prj[];
  people: Person[];
}

type Tab = 'project' | 'person' | 'timeline';
/** 주별 칸: ISO 주(월~일), ym = 목요일이 속한 달, n = 그 달의 몇 번째 주 */
interface WeekCol {
  week: string;
  start: string;
  end: string;
  ym: string;
  n: number;
}

/** 프로젝트별 투입인력 현황판: 프로젝트 기준 / 인력 기준 / 월 타임라인 */
export default function Staffing() {
  const { can } = useAuth();
  const [ym, setYm] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<Tab>('project');
  const [q, setQ] = useState('');
  const { data, error, loading } = useFetch<StaffingResp>(`/stats/staffing${qs({ ym })}`);
  // 주별 투입현황은 지난달부터 6개월 (선택한 달 기준)
  const { data: tl } = useFetch<StaffingResp>(tab === 'timeline' ? `/stats/staffing${qs({ ym: addMonths(ym, -1), months: 6 })}` : null);

  const kw = q.trim().toLowerCase();
  // 프로젝트 카드는 진행중 프로젝트만 표시
  const activeProjects = (data?.projects ?? []).filter((p) => p.statusCd === 'ACTIVE');
  const projects = activeProjects.filter((p) => !kw || p.prjCd.toLowerCase().includes(kw) || p.prjNm.toLowerCase().includes(kw) || p.members.some((m) => m.name.includes(q.trim())));
  const filterPeople = (list: Person[]) => list.filter((p) => !kw || p.name.includes(q.trim()) || p.deptCd.toLowerCase().includes(kw) || p.assignments.some((a) => a.prjNm.toLowerCase().includes(kw)));
  const people = filterPeople(data?.people ?? []);
  const all = data?.people ?? [];
  const wfAll = all.filter((p) => p.inWorkforce); // 인원 집계 기준 (대시보드·One-Page와 동일)

  return (
    <div>
      <PageHeader
        title="프로젝트별 투입현황"
        desc="어느 프로젝트에 누가, 얼마나 투입되어 있는지 봅니다. 진행중인 프로젝트만 카드로 표시하며, 카드를 누르면 상세로 이동합니다. 소요 MD는 제출된 주간 업무보고 기준, 계획 MD는 배정 투입률 기준입니다."
        actions={
          <>
            <div className="week-nav">
              <button className="btn sm" onClick={() => setYm(addMonths(ym, -1))} aria-label="이전 달">
                ◀
              </button>
              <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} style={{ width: 150 }} />
              <button className="btn sm" onClick={() => setYm(addMonths(ym, 1))} aria-label="다음 달">
                ▶
              </button>
            </div>
            {can('assignments') && (
              <Link className="btn" to="/assignments">
                배정 관리
              </Link>
            )}
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis">
            <Kpi label="진행중 프로젝트" value={`${activeProjects.length}개`} sub={activeProjects.some((p) => !p.headcount) ? `투입 인력 없음 ${activeProjects.filter((p) => !p.headcount).length}개` : undefined} />
            <Kpi label="투입 인원" value={`${all.filter((p) => p.assignments.length).length}명`} sub={`${Number(ym.slice(5))}월 배정 기준`} />
            <Kpi label="다중 투입" value={`${all.filter((p) => p.projectCount > 1).length}명`} sub="2개 이상 프로젝트" />
            <Kpi label="과투입 (오늘)" value={`${wfAll.filter((p) => p.overAlloc > 0).length}명`} tone={wfAll.some((p) => p.overAlloc > 0) ? 'bad' : undefined} />
            <Kpi label="투입 예정" value={`${wfAll.filter((p) => !p.currentAlloc && p.plannedAlloc > 0).length}명`} sub="시작 전 배정만 있음" />
            <Kpi label="대기" value={`${wfAll.filter((p) => !p.currentAlloc && !p.plannedAlloc).length}명`} sub="현재·예정 배정 없음" tone={wfAll.some((p) => !p.currentAlloc && !p.plannedAlloc) ? 'warn' : undefined} />
          </div>
          <Card>
            <div className="tabs" role="tablist">
              {(
                [
                  ['project', '프로젝트별'],
                  ['person', '인력별'],
                  ['timeline', '주별 투입현황'],
                ] as [Tab, string][]
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="filters">
              <input type="search" placeholder="프로젝트·인력·소속 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {tab === 'project' && <ByProject list={projects} ym={ym} />}
            {tab === 'person' && <ByPerson list={people} />}
            {tab === 'timeline' && (tl ? <Timeline list={filterPeople(tl.people)} months={tl.months} weeks={tl.weeks} /> : <Loading />)}
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** 프로젝트 카드: 프로젝트명 · 투입인력 · 투입률 · 시작일/종료일 · 소요 MD */
function ByProject({ list, ym }: { list: Prj[]; ym: string }) {
  const nav = useNavigate();
  if (!list.length) return <Empty>진행중인 프로젝트가 없습니다.</Empty>;
  const month = Number(ym.slice(5));
  // 투입 배정 화면과 같은 카드: 기본은 주요 정보만, 마우스를 올리면(포커스) 반전 + 상세 펼침, 누르면 상세 페이지
  return (
    <div className="board-projects">
      {list.map((p) => {
        const rate = p.planMd ? Math.round((p.actualMd / p.planMd) * 100) : null;
        const ended = ['DONE', 'STOP'].includes(p.statusCd);
        const go = () => nav(`/staffing/${p.prjCd}?ym=${ym}`);
        return (
          <section
            key={p.prjCd}
            className={`board-prj clickable ${ended ? 'ended' : ''}`}
            tabIndex={0}
            role="link"
            aria-label={`${p.prjNm} 상세 보기`}
            onClick={go}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6 }}>
                <PrjTypeBadge type={p.prjType}>{label(PRJ_TYPE, p.prjType)}</PrjTypeBadge>
                <Badge code={p.statusCd}>{label(PRJ_STATUS, p.statusCd)}</Badge>
              </span>
              <span className="small muted">
                {p.headcount}명 · {p.allocTotal}%
              </span>
            </div>
            <div className="board-prj-title" title={p.prjCd}>
              {p.prjNm}
            </div>
            <div className="board-members">
              {p.members.map((m) => (
                <div className="board-chip" key={m.asgId}>
                  <span className="board-chip-main">
                    <strong>
                      <span className="muted">{m.gradeCd}</span> {m.name}
                      {m.roleCd === 'PM' && <span className="board-pm">PM</span>}
                    </strong>
                  </span>
                </div>
              ))}
              {!p.members.length && <div className="board-drop-hint">{month}월에 배정된 인력 없음</div>}
            </div>
            <div className="board-prj-detail">
              <div className="board-detail-meta">
                {p.customerNm ? `${p.customerNm} · ` : ''}PM {p.pmName ?? '-'} · {p.startDt ?? '-'} ~ {p.endDt ?? '-'}
              </div>
              {p.members.length > 0 && (
                <ul className="board-detail-members">
                  {p.members.map((m) => (
                    <li key={m.asgId}>
                      <span>
                        {m.gradeCd} {m.name}
                      </span>
                      <span>
                        {m.allocRate}% · {label(ASG_ROLE, m.roleCd)} · {month}월 {num(m.actualMd)}/{num(m.planMd)} MD
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="board-final-md">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{month}월 소요 MD</strong>
                  <span>
                    {num(p.actualMd)} / 계획 {num(p.planMd)}
                  </span>
                </div>
                <ProgressBar value={rate} tone={rate != null && rate > 100 ? 'bad' : 'good'} />
                <div style={{ marginTop: 4 }}>누적 소요 {num(p.cumMd)} MD</div>
              </div>
              <div className="board-status-actions small">상세 보기 →</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ByPerson({ list }: { list: Person[] }) {
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  if (!list.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table className="tbl responsive">
        <thead>
          <tr>
            <th>인력</th>
            <th>소속</th>
            <th className="num">현재 투입률</th>
            <th>투입 프로젝트 (역할 · 투입률 · 기간)</th>
            <th className="num">계획 MD</th>
            <th className="num">실적 MD</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.empId}>
              <td data-label="인력">
                <span className="small muted">{p.gradeCd}</span> <strong>{p.name}</strong>
                {showHr && <div className="small muted">{label(EMPLOY_TYPE, p.employType)}</div>}
              </td>
              <td data-label="소속">{p.deptCd}</td>
              <td data-label="현재 투입률" className="num">
                {p.currentAlloc ? `${p.currentAlloc}%` : p.plannedAlloc ? null : <Badge tone="warn">대기</Badge>}
                {p.plannedAlloc > 0 && (
                  <div title={`${p.plannedStartDt}부터 투입 예정`}>
                    <Badge tone="neutral">예정 {p.plannedAlloc}%</Badge>
                  </div>
                )}
                {p.overAlloc > 0 && (
                  <div>
                    <Badge tone="bad">과투입 +{p.overAlloc}%</Badge>
                  </div>
                )}
              </td>
              <td data-label="투입 프로젝트" className="small">
                {p.assignments.length
                  ? p.assignments.map((a) => (
                      <div key={a.asgId}>
                        <strong>{a.prjNm}</strong> · {label(ASG_ROLE, a.roleCd)} {a.allocRate}% · {a.startDt.slice(5)} ~ {a.endDt.slice(5)}
                      </div>
                    ))
                  : '-'}
              </td>
              <td data-label="계획 MD" className="num">
                {num(p.assignments.reduce((s, a) => s + a.planMd, 0))}
              </td>
              <td data-label="실적 MD" className="num">
                {num(p.assignments.reduce((s, a, i, arr) => (arr.findIndex((x) => x.prjCd === a.prjCd) === i ? s + a.actualMd : s), 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 히트맵 색 (한 가지 파랑, 많을수록 진하게 — 순차 단계, 검증 통과) / 과투입은 상태색(빨강) + '!' 표시
 * 0% = 대기(중립 회색)
 */
const HEAT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const heatOf = (v: number) => (v <= 0 ? null : v > 100 ? 'over' : HEAT[Math.min(4, Math.ceil(v / 20) - 1)]);

type Cell = { total: number; items: { prjCd: string; prjNm?: string; pct: number }[] };
interface Col {
  key: string;
  label: string;
  sub: string;
  ym: string;
  range: string;
  of: (p: Person) => Cell | undefined;
}
interface Tip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function Timeline({ list, months, weeks }: { list: Person[]; months: string[]; weeks: WeekCol[] }) {
  // 월별로 접기: 접힌 달은 월 합계 한 칸, 펼친 달은 주별 칸
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<Tip | null>(null);
  const toggle = (ym: string) =>
    setFolded((s) => {
      const n = new Set(s);
      if (n.has(ym)) n.delete(ym);
      else n.add(ym);
      return n;
    });
  if (!list.length) return <Empty />;
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  const monthLabel = (m: string) => `${m.slice(2, 4)}.${Number(m.slice(5))}월`;
  const cols: Col[] = months.flatMap<Col>((m) =>
    folded.has(m)
      ? [{ key: m, label: '월 합계', sub: '', ym: m, range: monthLabel(m), of: (p: Person) => p.timeline.find((c) => c.ym === m) }]
      : weeks
          .filter((w) => w.ym === m)
          .map((w) => ({ key: w.week, label: `${w.n}주`, sub: `${md(w.start)}~`, ym: m, range: `${w.start} ~ ${w.end}`, of: (p: Person) => p.weekly.find((c) => c.week === w.week) })),
  );
  const span = (m: string) => cols.filter((c) => c.ym === m).length || 1;

  // 주별 투입 인원(FTE) = Σ투입률 ÷ 100, 기준선 = 대상 인원
  const fte = cols.map((c) => Math.round(list.reduce((s, p) => s + (c.of(p)?.total ?? 0), 0)) / 100);
  const head = list.length;
  const maxV = Math.max(head, ...fte, 1);
  const show = (e: MouseEvent, title: string, lines: string[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, title, lines });
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div className="legend tl-legend" aria-label="범례">
          <span>투입률</span>
          {['1~20', '21~40', '41~60', '61~80', '81~100'].map((l, i) => (
            <span key={l}>
              <i style={{ background: HEAT[i] }} />
              {l}%
            </span>
          ))}
          <span>
            <i className="tl-over-sw">!</i>
            과투입(100% 초과)
          </span>
          <span>
            <i className="tl-zero-sw" />
            대기
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setFolded(new Set(months))}>
            모두 월별
          </button>
          <button className="btn sm" onClick={() => setFolded(new Set())}>
            모두 주별
          </button>
        </div>
      </div>
      <div className="table-wrap" onScroll={() => setTip(null)}>
        <table className="tl-heat">
          <thead>
            <tr>
              <th rowSpan={2} className="tl-name">인력</th>
              {months.map((m) => {
                const f = folded.has(m);
                return (
                  <th key={m} colSpan={span(m)} className="tl-month" onClick={() => toggle(m)} title={f ? '주별로 펼치기' : '월별로 접기'}>
                    {monthLabel(m)} <span className="muted">{f ? '▸' : '▾'}</span>
                  </th>
                );
              })}
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className="tl-week" title={c.range}>
                  {c.sub ? c.label.replace('주', '') : '월'}
                </th>
              ))}
            </tr>
            <tr className="tl-chart-row">
              <th className="tl-name" title="투입 인원(FTE) = 투입률 합 ÷ 100, 점선 = 대상 인원">
                투입 인원 <span className="muted">/ {head}명</span>
              </th>
              {cols.map((c, i) => (
                <td key={c.key} onMouseEnter={(e) => show(e, c.range, [`투입 인원 ${fte[i]}명 (FTE)`, `대상 인원 ${head}명`, `가동 ${head ? Math.round((fte[i] / head) * 100) : 0}%`])} onMouseLeave={() => setTip(null)}>
                  <div className="tl-bar-wrap">
                    <div className="tl-ref" style={{ bottom: `${(head / maxV) * 100}%` }} />
                    <div className="tl-bar" style={{ height: `${(fte[i] / maxV) * 100}%` }} />
                  </div>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.empId}>
                <td className="tl-name" title={`${p.gradeCd} ${p.name} · ${p.deptCd}`}>
                  <span className="muted">{p.gradeCd}</span> {p.name} <span className="muted">{p.deptCd}</span>
                </td>
                {cols.map((c) => {
                  const v = c.of(p);
                  const total = v?.total ?? 0;
                  const h = heatOf(total);
                  return (
                    <td
                      key={c.key}
                      className="tl-hcell"
                      aria-label={`${p.name} ${c.range} ${total}%`}
                      onMouseEnter={(e) => show(e, `${p.name} · ${c.range}`, total ? v!.items.map((i) => `${i.prjNm ?? i.prjCd} ${i.pct}%`).concat(`합계 ${total}%`) : ['대기 (배정 없음)'])}
                      onMouseLeave={() => setTip(null)}
                    >
                      <i className={h === 'over' ? 'over' : h ? '' : 'zero'} style={h && h !== 'over' ? { background: h } : undefined}>
                        {h === 'over' ? '!' : null}
                      </i>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip && (
        <div className="tl-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <strong>{tip.title}</strong>
          {tip.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>
        칸 색 = 투입률(%) = Σ(배정 영업일 × 투입률) ÷ 그 주(접힌 달은 그 달) 영업일. 위 막대는 주별 투입 인원(FTE = 투입률 합 ÷ 100), 점선은 대상 인원입니다. 주 머리글 숫자는 그 달의 몇 번째 주입니다. 주(월~일)는 목요일이 속한 달로 묶고, 월 머리글을 누르면 그 달을 월별로 접거나 펼칩니다. 칸에 마우스를 올리면 프로젝트별 내역이 보입니다.
      </p>
    </>
  );
}
