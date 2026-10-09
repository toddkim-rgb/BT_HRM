import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast, PrjTypeBadge } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth, useShowHr } from '../lib/auth';
import { ISSUE_TYPE, ITEM_STATUS, SEVERITY, SM_WORK_TYPE, WW_STATUS } from '../lib/codes';
import { dateTime, label, num } from '../lib/format';
import { dow, isoWeek, md as mdLabel, shiftWeek, today, weekLabel } from '../lib/dates';
import { fillByAssignment, type WeekPlan } from '../lib/fill';
import { useFetch } from '../lib/hooks';

interface Item {
  prjCd: string;
  msId?: number | null;
  workNm: string;
  content?: string | null;
  progressBefore?: number | null;
  progressAfter?: number | null;
  targetProgress?: number | null;
  dueDt?: string | null;
  statusCd?: string | null;
  delayReason?: string | null;
  smWorkType?: string | null;
  smCount?: number | null;
}
interface Issue {
  prjCd: string;
  issueType: string;
  severity: string;
  content: string;
  actionPlan?: string | null;
  supportReqYn: boolean;
}
interface TsRow {
  prjCd: string;
  prjNm?: string;
  prjType?: string;
  md: Record<string, number | null>;
}
interface View {
  week: string;
  days: string[];
  businessDays: string[];
  holidays: string[];
  employee: { empId: string; name: string; gradeCd: string; deptCd: string; skillLevel?: string; jobCd: string | null } | null;
  wwId: number | null;
  statusCd: string;
  remark: string | null;
  submittedAt: string | null;
  timesheet: TsRow[];
  plan: (WeekPlan & { roles: string[] })[];
  dayAlloc: Record<string, number>;
  actualItems: Item[];
  prevProgress?: Record<string, number>;
  prevTarget?: Record<string, number>; // 작업 항목별 목표(%) — 지난주 차주 계획 // 작업 항목(프로젝트|작업명)별 전주(%) — 이전 보고서 기준
  planItems: Item[];
  issues: Issue[];
}
interface Project {
  prjCd: string;
  prjNm: string;
  prjType: string;
  statusCd: string;
}

const MD_OPTS: [string, string][] = [
  ['', '-'],
  ['0.5', '0.5'],
  ['1', '1'],
];

