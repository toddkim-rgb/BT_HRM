import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { WW_STATUS } from '../lib/codes';
import { dateTime, label, num } from '../lib/format';
import { isoWeek, shiftWeek, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface Row {
  wwId: number;
  empId: string;
  name: string;
  gradeCd: string;
  deptCd: string;
  reportWeek: string;
  statusCd: string;
  submittedAt: string | null;
  totalMd: number;
  mdByProject: Record<string, number>;
  delayCount: number;
  issueCount: number;
  highIssueCount: number;
  supportReqCount: number;
}
interface Member {
  empId: string;
  name: string;
  gradeCd: string;
  roleCd: string;
  allocRate: number;
  wwId: number | null;
  statusCd: string;
  projectMd: number;
}

export default function Approvals() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('SUBMITTED');
  const [week, setWeek] = useState('');
  const { data, error, loading, reload } = useFetch<Row[]>(`/weekly-works${qs({ status, week })}`);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [reject, setReject] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSel(new Set()), [data]);

  const act = async (ids: number[], action: 'APPROVE' | 'REJECT', reason?: string) => {
    setBusy(true);
    try {
      const r = await api.patch<{ results: { ok: boolean; error?: string }[] }>('/weekly-works/approve', { wwIds: ids, action, reason });
      const ok = r.results.filter((x) => x.ok).length;
      const fail = r.results.filter((x) => !x.ok);
      toast(`${action === 'APPROVE' ? '승인' : '반려'} ${ok}건${fail.length ? ` / 실패 ${fail.length}건: ${fail.map((f) => f.error).join(', ')}` : ''}`, fail.length ? 'bad' : 'good');
      setReject(null);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const rows = data ?? [];
  const selectable = rows.filter((r) => r.statusCd === 'SUBMITTED');
  const allSel = selectable.length > 0 && selectable.every((r) => sel.has(r.wwId));

  return (
    <div>
      <PageHeader title="주간보고 승인" desc="담당 프로젝트 인력의 주간 업무보고(투입MD 포함)를 승인/반려합니다. 승인된 실적만 가동률·MM에 반영됩니다." />
      <div className="stack">
        <Card
          title="보고서 목록"
          actions={
            <>
              <button className="btn sm good" disabled={!sel.size || busy} onClick={() => act([...sel], 'APPROVE')}>
                일괄 승인 ({sel.size})
              </button>
              <button className="btn sm danger" disabled={!sel.size || busy} onClick={() => setReject([...sel])}>
                반려
              </button>
            </>
          }
        >
          <div className="filters">
            <Select value={status} onChange={setStatus} options={{ SUBMITTED: '승인 대기', APPROVED: '승인', REJECTED: '반려', 'SUBMITTED,APPROVED,REJECTED': '전체' }} />
            <Select
              value={week}
              onChange={setWeek}
              placeholder="전체 주차"
              options={Array.from({ length: 8 }, (_, i) => {
                const w = shiftWeek(isoWeek(today()), -i);
                return [w, weekLabel(w)] as [string, string];
              })}
            />
          </div>
          <ErrorBox error={error} />
          {loading && !data ? (
            <Loading />
          ) : !rows.length ? (
            <Empty>{status === 'SUBMITTED' ? '승인 대기 중인 보고서가 없습니다.' : undefined}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="전체 선택"
                        checked={allSel}
                        disabled={!selectable.length}
                        onChange={(e) => setSel(new Set(e.target.checked ? selectable.map((r) => r.wwId) : []))}
                      />
                    </th>
                    <th>주차</th>
                    <th>인력</th>
                    <th>상태</th>
                    <th className="num">투입MD</th>
                    <th>프로젝트별</th>
                    <th>지연</th>
                    <th>이슈</th>
                    <th>제출</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.wwId}>
                      <td data-label="선택">
                        <input
                          type="checkbox"
                          aria-label={`${r.name} 선택`}
                          disabled={r.statusCd !== 'SUBMITTED'}
                          checked={sel.has(r.wwId)}
                          onChange={(e) =>
                            setSel((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.wwId);
                              else n.delete(r.wwId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td data-label="주차" className="nowrap">
                        {r.reportWeek}
                      </td>
                      <td data-label="인력">
                        <strong>{r.name}</strong> <span className="muted small">{r.gradeCd}</span>
                      </td>
                      <td data-label="상태">
                        <Badge code={r.statusCd}>{label(WW_STATUS, r.statusCd)}</Badge>
                      </td>
                      <td data-label="투입MD" className="num">
                        {num(r.totalMd)}
                      </td>
                      <td data-label="프로젝트별" className="small">
                        {Object.entries(r.mdByProject)
                          .map(([k, v]) => `${k} ${v}`)
                          .join(', ')}
                      </td>
                      <td data-label="지연">{r.delayCount ? <Badge code="DELAY">{r.delayCount}</Badge> : '-'}</td>
                      <td data-label="이슈">
                        {r.issueCount ? (
                          <span>
                            {r.issueCount}
                            {r.highIssueCount > 0 && <Badge code="H"> 상 {r.highIssueCount}</Badge>}
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
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <Link className="btn sm" to={`/weekly/${r.empId}/${r.reportWeek}`}>
                            상세
                          </Link>
                          {r.statusCd === 'SUBMITTED' && (
                            <button className="btn sm good" disabled={busy} onClick={() => act([r.wwId], 'APPROVE')}>
                              승인
                            </button>
                          )}
                          {(r.statusCd === 'SUBMITTED' || r.statusCd === 'APPROVED') && (
                            <button className="btn sm danger" disabled={busy} onClick={() => setReject([r.wwId])}>
                              반려
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {user && <SubmissionStatus />}
      </div>

      {reject && <RejectModal count={reject.length} busy={busy} onClose={() => setReject(null)} onSubmit={(reason) => act(reject, 'REJECT', reason)} />}
    </div>
  );
}

function SubmissionStatus() {
  const { user } = useAuth();
  const { data: projects } = useFetch<{ prjCd: string; prjNm: string }[]>(`/projects${qs({ mine: user?.role === 'PM' ? 'Y' : undefined, status: 'ACTIVE,WON' })}`);
  const [prjCd, setPrjCd] = useState('');
  const [week, setWeek] = useState(isoWeek(today()));
  const cur = prjCd || projects?.[0]?.prjCd || '';
  const { data, loading } = useFetch<Member[]>(cur ? `/weekly-works/project/${cur}/${week}/status` : null);
  const done = (data ?? []).filter((m) => m.statusCd === 'SUBMITTED' || m.statusCd === 'APPROVED').length;

  return (
    <Card title="프로젝트 제출 현황" actions={data && <span className="muted small">제출 {done}/{data.length}명</span>}>
      <div className="filters">
        <Select value={cur} onChange={setPrjCd} options={(projects ?? []).map((p) => [p.prjCd, `${p.prjCd} ${p.prjNm}`] as [string, string])} />
        <div className="week-nav">
          <button className="btn sm" onClick={() => setWeek(shiftWeek(week, -1))} aria-label="이전 주">
            ◀
          </button>
          <strong>{weekLabel(week)}</strong>
          <button className="btn sm" onClick={() => setWeek(shiftWeek(week, 1))} aria-label="다음 주">
            ▶
          </button>
        </div>
      </div>
      {!cur ? (
        <Empty>담당 프로젝트가 없습니다.</Empty>
      ) : loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>해당 주에 배정된 인력이 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>인력</th>
                <th>역할</th>
                <th className="num">투입률</th>
                <th>상태</th>
                <th className="num">이 프로젝트 MD</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.empId}>
                  <td data-label="인력">
                    <strong>{m.name}</strong> <span className="muted small">{m.gradeCd}</span>
                  </td>
                  <td data-label="역할">{m.roleCd}</td>
                  <td data-label="투입률" className="num">
                    {m.allocRate}%
                  </td>
                  <td data-label="상태">
                    <Badge code={m.statusCd}>{label(WW_STATUS, m.statusCd)}</Badge>
                  </td>
                  <td data-label="이 프로젝트 MD" className="num">
                    {num(m.projectMd)}
                  </td>
                  <td data-label="">
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
      )}
    </Card>
  );
}

function RejectModal({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={`반려 (${count}건)`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn danger" disabled={!reason.trim() || busy} onClick={() => onSubmit(reason.trim())}>
            반려
          </button>
        </>
      }
    >
      <Field label="반려 사유" required>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
      </Field>
    </Modal>
  );
}
