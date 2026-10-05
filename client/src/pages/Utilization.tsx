import { useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, Modal, PageHeader, ProgressBar } from '../components/ui';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EMPLOY_TYPE } from '../lib/codes';
import { label, num, pct } from '../lib/format';
import { addMonths, today } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface Row {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  employType: string;
  businessDays: number;
  leaveMd: number;
  availMd: number;
  totalMd: number;
  paidMd: number;
  reportedMd: number;
  byProject: { prjCd: string; prjNm?: string; md: number }[];
  util: number | null;
  paidUtil: number | null;
  inactive: boolean;
  currentAlloc: number;
  plannedAlloc: number;
  plannedStartDt: string | null;
  workforce: 'ASSIGNED' | 'PLANNED' | 'BENCH' | null;
  nextUtil: number | null;
  nextPaidUtil: number | null;
}
interface Summary {
  key?: string;
  headcount: number;
  availMd: number;
  totalMd: number;
  paidMd: number;
  util: number | null;
  paidUtil: number | null;
}
interface Resp {
  ym: string;
  nextYm: string;
  lowUtilPct: number;
  summary: Summary & { nextUtil: number | null };
  byDept: Summary[];
  byEmployType: Summary[];
  rows: Row[];
}

// 색 기준: 저가동 기준값(기준값 설정 LOW_UTIL_PCT, DB) 미만 = 위험, 기준값+15%p 미만 = 주의
let LOW_UTIL = 70;
const utilTone = (u: number | null) => (u == null ? undefined : u >= LOW_UTIL + 15 ? 'good' : u >= LOW_UTIL ? 'warn' : 'bad');

export default function Utilization() {
  const { user } = useAuth();
  const [ym, setYm] = useState(today().slice(0, 7));
  const { data, error, loading } = useFetch<Resp>(`/stats/utilization${qs({ ym })}`);
  if (data) LOW_UTIL = data.lowUtilPct;
  const [sort, setSort] = useState<'name' | 'util' | 'paidUtil'>('util');
  const [trend, setTrend] = useState<Row | null>(null);

  const rows = [...(data?.rows ?? [])].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] ?? -1) - (a[sort] ?? -1)));

  return (
    <div>
      <PageHeader
        title="가동률"
        desc={
          <>
            총 가동률 = 프로젝트 투입MD(SM·SI·내부·제안·기타) ÷ 가용MD · 유상 가동률 = SM+SI 투입MD ÷ 가용MD. 가용MD = 영업일 − 휴가 (진행 중인 달은 오늘까지). <b>제출된 주간 업무보고</b>만 집계합니다. 다음 달 예상은 배정 투입률 기준입니다.
          </>
        }
        actions={
          <div className="week-nav">
            <button className="btn sm" onClick={() => setYm(addMonths(ym, -1))} aria-label="이전 달">
              ◀
            </button>
            <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} style={{ width: 150 }} />
            <button className="btn sm" onClick={() => setYm(addMonths(ym, 1))} aria-label="다음 달">
              ▶
            </button>
          </div>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis">
            <Kpi label={user?.role === 'EMP' ? '대상' : '대상 인원'} value={`${data.summary.headcount}명`} />
            <Kpi label="총 가동률" value={pct(data.summary.util)} tone={utilTone(data.summary.util)} />
            <Kpi label="유상 가동률" value={pct(data.summary.paidUtil)} tone={utilTone(data.summary.paidUtil)} />
            <Kpi label="가용 MD" value={num(data.summary.availMd)} />
            <Kpi label="투입 MD" value={num(data.summary.totalMd)} sub={`유상 ${num(data.summary.paidMd)}`} />
            <Kpi label={`${Number(data.nextYm.slice(5))}월 예상 가동률`} value={pct(data.summary.nextUtil)} sub="배정 기준 평균" tone={utilTone(data.summary.nextUtil)} />
          </div>
          {user?.role !== 'EMP' && <Attention rows={data.rows} lowUtilPct={data.lowUtilPct} nextMonth={Number(data.nextYm.slice(5))} />}
          {user?.role !== 'EMP' && (
            <div className="grid cols-2" style={{ marginBottom: 16 }}>
              <GroupCard title="조직별" rows={data.byDept} />
              <GroupCard title="고용형태별" rows={data.byEmployType} map={EMPLOY_TYPE} />
            </div>
          )}
          <Card
            title="인력별"
            actions={
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }}>
                <option value="util">총 가동률순</option>
                <option value="paidUtil">유상 가동률순</option>
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
                      <th>고용형태</th>
                      <th className="num">영업일</th>
                      <th className="num">휴가</th>
                      <th className="num">가용MD</th>
                      <th className="num">투입MD</th>
                      <th className="num">유상MD</th>
                      <th>총 가동률</th>
                      <th>유상 가동률</th>
                      <th className="num">{Number(data.nextYm.slice(5))}월 예상</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.empId}>
                        <td data-label="인력">
                          <strong>{r.name}</strong> <span className="small muted">{r.gradeCd}</span> {r.inactive && <Badge tone="neutral">삭제·퇴사</Badge>}
                        </td>
                        <td data-label="소속">{r.deptCd}</td>
                        <td data-label="고용형태">{label(EMPLOY_TYPE, r.employType)}</td>
                        <td data-label="영업일" className="num">
                          {r.businessDays}
                        </td>
                        <td data-label="휴가" className="num">
                          {num(r.leaveMd)}
                        </td>
                        <td data-label="가용MD" className="num">
                          {num(r.availMd)}
                        </td>
                        <td data-label="투입MD" className="num">
                          {num(r.totalMd)}
                          {r.byProject.length > 1 && (
                            <div className="small muted" title="다중 프로젝트 투입">
                              {r.byProject.map((b) => `${b.prjNm ?? b.prjCd} ${num(b.md)}`).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td data-label="유상MD" className="num">
                          {num(r.paidMd)}
                        </td>
                        <td data-label="총 가동률">
                          <UtilCell v={r.util} />
                        </td>
                        <td data-label="유상 가동률">
                          <UtilCell v={r.paidUtil} />
                        </td>
                        <td data-label="다음 달 예상" className={`num ${utilTone(r.nextUtil) ?? ''}-text`} title="배정 투입률 기준 다음 달 예상 가동률">
                          {pct(r.nextUtil)}
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
      {trend && <TrendModal row={trend} onClose={() => setTrend(null)} />}
    </div>
  );
}

/** 주의가 필요한 인력: 대기 · 저가동 · 과투입 · 다음 달 투입 공백 */
function Attention({ rows: allRows, lowUtilPct, nextMonth }: { rows: Row[]; lowUtilPct: number; nextMonth: number }) {
  const rows = allRows.filter((r) => !r.inactive); // 삭제·퇴사 인력 제외
  const bench = rows.filter((r) => r.workforce === 'BENCH');
  const planned = rows.filter((r) => r.workforce === 'PLANNED');
  const low = rows.filter((r) => r.util != null && r.availMd > 0 && r.util < lowUtilPct && r.currentAlloc > 0);
  const over = rows.filter((r) => r.currentAlloc > 100);
  const gap = rows.filter((r) => r.currentAlloc > 0 && r.nextUtil != null && r.nextUtil < 50);
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
        <Item title="대기 (현재·예정 배정 없음)" tone="warn" list={bench} render={(r) => r.name} />
        <Item title="투입 예정 (시작 전 배정)" tone="info" list={planned} render={(r) => `${r.name}(${r.plannedStartDt ? r.plannedStartDt.slice(5).replace('-', '/') : ''}~)`} />
        <Item title={`저가동 (${lowUtilPct}% 미만)`} tone="warn" list={low} render={(r) => `${r.name}(${r.util}%)`} />
        <Item title="과투입 (투입률 100% 초과)" tone="bad" list={over} render={(r) => `${r.name}(+${r.currentAlloc - 100}%)`} />
        <Item title={`${nextMonth}월 투입 공백 (예상 50% 미만)`} tone="info" list={gap} render={(r) => `${r.name}(${r.nextUtil}%)`} />
      </div>
    </Card>
  );
}

function TrendModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const { data } = useFetch<{ ym: string; util: number | null; paidUtil: number | null; totalMd: number }[]>(`/stats/utilization/${row.empId}/trend?months=6`);
  return (
    <Modal title={`가동률 추이 · ${row.name}`} onClose={onClose}>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="legend" style={{ marginBottom: 6 }}>
            <span>
              <i style={{ background: '#b9cbe3' }} />총 가동률
            </span>
            <span>
              <i style={{ background: 'var(--primary-2)' }} />
              유상 가동률
            </span>
          </div>
          <div className="bars" role="img" aria-label="최근 6개월 가동률 막대그래프">
            {data.map((m) => (
              <div className="bar-col" key={m.ym} title={`${m.ym} 총 ${m.util ?? '-'}% / 유상 ${m.paidUtil ?? '-'}%`}>
                <div className="small">{m.util != null ? `${Math.round(m.util)}%` : '-'}</div>
                <div className="bar-pair" style={{ height: '70%' }}>
                  <div className="bar plan" style={{ height: `${Math.min(100, m.util ?? 0)}%` }} />
                  <div className="bar actual" style={{ height: `${Math.min(100, m.paidUtil ?? 0)}%` }} />
                </div>
                <div className="bar-label">{Number(m.ym.slice(5))}월</div>
              </div>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>월</th>
                  <th className="num">투입 MD</th>
                  <th className="num">총 가동률</th>
                  <th className="num">유상 가동률</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.ym}>
                    <td>{m.ym}</td>
                    <td className="num">{num(m.totalMd)}</td>
                    <td className="num">{pct(m.util)}</td>
                    <td className="num">{pct(m.paidUtil)}</td>
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

function UtilCell({ v }: { v: number | null }) {
  const tone = utilTone(v);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120, justifyContent: 'flex-end' }}>
      <div style={{ flex: 1, maxWidth: 90 }}>
        <ProgressBar value={v} tone={tone} />
      </div>
      <span className={`num ${tone ?? ''}-text`} style={{ minWidth: 48 }}>
        {pct(v)}
      </span>
    </div>
  );
}

function GroupCard({ title, rows, map }: { title: string; rows: Summary[]; map?: Record<string, string> }) {
  return (
    <Card title={title}>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>구분</th>
              <th className="num">인원</th>
              <th className="num">총 가동률</th>
              <th className="num">유상 가동률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{map ? label(map, r.key) : r.key}</td>
                <td className="num">{r.headcount}</td>
                <td className="num">{pct(r.util)}</td>
                <td className="num">{pct(r.paidUtil)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
