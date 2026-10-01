import { useEffect, useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { hasRole, useAuth } from '../lib/auth';
import { ASG_ROLE, ASG_STATUS, EMPLOY_TYPE } from '../lib/codes';
import { label } from '../lib/format';
import { today } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface Asg {
  asgId: number;
  empId: string;
  prjCd: string;
  roleCd: string;
  startDt: string;
  endDt: string;
  allocRate: number;
  residentType: string;
  status: string;
  overAlloc: number;
  employee: { name: string; gradeCd: string; skillLevel: string; employType: string; deptCd: string };
  project: { prjNm: string; prjType: string; pmEmpId: string | null };
}

export default function Assignments() {
  const { user } = useAuth();
  const [prjCd, setPrjCd] = useState('');
  const [status, setStatus] = useState('PLANNED,ACTIVE');
  const { data, error, loading, reload } = useFetch<Asg[]>(`/assignments${qs({ prjCd, status })}`);
  const { data: projects } = useFetch<{ prjCd: string; prjNm: string; pmEmpId: string | null; statusCd: string }[]>('/projects');
  const [edit, setEdit] = useState<Partial<Asg> | null>(null);
  const toast = useToast();

  const myProjects = (projects ?? []).filter((p) => !['DONE', 'STOP'].includes(p.statusCd) && (user?.role === 'ADMIN' || p.pmEmpId === user?.empId));
  const canManage = (a: Asg) => user?.role === 'ADMIN' || (user?.role === 'PM' && a.project.pmEmpId === user.empId);
  const t = today();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const cancel = async (a: Asg) => {
    if (!window.confirm(`${a.employee.name} · ${a.prjCd} 배정을 취소할까요?`)) return;
    try {
      await api.post(`/assignments/${a.asgId}/cancel`);
      toast('배정을 취소했습니다.');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };


  return (
    <div>
      <PageHeader
        title="투입 배정"
        desc="PM이 등록하면 즉시 확정됩니다. 투입률 합계가 100%를 넘어도 저장되며 과투입으로 표시됩니다."
        actions={
          hasRole(user, 'PM', 'ADMIN') && (
            <button className="btn primary" disabled={!myProjects.length} onClick={() => setEdit({ prjCd: prjCd || myProjects[0]?.prjCd, allocRate: 100, residentType: 'ONSITE', roleCd: 'DEV', startDt: t })}>
              + 배정 등록
            </button>
          )
        }
      />
      <Card>
        <div className="filters">
          <Select value={prjCd} onChange={setPrjCd} placeholder="프로젝트 전체" options={(projects ?? []).map((p) => [p.prjCd, `${p.prjCd} ${p.prjNm}`] as [string, string])} />
          <Select value={status} onChange={setStatus} options={{ 'PLANNED,ACTIVE': '투입예정·투입중', ACTIVE: '투입중', PLANNED: '투입예정', ENDED: '종료', CANCELED: '취소', '': '전체' }} />
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th>인력</th>
                  <th>프로젝트</th>
                  <th>역할</th>
                  <th>기간</th>
                  <th className="num">투입률</th>
                  <th>구분</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((a) => {
                  const over = a.overAlloc;
                  const releasing = a.status === 'ACTIVE' && a.endDt <= in30;
                  return (
                    <tr key={a.asgId}>
                      <td data-label="인력">
                        <strong>{a.employee.name}</strong> <span className="small muted">{a.employee.skillLevel}</span>
                        <div className="small muted">{label(EMPLOY_TYPE, a.employee.employType)}</div>
                      </td>
                      <td data-label="프로젝트">
                        <strong>{a.prjCd}</strong>
                        <div className="small muted">{a.project.prjNm}</div>
                      </td>
                      <td data-label="역할">{label(ASG_ROLE, a.roleCd)}</td>
                      <td data-label="기간" className="nowrap small">
                        {a.startDt} ~ {a.endDt}
                        {releasing && (
                          <div>
                            <Badge tone="warn">철수예정</Badge>
                          </div>
                        )}
                      </td>
                      <td data-label="투입률" className="num">
                        {a.allocRate}%{over > 0 && a.status !== 'CANCELED' && (
                          <div>
                            <Badge tone="bad">과투입 +{over}%</Badge>
                          </div>
                        )}
                      </td>
                      <td data-label="구분">{a.residentType === 'ONSITE' ? '상주' : '비상주'}</td>
                      <td data-label="상태">
                        <Badge code={a.status}>{label(ASG_STATUS, a.status)}</Badge>
                      </td>
                      <td data-label="">
                        {canManage(a) && a.status !== 'CANCELED' && (
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <button className="btn sm" onClick={() => setEdit(a)}>
                              수정
                            </button>
                            <button className="btn sm danger" onClick={() => cancel(a)}>
                              취소
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && (
        <AssignmentForm
          initial={edit}
          projects={myProjects}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AssignmentForm({ initial, projects, onClose, onSaved }: { initial: Partial<Asg>; projects: { prjCd: string; prjNm: string }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !initial.asgId;
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    existing: number;
    total: number;
    overAlloc: number;
    overlapping: { asgId: number; prjCd: string; roleCd: string; startDt: string; endDt: string; allocRate: number; project: { prjNm: string } }[];
  } | null>(null);
  const { data: emps } = useFetch<{ empId: string; name: string; deptCd: string; skillLevel: string; employType: string; allocTotal: number }[]>('/employees?status=ACTIVE');
  const set = (p: Partial<Asg>) => setF((s) => ({ ...s, ...p }));

  useEffect(() => {
    if (!f.empId || !f.startDt || !f.endDt || f.startDt > f.endDt || !f.allocRate) {
      setPreview(null);
      return;
    }
    api
      .get<typeof preview>(`/assignments/preview/overalloc${qs({ empId: f.empId, startDt: f.startDt, endDt: f.endDt, allocRate: f.allocRate, excludeAsgId: initial.asgId })}`)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [initial.asgId, f.empId, f.startDt, f.endDt, f.allocRate]);

  const save = async () => {
    setErr(null);
    try {
      const body = { empId: f.empId, prjCd: f.prjCd, roleCd: f.roleCd, startDt: f.startDt, endDt: f.endDt, allocRate: Number(f.allocRate), residentType: f.residentType };
      const r = isNew ? await api.post<{ overAlloc: number }>('/assignments', body) : await api.put<{ overAlloc: number }>(`/assignments/${initial.asgId}`, body);
      toast(r.overAlloc > 0 ? `저장했습니다. 과투입 +${r.overAlloc}%` : '저장했습니다.', r.overAlloc > 0 ? 'info' : 'good');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      title={isNew ? '투입 배정 등록' : '투입 배정 수정'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            저장 (즉시 확정)
          </button>
        </>
      }
    >
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="프로젝트" required full>
          <Select value={f.prjCd} onChange={(prjCd) => set({ prjCd })} disabled={!isNew} options={projects.map((p) => [p.prjCd, `${p.prjCd} ${p.prjNm}`] as [string, string])} />
        </Field>
        <Field label="인력" required full>
          <Select
            value={f.empId}
            onChange={(empId) => set({ empId })}
            placeholder="선택"
            options={(emps ?? []).map((e) => [e.empId, `${e.name} · ${e.deptCd} · ${e.skillLevel} · ${label(EMPLOY_TYPE, e.employType)} (현재 ${e.allocTotal}%)`] as [string, string])}
          />
        </Field>
        <Field label="투입 역할" required>
          <Select value={f.roleCd} onChange={(roleCd) => set({ roleCd })} options={ASG_ROLE} />
        </Field>
        <Field label="투입률 (%)" required hint="100 = 전일, 50 = 겸임">
          <input type="number" min={1} max={100} value={f.allocRate ?? ''} onChange={(e) => set({ allocRate: Number(e.target.value) })} />
        </Field>
        <Field label="투입 시작일" required>
          <input type="date" value={f.startDt ?? ''} onChange={(e) => set({ startDt: e.target.value })} />
        </Field>
        <Field label="투입 종료일" required>
          <input type="date" value={f.endDt ?? ''} onChange={(e) => set({ endDt: e.target.value })} />
        </Field>
        <Field label="투입 구분">
          <Select value={f.residentType} onChange={(residentType) => set({ residentType })} options={{ ONSITE: '상주', OFFSITE: '비상주' }} />
        </Field>
      </div>
      {preview && (
        <div className={`alert ${preview.overAlloc > 0 ? 'warn' : 'info'}`} style={{ marginTop: 12, marginBottom: 0 }}>
          {preview.overlapping.length ? (
            <>
              <strong>같은 기간 다른 투입 {preview.overlapping.length}건</strong>
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {preview.overlapping.map((o) => (
                  <li key={o.asgId}>
                    {o.prjCd} {o.project.prjNm} · {label(ASG_ROLE, o.roleCd)} {o.allocRate}% · {o.startDt} ~ {o.endDt}
                    {o.prjCd === f.prjCd && ' (같은 프로젝트 중복 배정)'}
                  </li>
                ))}
              </ul>
              기간 중 투입률 합계 최대 {preview.existing}% + 이번 {f.allocRate}% = {preview.total}%
              {preview.overAlloc > 0 && ` → 과투입 +${preview.overAlloc}% (저장은 가능)`}
            </>
          ) : (
            <>같은 기간 다른 투입이 없습니다. 투입률 {f.allocRate}%</>
          )}
        </div>
      )}
    </Modal>
  );
}
