import { useState, type DragEvent } from 'react';
import { Badge, Empty, ErrorBox, Loading, useToast, PrjTypeBadge } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ASG_ROLE, EMPLOY_TYPE, PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { label } from '../lib/format';
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
  skillLevel: string;
  employType: string;
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

type Drag = { kind: 'emp'; empId: string } | { kind: 'asg'; asgId: number };
const MIME = 'application/x-bt-hrm';

/** 직무 → 기본 투입 역할 */
const roleOf = (job: string | null) => (!job ? 'DEV' : job.includes('설계') ? 'DESIGN' : job.includes('운영') ? 'OPS' : job.includes('테스트') ? 'QA' : job.includes('개발') ? 'DEV' : 'ETC');

/**
 * 배정 보드: 인력을 프로젝트 카드로 끌어다 놓아 배정하고, 프로젝트의 인력을 인력 목록으로 끌어내 뺀다.
 * 터치 화면처럼 끌기가 안 되는 환경을 위해 '+ 인력' 선택과 '×' 버튼도 함께 제공한다.
 */
export function AssignmentBoard({ onEdit, refreshKey }: { onEdit: (a: BoardAsg) => void; refreshKey: number }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const t = today();
  const { data: asgs, error, reload: reloadAsg } = useFetch<BoardAsg[]>(`/assignments?status=PLANNED,ACTIVE&_=${refreshKey}`);
  const { data: emps, reload: reloadEmp } = useFetch<Emp[]>(`/employees?_=${refreshKey}`);
  const { data: projects } = useFetch<Prj[]>('/projects?status=ACTIVE,PROPOSAL');
  const [q, setQ] = useState('');
  const [benchOnly, setBenchOnly] = useState(false);
  const [over, setOver] = useState<string | null>(null); // 드롭 대상 강조 (프로젝트 코드 또는 'pool')
  const [busy, setBusy] = useState(false);

  // 편집: 투입 배정 '편집' 권한 + PM 역할은 담당 프로젝트만
  const canEditMenu = can('assignments', 'EDIT');
  const canManage = (p: { pmEmpId: string | null }) => canEditMenu && (user?.role !== 'PM' || p.pmEmpId === user.empId);
  const canDragEmp = canEditMenu && (projects ?? []).some(canManage);
  const reload = () => {
    reloadAsg();
    reloadEmp();
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

  /** 인력을 프로젝트에 배정 (기본값: 오늘~프로젝트 종료일, 남은 투입률) */
  const assign = async (empId: string, p: Prj) => {
    const e = emps?.find((x) => x.empId === empId);
    if (!e) throw new Error('인력을 찾을 수 없습니다.');
    if ((asgs ?? []).some((a) => a.empId === empId && a.prjCd === p.prjCd)) throw new Error(`${e.name}님은 이미 이 프로젝트에 배정되어 있습니다. 칩을 눌러 기간·투입률을 수정하세요.`);
    const startDt = p.startDt && p.startDt > t ? p.startDt : t;
    const endDt = p.endDt ?? `${t.slice(0, 4)}-12-31`;
    if (endDt < startDt) throw new Error('프로젝트 종료일이 지났습니다. 프로젝트 기간을 먼저 수정하세요.');
    const remain = 100 - e.allocTotal;
    const allocRate = remain > 0 ? remain : 100;
    const r = await api.post<{ overAlloc: number }>('/assignments', { empId, prjCd: p.prjCd, roleCd: roleOf(e.jobCd), startDt, endDt, allocRate, residentType: 'ONSITE' });
    return `${e.name}님을 ${p.prjNm}에 배정했습니다 (${allocRate}%, ${startDt} ~ ${endDt})${r.overAlloc > 0 ? ` · 과투입 +${r.overAlloc}%` : ''}. 칩을 누르면 역할·기간·투입률을 수정할 수 있습니다.`;
  };

  /** 프로젝트에서 빼기: 시작 전 배정은 취소, 진행 중 배정은 오늘 날짜로 종료 */
  const unassign = async (a: BoardAsg) => {
    if (a.startDt >= t) {
      await api.post(`/assignments/${a.asgId}/cancel`);
      return `${a.employee.name}님의 ${a.project.prjNm} 배정을 취소했습니다.`;
    }
    await api.put(`/assignments/${a.asgId}`, { empId: a.empId, prjCd: a.prjCd, roleCd: a.roleCd, startDt: a.startDt, endDt: t, allocRate: a.allocRate, residentType: a.residentType });
    return `${a.employee.name}님의 ${a.project.prjNm} 투입을 오늘(${t})로 종료했습니다. 지난 실적은 유지됩니다.`;
  };

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.setData(MIME, JSON.stringify(d));
    e.dataTransfer.setData('text/plain', d.kind === 'emp' ? d.empId : String(d.asgId));
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
    const a = asgs?.find((x) => x.asgId === d.asgId);
    if (!a || a.prjCd === p.prjCd) return;
    // 다른 프로젝트에서 옮기기 = 새 프로젝트에 배정 + 기존 프로젝트에서 빼기
    run(async () => {
      const msg = await assign(a.empId, p);
      if (canManage(a.project)) await unassign(a);
      return canManage(a.project) ? `${a.employee.name}님을 ${a.project.prjNm} → ${p.prjNm}(으)로 옮겼습니다.` : msg;
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
                <strong>{e.name}</strong>
                <small>
                  {e.deptCd} · {e.gradeCd} · {e.skillLevel}
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
        </div>
        <p className="board-hint">
          % = 오늘 투입률 · 예정 = 아직 시작 전인 배정 · 대기 = 배정 없음
          <br />
          프로젝트에서 빼려면 인력 칩을 이 목록으로 끌어다 놓으세요.
        </p>
      </aside>

      <div className="board-projects">
        {!projects.length && <Empty>진행중·제안 상태의 프로젝트가 없습니다.</Empty>}
        {projects.map((p) => {
          const members = asgs.filter((a) => a.prjCd === p.prjCd);
          const mine = canManage(p);
          const addable = emps.filter((e) => e.utilTarget && !members.some((m) => m.empId === e.empId));
          return (
            <section
              key={p.prjCd}
              className={`board-prj ${over === p.prjCd ? 'drop-over' : ''} ${mine ? '' : 'readonly'}`}
              onDragOver={(e) => mine && allowDrop(e, p.prjCd)}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => dropOnProject(e, p)}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 6 }}>
                  <PrjTypeBadge type={p.prjType}>{label(PRJ_TYPE, p.prjType)}</PrjTypeBadge>
                  <Badge code={p.statusCd}>{label(PRJ_STATUS, p.statusCd)}</Badge>
                </span>
                <span className="small muted">
                  {members.length}명 · {members.reduce((s, m) => s + m.allocRate, 0)}%
                </span>
              </div>
              <div className="board-prj-title" title={p.prjCd}>
                {p.prjNm}
              </div>
              <div className="small muted">
                PM {p.pmName ?? '-'} · {p.startDt ?? '-'} ~ {p.endDt ?? '-'}
              </div>
              <div className="board-members">
                {members.map((a) => (
                  <div
                    key={a.asgId}
                    className={`board-chip ${a.overAlloc > 0 ? 'over' : ''} ${a.status === 'PLANNED' ? 'planned' : ''}`}
                    draggable={mine}
                    onDragStart={(ev) => startDrag(ev, { kind: 'asg', asgId: a.asgId })}
                    title={`${label(ASG_ROLE, a.roleCd)} · ${a.startDt} ~ ${a.endDt}${a.overAlloc > 0 ? ` · 과투입 +${a.overAlloc}%` : ''}`}
                  >
                    <button type="button" className="board-chip-main" disabled={!mine} onClick={() => onEdit(a)}>
                      <strong>{a.employee.name}</strong>
                      <span>
                        {a.allocRate}% · {label(ASG_ROLE, a.roleCd)}
                        {a.status === 'PLANNED' && ' · 예정'}
                      </span>
                      <small>
                        ~ {a.endDt.slice(5)} · {label(EMPLOY_TYPE, a.employee.employType)}
                      </small>
                    </button>
                    {mine && (
                      <button type="button" className="board-chip-x" aria-label={`${a.employee.name} 빼기`} disabled={busy} onClick={() => window.confirm(`${a.employee.name}님을 ${p.prjNm}에서 뺄까요?`) && run(() => unassign(a))}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {!members.length && <div className="board-drop-hint">{mine ? '인력을 여기로 끌어다 놓으세요' : '배정된 인력 없음'}</div>}
              </div>
              {mine && (
                <select
                  className="board-add"
                  value=""
                  disabled={busy}
                  aria-label={`${p.prjNm}에 인력 추가`}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) run(() => assign(id, p));
                  }}
                >
                  <option value="">+ 인력 추가 (목록에서 선택)</option>
                  {addable.map((e) => (
                    <option key={e.empId} value={e.empId}>
                      {e.name} · {e.deptCd} · 현재 {e.allocTotal}%
                    </option>
                  ))}
                </select>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
