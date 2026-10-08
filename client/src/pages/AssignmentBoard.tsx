import { useState, type DragEvent } from 'react';
import { Badge, Empty, ErrorBox, Loading, useToast, PrjTypeBadge } from '../components/ui';
import { api } from '../lib/api';
import { isPmOf, pmScoped, useAuth, useShowHr } from '../lib/auth';
import { ASG_ROLE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label, num } from '../lib/format';
import { today } from '../lib/dates';
import { useFetch } from '../lib/hooks';

export interface BoardAsg {
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
interface Emp {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  jobCd: string | null;
  skillLevel?: string;
  employType: string;
  partner: { partnerNm: string } | null;
  utilTarget: boolean;
  allocTotal: number;
  overAlloc: number;
  plannedAlloc: number; // 아직 시작 전인 예정 배정의 투입률 합계
  plannedStartDt: string | null;
}
interface Prj {
  prjCd: string;
  prjNm: string;
  prjType: string;
  statusCd: string;
  pmEmpId: string | null;
  pmName: string | null;
  startDt: string | null;
  endDt: string | null;
}

interface ProjectMd {
  planMd: number;
  actualMd: number;
  planMm: number;
  actualMm: number;
  byEmp: Record<string, { planMd: number; actualMd: number }>;
}

type Drag = { kind: 'emp'; empId: string } | { kind: 'asg'; asgId: number } | { kind: 'partner'; partnerId: string };
interface PartnerOpt {
  partnerId: string;
  partnerNm: string;
  contactNm: string | null;
  staffName: string; // 수행인력으로 만들 때의 이름
  staffCount: number;
}

/** 소속 표기: 협력사 인력은 협력사명, 자사 인력은 소속 */
export const orgOf = (e: { employType: string; deptCd: string; partner?: { partnerNm: string } | null }) =>
  e.partner ? `협력사 ${e.partner.partnerNm}` : e.deptCd;
const MIME = 'application/x-bt-hrm';

/** 직무 → 기본 투입 역할 */
const roleOf = (job: string | null) => (!job ? 'DEV' : job.includes('설계') ? 'DESIGN' : job.includes('운영') ? 'OPS' : job.includes('테스트') ? 'QA' : job.includes('개발') ? 'DEV' : 'ETC');

/**
 * 배정 보드: 인력을 프로젝트 카드로 끌어다 놓아 배정하고, 프로젝트의 인력을 인력 목록으로 끌어내 뺀다.
 * 터치 화면처럼 끌기가 안 되는 환경을 위해 '+ 인력' 선택과 '×' 버튼도 함께 제공한다.
 */
export function AssignmentBoard({ onEdit, refreshKey }: { onEdit: (a: BoardAsg) => void; refreshKey: number }) {
  const { user, can } = useAuth();
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  const toast = useToast();
  const t = today();
  const { data: asgs, error, reload: reloadAsg } = useFetch<BoardAsg[]>(`/assignments?status=PLANNED,ACTIVE,ENDED&_=${refreshKey}`);
  const { data: emps, reload: reloadEmp } = useFetch<Emp[]>(`/employees?_=${refreshKey}`);
  const { data: projects } = useFetch<Prj[]>('/projects?status=ACTIVE,PROPOSAL,DONE,STOP');
  const { data: partners, reload: reloadPartners } = useFetch<PartnerOpt[]>(`/assignments/partners?_=${refreshKey}`);
  const { data: md, reload: reloadMd } = useFetch<Record<string, ProjectMd>>(`/assignments/project-md?_=${refreshKey}`);
  const [prjStatus, setPrjStatus] = useState<Record<string, string>>({}); // 보드에서 바꾼 상태 (프로젝트 목록 재조회 전 반영)
  const [q, setQ] = useState('');
  const [benchOnly, setBenchOnly] = useState(false);
  const [over, setOver] = useState<string | null>(null); // 드롭 대상 강조 (프로젝트 코드 또는 'pool')
  const [busy, setBusy] = useState(false);

  // 편집: 투입 배정 '편집' 권한 + PM 역할은 담당 프로젝트만
  const canEditMenu = can('assignments', 'EDIT');
  const canManage = (p: { prjCd: string }) => canEditMenu && (!pmScoped(user) || isPmOf(user, p.prjCd));
  const canDragEmp = canEditMenu && (projects ?? []).some(canManage);
  // 상태 변경: 프로젝트 편집 권한 또는 이 프로젝트의 배정 관리 권한
  const canStatus = (p: { prjCd: string }) => can('projects', 'EDIT') || canManage(p);
  const reload = () => {
    reloadAsg();
    reloadEmp();
    reloadPartners();
    reloadMd();
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await fn(), 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
      reload();
    }
  };