export default function WeeklyWork() {
  const showHr = useShowHr(); // 기술등급·고용형태는 수행인력에게 표시하지 않음
  const { user, can } = useAuth();
  const params = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const empId = params.empId ?? user!.empId;
  const week = params.week ?? isoWeek(today());
  const isMine = empId === user!.empId;

  const { data, error, loading } = useFetch<View>(`/weekly-works/${empId}/${week}`);
  const { data: projects } = useFetch<Project[]>('/projects?includeNp=Y');
  const [v, setV] = useState<View | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null); // 선택한 프로젝트 카드

  useEffect(() => {
    // 실적·계획·이슈가 달린 프로젝트는 카드가 있어야 하므로 투입시간 행에 없으면 추가
    setV(data ? withItemRows(data) : data);
    setDirty(false);
    setErr(null);
  }, [data]);

  const prjMap = useMemo(() => new Map((projects ?? []).map((p) => [p.prjCd, p])), [projects]);
  const editable = isMine && v != null && can('weekly', 'EDIT');
  const submitted = v?.statusCd === 'SUBMITTED';
  const isSm = (prjCd: string) => prjMap.get(prjCd)?.prjType === 'SM';
  const typeOf = (r: TsRow) => r.prjType ?? prjMap.get(r.prjCd)?.prjType ?? (r.prjCd.startsWith('NP-') ? 'NP' : undefined);
  const nameOf = (r: { prjCd: string; prjNm?: string }) => r.prjNm ?? prjMap.get(r.prjCd)?.prjNm ?? r.prjCd;

  const goWeek = (n: number) => {
    if (dirty && !window.confirm('저장하지 않은 내용이 있습니다. 이동할까요?')) return;
    nav(`/weekly/${empId}/${shiftWeek(week, n)}`);
  };

  const update = (fn: (draft: View) => void) => {
    setV((cur) => {
      if (!cur) return cur;
      const next: View = structuredClone(cur);
      fn(next);
      return next;
    });
    setDirty(true);
  };

  if (loading && !v) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!v) return null;

  const daySum = (d: string) => v.timesheet.reduce((s, r) => s + (r.md[d] ?? 0), 0);
  const rowSum = (r: TsRow) => Object.values(r.md).reduce<number>((s, x) => s + (x ?? 0), 0);
  const total = v.timesheet.reduce((s, r) => s + rowSum(r), 0);
  const planOf = (prjCd: string) => v.plan.find((p) => p.prjCd === prjCd)?.plannedMd ?? null;

  const payload = () => ({
    remark: v.remark,
    timesheet: v.timesheet.map((r) => ({ prjCd: r.prjCd, md: r.md })),
    actualItems: v.actualItems,
    planItems: v.planItems,
    issues: v.issues,
  });

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.put<{ view: View }>(`/weekly-works/${empId}/${week}`, payload());
      setV(r.view);
      setDirty(false);
      toast('임시저장했습니다.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 제출 = 확정 (승인 절차 없음). 제출된 보고서도 수정 후 다시 제출하면 바로 반영
  const submit = async (confirmWarnings = false) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ view: View }>(`/weekly-works/${empId}/${week}/submit`, { ...payload(), confirmWarnings });
      setConfirm(null);
      setV(r.view);
      setDirty(false);
      toast(submitted ? '수정 내용을 제출했습니다.' : '제출했습니다. 가동률·MM에 바로 반영됩니다.');
    } catch (e) {
      if (e instanceof ApiError && (e.details as { needConfirm?: boolean })?.needConfirm) {
        setConfirm((e.details as { warnings: string[] }).warnings);
      } else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 다중 프로젝트 투입: 배정률대로 요일별 MD 자동 배분
  const fill = () => {
    const hasInput = v.timesheet.some((r) => v.plan.some((p) => p.prjCd === r.prjCd) && Object.values(r.md).some((x) => x));
    if (hasInput && !window.confirm('배정된 프로젝트 행의 입력값을 배정률대로 다시 채웁니다. 계속할까요?')) return;
    update((d) => {
      const names = new Map(d.timesheet.map((r) => [r.prjCd, r]));
      d.timesheet = fillByAssignment(d.timesheet, d.plan, d.businessDays).map((r) => ({ ...names.get(r.prjCd), ...r }));
    });
    toast('배정률대로 채웠습니다. 실제와 다르면 수정하세요.', 'info');
  };

  const loadCarryover = async () => {
    const items = await api.get<Item[]>(`/weekly-works/${empId}/${week}/carryover`);
    if (!items.length) return toast('전주 차주 계획이 없습니다.', 'info');
    update((d) => {
      for (const it of items) if (!d.actualItems.some((a) => a.prjCd === it.prjCd && a.workNm === it.workNm)) d.actualItems.push(it);
      Object.assign(d, withItemRows(d));
    });
    toast(`전주 계획 ${items.length}건을 불러왔습니다. (프로젝트별 '주간 업무 내용'에서 확인)`, 'info');
  };

  // MD 일괄 입력: 선택한 프로젝트의 영업일을 한 번에 1 또는 0.5로 채운다 (하루 합계 1.0 이내)
  const bulkMd = (prjCd: string, val: number | null) => {
    // 하루 남은 여유(1.0 − 다른 프로젝트 입력)를 넘지 않게 채운다
    const next: Record<string, number | null> = {};
    let filled = 0;
    let limited = 0;
    if (val != null) {
      for (const day of v.businessDays) {
        const others = v.timesheet.filter((r) => r.prjCd !== prjCd).reduce((sum, r) => sum + (r.md[day] ?? 0), 0);
        const room = 1 - others;
        const fit: number | null = room >= val ? val : room >= 0.5 ? 0.5 : null;
        next[day] = fit;
        if (fit != null) filled++;
        if (fit !== val) limited++;
      }
    }
    update((d) => {
      const row = d.timesheet.find((r) => r.prjCd === prjCd);
      if (row) row.md = next;
    });
    if (val == null) return;
    if (!limited) toast(`영업일 ${filled}일에 ${val}MD씩 입력했습니다.`, 'info');
    else if (!filled) toast('다른 프로젝트 입력으로 하루 1.0MD가 이미 찼습니다. 입력할 수 있는 날이 없습니다.', 'bad');
    else toast(`${filled}일에 입력했습니다. 다른 프로젝트 입력 때문에 ${limited}일은 줄이거나 비웠습니다 (하루 합계 1.0MD 이내).`, 'info');
  };

  const removeRow = (prjCd: string) => {
    const linked = v.actualItems.filter((i) => i.prjCd === prjCd).length + v.planItems.filter((i) => i.prjCd === prjCd).length + v.issues.filter((i) => i.prjCd === prjCd).length;
    if (linked && !window.confirm(`${nameOf({ prjCd })}에 입력한 업무 내용·이슈·계획 ${linked}건도 함께 지워집니다. 계속할까요?`)) return;
    update((d) => {
      d.timesheet = d.timesheet.filter((r) => r.prjCd !== prjCd);
      d.actualItems = d.actualItems.filter((i) => i.prjCd !== prjCd);
      d.planItems = d.planItems.filter((i) => i.prjCd !== prjCd);
      d.issues = d.issues.filter((i) => i.prjCd !== prjCd);
    });
    setSel(null);
  };

  /** 주간 업무(실적) 항목 → 차주 계획 항목: 작업 항목·내용·마일스톤·SM 업무유형을 그대로 옮김 */
  const toPlan = (it: Item): Item => ({ prjCd: it.prjCd, msId: it.msId ?? null, workNm: it.workNm, content: it.content ?? null, smWorkType: it.smWorkType ?? null, targetProgress: null, dueDt: null });
  /** 차주 계획에 이미 같은 작업 항목이 있으면 건너뜀 */
  const copyToPlan = (items: Item[]) => {
    // 추가할 목록을 먼저 계산 (상태 갱신 함수 안에서 세면 개발 모드에서 두 번 실행될 수 있음)
    const plan = v?.planItems ?? [];
    const toAdd: Item[] = [];
    let skipped = 0;
    for (const it of items) {
      const name = it.workNm.trim();
      const dup = (p: Item) => p.prjCd === it.prjCd && p.workNm.trim() === name;
      if (!name || plan.some(dup) || toAdd.some(dup)) skipped += 1;
      else toAdd.push(toPlan(it));
    }
    if (toAdd.length) update((d) => void d.planItems.push(...toAdd.map((x) => ({ ...x }))));
    return { added: toAdd.length, skipped };
  };
  /** 이 프로젝트의 주간 업무 중 완료되지 않은 항목을 차주 계획으로 가져오기 (완료 = 금주 100%) */
  const importFromActual = (prjCd: string) => {
    const src = (v?.actualItems ?? []).filter((it) => it.prjCd === prjCd && it.workNm.trim() && it.progressAfter !== 100);
    const done = (v?.actualItems ?? []).filter((it) => it.prjCd === prjCd && it.progressAfter === 100).length;
    if (!src.length) return toast(done ? '완료되지 않은 주간 업무가 없습니다. (금주 100% 항목은 제외)' : '가져올 주간 업무가 없습니다. 주간 업무 내용을 먼저 입력하세요.', 'info');
    const r = copyToPlan(src);
    toast(`주간 업무 ${r.added}건을 차주 계획으로 가져왔습니다.${r.skipped ? ` (이미 있는 항목 ${r.skipped}건 제외)` : ''}${done ? ` 완료(100%) ${done}건은 제외했습니다.` : ''} 목표 진척률·완료 예정일을 입력하세요.`, 'info');
  };

  // 목표(%) = 지난주 차주 계획의 목표 진척률 (서버가 보내준 값, 작업 항목명 기준)
  const targetOf = (it: Item) => v?.prevTarget?.[`${it.prjCd}|${it.workNm.trim()}`] ?? null;
  const statusOf = (it: Item) => {
    if (isSm(it.prjCd)) return null;
    if (it.progressAfter === 100) return 'DONE';
    const target = targetOf(it);
    if (target != null && it.progressAfter != null && it.progressAfter < target) return 'DELAY';
    return it.progressAfter == null ? null : 'NORMAL';
  };

  // 선택한 프로젝트 (없으면 첫 카드)
  const cur = v.timesheet.find((r) => r.prjCd === sel) ?? v.timesheet[0] ?? null;
  const curCd = cur?.prjCd ?? '';
  const curNp = cur ? typeOf(cur) === 'NP' : false;
  const curSm = cur ? typeOf(cur) === 'SM' : false;
  const countOf = (prjCd: string) => ({
    actual: v.actualItems.filter((i) => i.prjCd === prjCd).length,
    plan: v.planItems.filter((i) => i.prjCd === prjCd).length,
    issue: v.issues.filter((i) => i.prjCd === prjCd).length,
  });

  return (
    <div>
      <PageHeader
        title="주간 업무보고"
        desc={
          v.employee && (
            <>
              {v.employee.gradeCd} {v.employee.name} · {v.employee.deptCd} · {v.employee.jobCd ?? '-'}
              {showHr && v.employee.skillLevel ? ` · ${v.employee.skillLevel}` : ''} {!isMine && <Badge tone="info">조회</Badge>}
            </>
          )
        }
        actions={
          <div className="week-nav">
            <button className="btn sm" onClick={() => goWeek(-1)} aria-label="이전 주">
              ◀
            </button>
            <strong>{weekLabel(week)}</strong>
            <button className="btn sm" onClick={() => goWeek(1)} aria-label="다음 주">
              ▶
            </button>
            {week !== isoWeek(today()) && (
              <button className="btn sm ghost" onClick={() => nav(`/weekly/${empId}/${isoWeek(today())}`)}>
                이번 주
              </button>
            )}
          </div>
        }
      />

      <div className="row" style={{ marginBottom: 12 }}>
        <Badge code={v.statusCd}>{label(WW_STATUS, v.statusCd)}</Badge>
        {v.submittedAt && <span className="muted small">제출 {dateTime(v.submittedAt)}</span>}
        {dirty && <span className="warn-text small">● 저장되지 않은 변경</span>}
      </div>
      {submitted && isMine && <div className="alert info">제출된 보고서입니다. 수정이 필요하면 고친 뒤 '수정 제출'을 누르세요. 바로 반영됩니다.</div>}
      {v.plan.length > 1 && (
        <div className="alert info">
          이번 주 {v.plan.length}개 프로젝트에 투입 중입니다 · {v.plan.map((p) => `${nameOf({ prjCd: p.prjCd })} 계획 ${num(p.plannedMd)}MD`).join(' · ')}
          {Object.values(v.dayAlloc).some((a) => a > 100) && ' · 배정률 합계가 100%를 넘는 날이 있어 하루 1.0MD 안에서 나눠 입력해야 합니다.'}
        </div>
      )}
      <ErrorBox error={err} />

      <div className="stack">
        {/* ① 프로젝트 카드 선택 */}
        <Card
          title={
            <>
              <span className="section-no">1</span>프로젝트 선택
            </>
          }
          actions={
            editable && (
              <>
                {v.plan.length > 0 && (
                  <button className="btn sm" onClick={fill}>
                    배정대로 채우기
                  </button>
                )}
                <button className="btn sm" onClick={loadCarryover}>
                  전주 계획 불러오기
                </button>
                <button className="btn sm" onClick={() => setAddOpen(true)}>
                  + 프로젝트/공통코드
                </button>
              </>
            )
          }
        >
          {!v.timesheet.length ? (
            <div className="empty">이번 주 배정된 프로젝트가 없습니다. {editable && "'+ 프로젝트/공통코드'로 추가하세요."}</div>
          ) : (
            <div className="ww-cards">
              {v.timesheet.map((r) => {
                const c = countOf(r.prjCd);
                const np = typeOf(r) === 'NP';
                const plan = planOf(r.prjCd);
                return (
                  <button type="button" key={r.prjCd} className={`ww-card ${r.prjCd === curCd ? 'active' : ''}`} onClick={() => setSel(r.prjCd)} aria-pressed={r.prjCd === curCd}>
                    <span className="row">{np ? <Badge tone="neutral">공통</Badge> : <Badge tone="info">{typeOf(r) ?? ''}</Badge>}</span>
                    <strong className="ww-card-name">{nameOf(r)}</strong>
                    <span className="ww-card-md">
                      {num(rowSum(r))}
                      <small> MD{plan != null && ` / 계획 ${num(plan)}`}</small>
                    </span>
                    {!np && (
                      <span className="small muted">
                        업무 {c.actual} · 이슈 {c.issue} · 계획 {c.plan}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="ww-days" aria-label="요일별 합계">
            {v.days.map((d) => {
              const w = dow(d);
              const off = v.holidays.includes(d) || w === '토' || w === '일';
              const sum = daySum(d);
              return (
                <div key={d} className={`ww-day ${off ? 'off' : ''} ${sum > 1 ? 'over' : ''}`}>
                  <span className={v.holidays.includes(d) ? 'bad-text' : ''}>
                    {w} <small>{mdLabel(d)}</small>
                  </span>
                  <strong>{sum ? num(sum) : '-'}</strong>
                </div>
              );
            })}
            <div className="ww-day total">
              <span>주간 합계</span>
              <strong>
                {num(total)} <small>/ 영업일 {v.businessDays.length}</small>
              </strong>
            </div>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            카드를 눌러 프로젝트별로 투입시간 → 주간 업무 내용 → 이슈 → 차주 계획 순으로 입력합니다. 하루 합계는 1.0MD를 넘을 수 없고, 휴가는 '+ 프로젝트/공통코드'에서 <b>휴가</b>를 추가해 입력합니다.
          </p>
        </Card>

        {/* ② 선택한 프로젝트 입력 */}
        {cur && (
          <Card
            className="ww-panel"
            title={
              <>
                <span className="section-no">2</span>
                {nameOf(cur)}
              </>
            }
            actions={
              editable && (
                <button className="btn sm danger" onClick={() => removeRow(curCd)}>
                  이 프로젝트 빼기
                </button>
              )
            }
          >
            {/* 투입시간 */}
            <div className="ww-step">
              <div className="ww-step-head">
                <h3>투입시간 (MD)</h3>
                {editable && (
                  <div className="row">
                    <span className="small muted">MD 일괄 입력</span>
                    <button className="btn sm" onClick={() => bulkMd(curCd, 1)}>
                      전체 1
                    </button>
                    <button className="btn sm" onClick={() => bulkMd(curCd, 0.5)}>
                      전체 0.5
                    </button>
                    <button className="btn sm ghost" onClick={() => bulkMd(curCd, null)}>
                      지우기
                    </button>
                  </div>
                )}
              </div>
              <div className="ww-md-grid">
                {v.days.map((d) => {
                  const w = dow(d);
                  const off = v.holidays.includes(d) || w === '토' || w === '일';
                  return (
                    <label key={d} className={`ww-md-cell ${off ? 'off' : ''} ${daySum(d) > 1 ? 'over' : ''}`}>
                      <span className={v.holidays.includes(d) ? 'bad-text' : ''}>
                        {w} <small>{mdLabel(d)}</small>
                      </span>
                      {editable ? (
                        <Select
                          value={cur.md[d] == null ? '' : String(cur.md[d])}
                          options={MD_OPTS}
                          onChange={(val) =>
                            update((dr) => {
                              const row = dr.timesheet.find((x) => x.prjCd === curCd);
                              if (row) row.md[d] = val === '' ? null : Number(val);
                            })
                          }
                        />
                      ) : (
                        <strong>{cur.md[d] ?? '-'}</strong>
                      )}
                    </label>
                  );
                })}
                <div className="ww-md-cell total">
                  <span>합계</span>
                  <strong>
                    {num(rowSum(cur))}
                    {planOf(curCd) != null && <small> / 계획 {num(planOf(curCd))}</small>}
                  </strong>
                </div>
              </div>
            </div>

            {curNp ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                공통코드(휴가·교육·대기·일반관리)는 투입시간만 입력합니다.
              </p>
            ) : (
              <>
                {/* 주간 업무 내용 (금주 실적) */}
                <div className="ww-step">
                  <div className="ww-step-head">
                    <h3>주간 업무 내용</h3>
                    {editable && (
                      <button className="btn sm" onClick={() => update((d) => void d.actualItems.push({ prjCd: curCd, workNm: '', progressBefore: 0 }))}>
                        + 업무 추가
                      </button>
                    )}
                  </div>
                  {!v.actualItems.some((i) => i.prjCd === curCd) && <div className="empty">이번 주 수행한 업무를 추가하세요. 전주에 적은 차주 계획은 자동으로 들어옵니다.</div>}
                  {v.actualItems.map((it, i) => {
                    if (it.prjCd !== curCd) return null;
                    const st = statusOf(it);
                    const set = (patch: Partial<Item>) =>
                      update((d) => {
                        Object.assign(d.actualItems[i], patch);
                      });
                    return (
                      <div className="item-card" key={i}>
                        <div className="item-head">
                          <div className="row">{st && <Badge code={st}>{ITEM_STATUS[st]}</Badge>}</div>
                          {editable && (
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                className="btn sm"
                                disabled={!it.workNm.trim()}
                                title="이 업무를 차주 계획에 추가"
                                onClick={() => {
                                  const r = copyToPlan([it]);
                                  toast(r.added ? `'${it.workNm}'을(를) 차주 계획에 추가했습니다.` : '차주 계획에 이미 같은 작업 항목이 있습니다.', 'info');
                                }}
                              >
                                차주 계획으로 복사
                              </button>
                              <button className="btn sm danger" onClick={() => update((d) => void d.actualItems.splice(i, 1))}>
                                삭제
                              </button>
                            </div>
                          )}
                        </div>
                        {curSm ? (
                          <div className="item-grid sm">
                            <Field label="작업 항목" full>
                              <input value={it.workNm} disabled={!editable} onChange={(e) => set({ workNm: e.target.value })} />
                            </Field>
                            <Field label="업무유형">
                              <Select value={it.smWorkType ?? 'ETC'} options={SM_WORK_TYPE} disabled={!editable} onChange={(smWorkType) => set({ smWorkType })} />
                            </Field>
                            <Field label="처리건수">
                              <input type="number" min={0} value={it.smCount ?? ''} disabled={!editable} onChange={(e) => set({ smCount: e.target.value === '' ? null : Number(e.target.value) })} />
                            </Field>
                            <Field label="주요 내용" full>
                              <textarea value={it.content ?? ''} disabled={!editable} onChange={(e) => set({ content: e.target.value })} rows={2} />
                            </Field>
                          </div>
                        ) : (
                          <div className="item-grid ww-actual">
                            <Field label="작업 항목">
                              <input value={it.workNm} disabled={!editable} onChange={(e) => set({ workNm: e.target.value })} />
                            </Field>
                            <Field label="전주(%)" hint="이전 보고서 자동">
                              <input type="number" value={v.prevProgress?.[`${it.prjCd}|${it.workNm.trim()}`] ?? 0} readOnly disabled title="이전 보고서에서 같은 작업 항목의 금주(%)를 자동으로 가져옵니다" />
                            </Field>
                            <Field label="목표(%)" hint="지난주 차주 계획">
                              <input value={targetOf(it) ?? '-'} readOnly disabled title="지난주 '차주 계획'의 목표 진척률을 자동으로 가져옵니다. 없으면 지연 판정을 하지 않습니다." />
                            </Field>
                            <Field label="금주(%)" required>
                              <input type="number" min={0} max={100} value={it.progressAfter ?? ''} disabled={!editable} onChange={(e) => set({ progressAfter: e.target.value === '' ? null : Number(e.target.value) })} />
                            </Field>
                            <Field label="상세 내용" full>
                              <textarea value={it.content ?? ''} disabled={!editable} onChange={(e) => set({ content: e.target.value })} rows={2} />
                            </Field>
                            {st === 'DELAY' && (
                              <Field label="지연 사유" required full>
                                <input value={it.delayReason ?? ''} disabled={!editable} onChange={(e) => set({ delayReason: e.target.value })} placeholder="목표 대비 미달 사유를 입력하세요" />
                              </Field>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 이슈 */}
                <div className="ww-step">
                  <div className="ww-step-head">
                    <h3>이슈 / 리스크</h3>
                    {editable && (
                      <button className="btn sm" onClick={() => update((d) => void d.issues.push({ prjCd: curCd, issueType: 'ISSUE', severity: 'M', content: '', supportReqYn: false }))}>
                        + 이슈 추가
                      </button>
                    )}
                  </div>
                  {!v.issues.some((i) => i.prjCd === curCd) && <div className="empty">이슈가 없으면 비워 두세요.</div>}
                  {v.issues.map((it, i) => {
                    if (it.prjCd !== curCd) return null;
                    const set = (patch: Partial<Issue>) =>
                      update((d) => {
                        Object.assign(d.issues[i], patch);
                      });
                    return (
                      <div className="item-card" key={i}>
                        <div className="item-grid plan">
                          <Field label="구분">
                            <Select value={it.issueType} options={ISSUE_TYPE} disabled={!editable} onChange={(issueType) => set({ issueType })} />
                          </Field>
                          <Field label="중요도">
                            <Select value={it.severity} options={SEVERITY} disabled={!editable} onChange={(severity) => set({ severity })} />
                          </Field>
                          <Field label="지원요청">
                            <label className="check" style={{ minHeight: 38 }}>
                              <input type="checkbox" checked={it.supportReqYn} disabled={!editable} onChange={(e) => set({ supportReqYn: e.target.checked })} /> PM 지원 필요
                            </label>
                          </Field>
                          <Field label=" ">
                            {editable ? (
                              <button className="btn sm danger" onClick={() => update((d) => void d.issues.splice(i, 1))}>
                                삭제
                              </button>
                            ) : (
                              <span />
                            )}
                          </Field>
                          <Field label="내용" required full>
                            <textarea value={it.content} disabled={!editable} onChange={(e) => set({ content: e.target.value })} rows={2} />
                          </Field>
                          <Field label="조치계획 / 요청사항" full>
                            <input value={it.actionPlan ?? ''} disabled={!editable} onChange={(e) => set({ actionPlan: e.target.value })} />
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 차주 계획 */}
                <div className="ww-step">
                  <div className="ww-step-head">
                    <h3>차주 계획</h3>
                    {editable && (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn sm" onClick={() => importFromActual(curCd)} title="이 프로젝트의 주간 업무 중 완료(100%)되지 않은 항목을 차주 계획으로 복사">
                          ⤓ 주간 업무 가져오기
                        </button>
                        <button className="btn sm" onClick={() => update((d) => void d.planItems.push({ prjCd: curCd, workNm: '' }))}>
                          + 계획 추가
                        </button>
                      </div>
                    )}
                  </div>
                  {!v.planItems.some((i) => i.prjCd === curCd) && <div className="empty">다음 주 계획을 추가하세요. (보고서 전체에 최소 1건, 차주 전일 휴가 시 예외)</div>}
                  {v.planItems.map((it, i) => {
                    if (it.prjCd !== curCd) return null;
                    const set = (patch: Partial<Item>) =>
                      update((d) => {
                        Object.assign(d.planItems[i], patch);
                      });
                    return (
                      <div className="item-card" key={i}>
                        <div className="item-grid plan">
                          <Field label="작업 항목" full>
                            <input value={it.workNm} disabled={!editable} onChange={(e) => set({ workNm: e.target.value })} />
                          </Field>
                          {curSm ? (
                            <Field label="업무유형">
                              <Select value={it.smWorkType ?? 'ETC'} options={SM_WORK_TYPE} disabled={!editable} onChange={(smWorkType) => set({ smWorkType })} />
                            </Field>
                          ) : (
                            <Field label="목표 진척률(%)">
                              <input type="number" min={0} max={100} value={it.targetProgress ?? ''} disabled={!editable} onChange={(e) => set({ targetProgress: e.target.value === '' ? null : Number(e.target.value) })} />
                            </Field>
                          )}
                          <Field label="완료 예정일">
                            <input type="date" value={it.dueDt ?? ''} disabled={!editable} onChange={(e) => set({ dueDt: e.target.value || null })} />
                          </Field>
                          <Field label=" ">
                            {editable ? (
                              <button className="btn sm danger" onClick={() => update((d) => void d.planItems.splice(i, 1))}>
                                삭제
                              </button>
                            ) : (
                              <span />
                            )}
                          </Field>
                          <Field label="계획 내용" full>
                            <input value={it.content ?? ''} disabled={!editable} onChange={(e) => set({ content: e.target.value })} />
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
        )}

        {/* ③ 특이사항 */}
        <Card
          title={
            <>
              <span className="section-no">3</span>특이사항 / 건의
            </>
          }
        >
          <textarea value={v.remark ?? ''} disabled={!editable} onChange={(e) => update((d) => void (d.remark = e.target.value))} rows={3} placeholder="선택 입력" />
        </Card>
      </div>

      {editable && (
        <div className="sticky-actions">
          {!submitted && (
            <button className="btn" disabled={busy} onClick={save}>
              임시저장
            </button>
          )}
          <button className="btn primary" disabled={busy} onClick={() => submit(false)}>
            {submitted ? '수정 제출' : '제출'}
          </button>
        </div>
      )}

      {addOpen && (
        <AddRowModal
          projects={(projects ?? []).filter((p) => !v.timesheet.some((r) => r.prjCd === p.prjCd) && !['DONE', 'STOP', 'PROPOSAL'].includes(p.statusCd))}
          onClose={() => setAddOpen(false)}
          onAdd={(p) => {
            update((d) => void d.timesheet.push({ prjCd: p.prjCd, prjNm: p.prjNm, prjType: p.prjType, md: {} }));
            setSel(p.prjCd);
            setAddOpen(false);
          }}
        />
      )}

      {confirm && (
        <Modal
          title="제출 전 확인"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                돌아가서 수정
              </button>
              <button className="btn primary" disabled={busy} onClick={() => submit(true)}>
                그대로 제출
              </button>
            </>
          }
        >
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {confirm.map((w) => (
              <li key={w} style={{ marginBottom: 6 }}>
                {w}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/** 실적·계획·이슈에 쓰인 프로젝트가 투입시간 행에 없으면 추가 (카드로 보여 주기 위해) */
function withItemRows(view: View): View {
  const have = new Set(view.timesheet.map((r) => r.prjCd));
  const extra = [...new Set([...view.actualItems, ...view.planItems, ...view.issues].map((i) => i.prjCd))].filter((c) => !have.has(c));
  return extra.length ? { ...view, timesheet: [...view.timesheet, ...extra.map((prjCd) => ({ prjCd, md: {} }))] } : view;
}

function AddRowModal({ projects, onAdd, onClose }: { projects: Project[]; onAdd: (p: Project) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = projects.filter((p) => !q || p.prjCd.toLowerCase().includes(q.toLowerCase()) || p.prjNm.includes(q));
  return (
    <Modal title="프로젝트 / 공통코드 추가" onClose={onClose}>
      <input type="search" placeholder="프로젝트명 검색" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ marginBottom: 10 }} />
      <div className="table-wrap">
        <table className="tbl">
          <tbody>
            {list.map((p) => (
              <tr key={p.prjCd} className="clickable" onClick={() => onAdd(p)}>
                <td>
                  <strong>{p.prjNm}</strong>
                </td>
                <td className="nowrap" style={{ textAlign: 'right' }}>
                  <PrjTypeBadge type={p.prjType}>{p.prjType === 'NP' ? '공통' : p.prjType}</PrjTypeBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.length && <div className="empty">추가할 수 있는 코드가 없습니다.</div>}
    </Modal>
  );
}
