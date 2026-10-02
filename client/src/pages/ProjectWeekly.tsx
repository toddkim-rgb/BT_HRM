import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader, ProgressBar, Select, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ISSUE_TYPE, ITEM_STATUS, SEVERITY, SM_WORK_TYPE, WW_STATUS } from '../lib/codes';
import { dateTime, label, num, pct } from '../lib/format';
import { isoWeek, shiftWeek, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

export interface Milestone {
  msId: number;
  msNm: string;
  planDt: string;
  doneDt: string | null;
  note: string | null;
  status: 'DONE' | 'DELAY' | 'PLANNED';
}
interface Member {
  empId: string;
  name: string;
  gradeCd: string;
  roleCd: string;
  allocRate: number;
  statusCd: string;
  plannedMd: number;
  md: number;
  actual: { workNm: string; content: string | null; progressBefore: number | null; progressAfter: number | null; targetProgress: number | null; statusCd: string | null; delayReason: string | null; smWorkType: string | null; smCount: number | null }[];
  plan: { workNm: string; content: string | null; targetProgress: number | null; dueDt: string | null; smWorkType: string | null }[];
}
interface Issue {
  wisId: number;
  author: string;
  issueType: string;
  severity: string;
  content: string;
  actionPlan: string | null;
  supportReqYn: boolean;
  onepageYn: boolean;
}
interface View {
  week: string;
  project: { prjCd: string; prjNm: string; prjType: string; customerNm: string | null; pmEmpId: string | null; pmName: string | null; contractMm: number | null };
  kpi: {
    headcount: number;
    submitted: number;
    notSubmitted: string[];
    weekMd: number;
    plannedMd: number;
    cumMm: number;
    burnRate: number | null;
    delayItems: number;
    issueCount: number;
    highIssueCount: number;
    msTotal: number;
    msDone: number;
    msDelayed: number;
    progress: number | null;
    next: { msNm: string; planDt: string; status: string } | null;
  };
  milestones: Milestone[];
  members: Member[];
  issues: Issue[];
  pmOpinion: string | null;
  confirmedYn: boolean;
  confirmedAt: string | null;
}

export const MS_STATUS: Record<string, string> = { DONE: '완료', DELAY: '지연', PLANNED: '예정' };

/** 프로젝트 주간보고: 인력별 주간 업무보고를 자동 취합 + PM 종합 의견 */
export default function ProjectWeekly() {
  const { user } = useAuth();
  const params = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const week = params.week ?? isoWeek(today());
  const { data: projects } = useFetch<{ prjCd: string; prjNm: string; pmEmpId: string | null }[]>(`/projects${qs({ status: 'ACTIVE', mine: user?.role === 'PM' ? 'Y' : undefined })}`);
  const prjCd = params.prjCd ?? projects?.[0]?.prjCd ?? '';
  const { data, error, loading, reload, setData } = useFetch<View>(prjCd ? `/projects/${prjCd}/weekly/${week}` : null);
  const [opinion, setOpinion] = useState('');
  const [busy, setBusy] = useState(false);
  const [msOpen, setMsOpen] = useState(false);

  useEffect(() => setOpinion(data?.pmOpinion ?? ''), [data]);

  const go = (p: string, w: string) => nav(`/project-weekly/${p}/${w}`);
  const canManage = !!data && (user?.role === 'ADMIN' || (user?.role === 'PM' && data.project.pmEmpId === user.empId));
  const editable = canManage && !data?.confirmedYn;

  const saveComment = async (confirm?: boolean) => {
    setBusy(true);
    try {
      setData(await api.put<View>(`/projects/${prjCd}/weekly/${week}/comment`, { pmOpinion: opinion, confirm }));
      toast(confirm === true ? '주간보고를 확정했습니다.' : confirm === false ? '확정을 취소했습니다.' : '종합 의견을 저장했습니다.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const toggleOnepage = async (i: Issue) => {
    try {
      await api.patch(`/projects/${prjCd}/weekly/${week}/issues/${i.wisId}/onepage`, { onepageYn: !i.onepageYn });
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };

  return (
    <div>
      <PageHeader
        title="프로젝트 주간보고"
        desc="인력별 주간 업무보고(제출분)를 자동으로 모읍니다. PM은 종합 의견만 적고 확정하면 됩니다."
        actions={
          <>
            <Select value={prjCd} onChange={(v) => go(v, week)} options={(projects ?? []).map((p) => [p.prjCd, p.prjNm] as [string, string])} />
            <div className="week-nav">
              <button className="btn sm" onClick={() => go(prjCd, shiftWeek(week, -1))} aria-label="이전 주">
                ◀
              </button>
              <strong>{weekLabel(week)}</strong>
              <button className="btn sm" onClick={() => go(prjCd, shiftWeek(week, 1))} aria-label="다음 주">
                ▶
              </button>
            </div>
          </>
        }
      />
      <ErrorBox error={error} />
      {!prjCd && projects ? (
        <Empty>진행 중인 담당 프로젝트가 없습니다.</Empty>
      ) : loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <strong>
              {data.project.prjNm}
            </strong>
            <span className="muted small">
              {data.project.customerNm ?? ''} · PM {data.project.pmName ?? '-'}
            </span>
            {data.confirmedYn ? <Badge tone="good">확정 {dateTime(data.confirmedAt)}</Badge> : <Badge tone="neutral">작성 중 (실시간 취합)</Badge>}
          </div>

          <div className="kpis">
            <Kpi label="제출" value={`${data.kpi.submitted}/${data.kpi.headcount}명`} tone={data.kpi.submitted === data.kpi.headcount ? 'good' : 'warn'} sub={data.kpi.notSubmitted.length ? `미제출: ${data.kpi.notSubmitted.join(', ')}` : '전원 제출'} />
            <Kpi label="금주 투입" value={`${num(data.kpi.weekMd)}MD`} sub={`계획 ${num(data.kpi.plannedMd)}MD`} />
            <Kpi label="누적 MM" value={num(data.kpi.cumMm, 2)} sub={data.project.contractMm ? `계약 ${num(data.project.contractMm)}MM · 소진 ${pct(data.kpi.burnRate)}` : '계약 MM 미등록'} />
            <Kpi label="마일스톤" value={data.kpi.msTotal ? `${data.kpi.msDone}/${data.kpi.msTotal}` : '-'} tone={data.kpi.msDelayed ? 'bad' : undefined} sub={data.kpi.msDelayed ? `지연 ${data.kpi.msDelayed}건` : data.kpi.next ? `다음: ${data.kpi.next.msNm} (${data.kpi.next.planDt})` : undefined} />
            <Kpi label="지연 작업" value={`${data.kpi.delayItems}건`} tone={data.kpi.delayItems ? 'bad' : undefined} />
            <Kpi label="이슈" value={`${data.kpi.issueCount}건`} tone={data.kpi.highIssueCount ? 'bad' : undefined} sub={data.kpi.highIssueCount ? `중요도 상 ${data.kpi.highIssueCount}건` : undefined} />
          </div>

          <div className="stack">
            <Card
              title={
                <>
                  <span className="section-no">1</span>주요 마일스톤
                </>
              }
              actions={
                canManage && (
                  <button className="btn sm" onClick={() => setMsOpen(true)}>
                    마일스톤 관리
                  </button>
                )
              }
            >
              <MilestoneTrack list={data.milestones} progress={data.kpi.progress} />
            </Card>

            <Card
              title={
                <>
                  <span className="section-no">2</span>인력별 실적 / 계획
                </>
              }
            >
              {!data.members.length ? (
                <Empty>이번 주 배정된 인력이 없습니다.</Empty>
              ) : (
                data.members.map((m) => (
                  <div className="item-card" key={m.empId}>
                    <div className="item-head">
                      <div className="row">
                        <strong>{m.name}</strong>
                        <span className="muted small">
                          {m.roleCd} · {m.allocRate}%
                        </span>
                        <Badge code={m.statusCd}>{label(WW_STATUS, m.statusCd)}</Badge>
                      </div>
                      <div className="row">
                        <span className="small">
                          <strong>{num(m.md)}</strong> / 계획 {num(m.plannedMd)} MD
                        </span>
                        {m.statusCd !== 'NONE' && (
                          <Link className="btn sm" to={`/weekly/${m.empId}/${week}`}>
                            보고서
                          </Link>
                        )}
                      </div>
                    </div>
                    {m.statusCd !== 'SUBMITTED' ? (
                      <div className="muted small">아직 제출하지 않았습니다.</div>
                    ) : (
                      <div className="grid cols-2" style={{ gap: 12 }}>
                        <div>
                          <div className="field-label" style={{ marginBottom: 4 }}>
                            금주 실적
                          </div>
                          {!m.actual.length && <div className="muted small">입력 없음</div>}
                          {m.actual.map((a, i) => (
                            <div key={i} className="small" style={{ marginBottom: 6 }}>
                              {a.statusCd && <Badge code={a.statusCd}>{ITEM_STATUS[a.statusCd]}</Badge>} <strong>{a.workNm}</strong>{' '}
                              {a.smWorkType ? (
                                <span className="muted">
                                  {label(SM_WORK_TYPE, a.smWorkType)} {a.smCount ?? 0}건
                                </span>
                              ) : (
                                <span className="muted">
                                  {a.progressBefore ?? 0}% → {a.progressAfter ?? '-'}%{a.targetProgress != null && ` (목표 ${a.targetProgress}%)`}
                                </span>
                              )}
                              {a.content && <div className="muted">{a.content}</div>}
                              {a.delayReason && <div className="bad-text">지연 사유: {a.delayReason}</div>}
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="field-label" style={{ marginBottom: 4 }}>
                            차주 계획
                          </div>
                          {!m.plan.length && <div className="muted small">입력 없음</div>}
                          {m.plan.map((p, i) => (
                            <div key={i} className="small" style={{ marginBottom: 6 }}>
                              <strong>{p.workNm}</strong>{' '}
                              <span className="muted">
                                {p.smWorkType ? label(SM_WORK_TYPE, p.smWorkType) : p.targetProgress != null ? `목표 ${p.targetProgress}%` : ''}
                                {p.dueDt && ` · ~${p.dueDt}`}
                              </span>
                              {p.content && <div className="muted">{p.content}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </Card>

            <Card
              title={
                <>
                  <span className="section-no">3</span>금주 이슈 / 리스크
                </>
              }
              actions={<span className="muted small">체크한 이슈는 전사 One-Page에 올라갑니다</span>}
            >
              {!data.issues.length ? (
                <Empty>제출된 이슈가 없습니다.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>One-Page</th>
                        <th>중요도</th>
                        <th>구분</th>
                        <th>내용</th>
                        <th>조치계획 / 요청</th>
                        <th>작성</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.issues.map((i) => (
                        <tr key={i.wisId}>
                          <td data-label="One-Page 반영">
                            <input type="checkbox" aria-label="One-Page 반영" checked={i.onepageYn} disabled={!editable} onChange={() => toggleOnepage(i)} />
                          </td>
                          <td data-label="중요도">
                            <Badge code={i.severity}>{label(SEVERITY, i.severity)}</Badge>
                          </td>
                          <td data-label="구분">{label(ISSUE_TYPE, i.issueType)}</td>
                          <td data-label="내용">
                            {i.content} {i.supportReqYn && <Badge tone="warn">지원요청</Badge>}
                          </td>
                          <td data-label="조치계획">{i.actionPlan ?? '-'}</td>
                          <td data-label="작성">{i.author}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title={
                <>
                  <span className="section-no">4</span>PM 종합 의견
                </>
              }
            >
              <textarea value={opinion} onChange={(e) => setOpinion(e.target.value)} disabled={!editable} rows={4} placeholder={canManage ? '금주 진행 상황, 리스크, 다음 주 중점 사항 등을 적어 주세요.' : 'PM이 아직 의견을 적지 않았습니다.'} />
              {canManage && (
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                  {data.confirmedYn ? (
                    <button className="btn" disabled={busy} onClick={() => saveComment(false)}>
                      확정 취소
                    </button>
                  ) : (
                    <>
                      <button className="btn" disabled={busy} onClick={() => saveComment()}>
                        의견 저장
                      </button>
                      <button className="btn primary" disabled={busy} onClick={() => saveComment(true)}>
                        확정
                      </button>
                    </>
                  )}
                </div>
              )}
              <p className="muted small" style={{ marginBottom: 0 }}>
                확정 전에는 화면을 열 때마다 최신 제출 내용으로 다시 모읍니다. 확정하면 그 시점 내용으로 고정됩니다.
              </p>
            </Card>
          </div>
        </>
      ) : null}

      {msOpen && data && (
        <MilestoneManager
          prjCd={prjCd}
          prjNm={data.project.prjNm}
          onClose={() => {
            setMsOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

export function MilestoneTrack({ list, progress }: { list: Milestone[]; progress: number | null }) {
  if (!list.length) return <Empty>등록된 마일스톤이 없습니다. PM이 '마일스톤 관리'에서 주요 마일스톤을 등록하면 진척 현황이 표시됩니다.</Empty>;
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <ProgressBar value={progress} tone={list.some((m) => m.status === 'DELAY') ? 'bad' : 'good'} />
        </div>
        <strong>{progress}%</strong>
      </div>
      <div className="ms-track">
        {list.map((m) => (
          <div key={m.msId} className={`ms-item ${m.status.toLowerCase()}`}>
            <div className="ms-dot">{m.status === 'DONE' ? '✔' : m.status === 'DELAY' ? '!' : ''}</div>
            <div className="ms-name">{m.msNm}</div>
            <div className="small muted">
              {m.planDt}
              {m.doneDt && m.doneDt !== m.planDt && ` → ${m.doneDt}`}
            </div>
            <Badge tone={m.status === 'DONE' ? 'good' : m.status === 'DELAY' ? 'bad' : 'neutral'}>{MS_STATUS[m.status]}</Badge>
          </div>
        ))}
      </div>
    </>
  );
}

function MilestoneManager({ prjCd, prjNm, onClose }: { prjCd: string; prjNm: string; onClose: () => void }) {
  const toast = useToast();
  const { data, reload } = useFetch<{ milestones: Milestone[] }>(`/projects/${prjCd}/milestones`);
  const [edit, setEdit] = useState<Partial<Milestone> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setErr(null);
    try {
      const body = { msNm: edit.msNm ?? '', planDt: edit.planDt ?? '', doneDt: edit.doneDt || null, note: edit.note || null };
      if (edit.msId) await api.put(`/projects/${prjCd}/milestones/${edit.msId}`, body);
      else await api.post(`/projects/${prjCd}/milestones`, body);
      setEdit(null);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const done = async (m: Milestone, doneDt: string | null) => {
    await api.put(`/projects/${prjCd}/milestones/${m.msId}`, { msNm: m.msNm, planDt: m.planDt, doneDt, note: m.note });
    toast(doneDt ? `'${m.msNm}' 완료 처리했습니다.` : '완료를 해제했습니다.');
    reload();
  };
  const remove = async (m: Milestone) => {
    if (!window.confirm(`'${m.msNm}' 마일스톤을 삭제할까요?`)) return;
    await api.del(`/projects/${prjCd}/milestones/${m.msId}`);
    reload();
  };

  return (
    <Modal title={`마일스톤 관리 · ${prjNm}`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        주요 마일스톤의 이름과 계획일만 등록하면 됩니다. 완료되면 완료 체크를 하세요. 진척률 = 완료 수 ÷ 전체 수, 계획일이 지났는데 완료되지 않으면 '지연'으로 표시됩니다.
      </p>
      <ErrorBox error={err} />
      {!data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>마일스톤</th>
                <th>계획일</th>
                <th>완료일</th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.milestones.map((m) => (
                <tr key={m.msId}>
                  <td data-label="마일스톤">
                    <strong>{m.msNm}</strong>
                    {m.note && <div className="small muted">{m.note}</div>}
                  </td>
                  <td data-label="계획일" className="nowrap">
                    {m.planDt}
                  </td>
                  <td data-label="완료일" className="nowrap">
                    {m.doneDt ?? '-'}
                  </td>
                  <td data-label="상태">
                    <Badge tone={m.status === 'DONE' ? 'good' : m.status === 'DELAY' ? 'bad' : 'neutral'}>{MS_STATUS[m.status]}</Badge>
                  </td>
                  <td data-label="">
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      {m.doneDt ? (
                        <button className="btn sm" onClick={() => done(m, null)}>
                          완료 해제
                        </button>
                      ) : (
                        <button className="btn sm good" onClick={() => done(m, today())}>
                          완료 체크
                        </button>
                      )}
                      <button className="btn sm" onClick={() => setEdit(m)}>
                        수정
                      </button>
                      <button className="btn sm danger" onClick={() => remove(m)}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.milestones.length && <Empty>등록된 마일스톤이 없습니다.</Empty>}
        </div>
      )}
      {edit ? (
        <div className="item-card" style={{ marginTop: 12 }}>
          <div className="form-grid">
            <Field label="마일스톤명" required full>
              <input value={edit.msNm ?? ''} onChange={(e) => setEdit({ ...edit, msNm: e.target.value })} placeholder="예: 설계 완료, 통합테스트 완료, 오픈" autoFocus />
            </Field>
            <Field label="계획일" required>
              <input type="date" value={edit.planDt ?? ''} onChange={(e) => setEdit({ ...edit, planDt: e.target.value })} />
            </Field>
            <Field label="완료일" hint="완료된 경우만">
              <input type="date" value={edit.doneDt ?? ''} onChange={(e) => setEdit({ ...edit, doneDt: e.target.value || null })} />
            </Field>
            <Field label="비고" full>
              <input value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="산출물, 일정 변경 사유 등 (선택)" />
            </Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={() => setEdit(null)}>
              취소
            </button>
            <button className="btn primary" disabled={!edit.msNm?.trim() || !edit.planDt} onClick={save}>
              저장
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setEdit({})}>
          + 마일스톤 추가
        </button>
      )}
    </Modal>
  );
}
