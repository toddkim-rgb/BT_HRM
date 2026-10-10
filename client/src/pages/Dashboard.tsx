import { Link } from 'react-router-dom';
import { Badge, Card, Empty, Kpi, Loading, PageHeader, ProgressBar } from '../components/ui';
import { useAuth } from '../lib/auth';
import { ASG_ROLE, ASG_STATUS, WW_STATUS } from '../lib/codes';
import { label, pct } from '../lib/format';
import { isoWeek, shiftWeek, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';
import { RateBar, type ProjectRate } from '../components/ProjectRate';

interface Summary {
  totalHeadcount: number;
  ownHeadcount: number;
  partnerHeadcount: number;
  assigned: number;
  bench: number;
  overAllocated: number;
  planned: number;
  plannedNames: { name: string; startDt: string | null }[];
  releasingIn30: number;
  util: { week: string; rate: number | null; total: number; assigned: number; fteRate: number | null; confirmed: boolean };
  projectRates: (ProjectRate & { prjNm: string; customerNm: string | null })[];
  prevUtil: { week: string; rate: number | null };
}

const diff = (a: number | null, b: number | null) => {
  if (a == null || b == null) return undefined;
  const d = Math.round((a - b) * 10) / 10;
  return `전주 대비 ${d >= 0 ? '▲' : '▼'}${Math.abs(d)}%p`;
};

export default function Dashboard() {
  const { user, can } = useAuth();
  const isMgr = user?.role !== 'EMP' || !!user?.isPm; // 전사 요약은 일반 수행인력 제외 (프로젝트 PM은 표시)
  return (
    <div>
      <PageHeader title={`안녕하세요, ${user?.name}${user?.gradeCd && user.gradeCd !== '-' ? ` ${user.gradeCd}` : ''}님`} desc={`${today()} · ${weekLabel(isoWeek(today()))}`} />
      {isMgr && <CompanySummary />}
      <div className="grid cols-2">
        <MyWeekly />
        <MyAssignments />
        {isMgr && can('submissions') && <SubmissionSummary />}
        {isMgr && can('projectMm') && <ProjectBurn />}
      </div>
    </div>
  );
}

function CompanySummary() {
  const { data } = useFetch<Summary>('/stats/summary');
  if (!data) return <Loading />;
  const pr = data.projectRates;
  const cnt = (s: string) => pr.filter((p) => p.status === s).length;
  return (
    <>
      {/* 시스템의 두 목표: 인력 가동률 100% · 프로젝트 투입률 종료 시 100% */}
      <div className="goal-row">
        <Link to="/utilization" className="goal-card">
          <div className="goal-title">인력 가동률 <span className="muted small">목표 100% · {weekLabel(data.util.week)}{data.util.confirmed ? ' 확정' : ''}</span></div>
          <div className="goal-value">{pct(data.util.rate)}</div>
          <div className="small">
            투입 {data.util.assigned}/{data.util.total}명 · FTE {pct(data.util.fteRate)} · 대기 {data.bench}명
            {diff(data.util.rate, data.prevUtil.rate) ? ` · ${diff(data.util.rate, data.prevUtil.rate)}` : ''}
          </div>
          <ProgressBar value={data.util.rate} tone={data.util.rate != null && data.util.rate >= 100 ? 'good' : 'warn'} />
        </Link>
        <Link to="/project-mm" className="goal-card">
          <div className="goal-title">프로젝트 투입률 <span className="muted small">종료 시 100% 목표 · 진행중 {pr.length}개</span></div>
          <div className="goal-value">
            정상 {cnt('NORMAL')} <span className="goal-sep">·</span> <span className="warn-text">미달 {cnt('UNDER')}</span> <span className="goal-sep">·</span> <span className="bad-text">초과 {cnt('OVER')}</span>
          </div>
          <div className="small muted">경과율 대비 ±10%p 기준{cnt('NO_BASE') ? ` · 기준 MD 없음 ${cnt('NO_BASE')}개` : ''}{cnt('NOT_STARTED') ? ` · 시작 전 ${cnt('NOT_STARTED')}개` : ''}</div>
        </Link>
      </div>
    <div className="kpis">
      <Kpi label="총 인원" value={`${data.totalHeadcount}명`} sub={`자사 ${data.ownHeadcount} · 협력사 ${data.partnerHeadcount}`} />
      <Kpi label="투입 인원" value={`${data.assigned}명`} />
      <Kpi label="투입 예정" value={`${data.planned}명`} sub={data.planned ? data.plannedNames.map((p) => `${p.name}${p.startDt ? ` ${Number(p.startDt.slice(5, 7))}/${Number(p.startDt.slice(8))}~` : ''}`).join(', ') : '시작 전 배정 없음'} />
      <Kpi label="대기 인원" value={`${data.bench}명`} sub="현재·예정 배정 없음" tone={data.bench ? 'warn' : undefined} />
      <Kpi label="과투입" value={`${data.overAllocated}명`} tone={data.overAllocated ? 'bad' : undefined} />
      <Kpi label="30일 내 철수 예정" value={`${data.releasingIn30}건`} tone={data.releasingIn30 ? 'warn' : undefined} />
    </div>
    </>
  );
}

function MyWeekly() {
  const { user } = useAuth();
  const thisWeek = isoWeek(today());
  const lastWeek = shiftWeek(thisWeek, -1);
  const { data: cur } = useFetch<{ statusCd: string }>(`/weekly-works/${user!.empId}/${thisWeek}`);
  const { data: prev } = useFetch<{ statusCd: string }>(`/weekly-works/${user!.empId}/${lastWeek}`);
  const row = (week: string, d: { statusCd: string } | null) => (
    <tr>
      <td>{weekLabel(week)}</td>
      <td>{d ? <Badge code={d.statusCd}>{label(WW_STATUS, d.statusCd)}</Badge> : '…'}</td>
      <td style={{ textAlign: 'right' }}>
        <Link className="btn sm" to={`/weekly/${user!.empId}/${week}`}>
          {d && d.statusCd !== 'SUBMITTED' ? '작성' : '보기'}
        </Link>
      </td>
    </tr>
  );
  return (
    <Card title="내 주간 업무보고">
      <div className="table-wrap">
        <table className="tbl">
          <tbody>
            {row(thisWeek, cur)}
            {row(lastWeek, prev)}
          </tbody>
        </table>
      </div>
      {prev && prev.statusCd !== 'SUBMITTED' && <div className="alert warn" style={{ marginTop: 10, marginBottom: 0 }}>지난주 보고서가 아직 제출되지 않았습니다.</div>}
      <p className="muted small" style={{ marginBottom: 0 }}>
        제출하면 바로 확정됩니다 (승인 절차 없음). 마감은 없으며 금요일 작성을 권장합니다.
      </p>
    </Card>
  );
}

function MyAssignments() {
  const { user } = useAuth();
  const { data } = useFetch<{ assignments: { asgId: number; prjCd: string; roleCd: string; startDt: string; endDt: string; allocRate: number; status: string; project: { prjNm: string } }[] }>(
    `/employees/${user!.empId}`,
  );
  const list = (data?.assignments ?? []).filter((a) => a.status === 'ACTIVE' || a.status === 'PLANNED');
  const activeTotal = list.filter((a) => a.status === 'ACTIVE').reduce((s, a) => s + a.allocRate, 0);
  return (
    <Card
      title="내 투입 현황"
      actions={
        activeTotal > 0 && (
          <Badge tone={activeTotal > 100 ? 'bad' : 'info'}>
            현재 배정률 합계 {activeTotal}%{activeTotal > 100 && ` (과투입 +${activeTotal - 100}%)`}
          </Badge>
        )
      }
    >
      {!data ? (
        <Loading />
      ) : !list.length ? (
        <Empty>현재 배정된 프로젝트가 없습니다. (대기)</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <tbody>
              {list.map((a) => (
                <tr key={a.asgId}>
                  <td>
                    <strong title={a.prjCd}>{a.project.prjNm}</strong>
                  </td>
                  <td className="small nowrap">
                    {label(ASG_ROLE, a.roleCd)} · {a.allocRate}%
                    <div className="muted">~ {a.endDt}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Badge code={a.status}>{label(ASG_STATUS, a.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SubmissionSummary() {
  const { data } = useFetch<{ prjCd: string; prjNm: string; assigned: number; submitted: number; missing: string[] }[]>('/weekly-works/project-summary');
  const lastWeek = shiftWeek(isoWeek(today()), -1);
  const { data: last } = useFetch<{ prjCd: string; assigned: number; submitted: number; missing: string[] }[]>(`/weekly-works/project-summary?week=${lastWeek}`);
  const missingLast = (last ?? []).reduce((s, p) => s + p.missing.length, 0);
  return (
    <Card
      title="이번 주 제출 현황"
      actions={
        <Link className="btn sm" to="/submissions">
          전체 보기
        </Link>
      }
    >
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Empty>진행 중인 담당 프로젝트가 없습니다.</Empty>
      ) : (
        <>
          {data.slice(0, 8).map((p) => (
            <div key={p.prjCd} className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span>
                <strong title={p.prjCd}>{p.prjNm}</strong>
              </span>
              <Badge tone={p.assigned && p.submitted === p.assigned ? 'good' : 'warn'}>
                {p.submitted}/{p.assigned}명
              </Badge>
            </div>
          ))}
          {missingLast > 0 && <div className="alert warn" style={{ marginTop: 8, marginBottom: 0 }}>지난주 미제출 {missingLast}건이 있습니다.</div>}
        </>
      )}
    </Card>
  );
}

function ProjectBurn() {
  const { data } = useFetch<{ prjCd: string; prjNm: string; customerNm: string | null; statusCd: string; pr: ProjectRate | null }[]>('/stats/projects');
  const order = ['UNDER', 'OVER', 'NO_BASE', 'NORMAL', 'NOT_STARTED', 'DONE'];
  const list = (data ?? []).filter((p) => p.statusCd === 'ACTIVE' && p.pr).sort((a, b) => order.indexOf(a.pr!.status) - order.indexOf(b.pr!.status));
  return (
    <Card
      title="프로젝트 투입률 (진행중)"
      actions={
        <Link className="btn sm" to="/project-mm">
          전체 보기
        </Link>
      }
    >
      {!data ? (
        <Loading />
      ) : !list.length ? (
        <Empty>진행중인 프로젝트가 없습니다.</Empty>
      ) : (
        list.slice(0, 8).map((p) => (
          <Link key={p.prjCd} to={`/project-mm/${p.prjCd}`} style={{ display: 'block', color: 'inherit', marginBottom: 12 }}>
            <div className="small" style={{ marginBottom: 2 }}>
              <span className="muted">{p.customerNm ?? ''}</span> <strong title={p.prjCd}>{p.prjNm}</strong>
            </div>
            <RateBar pr={p.pr} compact />
          </Link>
        ))
      )}
    </Card>
  );
}