  /** 인력을 프로젝트에 배정 (기본값: 오늘~프로젝트 종료일, 남은 투입률 / 기간이 지난 프로젝트는 프로젝트 기간 전체) */
  const assign = async (empId: string, p: Prj) => {
    const e = emps?.find((x) => x.empId === empId);
    if (!e) throw new Error('인력을 찾을 수 없습니다.');
    if ((asgs ?? []).some((a) => a.empId === empId && a.prjCd === p.prjCd)) throw new Error(`${e.name}님은 이미 이 프로젝트에 배정되어 있습니다. 칩을 눌러 기간·투입률을 수정하세요.`);
    let startDt = p.startDt && p.startDt > t ? p.startDt : t;
    const endDt = p.endDt ?? `${t.slice(0, 4)}-12-31`;
    if (endDt < startDt) startDt = p.startDt && p.startDt <= endDt ? p.startDt : endDt; // 기간이 지난 프로젝트: 과거 기간으로 배정
    const remain = 100 - e.allocTotal;
    const allocRate = remain > 0 ? remain : 100;
    const r = await api.post<{ overAlloc: number }>('/assignments', { empId, prjCd: p.prjCd, roleCd: roleOf(e.jobCd), startDt, endDt, allocRate, residentType: 'ONSITE' });
    return `${e.name}님을 ${p.prjNm}에 배정했습니다 (${allocRate}%, ${startDt} ~ ${endDt})${r.overAlloc > 0 ? ` · 과투입 +${r.overAlloc}%` : ''}. 칩을 누르면 역할·기간·투입률을 수정할 수 있습니다.`;
  };

  /** 협력사를 바로 배정: 소속 수행인력을 확보(없으면 생성)한 뒤 배정 */
  const assignPartner = async (partnerId: string, p: Prj) => {
    const r = await api.post<{ empId: string; name: string; created: boolean }>(`/assignments/partners/${partnerId}/staff`);
    const startDt = p.startDt && p.startDt > t ? p.startDt : t;
    let s = startDt;
    const endDt = p.endDt ?? `${t.slice(0, 4)}-12-31`;
    if (endDt < s) s = p.startDt && p.startDt <= endDt ? p.startDt : endDt;
    const o = await api.post<{ overAlloc: number }>('/assignments', { empId: r.empId, prjCd: p.prjCd, roleCd: 'DEV', startDt: s, endDt, allocRate: 100, residentType: 'ONSITE' });
    return `${r.name}님(협력사)을 ${p.prjNm}에 배정했습니다 (100%, ${s} ~ ${endDt})${o.overAlloc > 0 ? ` · 과투입 +${o.overAlloc}%` : ''}.${r.created ? ' 인력 화면에서 이메일·연락처를 보완하세요.' : ''}`;
  };

  /** 프로젝트 상태 변경: 기간과 무관하게 완료 처리 / 다시 진행으로 */
  const changeStatus = (p: Prj, statusCd: 'ACTIVE' | 'DONE') => {
    let closeAssignments = false;
    if (statusCd === 'DONE') {
      const live = (asgs ?? []).filter((a) => a.prjCd === p.prjCd && a.status !== 'ENDED').length;
      if (!window.confirm(`${p.prjNm}을(를) 완료로 처리할까요?`)) return;
      if (live > 0) closeAssignments = window.confirm(`진행 중·예정 배정 ${live}건이 있습니다. 오늘 날짜로 종료할까요?\n(취소를 누르면 배정은 그대로 두고 프로젝트만 완료 처리)`);
    } else if (!window.confirm(`${p.prjNm}을(를) 다시 진행중으로 표시할까요?`)) return;
    run(async () => {
      const r = await api.patch<{ closed: number; canceled: number }>(`/assignments/projects/${p.prjCd}/status`, { statusCd, closeAssignments });
      setPrjStatus((s) => ({ ...s, [p.prjCd]: statusCd }));
      return statusCd === 'DONE'
        ? `${p.prjNm}을(를) 완료 처리했습니다.${r.closed || r.canceled ? ` 배정 ${r.closed}건 종료, ${r.canceled}건 취소.` : ''}`
        : `${p.prjNm}을(를) 진행중으로 변경했습니다.`;
    });
  };

