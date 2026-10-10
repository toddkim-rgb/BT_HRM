import { useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { MoneyInput } from '../components/NumInputs';
import { Badge, Card, Empty, ErrorBox, Field, Kpi, Loading, PageHeader, PrjTypeBadge, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { EXPENSE_TYPE, JUDGE, fullWon, krw, pctText, type Judge } from '../lib/profit';

type PlStatus = 'OK' | 'RESERVE' | 'OVER' | 'NO_BASE';
interface Pl {
  prjCd: string;
  prjNm: string;
  prjType: string;
  customerNm: string | null;
  statusCd: string;
  startDt: string | null;
  endDt: string | null;
  elapsed: number | null;
  revenue: { amount: number; source: 'CONTRACT' | 'PROPOSED' } | null;
  baseline: { simId: number; version: number; name: string; mm: number; labor: number; expense: number; reserve: number; totalCost: number; targetRate: number; minRate: number; confirmedAt: string | null } | null;
  actual: { md: number; labor: number; ownLabor: number; partnerLabor: number; expense: number; cost: number };
  remaining: { md: number; labor: number; expense: number };
  forecast: { cost: number; profit: number | null; margin: number | null; judge: Judge | null };
  burn: number | null;
  variance: number | null;
  status: PlStatus;
  warnings: string[];
}
interface PlDetail extends Pl {
  monthly: { ym: string; baseline: number; actual: number; plan: number }[];
  people: { empId: string; name: string; grade: string; partner: boolean; actualMd: number; actualCost: number; remainingMd: number; remainingCost: number }[];
  expenses: { exId: number; expenseYm: string; expenseType: string; amount: number; memo: string | null }[];
}

export const PL_STATUS: Record<PlStatus, { label: string; tone: string; desc: string }> = {
  OK: { label: '예산 내', tone: 'good', desc: '예상 최종 원가가 기준선 인건비+경비 이내' },
  RESERVE: { label: '예비비 사용', tone: 'warn', desc: '기준선 인건비+경비를 넘어 예비비를 쓰는 중' },
  OVER: { label: '예산 초과', tone: 'bad', desc: '예상 최종 원가가 기준선 총원가(예비비 포함) 초과' },
  NO_BASE: { label: '기준선 없음', tone: 'neutral', desc: '실행예산 기준선을 확정하면 계획 대비 비교' },
};

/** 수익성 분석 화면 탭 */
export function ProfitTabs() {
  return (
    <nav className="tabs profit-tabs no-print">
      <NavLink to="/profit" end>
        사업비 시뮬레이션
      </NavLink>
      <NavLink to="/profit/actual">실적 손익</NavLink>
    </nav>
  );
}

const signed = (n: number | null) => (n == null ? '-' : `${n > 0 ? '+' : ''}${krw(n)}`);

export default function ProfitActual() {
  const { prjCd } = useParams();
  return prjCd ? <ActualDetail prjCd={prjCd} /> : <ActualList />;
}

function ActualList() {
  const nav = useNavigate();
  const { data, error } = useFetch<Pl[]>('/profit/actuals');
  const [filter, setFilter] = useState<'ACTIVE' | 'DONE' | 'ALL'>('ACTIVE');
  const list = useMemo(
    () =>
      (data ?? [])
        .filter((p) => (filter === 'ALL' ? true : filter === 'ACTIVE' ? p.statusCd === 'ACTIVE' : p.statusCd === 'DONE'))
        .filter((p) => p.baseline || p.revenue || p.actual.cost > 0)
        .sort((a, b) => ['OVER', 'RESERVE', 'OK', 'NO_BASE'].indexOf(a.status) - ['OVER', 'RESERVE', 'OK', 'NO_BASE'].indexOf(b.status) || a.prjNm.localeCompare(b.prjNm)),
    [data, filter],
  );
  // 사업구분별 합계 (사업비가 있는 프로젝트)
  const sums = ['SI', 'SM'].map((t) => {
    const ps = list.filter((p) => p.prjType === t && p.revenue);
    const rev = ps.reduce((s, p) => s + p.revenue!.amount, 0);
    const profit = ps.reduce((s, p) => s + (p.forecast.profit ?? 0), 0);
    return { t, n: ps.length, rev, profit, margin: rev ? (profit / rev) * 100 : null };
  });
  return (
    <div>
      <PageHeader title="수익성 분석" desc="실행예산 기준선 대비 실적 원가(주간보고 투입 MD × 1인 일 원가 + 경비)와 종료 시 예상 이익률을 봅니다." />
      <ProfitTabs />
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            {sums.map((s) => (
              <Kpi key={s.t} label={`${PRJ_TYPE[s.t]} 예상 이익률 (${s.n}개)`} value={pctText(s.margin)} sub={`사업비 ${krw(s.rev)} · 예상 이익 ${krw(s.profit)}`} />
            ))}
            <Kpi label="예산 초과" value={`${list.filter((p) => p.status === 'OVER').length}개`} tone={list.some((p) => p.status === 'OVER') ? 'bad' : undefined} sub="예상 최종 원가 > 기준선 총원가" />
            <Kpi label="예비비 사용" value={`${list.filter((p) => p.status === 'RESERVE').length}개`} tone={list.some((p) => p.status === 'RESERVE') ? 'warn' : undefined} sub="인건비+경비 계획 초과" />
          </div>
          <div className="row" style={{ gap: 6, margin: '4px 0 10px' }}>
            {(
              [
                ['ACTIVE', '진행중'],
                ['DONE', '완료'],
                ['ALL', '전체'],
              ] as const
            ).map(([k, v]) => (
              <button key={k} className={`btn sm ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>
                {v}
              </button>
            ))}
          </div>
          {!list.length ? (
            <Empty>표시할 프로젝트가 없습니다. 계약금액·실행예산 기준선·실적이 있는 프로젝트가 나타납니다.</Empty>
          ) : (
            <Card>
              <div className="table-wrap">
                <table className="tbl sim-tbl pl-tbl">
                  <thead>
                    <tr>
                      <th>프로젝트</th>
                      <th>상태</th>
                      <th className="r">사업비</th>
                      <th className="r">기준선 총원가</th>
                      <th className="r">실적 원가</th>
                      <th>소진 / 경과</th>
                      <th className="r">예상 최종 원가</th>
                      <th className="r">기준선 대비</th>
                      <th className="r">예상 이익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.prjCd} className="clickable" onClick={() => nav(`/profit/actual/${p.prjCd}`)}>
                        <td>
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <PrjTypeBadge type={p.prjType}>{label(PRJ_TYPE, p.prjType)}</PrjTypeBadge>
                            <span>
                              <strong>{p.prjNm}</strong>
                              <div className="small muted">{[p.customerNm, label(PRJ_STATUS, p.statusCd)].filter(Boolean).join(' · ')}</div>
                            </span>
                          </span>
                        </td>
                        <td title={PL_STATUS[p.status].desc}>
                          <Badge tone={PL_STATUS[p.status].tone}>{PL_STATUS[p.status].label}</Badge>
                        </td>
                        <td className="r nowrap">
                          {krw(p.revenue?.amount)}
                          {p.revenue?.source === 'PROPOSED' && <div className="small muted">기준선 제안가</div>}
                        </td>
                        <td className="r nowrap">{p.baseline ? `${krw(p.baseline.totalCost)} (v${p.baseline.version})` : '-'}</td>
                        <td className="r nowrap">{krw(p.actual.cost)}</td>
                        <td style={{ minWidth: 130 }}>
                          <BurnBar burn={p.burn} elapsed={p.elapsed} />
                        </td>
                        <td className="r nowrap">{krw(p.forecast.cost)}</td>
                        <td className={`r nowrap ${p.variance != null && p.variance > 0 ? 'bad-text' : ''}`}>{signed(p.variance)}</td>
                        <td className="r nowrap">{p.forecast.margin != null ? `${p.forecast.judge ? JUDGE[p.forecast.judge].icon : ''} ${pctText(p.forecast.margin)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <p className="small muted">
            실적 원가 = 제출된 주간보고 투입 MD × 1인 일 원가 + 경비 실적. 예상 최종 원가 = 실적 + 내일부터 남은 배정 계획 MD × 1인 일 원가 + 남은 계획 경비. 사업비는 프로젝트 계약금액(없으면 기준선 제안가).
          </p>
        </>
      )}
    </div>
  );
}

/** 원가 소진율(기준선 인건비+경비 대비) vs 기간 경과율 */
function BurnBar({ burn, elapsed }: { burn: number | null; elapsed: number | null }) {
  if (burn == null) return <span className="small muted">{elapsed != null ? `경과 ${pctText(elapsed)}` : '-'}</span>;
  const tone = elapsed != null && burn > elapsed + 10 ? 'bad' : elapsed != null && burn < elapsed - 10 ? 'warn' : 'good';
  return (
    <div className="burn" title={`원가 소진 ${pctText(burn)} · 기간 경과 ${pctText(elapsed)}`}>
      <div className="burn-track">
        <span className={`burn-fill ${tone}`} style={{ width: `${Math.min(100, burn)}%` }} />
        {elapsed != null && <i style={{ left: `${elapsed}%` }} />}
      </div>
      <span className="small">
        {pctText(burn)} <span className="muted">/ {pctText(elapsed)}</span>
      </span>
    </div>
  );
}

function ActualDetail({ prjCd }: { prjCd: string }) {
  const { data: d, error, reload } = useFetch<PlDetail>(`/profit/actuals/${prjCd}`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const b = d.baseline;
  return (
    <div>
      <PageHeader
        title={`${d.prjNm} · 실적 손익`}
        desc={
          <>
            {label(PRJ_TYPE, d.prjType)} · {d.customerNm ?? ''} · {d.startDt ?? '-'} ~ {d.endDt ?? '-'} <Badge tone={PL_STATUS[d.status].tone}>{PL_STATUS[d.status].label}</Badge>
          </>
        }
        actions={
          <span className="row no-print" style={{ gap: 6 }}>
            <Link className="btn" to="/profit/actual">
              ← 목록
            </Link>
            {b && (
              <Link className="btn" to={`/profit/sim/${b.simId}`}>
                기준선 v{b.version} 보기
              </Link>
            )}
            <button className="btn" onClick={() => window.print()}>
              인쇄 / PDF
            </button>
          </span>
        }
      />
      <div className="kpis">
        <Kpi label="사업비" value={krw(d.revenue?.amount)} sub={d.revenue ? (d.revenue.source === 'CONTRACT' ? '프로젝트 계약금액' : `기준선 v${b?.version} 제안가`) : '계약금액 없음'} />
        <Kpi label={b ? `기준선 총원가 (v${b.version})` : '기준선 총원가'} value={b ? krw(b.totalCost) : '-'} sub={b ? `인건비 ${krw(b.labor)} · 경비 ${krw(b.expense)} · 예비비 ${krw(b.reserve)}` : '실행예산 기준선 없음'} />
        <Kpi label="실적 원가 (오늘까지)" value={krw(d.actual.cost)} sub={`${d.actual.md.toLocaleString('ko-KR')} MD · 소진 ${pctText(d.burn)} / 경과 ${pctText(d.elapsed)}`} />
        <Kpi
          label="예상 최종 원가"
          value={krw(d.forecast.cost)}
          sub={`남은 인건비 ${krw(d.remaining.labor)}${d.variance != null ? ` · 기준선 대비 ${signed(d.variance)}` : ''}`}
          tone={d.status === 'OVER' ? 'bad' : d.status === 'RESERVE' ? 'warn' : undefined}
        />
        <Kpi
          label="예상 이익률"
          value={d.forecast.margin != null ? `${d.forecast.judge ? JUDGE[d.forecast.judge].icon : ''} ${pctText(d.forecast.margin)}` : '-'}
          sub={d.forecast.profit != null ? `예상 이익 ${krw(d.forecast.profit)}${b ? ` · 목표 ${b.targetRate}% / 최소 ${b.minRate}%` : ''}` : '사업비 필요'}
          tone={d.forecast.judge ? JUDGE[d.forecast.judge].tone : undefined}
        />
      </div>
      {d.warnings.length > 0 && (
        <div className="alert warn sim-warn">
          {d.warnings.map((w) => (
            <div key={w}>· {w}</div>
          ))}
        </div>
      )}
      <div className="stack">
        <div className="grid cols-2">
          <CompareCard d={d} />
          <ExpenseCard d={d} reload={reload} />
        </div>
        <MonthlyPlCard d={d} />
        <PeopleCard d={d} />
      </div>
    </div>
  );
}

/** 원가 구성: 기준선 vs 예상(실적 + 남은 계획) */
function CompareCard({ d }: { d: PlDetail }) {
  const b = d.baseline;
  const rows: [string, number | null, number, number | null][] = [
    ['인건비', b?.labor ?? null, d.actual.labor + d.remaining.labor, d.actual.labor],
    ['직접경비', b?.expense ?? null, d.actual.expense + d.remaining.expense, d.actual.expense],
    ['예비비', b?.reserve ?? null, 0, null],
  ];
  const total = (i: 1 | 2) => rows.reduce((s, r) => s + ((r[i] as number | null) ?? 0), 0);
  return (
    <Card title="원가: 기준선 vs 예상 최종">
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th />
              <th className="r">기준선</th>
              <th className="r">예상 최종</th>
              <th className="r">그중 실적</th>
              <th className="r">차이</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, base, fc, act]) => (
              <tr key={name}>
                <th>{name}</th>
                <td className="r">{krw(base)}</td>
                <td className="r">{name === '예비비' ? '-' : krw(fc)}</td>
                <td className="r">{act == null ? '-' : krw(act)}</td>
                <td className={`r ${base != null && name !== '예비비' && fc > base ? 'bad-text' : ''}`}>{base == null || name === '예비비' ? '-' : signed(fc - base)}</td>
              </tr>
            ))}
            <tr className="sim-current">
              <th>총원가</th>
              <td className="r">
                <strong>{b ? krw(total(1)) : '-'}</strong>
              </td>
              <td className="r">
                <strong>{krw(total(2))}</strong>
              </td>
              <td className="r">{krw(d.actual.cost)}</td>
              <td className={`r ${d.variance != null && d.variance > 0 ? 'bad-text' : ''}`}>{signed(d.variance)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        자사 인건비 {krw(d.actual.ownLabor)} · 협력사 {krw(d.actual.partnerLabor)} (실적). 예비비는 계획에만 있으며, 예상 최종 원가가 인건비+경비 계획을 넘으면 예비비를 쓰는 것으로 봅니다.
      </p>
    </Card>
  );
}

function ExpenseCard({ d, reload }: { d: PlDetail; reload: () => void }) {
  const editable = useAuth().can('profit', 'EDIT');
  const toast = useToast();
  const [f, setF] = useState({ expenseYm: new Date().toISOString().slice(0, 7), expenseType: 'TRAVEL', amount: null as number | null, memo: '' });
  const add = async () => {
    try {
      await api.post('/profit/expenses', { prjCd: d.prjCd, ...f, memo: f.memo || null });
      setF((s) => ({ ...s, amount: null, memo: '' }));
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  const remove = async (exId: number) => {
    if (!window.confirm('이 경비를 삭제할까요?')) return;
    await api.del(`/profit/expenses/${exId}`);
    reload();
  };
  return (
    <Card title={`직접경비 실적 (${krw(d.actual.expense)}${d.baseline ? ` / 계획 ${krw(d.baseline.expense)}` : ''})`}>
      {editable && (
        <div className="form-grid no-print" style={{ marginBottom: 10 }}>
          <Field label="월">
            <input type="month" value={f.expenseYm} onChange={(e) => e.target.value && setF((s) => ({ ...s, expenseYm: e.target.value }))} />
          </Field>
          <Field label="항목">
            <select value={f.expenseType} onChange={(e) => setF((s) => ({ ...s, expenseType: e.target.value }))}>
              {Object.entries(EXPENSE_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="금액">
            <MoneyInput value={f.amount} placeholder="원" onChange={(v) => setF((s) => ({ ...s, amount: v }))} />
          </Field>
          <Field label="내용">
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input value={f.memo} maxLength={100} onChange={(e) => setF((s) => ({ ...s, memo: e.target.value }))} />
              <button className="btn primary" disabled={!f.amount} onClick={add}>
                추가
              </button>
            </span>
          </Field>
        </div>
      )}
      {!d.expenses.length ? (
        <Empty>입력된 경비 실적이 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <tbody>
              {d.expenses.map((x) => (
                <tr key={x.exId}>
                  <td className="nowrap">{x.expenseYm}</td>
                  <td>{EXPENSE_TYPE[x.expenseType] ?? x.expenseType}</td>
                  <td className="r nowrap">{fullWon(x.amount)}</td>
                  <td className="small">{x.memo}</td>
                  {editable && (
                    <td className="r no-print">
                      <button className="btn sm ghost" onClick={() => remove(x.exId)} aria-label="경비 삭제">
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.remaining.expense > 0 && <p className="small muted" style={{ marginBottom: 0 }}>남은 계획 경비 {krw(d.remaining.expense)}는 예상 최종 원가에 포함됩니다.</p>}
    </Card>
  );
}

/** 월별: 기준선 계획 vs 실적(지난달까지) / 남은 계획(앞으로), 누계 */
function MonthlyPlCard({ d }: { d: PlDetail }) {
  if (!d.monthly.length) return null;
  const max = Math.max(1, ...d.monthly.map((m) => Math.max(m.baseline, m.actual + m.plan)));
  let cb = 0;
  let cf = 0;
  const cum = d.monthly.map((m) => {
    cb += m.baseline;
    cf += m.actual + m.plan;
    return { cb, cf };
  });
  return (
    <Card title="월별 원가: 기준선 vs 실적 · 남은 계획">
      <div className="pl-chart" aria-hidden>
        {d.monthly.map((m) => (
          <div key={m.ym} className="pl-col" title={`${m.ym} 기준선 ${fullWon(m.baseline)} / 실적 ${fullWon(m.actual)} / 남은 계획 ${fullWon(m.plan)}`}>
            <span className="pl-base" style={{ height: `${(m.baseline / max) * 100}%` }} />
            <span className="pl-act">
              <span className="pl-plan" style={{ height: `${(m.plan / max) * 100}%` }} />
              <span className="pl-done" style={{ height: `${(m.actual / max) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
      <div className="pl-legend small">
        <span>
          <i className="pl-base" /> 기준선 계획
        </span>
        <span>
          <i className="pl-done" /> 실적
        </span>
        <span>
          <i className="pl-plan" /> 남은 배정 계획
        </span>
      </div>
      <div className="table-wrap">
        <table className="tbl sim-month-tbl">
          <thead>
            <tr>
              <th />
              {d.monthly.map((m) => (
                <th key={m.ym} className="r">
                  {m.ym.slice(2).replace('-', '.')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>기준선</th>
              {d.monthly.map((m) => (
                <td key={m.ym} className="r">
                  {m.baseline ? krw(m.baseline) : '-'}
                </td>
              ))}
            </tr>
            <tr>
              <th>실적</th>
              {d.monthly.map((m) => (
                <td key={m.ym} className="r">
                  {m.actual ? krw(m.actual) : '-'}
                </td>
              ))}
            </tr>
            <tr>
              <th>남은 계획</th>
              {d.monthly.map((m) => (
                <td key={m.ym} className="r muted">
                  {m.plan ? krw(m.plan) : '-'}
                </td>
              ))}
            </tr>
            <tr>
              <th>누계 차이</th>
              {cum.map((c, i) => (
                <td key={d.monthly[i].ym} className={`r ${d.baseline && c.cf > c.cb ? 'bad-text' : ''}`}>
                  {d.baseline ? signed(c.cf - c.cb) : '-'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        기준선 월별 값은 인건비 계획에 경비·예비비를 기간에 고르게 나눠 더한 값입니다. 누계 차이 = (실적 + 남은 계획) 누계 − 기준선 누계.
      </p>
    </Card>
  );
}

function PeopleCard({ d }: { d: PlDetail }) {
  if (!d.people.length) return null;
  return (
    <Card title="인력별 원가 (실적 · 남은 배정)">
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>인력</th>
              <th className="r">실적 MD</th>
              <th className="r">실적 원가</th>
              <th className="r">남은 MD</th>
              <th className="r">남은 원가</th>
              <th className="r">합계</th>
            </tr>
          </thead>
          <tbody>
            {d.people.map((p) => (
              <tr key={p.empId}>
                <td>
                  <span className="small muted">{p.grade}</span> <strong>{p.name}</strong> {p.partner && <Badge tone="neutral">협력사</Badge>}
                </td>
                <td className="r">{p.actualMd.toLocaleString('ko-KR')}</td>
                <td className="r">{krw(p.actualCost)}</td>
                <td className="r">{p.remainingMd.toLocaleString('ko-KR')}</td>
                <td className="r">{krw(p.remainingCost)}</td>
                <td className="r">
                  <strong>{krw(p.actualCost + p.remainingCost)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
