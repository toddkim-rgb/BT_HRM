import { Link } from 'react-router-dom';
import { Badge, Card, Empty, Kpi, Loading, PageHeader, ProgressBar } from '../components/ui';
import { hasRole, useAuth } from '../lib/auth';
import { ASG_ROLE, ASG_STATUS, WW_STATUS } from '../lib/codes';
import { label, num, pct } from '../lib/format';
import { isoWeek, shiftWeek, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface Summary {
  totalHeadcount: number;
  ownHeadcount: number;
  partnerHeadcount: number;
  assigned: number;
  bench: number;
  overAllocated: number;
  releasingIn30: number;
  util: { util: number | null; paidUtil: number | null };
  prevUtil: { util: number | null; paidUtil: number | null };
}

const diff = (a: number | null, b: number | null) => {
  if (a == null || b == null) return undefined;
  const d = Math.round((a - b) * 10) / 10;
  return `전월 대비 ${d >= 0 ? '▲' : '▼'}${Math.abs(d)}%p`;
};

export default function Dashboard() {
  const { user } = useAuth();
  const isMgr = hasRole(user, 'PM', 'EXEC', 'ADMIN', 'SALES');
  return (
    <div>
      <PageHeader title={`안녕하세요, ${user?.name}님`} desc={`${today()} · ${weekLabel(isoWeek(today()))}`} />
      {isMgr && <CompanySummary />}
      <div className="grid cols-2">
        <MyWeekly />
        <MyAssignments />
        {hasRole(user, 'PM', 'ADMIN') && <PendingApprovals />}
        {isMgr && <ProjectBurn />}
      </div>
    </div>
  );
}

function CompanySummary() {
  const { data } = useFetch<Summary>('/stats/summary');
  if (!data) return <Loading />;
  return (
    <div className="kpis">
      <Kpi label="총 인원" value={`${data.totalHeadcount}명`} sub={`자사 ${data.ownHeadcount} · 협력사 ${data.partnerHeadcount}`} />
      <Kpi label="투입 인원" value={`${data.assigned}명`} />
      <Kpi label="대기 인원" value={`${data.bench}명`} tone={data.bench ? 'warn' : undefined} />
      <Kpi label="이번 달 총가동률" value={pct(data.util.util)} sub={diff(data.util.util, data.prevUtil.util)} />
      <Kpi label="이번 달 유상가동률" value={pct(data.util.paidUtil)} sub={diff(data.util.paidUtil, data.prevUtil.paidUtil)} />
      <Kpi label="과투입" value={`${data.overAllocated}명`} tone={data.overAllocated ? 'bad' : undefined} />
      <Kpi label="30일 내 철수 예정" value={`${data.releasingIn30}건`} tone={data.releasingIn30 ? 'warn' : undefined} />
    </div>
  );
}

function MyWeekly() {
  const { user } = useAuth();
  const thisWeek = isoWeek(today());
  const lastWeek = shiftWeek(thisWeek, -1);
  const { data: cur } = useFetch<{ statusCd: string; rejectReason: string | null }>(`/weekly-works/${user!.empId}/${thisWeek}`);
  const { data: prev } = useFetch<{ statusCd: string; rejectReason: string | null }>(`/weekly-works/${user!.empId}/${lastWeek}`);
  const row = (week: string, d: { statusCd: string; rejectReason: string | null } | null) => (
    <tr>
      <td>{weekLabel(week)}</td>
      <td>{d ? <Badge code={d.statusCd}>{label(WW_STATUS, d.statusCd)}</Badge> : '…'}</td>
      <td style={{ textAlign: 'right' }}>
        <Link className="btn sm" to={`/weekly/${user!.empId}/${week}`}>
          {d && ['NEW', 'DRAFT', 'REJECTED'].includes(d.statusCd) ? '작성' : '보기'}
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
      {prev?.statusCd === 'REJECTED' && <div className="alert bad" style={{ marginTop: 10, marginBottom: 0 }}>지난주 보고서가 반려되었습니다: {prev.rejectReason}</div>}
      <p className="muted small" style={{ marginBottom: 0 }}>
        제출 마감은 없으며 금요일 작성을 권장합니다. 지난 주차도 언제든 작성·제출할 수 있습니다.
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
  return (
    <Card title="내 투입 현황">
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
                    <strong>{a.prjCd}</strong>
                    <div className="small muted">{a.project.prjNm}</div>
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

function PendingApprovals() {
  const { data } = useFetch<{ wwId: number; name: string; reportWeek: string; highIssueCount: number; supportReqCount: number }[]>('/weekly-works?status=SUBMITTED');
  return (
    <Card
      title="승인 대기"
      actions={
        <Link className="btn sm" to="/approvals">
          전체 보기
        </Link>
      }
    >
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Empty>승인 대기 중인 보고서가 없습니다.</Empty>
      ) : (
        <>
          <div className="kpi-value" style={{ marginBottom: 8 }}>
            {data.length}건
          </div>
          <div className="small">
            {data.slice(0, 6).map((r) => (
              <div key={r.wwId} className="row" style={{ marginBottom: 4 }}>
                {r.name} <span className="muted">{r.reportWeek}</span>
                {r.highIssueCount > 0 && <Badge code="H">이슈 상</Badge>}
                {r.supportReqCount > 0 && <Badge tone="warn">지원요청</Badge>}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function ProjectBurn() {
  const { data } = useFetch<{ prjCd: string; prjNm: string; contractMm: number | null; actualMm: number; burnRate: number | null; statusCd: string }[]>('/stats/projects');
  const list = (data ?? []).filter((p) => p.burnRate != null && p.statusCd !== 'SALES').sort((a, b) => (b.burnRate ?? 0) - (a.burnRate ?? 0));
  return (
    <Card
      title="프로젝트 MM 소진율"
      actions={
        <Link className="btn sm" to="/project-mm">
          전체 보기
        </Link>
      }
    >
      {!data ? (
        <Loading />
      ) : !list.length ? (
        <Empty>계약 MM이 등록된 프로젝트가 없습니다.</Empty>
      ) : (
        list.slice(0, 8).map((p) => (
          <Link key={p.prjCd} to={`/project-mm/${p.prjCd}`} style={{ display: 'block', color: 'inherit', marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span>
                <strong>{p.prjCd}</strong> <span className="small muted">{p.prjNm}</span>
              </span>
              <span className="num small">
                {num(p.actualMm, 2)} / {num(p.contractMm)} MM · <strong>{pct(p.burnRate)}</strong>
              </span>
            </div>
            <ProgressBar value={p.burnRate} />
          </Link>
        ))
      )}
    </Card>
  );
}
