import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, ProgressBar, Select } from '../components/ui';
import { ASG_ROLE, EMPLOY_TYPE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label, num, pct } from '../lib/format';
import { useFetch } from '../lib/hooks';

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
    employee: { name: string; gradeCd: string; skillLevel: string; employType: string };
  }[];
}

const burnTone = (b: number | null) => (b == null ? undefined : b >= 100 ? 'bad' : b >= 80 ? 'warn' : 'good');

export default function ProjectMm() {
  const { prjCd } = useParams();
  return prjCd ? <ProjectDetail prjCd={prjCd} /> : <ProjectList />;
}

function ProjectList() {
  const { data, error, loading } = useFetch<Summary[]>('/stats/projects');
  const nav = useNavigate();
  const rows = (data ?? []).filter((p) => p.statusCd !== 'PROPOSAL');
  return (
    <div>
      <PageHeader title="프로젝트 MM 현황" desc="계획 MM = Σ(배정 기간 영업일 × 투입률) ÷ 22 · 실적 MM = 제출된 투입MD ÷ 22 · 소진율 = 누적 실적 MM ÷ 계약 MM" />
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
                  <th>프로젝트</th>
                  <th>PM</th>
                  <th className="num">투입인원</th>
                  <th className="num">계약MM</th>
                  <th className="num">계획MM</th>
                  <th className="num">현재까지 계획</th>
                  <th className="num">실적MM</th>
                  <th>MM 소진율</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.prjCd} className="clickable" onClick={() => nav(`/project-mm/${p.prjCd}`)}>
                    <td data-label="프로젝트">
                      <Badge tone="info">{label(PRJ_TYPE, p.prjType)}</Badge> <strong>{p.prjCd}</strong>
                      <div className="small muted">{p.prjNm}</div>
                    </td>
                    <td data-label="PM">{p.pmName ?? '-'}</td>
                    <td data-label="투입인원" className="num">
                      {p.headcount}명
                    </td>
                    <td data-label="계약MM" className="num">
                      {num(p.contractMm)}
                    </td>
                    <td data-label="계획MM" className="num">
                      {num(p.planMm, 2)}
                    </td>
                    <td data-label="현재까지 계획" className="num">
                      {num(p.planToDateMm, 2)}
                    </td>
                    <td data-label="실적MM" className="num">
                      <strong>{num(p.actualMm, 2)}</strong>
                    </td>
                    <td data-label="MM 소진율">
                      {p.burnRate == null ? (
                        <span className="muted">-</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 130, justifyContent: 'flex-end' }}>
                          <div style={{ flex: 1, maxWidth: 90 }}>
                            <ProgressBar value={p.burnRate} />
                          </div>
                          <span className={`num ${burnTone(p.burnRate)}-text`}>{pct(p.burnRate)}</span>
                        </div>
                      )}
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
        title={`${data.prjCd} ${data.prjNm}`}
        desc={
          <>
            {data.customerNm ?? ''} · {data.startDt} ~ {data.endDt} · PM {data.pmName ?? '-'} · <Badge code={data.statusCd}>{label(PRJ_STATUS, data.statusCd)}</Badge>
          </>
        }
        actions={
          <>
            <Select value={prjCd} onChange={(v) => nav(`/project-mm/${v}`)} options={(list ?? []).map((p) => [p.prjCd, `${p.prjCd} ${p.prjNm}`] as [string, string])} />
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
      </div>
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
                    <th className="num">투입률</th>
                    <th className="num">계획MM</th>
                    <th className="num">실적MM</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.asgId}>
                      <td data-label="인력">
                        <strong>{m.employee.name}</strong> <span className="small muted">{m.employee.skillLevel} · {label(EMPLOY_TYPE, m.employee.employType)}</span>
                      </td>
                      <td data-label="역할">{label(ASG_ROLE, m.roleCd)}</td>
                      <td data-label="기간" className="nowrap small">
                        {m.startDt} ~ {m.endDt}
                      </td>
                      <td data-label="투입률" className="num">
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
