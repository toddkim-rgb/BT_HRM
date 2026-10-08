import { useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth, useShowHr } from '../lib/auth';
import { ASG_ROLE, ASG_STATUS, EMP_STATUS, EMPLOY_TYPE, ROLE_LABEL, SKILL_LEVELS } from '../lib/codes';
import { label } from '../lib/format';
import { useFetch } from '../lib/hooks';

export interface Employee {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  jobCd: string | null;
  skillLevel: string;
  skillStack: string | null;
  employType: string;
  partnerId: string | null;
  partner?: { partnerNm: string } | null;
  careerStartDt: string | null;
  careerYears: number | null;
  email: string;
  phone: string | null;
  statusCd: string | null;
  deletedAt?: string | null;
  role: string;
  utilTarget: boolean;
  allocTotal?: number;
  overAlloc?: number;
  projectCount?: number;
  plannedAlloc?: number;
  plannedStartDt?: string | null;
  currentAssignments?: { prjCd: string; prjNm: string; roleCd: string; allocRate: number; endDt: string }[];
}

const blank: Partial<Employee> = {
  email: '',
  name: '',
  deptCd: '',
  gradeCd: '',
  skillLevel: '중급',
  employType: 'REG',
  statusCd: null,
  role: 'EMP',
  utilTarget: true,
};

