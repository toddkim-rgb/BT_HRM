import { useState } from 'react';
import { Card, Empty, ErrorBox, Kpi, Loading, PageHeader, ProgressBar } from '../components/ui';
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
  util: number | null;
  paidUtil: number | null;
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
  summary: Summary;
  byDept: Summary[];
  byEmployType: Summary[];
  rows: Row[];
}

const utilTone = (u: number | null) => (u == null ? undefined : u >= 85 ? 'good' : u >= 70 ? 'warn' : 'bad');

export default function Utilization() {
  const { user } = useAuth();
  const [ym, setYm] = useState(today().slice(0, 7));
  const { data, error, loading } = useFetch<Resp>(`/stats/utilization${qs({ ym })}`);
  const [sort, setSort] = useState<'name' | 'util' | 'paidUtil'>('util');

  const rows = [...(data?.rows ?? [])].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] ?? -1) - (a[sort] ?? -1)));

  return (
    <div>
      <PageHeader
        title="가동률"
        desc={
          <>
            총 가동률 = 프로젝트 투입MD(SM·SI·내부·제안·기타) ÷ 가용MD · 유상 가동률 = SM+SI 투입MD ÷ 가용MD. 가용MD = 영업일 − 휴가. <b>PM이 승인한 실적만</b> 집계합니다.
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
          </div>
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
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.empId}>
                        <td data-label="인력">
                          <strong>{r.name}</strong> <span className="small muted">{r.gradeCd}</span>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
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
