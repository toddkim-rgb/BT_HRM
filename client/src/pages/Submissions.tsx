import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { qs } from '../lib/api';
import { WW_STATUS } from '../lib/codes';
import { dateTime, label, num } from '../lib/format';
import { isoWeek, shiftWeek, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface Summary {
  prjCd: string;
  prjNm: string;
  assigned: number;
  submitted: number;
  missing: string[];
}
interface Member {
  empId: string;
  name: string;
  gradeCd: string;
  roleCd: string;
  allocRate: number;
  otherProjects: { prjCd: string; prjNm?: string; allocRate: number }[];
  wwId: number | null;
  statusCd: string;
  plannedMd: number;
  projectMd: number;
}
interface Report {
  wwId: number;
  empId: string;
  name: string;
  gradeCd: string;
  reportWeek: string;
  submittedAt: string | null;
  totalMd: number;
  mdByProject: Record<string, number>;
  mdProjects?: { prjCd: string; prjNm: string; md: number }[];
  delayCount: number;
  issueCount: number;
  highIssueCount: number;
  supportReqCount: number;
}

// 승인 절차 없음: 제출 = 확정. PM은 담당 프로젝트의 제출 현황과 보고 내용을 확인
export default function Submissions() {
  const [week, setWeek] = useState(isoWeek(today()));
  const [open, setOpen] = useState<string | null>(null);
  const { data: summary, error, loading } = useFetch<Summary[]>(`/weekly-works/project-summary${qs({ week })}`);
  const { data: reports } = useFetch<Report[]>(`/weekly-works${qs({ week })}`);

  return (
    <div>
      <PageHeader
        title="주간보고 현황"
        desc="승인 절차 없이 제출하면 바로 확정되어 가동률·MM에 반영됩니다. 담당 프로젝트의 제출 현황과 보고 내용을 확인하세요."
        actions={
          <div className="week-nav">
            <button className="btn sm" onClick={() => setWeek(shiftWeek(week, -1))} aria-label="이전 주">
              ◀
            </button>
            <strong>{weekLabel(week)}</strong>
            <button className="btn sm" onClick={() => setWeek(shiftWeek(week, 1))} aria-label="다음 주">
              ▶
            </button>
          </div>
        }
      />
      <div className="stack">
        <Card title="프로젝트별 제출 현황">
          <ErrorBox error={error} />
          {loading && !summary ? (
            <Loading />
          ) : !summary?.length ? (
            <Empty>진행 중인 담당 프로젝트가 없습니다.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>프로젝트</th>
                    <th className="num">제출</th>
                    <th>미제출</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {summary.map((p) => (
                    <SummaryRow key={p.prjCd} p={p} week={week} open={open === p.prjCd} onToggle={() => setOpen(open === p.prjCd ? null : p.prjCd)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="제출된 보고서">
          {!reports ? (
            <Loading />
          ) : !reports.length ? (
            <Empty>이 주차에 제출된 보고서가 없습니다.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>인력</th>
                    <th className="num">투입MD</th>
                    <th>프로젝트별 MD</th>
                    <th>지연</th>
                    <th>이슈</th>
                    <th>제출</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.wwId}>
                      <td data-label="인력">
                        <strong>{r.name}</strong> <span className="muted small">{r.gradeCd}</span>
                      </td>
                      <td data-label="투입MD" className="num">
                        {num(r.totalMd)}
                      </td>
                      <td data-label="프로젝트별 MD" className="small">
                        {(r.mdProjects ?? Object.entries(r.mdByProject).map(([prjCd, md]) => ({ prjCd, prjNm: prjCd, md })))
                          .map((x) => `${x.prjNm} ${x.md}`)
                          .join(' · ')}
                      </td>
                      <td data-label="지연">{r.delayCount ? <Badge code="DELAY">{r.delayCount}</Badge> : '-'}</td>
                      <td data-label="이슈">
                        {r.issueCount ? (
                          <span className="row" style={{ gap: 4 }}>
                            {r.issueCount}건{r.highIssueCount > 0 && <Badge code="H">상 {r.highIssueCount}</Badge>}
                            {r.supportReqCount > 0 && <Badge tone="warn">지원요청</Badge>}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td data-label="제출" className="small nowrap">
                        {dateTime(r.submittedAt)}
                      </td>
                      <td data-label="">
                        <Link className="btn sm" to={`/weekly/${r.empId}/${r.reportWeek}`}>
                          보기
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SummaryRow({ p, week, open, onToggle }: { p: Summary; week: string; open: boolean; onToggle: () => void }) {
  const done = p.assigned > 0 && p.submitted === p.assigned;
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td data-label="프로젝트">
          <strong title={p.prjCd}>{p.prjNm}</strong>
        </td>
        <td data-label="제출" className="num">
          <Badge tone={done ? 'good' : p.submitted ? 'warn' : 'neutral'}>
            {p.submitted}/{p.assigned}명
          </Badge>
        </td>
        <td data-label="미제출" className="small">
          {p.missing.join(', ') || '-'}
        </td>
        <td data-label="">
          <button className="btn sm">{open ? '접기' : '인력별'}</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} data-label="" style={{ background: 'var(--surface-2)' }}>
            <Members prjCd={p.prjCd} week={week} />
          </td>
        </tr>
      )}
    </>
  );
}

function Members({ prjCd, week }: { prjCd: string; week: string }) {
  const { data } = useFetch<Member[]>(`/weekly-works/project/${prjCd}/${week}/status`);
  if (!data) return <Loading />;
  if (!data.length) return <Empty>해당 주에 배정된 인력이 없습니다.</Empty>;
  return (
    <div className="table-wrap" style={{ margin: 0, padding: 0 }}>
    <table className="tbl" style={{ textAlign: 'left' }}>
      <thead>
        <tr>
          <th>인력</th>
          <th className="num">투입률</th>
          <th>동시 투입 (다른 프로젝트)</th>
          <th>상태</th>
          <th className="num">이 프로젝트 MD / 계획</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {data.map((m) => (
          <tr key={m.empId}>
            <td>
              <strong>{m.name}</strong> <span className="muted small">{m.roleCd}</span>
            </td>
            <td className="num">{m.allocRate}%</td>
            <td className="small">
              {m.otherProjects.length ? (
                <>
                  {m.otherProjects.map((o) => `${o.prjNm ?? o.prjCd} ${o.allocRate}%`).join(', ')}
                  {m.allocRate + m.otherProjects.reduce((s, o) => s + o.allocRate, 0) > 100 && (
                    <>
                      {' '}
                      <Badge tone="bad">과투입</Badge>
                    </>
                  )}
                </>
              ) : (
                '-'
              )}
            </td>
            <td>
              <Badge code={m.statusCd}>{label(WW_STATUS, m.statusCd)}</Badge>
            </td>
            <td className="num">
              {num(m.projectMd)} / {num(m.plannedMd)}
            </td>
            <td>
              {m.wwId && (
                <Link className="btn sm" to={`/weekly/${m.empId}/${week}`}>
                  보기
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
