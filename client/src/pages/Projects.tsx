import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { hasRole, useAuth } from '../lib/auth';
import { CONTRACT_TYPE, PRJ_STATUS, PRJ_TYPE, RESIDENT, REVENUE_METHOD } from '../lib/codes';
import { label, num, won } from '../lib/format';
import { useFetch } from '../lib/hooks';

export interface Project {
  prjCd: string;
  prjType: string;
  prjNm: string;
  customerNm: string | null;
  contractType: string | null;
  primeContractor: string | null;
  startDt: string | null;
  endDt: string | null;
  contractMm: number | null;
  contractAmt: number | null;
  revenueMethod: string | null;
  winProb: number | null;
  plOpenYn: boolean;
  pmEmpId: string | null;
  pmName: string | null;
  residentType: string | null;
  statusCd: string;
  headcount: number;
  amountVisible: boolean;
}

const TYPE_OPTS = { SM: 'SM 운영·유지보수', SI: 'SI 구축', IN: '내부 프로젝트', PS: '제안/영업지원', ETC: '기타' };

export default function Projects() {
  const { user } = useAuth();
  const canCreate = hasRole(user, 'ADMIN', 'SALES');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useFetch<Project[]>(`/projects${qs({ type, status })}`);
  const [edit, setEdit] = useState<Partial<Project> | null>(null);
  const canEdit = (p: Project) => hasRole(user, 'ADMIN') || (hasRole(user, 'SALES') && p.statusCd === 'PROPOSAL');

  return (
    <div>
      <PageHeader
        title="프로젝트"
        desc="코드는 {사업구분}-{연도}-{일련번호}로 자동 채번됩니다."
        actions={
          canCreate && (
            <button className="btn primary" onClick={() => setEdit({ prjType: 'SI', statusCd: user?.role === 'SALES' ? 'PROPOSAL' : 'ACTIVE', plOpenYn: false })}>
              + 프로젝트 등록
            </button>
          )
        }
      />
      <Card>
        <div className="filters">
          <Select value={type} onChange={setType} options={TYPE_OPTS} placeholder="사업구분 전체" />
          <Select value={status} onChange={setStatus} options={PRJ_STATUS} placeholder="상태 전체" />
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
                  <th>코드</th>
                  <th>프로젝트명</th>
                  <th>고객사</th>
                  <th>사업기간</th>
                  <th>PM</th>
                  <th className="num">투입</th>
                  <th className="num">계약MM</th>
                  <th className="num">계약금액</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.prjCd} className={canEdit(p) ? 'clickable' : ''} onClick={() => canEdit(p) && setEdit(p)}>
                    <td data-label="코드" className="nowrap">
                      <Badge tone="info">{label(PRJ_TYPE, p.prjType)}</Badge> {p.prjCd}
                    </td>
                    <td data-label="프로젝트명">
                      <strong>{p.prjNm}</strong>
                    </td>
                    <td data-label="고객사">
                      {p.customerNm ?? '-'}
                      {p.contractType === 'SUB' && <div className="small muted">하도급 · {p.primeContractor}</div>}
                    </td>
                    <td data-label="사업기간" className="nowrap small">
                      {p.startDt ?? ''} ~ {p.endDt ?? ''}
                    </td>
                    <td data-label="PM">{p.pmName ?? '-'}</td>
                    <td data-label="투입" className="num">
                      {p.headcount}명
                    </td>
                    <td data-label="계약MM" className="num">
                      {num(p.contractMm)}
                    </td>
                    <td data-label="계약금액" className="num">
                      {p.amountVisible ? won(p.contractAmt) : <span className="muted">비공개</span>}
                    </td>
                    <td data-label="상태">
                      <Badge code={p.statusCd}>
                        {label(PRJ_STATUS, p.statusCd)}
                        {p.statusCd === 'PROPOSAL' && p.winProb != null && ` ${p.winProb}%`}
                      </Badge>
                    </td>
                    <td data-label="" onClick={(e) => e.stopPropagation()}>
                      {p.statusCd !== 'PROPOSAL' && hasRole(user, 'PM', 'EXEC', 'ADMIN', 'SALES') && (
                        <Link className="btn sm" to={`/project-mm/${p.prjCd}`}>
                          MM
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
      {edit && (
        <ProjectForm
          initial={edit}
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

function ProjectForm({ initial, onClose, onSaved }: { initial: Partial<Project>; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const isNew = !initial.prjCd;
  const isSales = user?.role === 'SALES';
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const { data: emps } = useFetch<{ empId: string; name: string; role: string; deptCd: string }[]>('/employees');
  const set = (p: Partial<Project>) => setF((s) => ({ ...s, ...p }));
  const numOrNull = (v: string) => (v === '' ? null : Number(v));

  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, contractAmt: f.contractAmt == null ? null : Math.round(f.contractAmt) };
      if (isNew) {
        const r = await api.post<{ prjCd: string }>('/projects', body);
        toast(`등록했습니다. (${r.prjCd})`);
      } else {
        await api.put(`/projects/${initial.prjCd}`, body);
        toast('저장했습니다.');
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      title={isNew ? '프로젝트 등록' : `프로젝트 수정 · ${initial.prjCd}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            저장
          </button>
        </>
      }
    >
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="사업구분" required hint={isNew ? undefined : '코드 체계 유지를 위해 변경 불가'}>
          <Select value={f.prjType} onChange={(prjType) => set({ prjType })} options={TYPE_OPTS} disabled={!isNew} />
        </Field>
        <Field label="상태" required>
          <Select value={f.statusCd} onChange={(statusCd) => set({ statusCd })} options={isSales ? { PROPOSAL: '제안' } : PRJ_STATUS} />
        </Field>
        <Field label="프로젝트명" required full>
          <input value={f.prjNm ?? ''} onChange={(e) => set({ prjNm: e.target.value })} />
        </Field>
        <Field label="고객사">
          <input value={f.customerNm ?? ''} onChange={(e) => set({ customerNm: e.target.value })} placeholder="○○병원" />
        </Field>
        <Field label="PM">
          <Select
            value={f.pmEmpId}
            onChange={(pmEmpId) => set({ pmEmpId: pmEmpId || null })}
            placeholder="미지정"
            options={(emps ?? []).filter((e) => e.role === 'PM' || e.empId === f.pmEmpId).map((e) => [e.empId, `${e.name} (${e.deptCd})`] as [string, string])}
          />
        </Field>
        <Field label="계약형태">
          <Select value={f.contractType} onChange={(contractType) => set({ contractType: contractType || null })} options={CONTRACT_TYPE} placeholder="-" />
        </Field>
        <Field label="원도급사명">
          <input value={f.primeContractor ?? ''} disabled={f.contractType !== 'SUB'} onChange={(e) => set({ primeContractor: e.target.value })} />
        </Field>
        <Field label="사업 시작일">
          <input type="date" value={f.startDt ?? ''} onChange={(e) => set({ startDt: e.target.value })} />
        </Field>
        <Field label="사업 종료일">
          <input type="date" value={f.endDt ?? ''} onChange={(e) => set({ endDt: e.target.value })} />
        </Field>
        <Field label="계약 MM">
          <input type="number" step="0.1" min={0} value={f.contractMm ?? ''} onChange={(e) => set({ contractMm: numOrNull(e.target.value) })} />
        </Field>
        <Field label="계약금액 (부가세 제외, 원)">
          <input type="number" min={0} value={f.contractAmt ?? ''} onChange={(e) => set({ contractAmt: numOrNull(e.target.value) })} />
        </Field>
        <Field label="매출 인식 방식" hint="비우면 SM=월정액, SI=투입MM×청구단가">
          <Select value={f.revenueMethod} onChange={(revenueMethod) => set({ revenueMethod: revenueMethod || null })} options={REVENUE_METHOD} placeholder="자동" />
        </Field>
        <Field label="상주 여부">
          <Select value={f.residentType} onChange={(residentType) => set({ residentType: residentType || null })} options={RESIDENT} placeholder="-" />
        </Field>
        <Field label="수주확률 (%)" hint="제안 프로젝트 참고용">
          <input type="number" min={0} max={100} value={f.winProb ?? ''} onChange={(e) => set({ winProb: numOrNull(e.target.value) })} />
        </Field>
        {!isSales && (
          <Field label="PM 손익 공개">
            <label className="check" style={{ minHeight: 38 }}>
              <input type="checkbox" checked={!!f.plOpenYn} onChange={(e) => set({ plOpenYn: e.target.checked })} /> 담당 PM에게 손익 공개
            </label>
          </Field>
        )}
      </div>
    </Modal>
  );
}
