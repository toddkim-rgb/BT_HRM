import { useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { dateTime } from '../lib/format';
import { useFetch } from '../lib/hooks';

interface Req {
  reqId: number;
  reqType: 'PW_RESET' | 'ID_INQUIRY';
  name: string;
  email: string | null;
  empId: string | null;
  contact: string | null;
  message: string | null;
  matchedEmpId: string | null;
  matched: { empId: string; name: string; email: string; deptCd: string; phone: string | null } | null;
  statusCd: 'OPEN' | 'DONE' | 'REJECTED';
  handledBy: string | null;
  handledAt: string | null;
  handleNote: string | null;
  createdAt: string;
}

const TYPE: Record<string, string> = { PW_RESET: '비밀번호 재설정', ID_INQUIRY: 'ID 문의' };
const STATUS: Record<string, string> = { OPEN: '대기', DONE: '처리 완료', REJECTED: '반려' };

/** 로그인 화면에서 들어온 비밀번호 재설정 요청·ID 문의 처리 (시스템관리자) */
export default function AccountRequests() {
  const [status, setStatus] = useState('OPEN');
  const { data, error, loading, reload } = useFetch<Req[]>(`/admin/account-requests${qs({ status })}`);
  const [handle, setHandle] = useState<Req | null>(null);

  return (
    <div>
      <PageHeader title="계정 요청" desc="로그인 화면에서 접수된 비밀번호 재설정 요청과 ID 문의입니다. 본인 여부를 확인한 뒤 처리하세요. (메일은 발송하지 않습니다)" />
      <Card>
        <div className="filters">
          <Select value={status} onChange={setStatus} options={{ OPEN: '처리 대기', DONE: '처리 완료', REJECTED: '반려', ALL: '전체' }} />
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>{status === 'OPEN' ? '처리할 요청이 없습니다.' : undefined}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th>접수</th>
                  <th>유형</th>
                  <th>요청자</th>
                  <th>입력 정보</th>
                  <th>일치 계정</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.reqId}>
                    <td data-label="접수" className="small nowrap">
                      {dateTime(r.createdAt)}
                    </td>
                    <td data-label="유형">
                      <Badge tone={r.reqType === 'PW_RESET' ? 'warn' : 'info'}>{TYPE[r.reqType]}</Badge>
                    </td>
                    <td data-label="요청자">
                      <strong>{r.name}</strong>
                    </td>
                    <td data-label="입력 정보" className="small">
                      {[r.email, r.empId && `사번 ${r.empId}`, r.contact && `연락처 ${r.contact}`].filter(Boolean).join(' · ')}
                      {r.message && <div className="muted">“{r.message}”</div>}
                    </td>
                    <td data-label="일치 계정" className="small">
                      {r.matched ? (
                        <>
                          <Badge tone="good">일치</Badge> {r.matched.name} ({r.matched.empId}) · {r.matched.deptCd}
                        </>
                      ) : (
                        <Badge tone="bad">일치 계정 없음</Badge>
                      )}
                    </td>
                    <td data-label="상태">
                      <Badge tone={r.statusCd === 'OPEN' ? 'warn' : r.statusCd === 'DONE' ? 'good' : 'neutral'}>{STATUS[r.statusCd]}</Badge>
                      {r.handleNote && <div className="small muted">{r.handleNote}</div>}
                    </td>
                    <td data-label="">
                      {r.statusCd === 'OPEN' && (
                        <button className="btn sm primary" onClick={() => setHandle(r)}>
                          처리
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {handle && (
        <HandleDialog
          req={handle}
          onClose={() => {
            setHandle(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function HandleDialog({ req, onClose }: { req: Req; onClose: () => void }) {
  const toast = useToast();
  const [empId, setEmpId] = useState(req.matchedEmpId ?? '');
  const [note, setNote] = useState('');
  const [issued, setIssued] = useState<{ tempPassword: string; email: string; name: string; phone: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: emps } = useFetch<{ empId: string; name: string; email: string; deptCd: string }[]>('/employees');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const issue = () => run(async () => setIssued(await api.post<NonNullable<typeof issued>>(`/admin/account-requests/${req.reqId}/issue-temp-password`, { empId })));
  const close = (statusCd: 'DONE' | 'REJECTED') =>
    run(async () => {
      await api.post(`/admin/account-requests/${req.reqId}/close`, { statusCd, note: note || null });
      toast(statusCd === 'DONE' ? '처리 완료로 표시했습니다.' : '반려했습니다.');
      onClose();
    });
  const selected = emps?.find((e) => e.empId === empId);

  return (
    <Modal
      title={`${TYPE[req.reqType]} 처리 · ${req.name}`}
      onClose={onClose}
      footer={
        issued ? (
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        ) : (
          <>
            <button className="btn danger" disabled={busy} onClick={() => close('REJECTED')} style={{ marginRight: 'auto' }}>
              반려
            </button>
            {req.reqType === 'PW_RESET' ? (
              <button className="btn primary" disabled={busy || !empId} onClick={issue}>
                임시 비밀번호 발급
              </button>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => close('DONE')}>
                안내 완료
              </button>
            )}
          </>
        )
      }
    >
      <ErrorBox error={err} />
      {issued ? (
        <div className="stack" style={{ gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>{issued.name}</strong>님({issued.email})의 임시 비밀번호입니다. 이 창을 닫으면 다시 볼 수 없으니 본인에게 직접 전달하세요{issued.phone ? ` (연락처 ${issued.phone})` : ''}.
          </p>
          <div className="temp-pw">{issued.tempPassword}</div>
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(issued.tempPassword).then(() => toast('복사했습니다.'));
            }}
          >
            복사
          </button>
          <p className="muted small" style={{ margin: 0 }}>
            임시 비밀번호로 로그인하면 새 비밀번호를 설정해야 다른 화면을 이용할 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <dl className="desc-list">
            <dt>입력 정보</dt>
            <dd>{[req.email, req.empId && `사번 ${req.empId}`, req.contact && `연락처 ${req.contact}`].filter(Boolean).join(' · ')}</dd>
            {req.message && (
              <>
                <dt>메모</dt>
                <dd>{req.message}</dd>
              </>
            )}
          </dl>
          {req.reqType === 'PW_RESET' ? (
            <Field label="대상 계정" required hint={req.matched ? '입력한 이메일·성명과 일치하는 계정이 선택되어 있습니다.' : '일치하는 계정이 없습니다. 본인 확인 후 직접 선택하세요.'}>
              <Select
                value={empId}
                onChange={setEmpId}
                placeholder="선택"
                options={(emps ?? []).map((e) => [e.empId, `${e.name} · ${e.email} · ${e.deptCd}`] as [string, string])}
              />
            </Field>
          ) : (
            <>
              <Field label="계정 찾기" hint="안내할 계정을 확인하세요 (요청자 연락처로 직접 안내)">
                <Select
                  value={empId}
                  onChange={setEmpId}
                  placeholder="선택"
                  options={(emps ?? []).map((e) => [e.empId, `${e.name} · ${e.deptCd}`] as [string, string])}
                />
              </Field>
              {selected && (
                <div className="alert info" style={{ marginBottom: 0 }}>
                  로그인 이메일: <strong>{selected.email}</strong>
                </div>
              )}
            </>
          )}
          <Field label="처리 메모" hint="안내 완료·반려 시 기록 (선택)">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