  /** 프로젝트에서 빼기: 시작 전·이미 끝난 배정은 취소, 진행 중 배정은 오늘 날짜로 종료 */
  const unassign = async (a: BoardAsg) => {
    if (a.startDt >= t || a.endDt < t) {
      await api.post(`/assignments/${a.asgId}/cancel`);
      return `${a.employee.name}님의 ${a.project.prjNm} 배정을 취소했습니다.`;
    }
    await api.put(`/assignments/${a.asgId}`, { empId: a.empId, prjCd: a.prjCd, roleCd: a.roleCd, startDt: a.startDt, endDt: t, allocRate: a.allocRate, residentType: a.residentType });
    return `${a.employee.name}님의 ${a.project.prjNm} 투입을 오늘(${t})로 종료했습니다. 지난 실적은 유지됩니다.`;
  };

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.setData(MIME, JSON.stringify(d));
    e.dataTransfer.setData('text/plain', d.kind === 'emp' ? d.empId : d.kind === 'partner' ? d.partnerId : String(d.asgId));
    e.dataTransfer.effectAllowed = 'move';
  };
  const readDrag = (e: DragEvent): Drag | null => {
    try {
      return JSON.parse(e.dataTransfer.getData(MIME)) as Drag;
    } catch {
      return null;
    }
  };
  const allowDrop = (e: DragEvent, key: string) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (over !== key) setOver(key);
  };

  const dropOnProject = (e: DragEvent, p: Prj) => {
    e.preventDefault();
    setOver(null);
    const d = readDrag(e);
    if (!d || busy) return;
    if (!canManage(p)) return toast('담당 프로젝트에만 배정할 수 있습니다.', 'bad');
    if (d.kind === 'emp') return run(() => assign(d.empId, p));
    if (d.kind === 'partner') return run(() => assignPartner(d.partnerId, p));
    const a = asgs?.find((x) => x.asgId === d.asgId);
    if (!a || a.prjCd === p.prjCd || a.status === 'ENDED') return;
    // 다른 프로젝트에서 옮기기 = 새 프로젝트에 배정 + 기존 프로젝트에서 빼기
    run(async () => {
      const msg = await assign(a.empId, p);
      if (canManage(a)) await unassign(a);
      return canManage(a) ? `${a.employee.name}님을 ${a.project.prjNm} → ${p.prjNm}(으)로 옮겼습니다.` : msg;
    });
  };
  const dropOnPool = (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const d = readDrag(e);
    if (!d || d.kind !== 'asg' || busy) return;
    const a = asgs?.find((x) => x.asgId === d.asgId);
    if (a) run(() => unassign(a));
  };

  if (error) return <ErrorBox error={error} />;
  if (!asgs || !emps || !projects) return <Loading />;
  // 소속 인력이 아직 없는 협력사 (선택하면 수행인력을 만들어 배정)
  const newPartners = (partners ?? []).filter((x) => x.staffCount === 0);

  // 종료된 프로젝트(완료·중단 또는 종료일이 지난 프로젝트)는 하단에 배치
  // 진행/종료는 프로젝트 상태 기준 (완료·중단 = 종료, 하단 배치). 기간이 지나도 진행중이면 진행으로 표시
  const statusOf = (p: Prj) => prjStatus[p.prjCd] ?? p.statusCd;
  const isEnded = (p: Prj) => ['DONE', 'STOP'].includes(statusOf(p));
  const isOverdue = (p: Prj) => !isEnded(p) && !!p.endDt && p.endDt < t;
  const sorted = [...projects].sort((a, b) => Number(isEnded(a)) - Number(isEnded(b)));

  const kw = q.trim().toLowerCase();
  const pool = emps
    .filter((e) => e.utilTarget)
    .filter((e) => !benchOnly || (e.allocTotal === 0 && e.plannedAlloc === 0))
    .filter((e) => !kw || e.name.toLowerCase().includes(kw) || e.deptCd.toLowerCase().includes(kw))
    .sort((a, b) => a.allocTotal - b.allocTotal || a.plannedAlloc - b.plannedAlloc || a.name.localeCompare(b.name));

  return (
    <div className="board">
      <aside className={`board-pool ${over === 'pool' ? 'drop-over' : ''}`} onDragOver={(e) => allowDrop(e, 'pool')} onDragLeave={() => setOver(null)} onDrop={dropOnPool}>
        <div className="board-pool-head">
          <strong>인력 {pool.length}명</strong>
          <label className="check small">
            <input type="checkbox" checked={benchOnly} onChange={(e) => setBenchOnly(e.target.checked)} /> 미배정만
          </label>
        </div>
        <input type="search" placeholder="이름·소속 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="board-pool-list">
          {pool.map((e) => (
            <div key={e.empId} className="board-emp" draggable={canDragEmp} onDragStart={(ev) => startDrag(ev, { kind: 'emp', empId: e.empId })} title={canDragEmp ? '프로젝트 카드로 끌어다 놓으세요' : undefined}>
              <span className="board-emp-name">
                <strong>
                  <span className="muted">{e.gradeCd}</span> {e.name}
                </strong>
                <small>
                  {orgOf(e)}
                  {e.jobCd ? ` · ${e.jobCd}` : ''}
                  {showHr && e.skillLevel ? ` · ${e.skillLevel}` : ''}
                </small>
              </span>
              <span className="board-emp-badges">
                {e.allocTotal > 0 ? (
                  <Badge tone={e.overAlloc > 0 ? 'bad' : e.allocTotal >= 100 ? 'good' : 'info'}>{e.allocTotal}%</Badge>
                ) : e.plannedAlloc === 0 ? (
                  <Badge tone="warn">대기</Badge>
                ) : null}
                {e.plannedAlloc > 0 && (
                  <span title={`${e.plannedStartDt}부터 투입 예정`}>
                    <Badge tone="neutral">예정 {e.plannedAlloc}%</Badge>
                  </span>
                )}
              </span>
            </div>
          ))}
          {!pool.length && <Empty>해당하는 인력이 없습니다.</Empty>}
          {!benchOnly && newPartners.length > 0 && (
            <>
              <div className="board-pool-sub">협력사 (인력 미등록)</div>
              {newPartners
                .filter((x) => !kw || x.partnerNm.toLowerCase().includes(kw))
                .map((x) => (
                  <div key={x.partnerId} className="board-emp partner" draggable={canDragEmp} onDragStart={(ev) => startDrag(ev, { kind: 'partner', partnerId: x.partnerId })} title={canDragEmp ? '프로젝트 카드로 끌어다 놓으면 협력사 수행인력으로 배정됩니다' : undefined}>
                    <span className="board-emp-name">
                      <strong>{x.staffName}</strong>
                      <small>협력사 {x.partnerNm}</small>
                    </span>
                    <span className="board-emp-badges">
                      <Badge tone="info">협력사</Badge>
                    </span>
                  </div>
                ))}
            </>
          )}
        </div>
        <p className="board-hint">
          % = 오늘 투입률 · 예정 = 아직 시작 전인 배정 · 대기 = 배정 없음
          <br />
          프로젝트에서 빼려면 인력 칩을 이 목록으로 끌어다 놓으세요.
        </p>
      </aside>

      <div className="board-projects">
        {!projects.length && <Empty>프로젝트가 없습니다.</Empty>}
        {sorted.map((p) => {
          const ended = isEnded(p);
          const overdue = isOverdue(p);
          const pmd = md?.[p.prjCd];
          // 진행 중 프로젝트는 진행·예정 배정만, 종료(또는 기간 경과) 프로젝트는 지난 배정까지 표시
          const members = asgs.filter((a) => a.prjCd === p.prjCd && (ended || overdue || a.status !== 'ENDED'));
          const mine = canManage(p);
          const addable = emps.filter((e) => e.utilTarget && !members.some((m) => m.empId === e.empId));
          return (
            <section
              key={p.prjCd}
              className={`board-prj ${over === p.prjCd ? 'drop-over' : ''} ${mine ? '' : 'readonly'} ${ended ? 'ended' : ''}`}
              onDragOver={(e) => mine && allowDrop(e, p.prjCd)}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => dropOnProject(e, p)}
              tabIndex={0}
              aria-label={`${p.prjNm} (상세는 마우스를 올리거나 선택하면 표시)`}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 6 }}>
                  <PrjTypeBadge type={p.prjType}>{label(PRJ_TYPE, p.prjType)}</PrjTypeBadge>
                  <Badge code={statusOf(p)}>{label(PRJ_STATUS, statusOf(p))}</Badge>
                  {overdue && <Badge tone="warn">기간 경과</Badge>}
                </span>
                <span className="small muted">
                  {members.length}명 · {members.reduce((s, m) => s + m.allocRate, 0)}%
                </span>
              </div>
              <div className="board-prj-title" title={p.prjCd}>
                {p.prjNm}
              </div>
              <div className="board-members">
                {members.map((a) => (
                  <div
                    key={a.asgId}
                    className={`board-chip ${a.overAlloc > 0 ? 'over' : ''} ${a.status === 'PLANNED' ? 'planned' : ''} ${a.status === 'ENDED' ? 'ended' : ''}`}
                    draggable={mine && a.status !== 'ENDED'}
                    onDragStart={(ev) => startDrag(ev, { kind: 'asg', asgId: a.asgId })}
                    title={`${label(ASG_ROLE, a.roleCd)} · ${a.startDt} ~ ${a.endDt}${a.overAlloc > 0 ? ` · 과투입 +${a.overAlloc}%` : ''}`}
                  >
                    <button type="button" className="board-chip-main" disabled={!mine} onClick={() => onEdit(a)}>
                      <strong>
                        <span className="muted">{a.employee.gradeCd}</span> {a.employee.name}
                        {a.roleCd === 'PM' && <span className="board-pm">PM</span>}
                      </strong>
                    </button>
                    {mine && (
                      <button type="button" className="board-chip-x" aria-label={`${a.employee.name} 빼기`} disabled={busy} onClick={() => window.confirm(a.status === 'ENDED' ? `${a.employee.name}님의 ${p.prjNm} 지난 배정을 취소할까요? 가동률 등 지난 집계에서도 빠집니다.` : `${a.employee.name}님을 ${p.prjNm}에서 뺄까요?`) && run(() => unassign(a))}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {!members.length && <div className="board-drop-hint">{mine ? '인력을 여기로 끌어다 놓으세요' : '배정된 인력 없음'}</div>}
              </div>
              {/* 상세: 마우스를 올리면(또는 포커스) 카드 아래로 펼쳐짐, 터치 화면은 항상 표시 */}
              <div className="board-prj-detail">
                <div className="board-detail-meta">
                  PM {p.pmName ?? '-'} · {p.startDt ?? '-'} ~ {p.endDt ?? '-'}
                </div>
                {members.length > 0 && (
                  <ul className="board-detail-members">
                    {members.map((a) => (
                      <li key={a.asgId}>
                        <span>
                          {a.employee.gradeCd} {a.employee.name}
                        </span>
                        <span>
                          {ended ? `실적 ${num(pmd?.byEmp[a.empId]?.actualMd ?? 0)}MD` : `${a.allocRate}%`} · {label(ASG_ROLE, a.roleCd)}
                          {a.status === 'PLANNED' && ' · 예정'}
                          {a.status === 'ENDED' && ' · 종료'}
                          {a.overAlloc > 0 && ` · 과투입 +${a.overAlloc}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {ended && (
                  <div className="board-final-md" title="계획 MD = Σ(배정 기간 영업일 × 투입률) · 실적 MD = 제출된 주간 업무보고 기준">
                    <strong>최종 MD</strong> 실적 {num(pmd?.actualMd ?? 0)} MD ({num(pmd?.actualMm ?? 0, 2)} MM) · 계획 {num(pmd?.planMd ?? 0)} MD ({num(pmd?.planMm ?? 0, 2)} MM)
                  </div>
                )}
                {mine && (
                  <select
                    className="board-add"
                    value=""
                    disabled={busy}
                    aria-label={`${p.prjNm}에 인력 추가`}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id.startsWith('partner:')) run(() => assignPartner(id.slice(8), p));
                      else if (id) run(() => assign(id, p));
                    }}
                  >
                    <option value="">+ 인력 추가 (목록에서 선택)</option>
                    <optgroup label="수행인력">
                      {addable.map((e) => (
                        <option key={e.empId} value={e.empId}>
                          {e.gradeCd} {e.name} · {orgOf(e)}
                          {e.jobCd ? ` · ${e.jobCd}` : ''} · 현재 {e.allocTotal}%
                        </option>
                      ))}
                    </optgroup>
                    {newPartners.length > 0 && (
                      <optgroup label="협력사 (인력 미등록 → 수행인력으로 추가)">
                        {newPartners.map((x) => (
                          <option key={x.partnerId} value={`partner:${x.partnerId}`}>
                            {x.staffName} · 협력사 {x.partnerNm}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
                {canStatus(p) && (
                  <div className="board-status-actions">
                    {ended ? (
                      <button type="button" className="btn sm" disabled={busy} onClick={() => changeStatus(p, 'ACTIVE')}>
                        진행으로 변경
                      </button>
                    ) : (
                      <button type="button" className="btn sm" disabled={busy} onClick={() => changeStatus(p, 'DONE')}>
                        완료 처리
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
