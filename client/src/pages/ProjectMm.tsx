import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, Select, PrjTypeBadge } from '../components/ui';
import { ASG_ROLE, EMPLOY_TYPE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label, num, pct } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { RateBar, baseLabel, type ProjectRate } from '../components/ProjectRate';
import { useShowHr } from '../lib/auth';

interface Summary {
  prjCd: string;
  prjNm: string;
  prjType: string;
  customerNm: string | null;
  statusCd: string;
  startDt: string | null;
  endDt: string | null;
  pmName: string | null;
  headcount: number;
  contractMm: number | null;
  planMm: number;
  planToDateMm: number;
  actualMm: number;
  burnRate: number | null;
  pr: ProjectRate | null;
}
interface Detail extends Summary {
  monthly: { ym: string; planMm: number; actualMm: number }[];
  members: {
    asgId: number;
    empId: string;
    roleCd: string;
    startDt: string;
    endDt: string;
    allocRate: number;
    planMm: number;
    actualMmByEmp: number;
    employee: { name: string; gradeCd: string; deptCd: string; skillLevel: string; employType: string };
  }[];
}

const burnTone = (b: number | null) => (b == null ? undefined : b >= 100 ? 'bad' : b >= 80 ? 'warn' : 'good');

export default function ProjectMm() {
  const { prjCd } = useParams();
  return prjCd ? <ProjectDetail prjCd={prjCd} /> : <ProjectList />;
}

