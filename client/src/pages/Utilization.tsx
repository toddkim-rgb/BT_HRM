import { useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, Modal, PageHeader, ProgressBar } from '../components/ui';
import { qs } from '../lib/api';
import { useAuth, useShowHr } from '../lib/auth';
import { EMPLOY_TYPE } from '../lib/codes';
import { label, num, pct } from '../lib/format';
import { isoWeek, md, shiftWeek, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

/**
 * 가동률 (v1.8): 주 단위 · 그 주에 프로젝트 배정이 있는 인원 ÷ 등록된 전체 인원 × 100
 * 부분 투입도 1명으로 셈. 기본은 지난주.
 */
interface Row {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  employType: string;
  assigned: boolean;
  allocTotal: number;
  projects: { prjCd: string; prjNm: string; allocRate: number; roleCd: string }[];
  reportedMd: number;
  status: 'ASSIGNED' | 'PLANNED' | 'BENCH' | null; // 오늘 기준 인원 구분
  plannedStartDt: string | null;
}
interface Group {
  key: string;
  total: number;
  assigned: number;
  rate: number | null;
}
interface TrendPoint {
  week: string;
  start: string;
  total: number;
  assigned: number;
  rate: number | null;
  projected: boolean;
}
interface Resp {
  week: string;
  days: string[];
  total: number;
  assigned: number;
  notAssigned: number;
  rate: number | null;
  prevRate: number | null;
  diff: number | null;
  rows: Row[];
  byDept: Group[];
  byEmployType: Group[];
  trend: TrendPoint[];
}

const lastWeek = () => shiftWeek(isoWeek(today()), -1);
const diffText = (d: number | null) => (d == null ? undefined : `전주 대비 ${d >= 0 ? '▲' : '▼'}${Math.abs(d)}%p`);

export default function Utilization() {
  const { user } = useAuth();
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  const isEmp = user?.role === 'EMP' && !user?.isPm; // 일반 수행인력은 본인만
  const [week, setWeek] = useState(lastWeek());
  const { data, error, loading } = useFetch<Resp>(`/stats/utilization${qs({ week })}`);
  const [sort, setSort] = useState<'assigned' | 'name' | 'dept'>('assigned');
  const [trend, setTrend] = useState<Row | null>(null);

  const rows = [...(data?.rows ?? [])].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'dept' ? a.deptCd.localeCompare(b.deptCd) || a.name.localeCompare(b.name) : Number(a.assigned) - Number(b.assigned) || a.name.localeCompare(b.name),
  );
  const isFuture = week >= isoWeek(today());

  return (
    <div>
      <PageHeader
        title="가동률"
        desc={
          <>
            가동률(주) = 그 주에 <b>프로젝트 배정</b>이 있는 인원 ÷ 등록된 전체 인원 × 100. 부분 투입(50% 등)도 1명으로 셉니다. 대상 인원은 삭제·퇴사·휴직을 제외한 투입 대상 인력이며, 기본은 <b>지난주</b>입니다.
          </>
        }
        actions={
          <div className="week-nav">
            <button className="btn sm" onClick={() => setWeek(shiftWeek(week, -1))} aria-label="이전 주">
              ◀
            </button>
            <span style={{ minWidth: 150, textAlign: 'center' }}>
              <strong>{weekLabel(week)}</strong>
            </span>
            <button className="btn sm" onClick={() => setWeek(shiftWeek(week, 1))} aria-label="다음 주">
              ▶
            </button>
            {week !== lastWeek() && (
              <button className="btn sm" onClick={() => setWeek(lastWeek())}>
                지난주
              </button>
            )}
          </div>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis">
            <Kpi label={isFuture ? '가동률 (배정 기준 예상)' : '가동률'} value={pct(data.rate)} sub={diffText(data.diff)} />
            <Kpi label="대상 인원" value={`${data.total}명`} />
            <Kpi label="투입" value={`${data.assigned}명`} sub="그 주 배정 있음" />
            <Kpi label="미투입" value={`${data.notAssigned}명`} sub="그 주 배정 없음" tone={data.notAssigned ? 'warn' : undefined} />
          </div>

          {!isEmp && <TrendCard trend={data.trend} week={week} onPick={setWeek} />}
          {!isEmp && <Attention rows={data.rows} week={week} />}
          {!isEmp && (
            <div className="grid cols-2" style={{ marginBottom: 16 }}>
              <GroupCard title="조직별" rows={data.byDept} />
              <GroupCard title="고용형태별" rows={data.byEmployType} map={EMPLOY_TYPE} />
            </div>
          )}

          <Card
            title={`인력별 · ${weekLabel(week)}`}
            actions={
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }}>
                <option value="assigned">미투입 먼저</option>
                <option value="dept">소속순</option>
                <option value="name">이름순</option>
              </select>
            }
          >
            {!rows.length ? (
              <Empty />
            ) : (
              <div className="table-wrap">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th>인력</th>
                      <th>소속</th>
                      {showHr && <th>고용형태</th>}
                      <th>투입</th>
                      <th>배정 프로젝트</th>
                      <th className="num" title="제출된 주간 업무보고 기준 (참고)">
                        보고 MD
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.empId}>
                        <td data-label="인력">
                          <span className="small muted">{r.gradeCd}</span> <strong>{r.name}</strong>
                        </td>
                        <td data-label="소속">{r.deptCd}</td>
                        {showHr && <td data-label="고용형태">{label(EMPLOY_TYPE, r.employType)}</td>}
                        <td data-label="투입">{r.assigned ? <Badge tone="good">투입</Badge> : <Badge tone="warn">미투입</Badge>}</td>
                        <td data-label="배정 프로젝트">
                          {r.projects.length ? (
                            <span className="small">
                              {r.projects.map((p) => (
                                <span key={p.prjCd} title={p.prjCd} style={{ marginRight: 8 }}>
                                  {p.prjNm} {p.allocRate}%
                                </span>
                              ))}
                              {r.allocTotal > 100 && <Badge tone="bad">과투입 {r.allocTotal}%</Badge>}
                            </span>
                          ) : (
                            <span className="muted small">-</span>
                          )}
                        </td>
                        <td data-label="보고 MD" className="num">
                          {num(r.reportedMd)}
                        </td>
                        <td data-label="">
                          <button className="btn sm" onClick={() => setTrend(r)}>
                            추이
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
      {trend && <TrendModal row={trend} week={week} onClose={() => setTrend(null)} />}
    </div>
  );
}

