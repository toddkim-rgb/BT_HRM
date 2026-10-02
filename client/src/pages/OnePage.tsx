import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, ErrorBox, Loading, useToast } from '../components/ui';
import { api } from '../lib/api';
import { hasRole, useAuth } from '../lib/auth';
import { ISSUE_TYPE, SEVERITY } from '../lib/codes';
import { dateTime, label, num, pct } from '../lib/format';
import { isoWeek, md, shiftWeek, today } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface Data {
  week: string;
  days: string[];
  refDt: string;
  kpi: { total: number; own: number; partner: number; assigned: number; bench: number; util: number | null; paidUtil: number | null; utilDiff: number | null; paidUtilDiff: number | null; submitted: number; submitTarget: number; highIssues: number };
  byType: { type: string; label: string; headcount: number; weekMd: number; monthMm: number }[];
  projects: {
    prjCd: string;
    prjNm: string;
    prjType: string;
    pmName: string | null;
    headcount: number;
    members: { name: string; allocRate: number }[];
    submitted: number;
    weekMd: number;
    cumMm: number;
    contractMm: number | null;
    burnRate: number | null;
    msTotal: number;
    msDone: number;
    msDelayed: number;
    next: { msNm: string; planDt: string; status: string } | null;
    pmOpinion: string | null;
    confirmedYn: boolean;
  }[];
  attention: {
    overAllocated: { name: string; total: number }[];
    bench: string[];
    lowUtil: { name: string; util: number }[];
    lowUtilPct: number;
    releasing: { name: string; prjCd: string; endDt: string }[];
    notSubmitted: string[];
    delayedMilestones: { prjCd: string; msNm: string; planDt: string }[];
    burnOver80: { prjCd: string; burnRate: number }[];
  };
  issues: { prjCd: string; prjNm: string; issueType: string; severity: string; content: string; actionPlan: string | null; author: string }[];
}
interface Report {
  week: string;
  statusCd: 'DRAFT' | 'CONFIRMED';
  execNote: string | null;
  nextPlan: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  data: Data;
}

const diff = (d: number | null) => (d == null ? null : <span className={d >= 0 ? 'good-text' : 'bad-text'}>{d >= 0 ? '▲' : '▼'}{Math.abs(d)}%p</span>);