function ProjectList() {
  const { data, error, loading } = useFetch<Summary[]>('/stats/projects');
  const { data: settings } = useFetch<Record<string, string>>('/admin/settings');
  const mdPerMm = settings?.MD_PER_MM ?? '22';
  const nav = useNavigate();
  const [showDone, setShowDone] = useState(false);
  // 진행중 → 완료 순, 진행중은 과소·과다를 위로
  const order = ['UNDER', 'OVER', 'NO_BASE', 'NORMAL', 'NOT_STARTED', 'DONE'];
  const rows = (data ?? [])
    .filter((p) => p.statusCd !== 'PROPOSAL' && (showDone || !['DONE', 'STOP'].includes(p.statusCd)))
    .sort((a, b) => order.indexOf(a.pr?.status ?? 'NORMAL') - order.indexOf(b.pr?.status ?? 'NORMAL'));
  const doneCount = (data ?? []).filter((p) => ['DONE', 'STOP'].includes(p.statusCd)).length;
  return (
    <div>
      <PageHeader
        title="프로젝트 투입률"
        desc={`투입률 = 누적 실적 MD ÷ 기준 MD (종료 시 100% 목표). 기준 MD = 계약 MM × ${mdPerMm}MD, 계약 MM이 없으면 배정 계획 MD. 실적 MD는 제출된 주간 업무보고 기준. 진행 중에는 기간 경과율과 비교해 ±10%p를 넘으면 과소·과다로 표시하고, 종료 예상 = (실적 + 남은 배정 계획) ÷ 기준입니다.`}
        actions={
          doneCount > 0 && (
            <label className="check small">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 완료 프로젝트 포함 ({doneCount})
            </label>
          )
        }
      />
      <Card>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !rows.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th>고객사</th>
                  <th>프로젝트</th>
                  <th>PM</th>
                  <th>기간</th>
                  <th className="num">기준 MD</th>
                  <th className="num">실적 MD</th>
                  <th style={{ minWidth: 200 }}>투입률 / 경과율</th>
                  <th className="num">종료 예상</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.prjCd} className="clickable" onClick={() => nav(`/project-mm/${p.prjCd}`)}>
                    <td data-label="고객사">{p.customerNm ?? '-'}</td>
                    <td data-label="프로젝트">
                      <PrjTypeBadge type={p.prjType}>{label(PRJ_TYPE, p.prjType)}</PrjTypeBadge> <strong title={p.prjCd}>{p.prjNm}</strong>
                    </td>
                    <td data-label="PM">{p.pmName ?? '-'}</td>
                    <td data-label="기간" className="small nowrap">
                      {p.startDt ?? '-'} ~ {p.endDt ?? '-'}
                    </td>
                    <td data-label="기준 MD" className="num">
                      {p.pr?.baseMd != null ? num(p.pr.baseMd) : '-'}
                      {p.pr && <div className="small muted">{baseLabel(p.pr)}</div>}
                    </td>
                    <td data-label="실적 MD" className="num">
                      <strong>{num(p.pr?.actualMd ?? 0)}</strong>
                    </td>
                    <td data-label="투입률 / 경과율">
                      <RateBar pr={p.pr} />
                    </td>
                    <td data-label="종료 예상" className="num">
                      {p.pr?.forecast != null ? <span className={p.pr.forecast > 100 ? 'bad-text' : undefined}>{pct(p.pr.forecast)}</span> : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ProjectDetail({ prjCd }: { prjCd: string }) {
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  const { data, error, loading } = useFetch<Detail>(`/stats/projects/${prjCd}/mm`);
  const { data: list } = useFetch<Summary[]>('/stats/projects');
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const maxMm = Math.max(0.1, ...data.monthly.flatMap((m) => [m.planMm, m.actualMm]));

  return (
    <div>
      <PageHeader
        title={data.prjNm}
        desc={
          <>
            {data.customerNm ?? ''} · {data.startDt} ~ {data.endDt} · PM {data.pmName ?? '-'} · <Badge code={data.statusCd}>{label(PRJ_STATUS, data.statusCd)}</Badge>
          </>
        }
        actions={
          <>
            <Select value={prjCd} onChange={(v) => nav(`/project-mm/${v}`)} options={(list ?? []).map((p) => [p.prjCd, p.prjNm] as [string, string])} />
            <Link className="btn" to="/project-mm">
              목록
            </Link>
          </>
        }
      />
      <div className="kpis">
        <Kpi label="투입 인원" value={`${data.headcount}명`} />
        <Kpi label="계약 MM" value={num(data.contractMm)} />
        <Kpi label="계획 MM" value={num(data.planMm, 2)} sub={`현재까지 ${num(data.planToDateMm, 2)}`} />
        <Kpi label="실적 MM" value={num(data.actualMm, 2)} />
        <Kpi label="MM 소진율" value={pct(data.burnRate)} tone={burnTone(data.burnRate)} sub={data.burnRate != null && data.burnRate >= 80 ? '80% 이상 소진' : undefined} />
        <Kpi label="종료 예상 투입률" value={pct(data.pr?.forecast ?? null)} sub="실적 + 남은 배정 계획" tone={data.pr?.forecast != null && data.pr.forecast > 100 ? 'bad' : undefined} />
      </div>
      {data.pr && (
        <Card title="프로젝트 투입률 (종료 시 100% 목표)">
          <RateBar pr={data.pr} />
          <div className="small muted" style={{ marginTop: 6 }}>
            실적 {num(data.pr.actualMd)} MD ÷ 기준 {data.pr.baseMd != null ? num(data.pr.baseMd) : '-'} MD ({baseLabel(data.pr)}) · 남은 배정 계획 {num(data.pr.remainingPlanMd)} MD
          </div>
        </Card>
      )}
      <div className="stack">
        <Card
          title="월별 계획 vs 실적 MM"
          actions={
            <div className="legend">
              <span>
                <i style={{ background: '#b9cbe3' }} />
                계획
              </span>
              <span>
                <i style={{ background: 'var(--primary-2)' }} />
                실적
              </span>
            </div>
          }
        >
          {!data.monthly.length ? (
            <Empty />
          ) : (
            <div className="bars" role="img" aria-label="월별 계획 대비 실적 MM 막대그래프">
              {data.monthly.map((m) => (
                <div className="bar-col" key={m.ym} title={`${m.ym} 계획 ${m.planMm} / 실적 ${m.actualMm}`}>
                  <div className="bar-pair">
                    <div className="bar plan" style={{ height: `${(m.planMm / maxMm) * 100}%` }} />
                    <div className="bar actual" style={{ height: `${(m.actualMm / maxMm) * 100}%` }} />
                  </div>
                  <div className="bar-label">{Number(m.ym.slice(5))}월</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="투입 인력">
          {!data.members.length ? (
            <Empty>배정된 인력이 없습니다.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>인력</th>
                    <th>역할</th>
                    <th>기간</th>
                    <th className="num">배정률</th>
                    <th className="num">계획MM</th>
                    <th className="num">실적MM</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.asgId}>
                      <td data-label="인력">
                        <span className="small muted">{m.employee.gradeCd}</span> <strong>{m.employee.name}</strong> <span className="small muted">{m.employee.deptCd}</span>
                        {showHr && <div className="small muted">{m.employee.skillLevel} · {label(EMPLOY_TYPE, m.employee.employType)}</div>}
                      </td>
                      <td data-label="역할">{label(ASG_ROLE, m.roleCd)}</td>
                      <td data-label="기간" className="nowrap small">
                        {m.startDt} ~ {m.endDt}
                      </td>
                      <td data-label="배정률" className="num">
                        {m.allocRate}%
                      </td>
                      <td data-label="계획MM" className="num">
                        {num(m.planMm, 2)}
                      </td>
                      <td data-label="실적MM" className="num">
                        {num(m.actualMmByEmp, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>
            같은 인력이 여러 번 배정된 경우 실적MM은 인력 기준 합계입니다.
          </p>
        </Card>
      </div>
    </div>
  );
}