/** 최근 12주 가동률 + 이후 4주 예상(현재 배정 기준) */
function TrendCard({ trend, week, onPick }: { trend: TrendPoint[]; week: string; onPick: (w: string) => void }) {
  return (
    <Card title="주간 가동률 추이" actions={<span className="small muted">옅은 막대 = 이번 주 이후 (배정 기준 예상)</span>}>
      <div className="bars" role="img" aria-label="주간 가동률 막대그래프">
        {trend.map((t) => (
          <div
            className="bar-col"
            key={t.week}
            title={`${weekLabel(t.week)} · ${t.assigned}/${t.total}명 · ${pct(t.rate)}`}
            onClick={() => onPick(t.week)}
            style={{ cursor: 'pointer', outline: t.week === week ? '2px solid var(--primary)' : undefined, borderRadius: 4 }}
          >
            <div className="small">{t.rate != null ? `${Math.round(t.rate)}%` : '-'}</div>
            <div className="bar-pair" style={{ height: '70%' }}>
              <div className={`bar ${t.projected ? 'plan' : 'actual'}`} style={{ height: `${Math.min(100, t.rate ?? 0)}%` }} />
            </div>
            <div className="bar-label">{md(t.start)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 주의 인력: 그 주 미투입 · 오늘 기준 대기 / 투입 예정 · 그 주 과투입 */
function Attention({ rows, week }: { rows: Row[]; week: string }) {
  const notAssigned = rows.filter((r) => !r.assigned);
  const bench = rows.filter((r) => r.status === 'BENCH');
  const planned = rows.filter((r) => r.status === 'PLANNED');
  const over = rows.filter((r) => r.allocTotal > 100);
  const Item = ({ title, tone, list, render }: { title: string; tone: string; list: Row[]; render: (r: Row) => string }) => (
    <div className="attn-box">
      <div className="row" style={{ marginBottom: 6 }}>
        <Badge tone={list.length ? tone : 'neutral'}>{list.length}명</Badge>
        <strong>{title}</strong>
      </div>
      <div className="small">{list.length ? list.map(render).join(', ') : <span className="muted">없음</span>}</div>
    </div>
  );
  return (
    <Card title="주의 인력" className="attn-card">
      <div className="attn-grid">
        <Item title={`미투입 (${weekLabel(week)} 배정 없음)`} tone="warn" list={notAssigned} render={(r) => r.name} />
        <Item title="대기 (오늘 기준 현재·예정 배정 없음)" tone="warn" list={bench} render={(r) => r.name} />
        <Item title="투입 예정 (오늘 기준 시작 전 배정)" tone="info" list={planned} render={(r) => `${r.name}(${r.plannedStartDt ? md(r.plannedStartDt) : ''}~)`} />
        <Item title="과투입 (배정 합계 100% 초과)" tone="bad" list={over} render={(r) => `${r.name}(${r.allocTotal}%)`} />
      </div>
    </Card>
  );
}

function TrendModal({ row, week, onClose }: { row: Row; week: string; onClose: () => void }) {
  const { data } = useFetch<{ week: string; assigned: boolean; projects: { prjCd: string; prjNm: string; allocRate: number }[]; reportedMd: number }[]>(
    `/stats/utilization/${row.empId}/trend${qs({ week })}`,
  );
  const cnt = data?.filter((d) => d.assigned).length ?? 0;
  return (
    <Modal title={`주간 투입 추이 · ${row.name}`} onClose={onClose}>
      {!data ? (
        <Loading />
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            최근 12주 중 {cnt}주 투입 ({Math.round((cnt / data.length) * 100)}%)
          </p>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>주차</th>
                  <th>투입</th>
                  <th>배정 프로젝트</th>
                  <th className="num">보고 MD</th>
                </tr>
              </thead>
              <tbody>
                {data.map((w) => (
                  <tr key={w.week}>
                    <td>
                      {weekLabel(w.week)}
                    </td>
                    <td>{w.assigned ? <Badge tone="good">투입</Badge> : <Badge tone="warn">미투입</Badge>}</td>
                    <td className="small">{w.projects.map((p) => `${p.prjNm} ${p.allocRate}%`).join(' · ') || '-'}</td>
                    <td className="num">{num(w.reportedMd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function GroupCard({ title, rows, map }: { title: string; rows: Group[]; map?: Record<string, string> }) {
  return (
    <Card title={title}>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>구분</th>
              <th className="num">투입/대상</th>
              <th>가동률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{map ? label(map, r.key) : r.key}</td>
                <td className="num">
                  {r.assigned}/{r.total}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                    <div style={{ flex: 1, maxWidth: 90 }}>
                      <ProgressBar value={r.rate} />
                    </div>
                    <span className="num" style={{ minWidth: 48 }}>
                      {pct(r.rate)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
