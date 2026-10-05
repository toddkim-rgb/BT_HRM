import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, ProgressBar } from '../components/ui';
import { qs } from '../lib/api';
import { ASG_ROLE, EMPLOY_TYPE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label, num } from '../lib/format';
import { addMonths, today } from '../lib/dates';
import { useFetch } from '../lib/hooks';

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
}
export interface StaffingResp {
  ym: string;
  months: string[];
  projects: Prj[];
  people: Person[];
}

type Tab = 'project' | 'person' | 'timeline';

/** 프로젝트별 투입인력 현황판: 프로젝트 기준 / 인력 기준 / 월 타임라인 */
export default function Staffing() {
  const [ym, setYm] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<Tab>('project');
  const [q, setQ] = useState('');
  const { data, error, loading } = useFetch<StaffingResp>(`/stats/staffing${qs({ ym })}`);

  const kw = q.trim().toLowerCase();
  // 프로젝트 카드는 진행중 프로젝트만 표시
  const activeProjects = (data?.projects ?? []).filter((p) => p.statusCd === 'ACTIVE');
  const projects = activeProjects.filter((p) => !kw || p.prjCd.toLowerCase().includes(kw) || p.prjNm.toLowerCase().includes(kw) || p.members.some((m) => m.name.includes(q.trim())));
  const people = (data?.people ?? []).filter((p) => !kw || p.name.includes(q.trim()) || p.deptCd.toLowerCase().includes(kw) || p.assignments.some((a) => a.prjNm.toLowerCase().includes(kw)));
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
            <Link className="btn" to="/assignments">
              배정 관리
            </Link>
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
                  ['timeline', '월 타임라인'],
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
            {tab === 'timeline' && <Timeline list={people} months={data.months} />}
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
  return (
    <div className="prj-cards">
      {list.map((p) => {
        const rate = p.planMd ? Math.round((p.actualMd / p.planMd) * 100) : null;
        return (
          <button type="button" className="prj-card" key={p.prjCd} onClick={() => nav(`/staffing/${p.prjCd}?ym=${ym}`)} aria-label={`${p.prjNm} 상세 보기`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6 }}>
                <Badge tone="info">{label(PRJ_TYPE, p.prjType)}</Badge>
              </span>
              <Badge code={p.statusCd}>{label(PRJ_STATUS, p.statusCd)}</Badge>
            </div>
            <div className="prj-card-title">{p.prjNm}</div>
            <div className="small muted">
              {p.customerNm ? `${p.customerNm} · ` : ''}PM {p.pmName ?? '-'}
            </div>

            <dl className="prj-card-facts">
              <div>
                <dt>시작일</dt>
                <dd>{p.startDt ?? '-'}</dd>
              </div>
              <div>
                <dt>종료일</dt>
                <dd>{p.endDt ?? '-'}</dd>
              </div>
              <div>
                <dt>투입인력</dt>
                <dd>
                  <strong>{p.headcount}명</strong>
                </dd>
              </div>
              <div>
                <dt>투입률 합계</dt>
                <dd>
                  <strong>{p.allocTotal}%</strong>
                </dd>
              </div>
            </dl>

            <div className="prj-card-members">
              {p.members.slice(0, 6).map((m) => (
                <span className="chip" key={m.asgId}>
                  {m.name} <small>{m.allocRate}%</small>
                </span>
              ))}
              {p.members.length > 6 && <span className="chip">+{p.members.length - 6}</span>}
              {!p.members.length && <span className="small warn-text">이 달에 배정된 인력이 없습니다</span>}
            </div>

            <div className="prj-card-md">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">{month}월 소요 MD</span>
                <span className="small">
                  <strong>{num(p.actualMd)}</strong> / 계획 {num(p.planMd)}
                </span>
              </div>
              <ProgressBar value={rate} tone={rate != null && rate > 100 ? 'bad' : 'good'} />
              <div className="small muted" style={{ marginTop: 4 }}>
                누적 소요 {num(p.cumMd)} MD
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ByPerson({ list }: { list: Person[] }) {
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
                <strong>{p.name}</strong>{' '}
                <span className="small muted">
                  {p.gradeCd} · {label(EMPLOY_TYPE, p.employType)}
                </span>
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

/** 타임라인 칸에 넣을 짧은 프로젝트명 */
const shortName = (name: string) => (name.length > 9 ? `${name.slice(0, 8)}…` : name);

const cellTone = (total: number) => (total === 0 ? 'tl-0' : total > 100 ? 'tl-over' : total >= 80 ? 'tl-full' : 'tl-part');

function Timeline({ list, months }: { list: Person[]; months: string[] }) {
  if (!list.length) return <Empty />;
  return (
    <>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span>
          <i className="tl-full" />
          80~100%
        </span>
        <span>
          <i className="tl-part" />
          80% 미만
        </span>
        <span>
          <i className="tl-over" />
          과투입
        </span>
        <span>
          <i className="tl-0" />
          대기
        </span>
      </div>
      <div className="table-wrap">
        <table className="tbl tl-table">
          <thead>
            <tr>
              <th>인력</th>
              {months.map((m) => (
                <th key={m}>
                  {m.slice(2, 4)}.{Number(m.slice(5))}월
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.empId}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="small muted">{p.deptCd}</div>
                </td>
                {p.timeline.map((c) => (
                  <td key={c.ym} className={`tl-cell ${cellTone(c.total)}`} title={c.items.map((i) => `${i.prjNm ?? i.prjCd} ${i.pct}%`).join('\n') || '대기'}>
                    <strong>{c.total ? `${c.total}%` : '대기'}</strong>
                    <div className="tl-items">{c.items.map((i) => `${shortName(i.prjNm ?? i.prjCd)} ${i.pct}`).join(' · ')}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        월 투입률 = Σ(배정 영업일 × 투입률) ÷ 그 달 영업일. 월 중간에 시작·종료하는 배정은 그만큼 낮게 표시됩니다.
      </p>
    </>
  );
}
