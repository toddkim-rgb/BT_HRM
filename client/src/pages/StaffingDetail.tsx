import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, PrjTypeBadge } from '../components/ui';
import { qs } from '../lib/api';
import { ASG_ROLE, EMPLOY_TYPE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label, num, pct } from '../lib/format';
import { addMonths, isoWeek, today } from '../lib/dates';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { MilestoneTrack, type Milestone } from './ProjectWeekly';
import type { StaffingResp } from './Staffing';

/** 프로젝트 투입 상세: 카드에서 선택한 프로젝트의 투입 인력·기간·MD·마일스톤 */
export default function StaffingDetail() {
  const { can } = useAuth();
  const { prjCd = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const ym = sp.get('ym') ?? today().slice(0, 7);
  const setYm = (v: string) => setSp({ ym: v }, { replace: true });
  const { data, error, loading } = useFetch<StaffingResp>(`/stats/staffing${qs({ ym })}`);
  const { data: ms } = useFetch<{ milestones: Milestone[]; progress: number | null }>(`/projects/${prjCd}/milestones`);
  const { data: prj } = useFetch<{ prjNm: string; prjType: string; statusCd: string; customerNm: string | null; pmName: string | null; startDt: string | null; endDt: string | null; contractMm: number | null }>(`/projects/${prjCd}`);
  const p = data?.projects.find((x) => x.prjCd === prjCd);
  const month = Number(ym.slice(5));
  const t = today();

  return (
    <div>
      <PageHeader
        title={prj ? prj.prjNm : ''}
        desc={
          prj && (
            <>
              <PrjTypeBadge type={prj.prjType}>{label(PRJ_TYPE, prj.prjType)}</PrjTypeBadge> <Badge code={prj.statusCd}>{label(PRJ_STATUS, prj.statusCd)}</Badge> {prj.customerNm ? `${prj.customerNm} · ` : ''}PM {prj.pmName ?? '-'} · {prj.startDt ?? '-'} ~ {prj.endDt ?? '-'}
            </>
          )
        }
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
            <Link className="btn" to="/staffing">
              ← 목록
            </Link>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            <Kpi label="투입인력" value={`${p?.headcount ?? 0}명`} sub={`${month}월 배정 기준`} />
            <Kpi label="투입률 합계" value={`${p?.allocTotal ?? 0}%`} sub="100% = 1명 전일 투입" />
            <Kpi label={`${month}월 소요 MD`} value={num(p?.actualMd ?? 0)} sub={`계획 ${num(p?.planMd ?? 0)} MD`} />
            <Kpi label="누적 소요 MD" value={num(p?.cumMd ?? 0)} sub={prj?.contractMm ? `계약 ${num(prj.contractMm)} MM` : undefined} />
            <Kpi label="마일스톤" value={ms?.milestones.length ? pct(ms.progress) : '-'} sub={ms?.milestones.length ? `${ms.milestones.filter((m) => m.status === 'DONE').length}/${ms.milestones.length} 완료` : '미등록'} tone={ms?.milestones.some((m) => m.status === 'DELAY') ? 'bad' : undefined} />
          </div>
          <div className="stack">
            <Card
              title="투입 인력"
              actions={
                <>
                  {can('assignments') && (
                    <Link className="btn sm" to="/assignments">
                      배정 관리
                    </Link>
                  )}
                  {can('projectWeekly') && (
                    <Link className="btn sm" to={`/project-weekly/${prjCd}/${isoWeek(t)}`}>
                      주간보고
                    </Link>
                  )}
                  {can('projectMm') && (
                    <Link className="btn sm" to={`/project-mm/${prjCd}`}>
                      MM 현황
                    </Link>
                  )}
                </>
              }
            >
              {!p?.members.length ? (
                <Empty>{month}월에 배정된 인력이 없습니다.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>인력</th>
                        <th>역할</th>
                        <th className="num">투입률</th>
                        <th>시작일</th>
                        <th>종료일</th>
                        <th>상태</th>
                        <th className="num">{month}월 계획 MD</th>
                        <th className="num">{month}월 소요 MD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.members.map((m) => (
                        <tr key={m.asgId}>
                          <td data-label="인력">
                            <strong>{m.name}</strong>{' '}
                            <span className="small muted">
                              {m.gradeCd} · {m.skillLevel} · {label(EMPLOY_TYPE, m.employType)}
                            </span>
                          </td>
                          <td data-label="역할">{label(ASG_ROLE, m.roleCd)}</td>
                          <td data-label="투입률" className="num">
                            {m.allocRate}%
                          </td>
                          <td data-label="시작일" className="nowrap">
                            {m.startDt}
                          </td>
                          <td data-label="종료일" className="nowrap">
                            {m.endDt}
                          </td>
                          <td data-label="상태">{m.active ? <Badge tone="good">투입중</Badge> : m.startDt > t ? <Badge tone="info">예정</Badge> : <Badge tone="neutral">종료</Badge>}</td>
                          <td data-label="계획 MD" className="num">
                            {num(m.planMd)}
                          </td>
                          <td data-label="소요 MD" className="num">
                            <strong>{num(m.actualMd)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>합계</td>
                        <td className="num">{p.allocTotal}%</td>
                        <td colSpan={3} />
                        <td className="num">{num(p.planMd)}</td>
                        <td className="num">{num(p.actualMd)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="muted small" style={{ marginBottom: 0 }}>
                소요 MD는 제출된 주간 업무보고 기준, 계획 MD는 배정 투입률 × 영업일 기준입니다. 같은 인력이 여러 번 배정된 경우 소요 MD는 인력 기준으로 같은 값이 표시됩니다.
              </p>
            </Card>
            <Card title="주요 마일스톤">{ms ? <MilestoneTrack list={ms.milestones} progress={ms.progress} /> : <Loading />}</Card>
          </div>
        </>
      )}
    </div>
  );
}