export default function Employees() {
  const { can } = useAuth();
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  const isAdmin = can('employees', 'EDIT'); // 인력 '편집' 권한 (관리자 계정·역할 변경은 시스템관리자만)
  const [q, setQ] = useState('');
  const [employType, setEmployType] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'active' | 'deleted'>('active');
  const deletedView = view === 'deleted';
  const { data, error, loading, reload } = useFetch<Employee[]>(
    `/employees${qs({ q, employType, status: deletedView ? undefined : status, includeRetired: status === 'RETIRED' ? 'Y' : undefined, deleted: deletedView ? 'Y' : undefined })}`,
  );
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [removing, setRemoving] = useState<Employee | null>(null);
  const toast = useToast();

  const restore = async (e: Employee) => {
    if (!window.confirm(`${e.name}님을 복구할까요? 목록·로그인·배정 대상에 다시 포함됩니다.`)) return;
    try {
      await api.post(`/employees/${e.empId}/restore`);
      toast(`${e.name}님을 복구했습니다.`);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'bad');
    }
  };

  return (
    <div>
      <PageHeader
        title="인력"
        desc="자사·협력사 인력 마스터. 투입률 합계는 오늘 기준이며 100% 초과분은 과투입으로 표시합니다."
        actions={
          isAdmin && (
            <>
              <button className="btn" onClick={() => setImportOpen(true)}>
                엑셀(CSV) 일괄 등록
              </button>
              <button className="btn primary" onClick={() => setEdit({ ...blank })}>
                + 인력 등록
              </button>
            </>
          )
        }
      />
      <Card>
        {isAdmin && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={!deletedView} className={!deletedView ? 'active' : ''} onClick={() => setView('active')}>
              인력
            </button>
            <button role="tab" aria-selected={deletedView} className={deletedView ? 'active' : ''} onClick={() => setView('deleted')}>
              삭제된 인력
            </button>
          </div>
        )}
        <div className="filters">
          <input type="search" placeholder="이름·이메일·소속·기술 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={employType} onChange={setEmployType} options={EMPLOY_TYPE} placeholder="고용형태 전체" />
          {!deletedView && <Select value={status} onChange={setStatus} options={{ ...EMP_STATUS, NONE: '미지정' }} placeholder="퇴사 제외 전체" />}
        </div>
        {deletedView && <div className="alert info">삭제 처리된 인력입니다. 목록·로그인·배정 대상에서 제외되며, 과거 배정·주간보고·가동률 이력은 유지됩니다. 복구하면 다시 사용할 수 있습니다.</div>}
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
                  <th>직급</th>
                  <th>성명</th>
                  <th>소속</th>
                  <th>역할</th>
                  {showHr && <th>기술등급</th>}
                  {showHr && <th>고용형태</th>}
                  <th className="num">경력</th>
                  <th className="num">투입률</th>
                  <th>상태</th>
                  {isAdmin && <th>권한</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.empId} className="clickable" onClick={() => setDetail(e.empId)}>
                    <td data-label="직급">{e.gradeCd}</td>
                    <td data-label="성명">
                      <strong>{e.name}</strong>
                    </td>
                    <td data-label="소속">
                      {e.deptCd}
                      {e.partner && <div className="small muted">협력사 {e.partner.partnerNm}</div>}
                    </td>
                    <td data-label="역할">{e.jobCd ?? '-'}</td>
                    {showHr && <td data-label="기술등급">{e.skillLevel}</td>}
                    {showHr && <td data-label="고용형태">{label(EMPLOY_TYPE, e.employType)}</td>}
                    <td data-label="경력" className="num">
                      {e.careerYears != null ? `${e.careerYears}년` : '-'}
                    </td>
                    <td data-label="투입률" className="num">
                      {e.allocTotal ? (
                        <span title={(e.currentAssignments ?? []).map((a) => `${a.prjNm} ${a.allocRate}%`).join('\n')}>
                          {e.allocTotal}%{(e.projectCount ?? 0) > 1 && <div className="small muted">{e.projectCount}개 프로젝트</div>}
                        </span>
                      ) : e.plannedAlloc ? (
                        <span title={`${e.plannedStartDt}부터 투입 예정`}>
                          <Badge tone="neutral">예정 {e.plannedAlloc}%</Badge>
                        </span>
                      ) : e.utilTarget ? (
                        <Badge tone="warn">대기</Badge>
                      ) : (
                        <span className="muted small">대상 아님</span>
                      )}
                      {!!e.overAlloc && (
                        <div>
                          <Badge tone="bad">과투입 +{e.overAlloc}%</Badge>
                        </div>
                      )}
                    </td>
                    <td data-label="상태">
                      {deletedView ? (
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <Badge tone="neutral">삭제 {e.deletedAt ? e.deletedAt.slice(0, 10) : ''}</Badge>
                          <button
                            className="btn sm"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              restore(e);
                            }}
                          >
                            복구
                          </button>
                        </span>
                      ) : e.statusCd ? (
                        <Badge code={e.statusCd}>{label(EMP_STATUS, e.statusCd)}</Badge>
                      ) : (
                        <span className="muted small">미지정</span>
                      )}
                    </td>
                    {isAdmin && <td data-label="권한">{label(ROLE_LABEL, e.role)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detail && (
        <EmployeeDetail
          empId={detail}
          onClose={() => setDetail(null)}
          onEdit={
            isAdmin && !deletedView
              ? (e) => {
                  setDetail(null);
                  setEdit(e);
                }
              : undefined
          }
          onDelete={
            isAdmin && !deletedView
              ? (e) => {
                  setDetail(null);
                  setRemoving(e);
                }
              : undefined
          }
        />
      )}
      {edit && (
        <EmployeeForm
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
      {removing && (
        <DeleteDialog
          emp={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            reload();
          }}
        />
      )}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onDone={() => {
            reload();
          }}
        />
      )}
    </div>
  );
}

