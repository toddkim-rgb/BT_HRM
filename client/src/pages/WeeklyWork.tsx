import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  employee: { empId: string; name: string; gradeCd: string; skillLevel: string; jobCd: string | null } | null;
  wwId: number | null;
  statusCd: string;
  remark: string | null;
  submittedAt: string | null;
  timesheet: TsRow[];
  plan: (WeekPlan & { roles: string[] })[];
  dayAlloc: Record<string, number>;
  actualItems: Item[];
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
  const { user } = useAuth();
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

  useEffect(() => {
    setV(data);
    setDirty(false);
    setErr(null);
  }, [data]);

  const prjMap = useMemo(() => new Map((projects ?? []).map((p) => [p.prjCd, p])), [projects]);
  const editable = isMine && v != null;
  const submitted = v?.statusCd === 'SUBMITTED';
  const isSm = (prjCd: string) => prjMap.get(prjCd)?.prjType === 'SM';
  const workProjects = (v?.timesheet ?? []).filter((r) => r.prjType !== 'NP' && prjMap.get(r.prjCd)?.prjType !== 'NP');
  const prjOptions: [string, string][] = workProjects.map((r) => [r.prjCd, `${r.prjCd} ${r.prjNm ?? ''}`]);

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

  // 다중 프로젝트 투입: 배정 투입률대로 요일별 MD 자동 배분
  const fill = () => {
    const hasInput = v.timesheet.some((r) => v.plan.some((p) => p.prjCd === r.prjCd) && Object.values(r.md).some((x) => x));
    if (hasInput && !window.confirm('배정된 프로젝트 행의 입력값을 투입률대로 다시 채웁니다. 계속할까요?')) return;
    update((d) => {
      const names = new Map(d.timesheet.map((r) => [r.prjCd, r]));
      d.timesheet = fillByAssignment(d.timesheet, d.plan, d.businessDays).map((r) => ({ ...names.get(r.prjCd), ...r }));
    });
    toast('배정 투입률대로 채웠습니다. 실제와 다르면 수정하세요.', 'info');
  };

  const loadCarryover = async () => {
    const items = await api.get<Item[]>(`/weekly-works/${empId}/${week}/carryover`);
    if (!items.length) return toast('전주 차주 계획이 없습니다.', 'info');
    update((d) => {
      for (const it of items) if (!d.actualItems.some((a) => a.prjCd === it.prjCd && a.workNm === it.workNm)) d.actualItems.push(it);
    });
    toast(`전주 계획 ${items.length}건을 불러왔습니다.`, 'info');
  };

  const statusOf = (it: Item) => {
    if (isSm(it.prjCd)) return null;
    if (it.progressAfter === 100) return 'DONE';
    if (it.targetProgress != null && it.progressAfter != null && it.progressAfter < it.targetProgress) return 'DELAY';
    return it.progressAfter == null ? null : 'NORMAL';
  };

  const defaultPrj = prjOptions[0]?.[0] ?? '';

  return (
    <div>
      <PageHeader
        title="주간 업무보고"
        desc={
          v.employee && (
            <>
              {v.employee.name} ({v.employee.jobCd ?? '-'} / {v.employee.skillLevel}) {!isMine && <Badge tone="info">조회</Badge>}
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
          이번 주 {v.plan.length}개 프로젝트에 투입 중입니다 · {v.plan.map((p) => `${p.prjCd} 계획 ${num(p.plannedMd)}MD`).join(' · ')}
          {Object.values(v.dayAlloc).some((a) => a > 100) && ' · 투입률 합계가 100%를 넘는 날이 있어 하루 1.0MD 안에서 나눠 입력해야 합니다.'}
        </div>
      )}
      <ErrorBox error={err} />

      <div className="stack">
        {/* ① 투입시간 */}
        <Card
          title={
            <>
              <span className="section-no">1</span>투입시간 (MD)
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
                <button className="btn sm" onClick={() => setAddOpen(true)}>
                  + 프로젝트/공통코드
                </button>
              </>
            )
          }
        >
          <div className="ts-mobile">
            {v.days.map((d) => {
              const w = dow(d);
              const off = v.holidays.includes(d) || w === '토' || w === '일';
              return (
                <div key={d} className={`ts-day ${off ? 'off' : ''}`}>
                  <div className="ts-day-head">
                    <span className={v.holidays.includes(d) ? 'bad-text' : off ? 'muted' : ''}>
                      {mdLabel(d)} ({w}){v.holidays.includes(d) && ' 공휴일'}
                    </span>
                    <span className={daySum(d) > 1 ? 'bad-text' : 'muted'}>{daySum(d) ? `${num(daySum(d))}MD` : ''}</span>
                  </div>
                  {v.timesheet.map((r, ri) => (
                    <div className="ts-day-row" key={r.prjCd}>
                      <span className="name">
                        <strong>{r.prjCd}</strong> <span className="small muted">{r.prjNm}</span>
                      </span>
                      {editable ? (
                        <Select
                          value={r.md[d] == null ? '' : String(r.md[d])}
                          options={MD_OPTS}
                          onChange={(val) =>
                            update((dr) => {
                              dr.timesheet[ri].md[d] = val === '' ? null : Number(val);
                            })
                          }
                        />
                      ) : (
                        <span>{r.md[d] ?? '-'}</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {v.timesheet.map((r) => (
              <div className="row" key={r.prjCd} style={{ justifyContent: 'space-between' }}>
                <span className="small">{r.prjCd}</span>
                <span className="small">
                  {num(rowSum(r))}MD{planOf(r.prjCd) != null && <span className="muted"> / 계획 {num(planOf(r.prjCd))}</span>}
                </span>
              </div>
            ))}
            <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}>
              <span>주간 합계</span>
              <span>{num(total)}MD</span>
            </div>
          </div>
          <div className="table-wrap ts-desktop">
            <table className="tbl ts-table">
              <thead>
                <tr>
                  <th>프로젝트</th>
                  {v.days.map((d) => {
                    const w = dow(d);
                    const hol = v.holidays.includes(d);
                    return (
                      <th key={d} className={hol ? 'holiday' : w === '토' || w === '일' ? 'weekend' : ''}>
                        {w}
                        <div className="small">{mdLabel(d)}</div>
                      </th>
                    );
                  })}
                  <th>합계</th>
                  <th>계획</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {v.timesheet.map((r, ri) => (
                  <tr key={r.prjCd}>
                    <td>
                      <div className="nowrap">
                        <strong>{r.prjCd}</strong>
                      </div>
                      <div className="small muted">{r.prjNm}</div>
                    </td>
                    {v.days.map((d) => (
                      <td key={d} className={daySum(d) > 1 ? 'over' : ''}>
                        {editable ? (
                          <Select
                            value={r.md[d] == null ? '' : String(r.md[d])}
                            options={MD_OPTS}
                            onChange={(val) =>
                              update((dr) => {
                                dr.timesheet[ri].md[d] = val === '' ? null : Number(val);
                              })
                            }
                          />
                        ) : (
                          (r.md[d] ?? '')
                        )}
                      </td>
                    ))}
                    <td className="num">
                      <strong>{num(rowSum(r))}</strong>
                    </td>
                    <td className="num muted" title="배정 투입률 기준 이번 주 계획 MD">
                      {planOf(r.prjCd) != null ? num(planOf(r.prjCd)) : '-'}
                    </td>
                    {editable && (
                      <td>
                        <button
                          className="icon-btn"
                          aria-label="행 삭제"
                          onClick={() =>
                            update((dr) => {
                              dr.timesheet.splice(ri, 1);
                            })
                          }
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>일 합계</td>
                  {v.days.map((d) => (
                    <td key={d} className={daySum(d) > 1 ? 'over bad-text' : ''}>
                      {daySum(d) ? num(daySum(d)) : ''}
                    </td>
                  ))}
                  <td className="num">{num(total)}</td>
                  <td className="num muted">{num(v.plan.reduce((s, p) => s + p.plannedMd, 0))}</td>
                  {editable && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            0.5MD 단위, 하루 합계는 1.0MD를 넘을 수 없습니다. 이번 주 영업일 {v.businessDays.length}일 · 휴가는 공통코드 <b>NP-LV</b>로 입력합니다. 배정된 프로젝트는 자동으로 표시됩니다.
          </p>
        </Card>

        {/* ② 금주 실적 */}
        <Card
          title={
            <>
              <span className="section-no">2</span>금주 실적
            </>
          }
          actions={
            editable && (
              <>
                <button className="btn sm" onClick={loadCarryover}>
                  전주 계획 불러오기
                </button>
                <button
                  className="btn sm"
                  disabled={!defaultPrj}
                  onClick={() =>
                    update((d) => {
                      d.actualItems.push({ prjCd: defaultPrj, workNm: '', progressBefore: 0 });
                    })
                  }
                >
                  + 실적
                </button>
              </>
            )
          }
        >
          {!v.actualItems.length && <div className="empty">실적 항목이 없습니다.{editable && !defaultPrj && ' 먼저 ①에 프로젝트를 추가하세요.'}</div>}
          {v.actualItems.map((it, i) => {
            const sm = isSm(it.prjCd);
            const st = statusOf(it);
            const set = (patch: Partial<Item>) =>
              update((d) => {
                Object.assign(d.actualItems[i], patch);
              });
            return (
              <div className="item-card" key={i}>
                <div className="item-head">
                  <div className="row">
                    {st && <Badge code={st}>{ITEM_STATUS[st]}</Badge>}
                    {sm && <Badge tone="info">SM</Badge>}
                  </div>
                  {editable && (
                    <button className="btn sm danger" onClick={() => update((d) => void d.actualItems.splice(i, 1))}>
                      삭제
                    </button>
                  )}
                </div>
                {sm ? (
                  <div className="item-grid sm">
                    <Field label="프로젝트">
                      <PrjSelect value={it.prjCd} options={prjOptions} disabled={!editable} onChange={(prjCd) => set({ prjCd })} />
                    </Field>
                    <Field label="작업 항목">
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
                  <div className="item-grid">
                    <Field label="프로젝트">
                      <PrjSelect value={it.prjCd} options={prjOptions} disabled={!editable} onChange={(prjCd) => set({ prjCd })} />
                    </Field>
                    <Field label="작업 항목">
                      <input value={it.workNm} disabled={!editable} onChange={(e) => set({ workNm: e.target.value })} />
                    </Field>
                    <Field label="전주(%)">
                      <input type="number" min={0} max={100} value={it.progressBefore ?? 0} disabled={!editable} onChange={(e) => set({ progressBefore: Number(e.target.value) })} />
                    </Field>
                    <Field label="목표(%)">
                      <input type="number" min={0} max={100} value={it.targetProgress ?? ''} disabled={!editable} onChange={(e) => set({ targetProgress: e.target.value === '' ? null : Number(e.target.value) })} />
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
        </Card>

        {/* ③ 차주 계획 */}
        <Card
          title={
            <>
              <span className="section-no">3</span>차주 계획
            </>
          }
          actions={
            editable && (
              <button className="btn sm" disabled={!defaultPrj} onClick={() => update((d) => void d.planItems.push({ prjCd: defaultPrj, workNm: '' }))}>
                + 계획
              </button>
            )
          }
        >
          {!v.planItems.length && <div className="empty">차주 계획이 없습니다. (최소 1건, 차주 전일 휴가 시 예외)</div>}
          {v.planItems.map((it, i) => {
            const sm = isSm(it.prjCd);
            const set = (patch: Partial<Item>) =>
              update((d) => {
                Object.assign(d.planItems[i], patch);
              });
            return (
              <div className="item-card" key={i}>
                <div className="item-grid plan">
                  <Field label="프로젝트">
                    <PrjSelect value={it.prjCd} options={prjOptions} disabled={!editable} onChange={(prjCd) => set({ prjCd })} />
                  </Field>
                  <Field label="작업 항목">
                    <input value={it.workNm} disabled={!editable} onChange={(e) => set({ workNm: e.target.value })} />
                  </Field>
                  {sm ? (
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
                  <Field label="계획 내용" full>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input value={it.content ?? ''} disabled={!editable} onChange={(e) => set({ content: e.target.value })} />
                      {editable && (
                        <button className="btn sm danger" onClick={() => update((d) => void d.planItems.splice(i, 1))}>
                          삭제
                        </button>
                      )}
                    </div>
                  </Field>
                </div>
              </div>
            );
          })}
        </Card>

        {/* ④ 이슈/리스크 */}
        <Card
          title={
            <>
              <span className="section-no">4</span>이슈 / 리스크
            </>
          }
          actions={
            editable && (
              <button
                className="btn sm"
                disabled={!defaultPrj}
                onClick={() => update((d) => void d.issues.push({ prjCd: defaultPrj, issueType: 'ISSUE', severity: 'M', content: '', supportReqYn: false }))}
              >
                + 신규 이슈
              </button>
            )
          }
        >
          {!v.issues.length && <div className="empty">이슈가 없으면 생략할 수 있습니다.</div>}
          {v.issues.map((it, i) => {
            const set = (patch: Partial<Issue>) =>
              update((d) => {
                Object.assign(d.issues[i], patch);
              });
            return (
              <div className="item-card" key={i}>
                <div className="item-grid plan">
                  <Field label="프로젝트">
                    <PrjSelect value={it.prjCd} options={prjOptions} disabled={!editable} onChange={(prjCd) => set({ prjCd })} />
                  </Field>
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
                  <Field label="내용" required full>
                    <textarea value={it.content} disabled={!editable} onChange={(e) => set({ content: e.target.value })} rows={2} />
                  </Field>
                  <Field label="조치계획 / 요청사항" full>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input value={it.actionPlan ?? ''} disabled={!editable} onChange={(e) => set({ actionPlan: e.target.value })} />
                      {editable && (
                        <button className="btn sm danger" onClick={() => update((d) => void d.issues.splice(i, 1))}>
                          삭제
                        </button>
                      )}
                    </div>
                  </Field>
                </div>
              </div>
            );
          })}
        </Card>

        {/* ⑤ 특이사항 */}
        <Card
          title={
            <>
              <span className="section-no">5</span>특이사항 / 건의
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

function PrjSelect({ value, options, onChange, disabled }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  const opts = options.some(([k]) => k === value) ? options : [[value, value] as [string, string], ...options];
  return <Select value={value} options={opts} onChange={onChange} disabled={disabled} />;
}

function AddRowModal({ projects, onAdd, onClose }: { projects: Project[]; onAdd: (p: Project) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = projects.filter((p) => !q || p.prjCd.toLowerCase().includes(q.toLowerCase()) || p.prjNm.includes(q));
  return (
    <Modal title="프로젝트 / 공통코드 추가" onClose={onClose}>
      <input type="search" placeholder="코드 또는 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ marginBottom: 10 }} />
      <div className="table-wrap">
        <table className="tbl">
          <tbody>
            {list.map((p) => (
              <tr key={p.prjCd} className="clickable" onClick={() => onAdd(p)}>
                <td className="nowrap">
                  <strong>{p.prjCd}</strong>
                </td>
                <td>{p.prjNm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.length && <div className="empty">추가할 수 있는 코드가 없습니다.</div>}
    </Modal>
  );
}