/** 전사 주간 One-Page: 제출된 주간 업무보고에서 자동 생성 (A4 가로 1장 인쇄·PDF) */
export default function OnePage() {
  const { user } = useAuth();
  const params = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const week = params.week ?? shiftWeek(isoWeek(today()), -1); // 기본: 지난주 (월요일에 지난주 보고)
  const { data: r, error, loading, reload } = useFetch<Report>(`/reports/weekly/${week}`);
  const canEdit = hasRole(user, 'EXEC', 'ADMIN');
  const [execNote, setExecNote] = useState('');
  const [nextPlan, setNextPlan] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setExecNote(r?.execNote ?? '');
    setNextPlan(r?.nextPlan ?? '');
  }, [r]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const body = { execNote: execNote || null, nextPlan: nextPlan || null };

  if (error) return <ErrorBox error={error} />;
  if (loading && !r) return <Loading />;
  if (!r) return null;
  const d = r.data;
  const confirmed = r.statusCd === 'CONFIRMED';
  const editable = canEdit && !confirmed;
  const a = d.attention;

  return (
    <div className="onepage-wrap">
      <div className="page-header no-print">
        <div>
          <h1>전사 주간 One-Page</h1>
          <p className="muted">제출된 주간 업무보고로 자동 생성됩니다. 확정하면 그 시점 수치로 고정됩니다.</p>
        </div>
        <div className="page-actions">
          <div className="week-nav">
            <button className="btn sm" onClick={() => nav(`/onepage/${shiftWeek(week, -1)}`)} aria-label="이전 주">
              ◀
            </button>
            <strong>{week}</strong>
            <button className="btn sm" onClick={() => nav(`/onepage/${shiftWeek(week, 1)}`)} aria-label="다음 주">
              ▶
            </button>
          </div>
          <button className="btn" onClick={() => window.print()}>
            인쇄 / PDF 저장
          </button>
          {canEdit &&
            (confirmed ? (
              <button className="btn" disabled={busy} onClick={() => act(() => api.post(`/reports/weekly/${week}/unconfirm`), '확정을 취소했습니다.')}>
                확정 취소
              </button>
            ) : (
              <>
                <button className="btn" disabled={busy} onClick={() => act(() => api.put(`/reports/weekly/${week}`, body), '저장했습니다.')}>
                  입력 저장
                </button>
                <button className="btn primary" disabled={busy} onClick={() => act(() => api.post(`/reports/weekly/${week}/confirm`, body), '리포트를 확정했습니다.')}>
                  확정
                </button>
              </>
            ))}
        </div>
      </div>

      <div className="onepage">
        <div className="op-head">
          <div>
            <h2>전사 SM·SI 인력 주간 현황</h2>
            <span>
              {week} ({md(d.days[0])} ~ {md(d.days[6])})
            </span>
          </div>
          <div className="op-status">
            {confirmed ? (
              <>
                확정: {r.confirmedByName} · {dateTime(r.confirmedAt)}
              </>
            ) : (
              <>초안 (실시간 집계 · 기준일 {d.refDt})</>
            )}
          </div>
        </div>

        <div className="op-kpis">
          <OpKpi label="총 인원" value={`${d.kpi.total}명`} sub={`자사 ${d.kpi.own} · 협력사 ${d.kpi.partner}`} />
          <OpKpi label="투입 인원" value={`${d.kpi.assigned}명`} />
          <OpKpi label="대기 인원" value={`${d.kpi.bench}명`} />
          <OpKpi label="총 가동률" value={pct(d.kpi.util)} sub={diff(d.kpi.utilDiff)} />
          <OpKpi label="유상 가동률" value={pct(d.kpi.paidUtil)} sub={diff(d.kpi.paidUtilDiff)} />
          <OpKpi label="주간보고 제출" value={`${d.kpi.submitted}/${d.kpi.submitTarget}`} sub={d.kpi.submitted < d.kpi.submitTarget ? '미제출분은 집계 제외' : '전원 제출'} />
          <OpKpi label="중요 이슈(상)" value={`${d.kpi.highIssues}건`} />
        </div>

        <div className="op-grid">
          <section className="op-box">
            <h3>① 사업구분별 투입</h3>
            <table>
              <thead>
                <tr>
                  <th>구분</th>
                  <th className="num">인원</th>
                  <th className="num">금주 MD</th>
                  <th className="num">월누계 MM</th>
                </tr>
              </thead>
              <tbody>
                {d.byType.map((t) => (
                  <tr key={t.type}>
                    <td>{t.label}</td>
                    <td className="num">{t.headcount}</td>
                    <td className="num">{num(t.weekMd)}</td>
                    <td className="num">{num(t.monthMm, 2)}</td>
                  </tr>
                ))}
                {!d.byType.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      투입 내역 없음
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <h3 style={{ marginTop: 10 }}>③ 주의 사항</h3>
            <ul className="op-list">
              {a.overAllocated.length > 0 && <li>과투입 {a.overAllocated.length}명: {a.overAllocated.map((o) => `${o.name}(+${o.total - 100}%)`).join(', ')}</li>}
              {a.bench.length > 0 && <li>대기 {a.bench.length}명: {a.bench.join(', ')}</li>}
              {a.lowUtil.length > 0 && <li>저가동({a.lowUtilPct}% 미만) {a.lowUtil.length}명: {a.lowUtil.map((l) => `${l.name}(${l.util}%)`).join(', ')}</li>}
              {a.releasing.length > 0 && <li>30일 내 철수 예정 {a.releasing.length}건: {a.releasing.map((x) => `${x.name}(${x.prjCd} ~${md(x.endDt)})`).join(', ')}</li>}
              {a.delayedMilestones.length > 0 && <li className="bad-text">마일스톤 지연 {a.delayedMilestones.length}건: {a.delayedMilestones.map((m) => `${m.prjCd} ${m.msNm}(${md(m.planDt)})`).join(', ')}</li>}
              {a.burnOver80.length > 0 && <li>계약 MM 80% 이상 소진: {a.burnOver80.map((b) => `${b.prjCd}(${b.burnRate}%)`).join(', ')}</li>}
              {a.notSubmitted.length > 0 && <li>주간보고 미제출 {a.notSubmitted.length}명: {a.notSubmitted.join(', ')}</li>}
              {!(a.overAllocated.length || a.bench.length || a.lowUtil.length || a.releasing.length || a.delayedMilestones.length || a.burnOver80.length || a.notSubmitted.length) && <li className="muted">특이사항 없음</li>}
            </ul>
          </section>

          <section className="op-box">
            <h3>② 프로젝트별 투입인력 · MM</h3>
            <table>
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>PM</th>
                  <th>투입인력</th>
                  <th className="num">금주 MD</th>
                  <th className="num">누적 / 계약 MM</th>
                  <th>마일스톤</th>
                  <th className="num">제출</th>
                </tr>
              </thead>
              <tbody>
                {d.projects.map((p) => (
                  <tr key={p.prjCd}>
                    <td>
                      <Link to={`/project-weekly/${p.prjCd}/${week}`} className="op-link">
                        <strong>{p.prjCd}</strong>
                      </Link>
                      <div className="op-sub">{p.prjNm}</div>
                    </td>
                    <td className="nowrap">{p.pmName ?? '-'}</td>
                    <td>
                      <strong>{p.headcount}명</strong>
                      <div className="op-sub">{p.members.map((m) => (m.allocRate === 100 ? m.name : `${m.name}(${m.allocRate}%)`)).join(', ')}</div>
                    </td>
                    <td className="num">{num(p.weekMd)}</td>
                    <td className="num">
                      {num(p.cumMm, 2)}
                      {p.contractMm != null && ` / ${num(p.contractMm)}`}
                      {p.burnRate != null && <div className={`op-sub ${p.burnRate >= 100 ? 'bad-text' : p.burnRate >= 80 ? 'warn-text' : ''}`}>{p.burnRate}%</div>}
                    </td>
                    <td>
                      {p.msTotal ? (
                        <>
                          {p.msDone}/{p.msTotal} {p.msDelayed > 0 && <span className="bad-text">지연 {p.msDelayed}</span>}
                          {p.next && (
                            <div className="op-sub">
                              다음: {p.next.msNm} ({md(p.next.planDt)})
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td className="num">
                      {p.submitted}/{p.headcount}
                    </td>
                  </tr>
                ))}
                {!d.projects.length && (
                  <tr>
                    <td colSpan={7} className="muted">
                      진행 중인 프로젝트 없음
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="op-box">
            <h3>④ 프로젝트 PM 의견</h3>
            <ul className="op-list">
              {d.projects.filter((p) => p.pmOpinion).map((p) => (
                <li key={p.prjCd}>
                  <strong>{p.prjCd}</strong> {p.pmOpinion}
                </li>
              ))}
              {!d.projects.some((p) => p.pmOpinion) && <li className="muted">입력된 PM 의견 없음</li>}
            </ul>
            <h3 style={{ marginTop: 10 }}>⑤ 주요 이슈 / 리스크</h3>
            <ul className="op-list">
              {d.issues.map((i, n) => (
                <li key={n}>
                  <Badge code={i.severity}>{label(SEVERITY, i.severity)}</Badge> <strong>{i.prjCd}</strong> [{label(ISSUE_TYPE, i.issueType)}] {i.content}
                  {i.actionPlan && <span className="muted"> → {i.actionPlan}</span>}
                </li>
              ))}
              {!d.issues.length && <li className="muted">PM이 선택한 이슈 없음</li>}
            </ul>
            <NoteField value={execNote} onChange={setExecNote} editable={editable} placeholder="이슈·리스크 종합 의견 (사업부장 입력)" />
          </section>

          <section className="op-box">
            <h3>⑥ 차주 계획 / 의사결정 필요 사항</h3>
            <NoteField value={nextPlan} onChange={setNextPlan} editable={editable} placeholder="차주 계획, 의사결정이 필요한 사항 (사업부장 입력)" rows={6} />
          </section>
        </div>
      </div>
    </div>
  );
}

function OpKpi({ label: l, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="op-kpi">
      <div className="op-kpi-label">{l}</div>
      <div className="op-kpi-value">{value}</div>
      <div className="op-kpi-sub">{sub}</div>
    </div>
  );
}

/** 화면에서는 입력란, 인쇄·확정 후에는 글 그대로 */
function NoteField({ value, onChange, editable, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; editable: boolean; placeholder: string; rows?: number }) {
  return (
    <>
      {editable && <textarea className="no-print" value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} />}
      <div className={`op-note ${editable ? 'print-only' : ''}`}>{value || (editable ? '' : <span className="muted">입력 없음</span>)}</div>
    </>
  );
}