function EmployeeDetail({ empId, onClose, onEdit, onDelete }: { empId: string; onClose: () => void; onEdit?: (e: Employee) => void; onDelete?: (e: Employee) => void }) {
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  const { data, loading, error } = useFetch<Employee & { assignments: { asgId: number; prjCd: string; roleCd: string; startDt: string; endDt: string; allocRate: number; status: string; project: { prjNm: string } }[] }>(
    `/employees/${empId}`,
  );
  return (
    <Modal
      title="인력 상세"
      onClose={onClose}
      wide
      footer={
        data &&
        (onEdit || onDelete) && (
          <>
            {onDelete && (
              <button className="btn danger" onClick={() => onDelete(data)} style={{ marginRight: 'auto' }}>
                삭제
              </button>
            )}
            {onEdit && (
              <button className="btn primary" onClick={() => onEdit(data)}>
                수정
              </button>
            )}
          </>
        )
      }
    >
      <ErrorBox error={error} />
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="stack">
          <dl className="desc-list">
            <dt>직급</dt>
            <dd>{data.gradeCd}</dd>
            <dt>성명</dt>
            <dd>
              <strong>{data.name}</strong>
            </dd>
            <dt>소속</dt>
            <dd>
              {data.deptCd} {data.partner && `· 협력사 ${data.partner.partnerNm}`}
            </dd>
            <dt>역할</dt>
            <dd>{data.jobCd ?? '-'}</dd>
            {showHr && (
              <>
                <dt>고용형태</dt>
                <dd>{label(EMPLOY_TYPE, data.employType)}</dd>
                <dt>기술등급</dt>
                <dd>{data.skillLevel}</dd>
              </>
            )}
            <dt>기술스택</dt>
            <dd>{data.skillStack ?? '-'}</dd>
            <dt>경력</dt>
            <dd>{data.careerYears != null ? `${data.careerYears}년 (IT 경력 시작 ${data.careerStartDt})` : '-'}</dd>
            <dt>이메일 (로그인)</dt>
            <dd>{data.email}</dd>
            <dt>연락처</dt>
            <dd>{data.phone ?? '-'}</dd>
            <dt>상태</dt>
            <dd>{data.statusCd ? label(EMP_STATUS, data.statusCd) : '미지정'}</dd>
          </dl>
          <div>
            <h2 style={{ marginBottom: 8 }}>투입 이력</h2>
            {!data.assignments.length ? (
              <Empty>투입 이력이 없습니다.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="tbl responsive">
                  <thead>
                    <tr>
                      <th>프로젝트</th>
                      <th>역할</th>
                      <th>기간</th>
                      <th className="num">투입률</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assignments.map((a) => (
                      <tr key={a.asgId}>
                        <td data-label="프로젝트">
                          <strong title={a.prjCd}>{a.project.prjNm}</strong>
                        </td>
                        <td data-label="역할">{label(ASG_ROLE, a.roleCd)}</td>
                        <td data-label="기간" className="nowrap">
                          {a.startDt} ~ {a.endDt}
                        </td>
                        <td data-label="투입률" className="num">
                          {a.allocRate}%
                        </td>
                        <td data-label="상태">
                          <Badge code={a.status}>{label(ASG_STATUS, a.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function DeleteDialog({ emp, onClose, onDone }: { emp: Employee; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, error } = useFetch<{
    mode: 'HARD' | 'ARCHIVE';
    counts: { assignmentsActive: number; assignmentsPlanned: number; assignmentsTotal: number; weeklyWorks: number; pmProjects: number };
    blockers: string[];
  }>(`/employees/${emp.empId}/delete-impact`);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.del<{ mode: 'HARD' | 'ARCHIVE' }>(`/employees/${emp.empId}`);
      toast(r.mode === 'HARD' ? `${emp.name}님을 완전히 삭제했습니다.` : `${emp.name}님을 삭제 처리했습니다. '삭제된 인력'에서 복구할 수 있습니다.`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const blocked = !!data?.blockers.length;
  return (
    <Modal
      title={`인력 삭제 · ${emp.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn danger" disabled={!data || blocked || !agree || busy} onClick={run}>
            {data?.mode === 'HARD' ? '완전 삭제' : '삭제 처리'}
          </button>
        </>
      }
    >
      <ErrorBox error={error ?? err} />
      {!data ? (
        <Loading />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {blocked ? (
            <div className="alert bad" style={{ marginBottom: 0 }}>
              삭제할 수 없습니다.
              {data.blockers.map((b) => `\n· ${b}`).join('')}
            </div>
          ) : data.mode === 'HARD' ? (
            <div className="alert warn" style={{ marginBottom: 0 }}>
              연결된 이력(배정·주간보고 등)이 없는 인력입니다. <strong>완전히 삭제</strong>되며 되돌릴 수 없습니다.
            </div>
          ) : (
            <>
              <div className="alert info" style={{ marginBottom: 0 }}>
                이력이 있는 인력이라 <strong>삭제 처리(보관)</strong>합니다. 목록·로그인·배정 대상에서 제외되고, 과거 가동률·MM·주간보고는 유지됩니다. '삭제된 인력'에서 복구할 수 있습니다.
              </div>
              <dl className="desc-list">
                <dt>진행 중 배정</dt>
                <dd>{data.counts.assignmentsActive}건 → 오늘 날짜로 종료</dd>
                <dt>예정 배정</dt>
                <dd>{data.counts.assignmentsPlanned}건 → 취소</dd>
                <dt>전체 배정 이력</dt>
                <dd>{data.counts.assignmentsTotal}건 (보존)</dd>
                <dt>주간 업무보고</dt>
                <dd>{data.counts.weeklyWorks}건 (보존)</dd>
              </dl>
            </>
          )}
          {!blocked && (
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {emp.name}님({emp.email})을 {data.mode === 'HARD' ? '완전 삭제' : '삭제 처리'}합니다.
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}

function EmployeeForm({ initial, onClose, onSaved }: { initial: Partial<Employee>; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth(); // 권한(역할) 변경은 시스템관리자만
  const toast = useToast();
  const isNew = !('careerYears' in initial); // 조회해 온 인력에는 careerYears가 있음
  const [f, setF] = useState({ ...initial });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: partners } = useFetch<{ partnerId: string; partnerNm: string; statusCd: string }[]>('/admin/partners');
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const needsPartner = f.employType === 'PARTNER' || f.employType === 'FREE';

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { ...f, partnerId: needsPartner ? f.partnerId : null };
      if (isNew) {
        await api.post('/employees', body);
        toast(`등록했습니다. 로그인 아이디와 초기 비밀번호는 모두 ${(f.email ?? '').toLowerCase()} 입니다. (첫 로그인 시 비밀번호 변경)`, 'info');
      } else {
        await api.put(`/employees/${initial.empId}`, body);
        toast('저장했습니다.');
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPw = async () => {
    if (!window.confirm(`${initial.name}님의 비밀번호를 이메일 주소(${initial.email})로 초기화할까요?\n첫 로그인 시 새 비밀번호를 설정해야 합니다.`)) return;
    try {
      await api.post(`/employees/${initial.empId}/reset-password`);
      toast(`비밀번호를 이메일 주소(${initial.email})로 초기화했습니다.`, 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };

  return (
    <Modal
      title={isNew ? '인력 등록' : `인력 수정 · ${initial.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          {!isNew && (
            <button className="btn ghost" onClick={resetPw} style={{ marginRight: 'auto' }}>
              비밀번호 초기화
            </button>
          )}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
            저장
          </button>
        </>
      }
    >
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="고용형태" required>
          <Select value={f.employType} onChange={(employType) => set({ employType })} options={EMPLOY_TYPE} />
        </Field>
        {needsPartner && (
          <Field label="협력사" required full>
            <Select
              value={f.partnerId}
              onChange={(partnerId) => set({ partnerId })}
              placeholder="선택"
              options={(partners ?? []).filter((p) => p.statusCd === 'ACTIVE' || p.partnerId === f.partnerId).map((p) => [p.partnerId, p.partnerNm] as [string, string])}
            />
          </Field>
        )}
        <Field label="성명" required>
          <input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="소속 (본부/팀)" required>
          <input value={f.deptCd ?? ''} onChange={(e) => set({ deptCd: e.target.value })} />
        </Field>
        <Field label="직급" required>
          <input value={f.gradeCd ?? ''} onChange={(e) => set({ gradeCd: e.target.value })} />
        </Field>
        <Field label="직무">
          <input value={f.jobCd ?? ''} onChange={(e) => set({ jobCd: e.target.value })} placeholder="개발, 설계, 운영…" />
        </Field>
        <Field label="기술등급" required>
          <Select value={f.skillLevel} onChange={(skillLevel) => set({ skillLevel })} options={SKILL_LEVELS.map((s) => [s, s] as [string, string])} />
        </Field>
        <Field label="IT 경력 시작일" hint="경력연수 자동 계산">
          <input type="date" value={f.careerStartDt ?? ''} onChange={(e) => set({ careerStartDt: e.target.value })} />
        </Field>
        <Field label="주요 기술스택" full>
          <input value={f.skillStack ?? ''} onChange={(e) => set({ skillStack: e.target.value })} placeholder="예: Java, Spring, Oracle" />
        </Field>
        <Field label="업무 이메일" required hint="로그인 ID로 사용">
          <input type="email" value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="연락처" required hint="아이디(이메일) 찾기 본인 확인에 사용">
          <input type="tel" value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="010-0000-0000" />
        </Field>
        <Field label="상태">
          <Select value={f.statusCd} onChange={(statusCd) => set({ statusCd: statusCd || null })} options={EMP_STATUS} placeholder="미지정" />
        </Field>
        <Field label="시스템 권한" required>
          <Select value={f.role} onChange={(role) => set({ role })} options={ROLE_LABEL} disabled={user?.role !== 'ADMIN'} title={user?.role !== 'ADMIN' ? '권한(역할)은 시스템관리자만 변경할 수 있습니다' : undefined} />
        </Field>
        <Field label="투입 대상" hint="관리자·사업관리자 등은 해제 (가동률·대기 인원 집계 제외)">
          <label className="check" style={{ minHeight: 38 }}>
            <input type="checkbox" checked={f.utilTarget ?? true} onChange={(e) => set({ utilTarget: e.target.checked })} /> 가동률 집계 대상
          </label>
        </Field>
      </div>
      <p className="muted small">
        로그인 아이디와 초기 비밀번호는 <strong>업무 이메일 주소</strong>(소문자)입니다. 첫 로그인 시 새 비밀번호를 설정해야 합니다.
      </p>
      <p className="muted small">주민등록번호·주소·연봉 등 민감 개인정보는 수집하지 않습니다.</p>
    </Modal>
  );
}

const CSV_HEADERS = ['name', 'deptCd', 'gradeCd', 'jobCd', 'skillLevel', 'skillStack', 'employType', 'partnerId', 'careerStartDt', 'email', 'phone', 'role'];
const CSV_HEADER_KO = ['성명', '소속', '직급', '직무', '기술등급', '기술스택', '고용형태(REG/CONT/FREE/PARTNER)', '협력사ID', 'IT경력시작일', '이메일(로그인ID·필수)', '연락처(필수)', '권한(EMP 수행인력/EXEC 사업관리자/ADMIN)'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<{ created: number; failed: number; results: { row: number; email?: string; name?: string; error?: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const template = () => {
    const csv = '﻿' + [CSV_HEADER_KO.join(','), '홍길동,SI사업팀,대리,개발,중급,"Java, React",REG,,2019-01-02,hong@example.com,010-0000-0000,EMP'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = '인력_일괄등록_양식.csv';
    a.click();
  };

  const onFile = async (file: File) => {
    setErr(null);
    setResult(null);
    const text = (await file.text()).replace(/^﻿/, '');
    const all = parseCsv(text);
    if (all.length < 2) return setErr('데이터 행이 없습니다.');
    setRows(
      all.slice(1).map((r) => {
        const o: Record<string, string> = {};
        CSV_HEADERS.forEach((h, i) => {
          const v = (r[i] ?? '').trim();
          if (v) o[h] = v;
        });
        return o;
      }),
    );
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<typeof result>('/employees/import', { rows });
      setResult(r);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="인력 일괄 등록"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn primary" disabled={!rows.length || busy || !!result} onClick={run}>
            {rows.length}건 등록
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        엑셀에서 양식을 채운 뒤 <b>CSV UTF-8</b>로 저장해 올려 주세요. 열 순서는 양식과 같아야 합니다.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={template}>
          양식 내려받기
        </button>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} style={{ maxWidth: 320 }} />
      </div>
      <ErrorBox error={err} />
      {result && result.created > 0 && (
        <div className="alert info">등록된 인력의 로그인 아이디와 초기 비밀번호는 모두 본인 이메일 주소입니다. 첫 로그인 시 비밀번호를 변경해야 합니다.</div>
      )}
      {result && (
        <div className={`alert ${result.failed ? 'warn' : 'good'}`}>
          등록 {result.created}건 / 실패 {result.failed}건
          {result.results
            .filter((r) => r.error)
            .map((r) => `\n${r.row}행: ${r.error}`)
            .join('')}
        </div>
      )}
      {!!rows.length && !result && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {['성명', '이메일', '소속', '직급', '등급', '고용형태', '협력사'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.deptCd}</td>
                  <td>{r.gradeCd}</td>
                  <td>{r.skillLevel}</td>
                  <td>{r.employType}</td>
                  <td>{r.partnerId}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && <p className="muted small">외 {rows.length - 50}건</p>}
        </div>
      )}
    </Modal>
  );
}
