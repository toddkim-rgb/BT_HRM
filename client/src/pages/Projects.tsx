import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast, PrjTypeBadge } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  const { can } = useAuth();
  const canCreate = can('projects', 'EDIT');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useFetch<Project[]>(`/projects${qs({ type, status })}`);
  const [edit, setEdit] = useState<Partial<Project> | null>(null);
  const canEdit = (_p: Project) => can('projects', 'EDIT');

  return (
    <div>
      <PageHeader
        title="프로젝트"
        desc="코드는 {사업구분}-{연도}-{일련번호}로 자동 채번됩니다."
        actions={
          canCreate && (
            <button className="btn primary" onClick={() => setEdit({ prjType: 'SI', statusCd: 'ACTIVE', plOpenYn: false })}>
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
                  <th>프로젝트명</th>
                  <th>사업구분</th>
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
                    <td data-label="프로젝트명">
                      <strong title={p.prjCd}>{p.prjNm}</strong>
                    </td>
                    <td data-label="사업구분" className="nowrap">
                      <PrjTypeBadge type={p.prjType}>{label(PRJ_TYPE, p.prjType)}</PrjTypeBadge>
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
                      </Badge>
                    </td>
                    <td data-label="" onClick={(e) => e.stopPropagation()}>
                      {p.statusCd !== 'PROPOSAL' && can('projectMm') && (
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
  const { can } = useAuth();
  const toast = useToast();
  const isNew = !initial.prjCd;
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const { data: emps } = useFetch<{ empId: string; name: string; role: string; deptCd: string }[]>('/employees');
  const set = (p: Partial<Project>) => setF((s) => ({ ...s, ...p }));
  const numOrNull = (v: string) => (v === '' ? null : Number(v));
  const typeChanged = !isNew && f.prjType !== initial.prjType;

  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, contractAmt: f.contractAmt == null ? null : Math.round(f.contractAmt) };
      if (isNew) {
        await api.post('/projects', body);
        toast(`${f.prjNm} 프로젝트를 등록했습니다.`);
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
      title={isNew ? '프로젝트 등록' : `프로젝트 수정 · ${initial.prjNm}`}
      onClose={onClose}
      wide
      footer={
        <>
          {!isNew && can('projects', 'EDIT') && (
            <button className="btn danger" onClick={() => setRemoving(true)} style={{ marginRight: 'auto' }}>
              삭제
            </button>
          )}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            저장
          </button>
        </>
      }
    >
      {removing && initial.prjCd && <DeleteProjectDialog prjCd={initial.prjCd} prjNm={initial.prjNm ?? ''} onClose={() => setRemoving(false)} onDone={onSaved} />}
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="사업구분" required hint={typeChanged ? '변경하면 내부 프로젝트 코드가 새 구분으로 다시 부여됩니다 (연결 데이터는 그대로 유지)' : undefined}>
          <Select value={f.prjType} onChange={(prjType) => set({ prjType })} options={TYPE_OPTS} />
        </Field>
        <Field label="상태" required>
          <Select value={f.statusCd} onChange={(statusCd) => set({ statusCd })} options={PRJ_STATUS} />
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
        <Field label="PM 손익 공개">
          <label className="check" style={{ minHeight: 38 }}>
            <input type="checkbox" checked={!!f.plOpenYn} onChange={(e) => set({ plOpenYn: e.target.checked })} /> 담당 PM에게 손익 공개
          </label>
        </Field>
      </div>
    </Modal>
  );
}

interface DeleteImpact {
  hasHistory: boolean;
  counts: { assignments: number; timesheets: number; totalMd: number; workItems: number; issues: number; milestones: number; weeklyComments: number; etc: number };
}

/** 프로젝트 삭제: 연결 데이터 건수를 보여 주고, 이력이 있으면 프로젝트명을 입력해 확인 */
function DeleteProjectDialog({ prjCd, prjNm, onClose, onDone }: { prjCd: string; prjNm: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, error } = useFetch<DeleteImpact>(`/projects/${prjCd}/delete-impact`);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = !!data && (!data.hasHistory || typed.trim() === prjNm.trim());

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.del(`/projects/${prjCd}`, { confirm: typed.trim() });
      toast(`${prjNm} 프로젝트를 삭제했습니다.`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const c = data?.counts;
  return (
    <Modal
      title={`프로젝트 삭제 · ${prjNm}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn danger" disabled={!ready || busy} onClick={run}>
            완전 삭제
          </button>
        </>
      }
    >
      <ErrorBox error={error ?? err} />
      {!data || !c ? (
        <Loading />
      ) : !data.hasHistory ? (
        <div className="alert warn" style={{ marginBottom: 0 }}>
          <strong>{prjNm}</strong> — 연결된 배정·실적이 없는 프로젝트입니다. 삭제하면 되돌릴 수 없습니다.
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="alert bad" style={{ marginBottom: 0 }}>
            <strong>{prjNm}</strong>에 연결된 아래 데이터가 <strong>함께 삭제</strong>되며 되돌릴 수 없습니다. 투입 MD가 지워지면 과거 가동률·MM 수치가 달라집니다. 이력을 남기려면 삭제 대신 상태를 '완료' 또는 '중단'으로 바꾸세요.
          </div>
          <dl className="desc-list">
            <dt>투입 배정</dt>
            <dd>{c.assignments}건</dd>
            <dt>투입 MD</dt>
            <dd>
              {num(c.totalMd)} MD ({c.timesheets}행)
            </dd>
            <dt>주간보고 항목</dt>
            <dd>
              실적·계획 {c.workItems}건, 이슈 {c.issues}건
            </dd>
            <dt>마일스톤</dt>
            <dd>{c.milestones}건</dd>
            <dt>프로젝트 주간보고</dt>
            <dd>{c.weeklyComments}건</dd>
          </dl>
          <Field label={`확인을 위해 프로젝트명 "${prjNm}"을(를) 입력하세요`} required>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={prjNm} autoFocus />
          </Field>
          <p className="muted small" style={{ margin: 0 }}>
            다른 프로젝트의 투입 MD와 개인 주간 업무보고 자체는 지워지지 않습니다. 이미 확정한 전사 One-Page는 확정 시점 내용 그대로 남습니다.
          </p>
        </div>
      )}
    </Modal>
  );
}
