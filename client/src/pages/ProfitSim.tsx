import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MoneyInput, PctInput } from '../components/NumInputs';
import { Badge, Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ASG_ROLE, PRJ_TYPE, SKILL_LEVELS } from '../lib/codes';
import { dateTime, label } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { EXPENSE_TYPE, JUDGE, fullWon, krw, mmText, pctText, type SimInput, type SimProject, type SimResult, type SimRow } from '../lib/profit';

interface Detail {
  simId: number;
  prjCd: string;
  project: SimProject | null;
  name: string;
  statusCd: 'DRAFT' | 'BASELINE';
  version: number | null;
  latestBaseline: number | null;
  memo: string | null;
  input: SimInput;
  result: SimResult;
  basisAt: { kosaYear: number | null; legalRate: number; overheadRate: number } | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}
interface Options {
  mdPerMm: number;
  ownGrades: { grade: string; monthlyCost: number }[];
  partnerGrades: { grade: string; monthlyCost: number | null }[];
  roleJobs: Record<string, string>;
  kosaYear: number | null;
  kosaJobs: string[];
  reserveRate: number;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function ProfitSim() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const editable = useAuth().can('profit', 'EDIT');
  const { data: d, error, reload } = useFetch<Detail>(`/profit/sims/${id}`);
  const { data: opt } = useFetch<Options>('/profit/options');

  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [input, setInput] = useState<SimInput | null>(null);
  const [saved, setSaved] = useState('');
  const [result, setResult] = useState<SimResult | null>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [calcing, setCalcing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!d) return;
    setName(d.name);
    setMemo(d.memo ?? '');
    setInput(d.input);
    setResult(d.result);
    setSaved(JSON.stringify({ name: d.name, memo: d.memo ?? '', input: d.input }));
  }, [d]);

  const readOnly = !editable || d?.statusCd === 'BASELINE';
  const dirty = !!input && JSON.stringify({ name, memo, input }) !== saved;

  // 입력이 바뀌면 서버에서 다시 계산 (0.4초 모아서)
  const seq = useRef(0);
  useEffect(() => {
    if (!input || readOnly || !dirty) return;
    const my = ++seq.current;
    setCalcing(true);
    const t = window.setTimeout(() => {
      api
        .post<SimResult>('/profit/calc', input)
        .then((r) => {
          if (my !== seq.current) return;
          setResult(r);
          setCalcErr(null);
        })
        .catch((e) => my === seq.current && setCalcErr(errMsg(e)))
        .finally(() => my === seq.current && setCalcing(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [input, readOnly, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!input) return false;
    try {
      await api.put(`/profit/sims/${id}`, { ...input, name, memo });
      setSaved(JSON.stringify({ name, memo, input }));
      toast('저장했습니다.');
      return true;
    } catch (e) {
      toast(errMsg(e), 'bad');
      return false;
    }
  }, [id, input, name, memo, toast]);

  const copy = async () => {
    const n = window.prompt('복사할 새 시나리오 이름', `${name} 복사`);
    if (!n?.trim()) return;
    try {
      const r = await api.post<{ simId: number }>(`/profit/sims/${id}/copy`, { name: n.trim() });
      nav(`/profit/sim/${r.simId}`);
    } catch (e) {
      toast(errMsg(e), 'bad');
    }
  };
  const remove = async () => {
    if (!window.confirm(`'${name}' 시뮬레이션을 삭제할까요?`)) return;
    try {
      await api.del(`/profit/sims/${id}`);
      setSaved(JSON.stringify({ name, memo, input })); // 이동 경고 끄기
      nav('/profit');
    } catch (e) {
      toast(errMsg(e), 'bad');
    }
  };

  const set = (patch: Partial<SimInput>) => setInput((s) => (s ? { ...s, ...patch } : s));
  const setRow = (i: number, patch: Partial<SimRow>) => setInput((s) => (s ? { ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : s));

  if (error) return <ErrorBox error={error} />;
  if (!d || !input || !result) return <Loading />;
  const r = result;
  const p = d.project;
  const statusBadge = d.statusCd === 'BASELINE' ? <Badge tone={d.version === d.latestBaseline ? 'good' : 'neutral'}>기준선 v{d.version}{d.version === d.latestBaseline ? ' · 현재 실행예산' : ' · 이전 버전'}</Badge> : <Badge tone="info">작성 중</Badge>;

  return (
    <div className="sim-page">
      <PageHeader
        title={`${p?.prjNm ?? d.prjCd} · ${name}`}
        desc={
          <>
            {p && `${label(PRJ_TYPE, p.prjType)} · ${p.customerNm ?? ''} `}
            {statusBadge}{' '}
            {d.statusCd === 'BASELINE' ? `${d.confirmedBy ?? ''} 확정 ${dateTime(d.confirmedAt)} — 확정 당시 원가 기준으로 계산된 금액입니다.` : `${d.createdBy} 작성 · ${dateTime(d.updatedAt)} 저장`}
          </>
        }
        actions={
          <span className="row no-print" style={{ gap: 6 }}>
            <Link className="btn" to="/profit">
              ← 목록
            </Link>
            <button className="btn" onClick={() => window.print()}>
              인쇄 / PDF
            </button>
            {editable && (
              <button className="btn" onClick={copy}>
                복사
              </button>
            )}
            {!readOnly && (
              <>
                <button className="btn danger" onClick={remove}>
                  삭제
                </button>
                <button className="btn" onClick={() => setConfirming(true)} disabled={!input.rows.length}>
                  기준선으로 확정
                </button>
                <button className="btn primary" onClick={save} disabled={!dirty}>
                  {dirty ? '저장' : '저장됨'}
                </button>
              </>
            )}
          </span>
        }
      />

      {/* 요약 */}
      <div className={`kpis sim-kpis ${calcing ? 'calcing' : ''}`}>
        <Kpi label="총원가 (손익분기)" value={krw(r.totals.totalCost)} sub={`${mmText(r.totals.mm)} · 인건비 ${krw(r.totals.labor)}`} />
        <Kpi label={`적정 사업비 (목표 ${input.targetRate}%)`} value={krw(r.totals.fairPrice)} sub={`최소 ${krw(r.totals.minPrice)} (최소 ${input.minRate}%)`} />
        <Kpi
          label={r.kosa ? `대가산정 예산 (${r.kosa.year} KOSA)` : '대가산정 예산'}
          value={r.kosa ? krw(r.kosa.budget) : '-'}
          sub={r.kosa ? `적정 사업비 대비 ${pctText(r.kosa.headroom)}` : '원가 기준에서 KOSA 단가 설정 필요'}
          tone={r.kosa?.headroom != null ? (r.kosa.headroom >= 100 ? 'good' : 'warn') : undefined}
        />
        <Kpi
          label="제안가 · 예상 이익률"
          value={r.proposed ? `${JUDGE[r.proposed.judge].icon} ${pctText(r.proposed.margin)}` : '-'}
          sub={r.proposed ? `${krw(r.proposed.amount)} · 이익 ${krw(r.proposed.profit)} · ${JUDGE[r.proposed.judge].label}` : '제안가를 입력하면 판정'}
          tone={r.proposed ? JUDGE[r.proposed.judge].tone : undefined}
        />
      </div>
      {calcErr && <div className="alert bad">{calcErr}</div>}
      {r.warnings.length > 0 && (
        <div className="alert warn sim-warn">
          {r.warnings.map((w) => (
            <div key={w}>· {w}</div>
          ))}
        </div>
      )}

      <div className="stack">
        <Card title="기본 조건">
          <div className="form-grid">
            <Field label="시나리오명">
              <input value={name} disabled={readOnly} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="사업 시작일">
              <input type="date" value={input.startDt} disabled={readOnly} onChange={(e) => e.target.value && set({ startDt: e.target.value })} />
            </Field>
            <Field label="사업 종료일">
              <input type="date" value={input.endDt} disabled={readOnly} onChange={(e) => e.target.value && set({ endDt: e.target.value })} />
            </Field>
            <Field label="예비비율" hint="(인건비 + 경비) 대비 리스크 예비비">
              <PctInput value={input.reserveRate} disabled={readOnly} onChange={(v) => set({ reserveRate: v ?? 0 })} />
            </Field>
            <Field label="목표 이익률" hint="적정 사업비 기준 · 이상이면 🟢">
              <PctInput value={input.targetRate} disabled={readOnly} onChange={(v) => set({ targetRate: v ?? 0 })} />
            </Field>
            <Field label="최소 이익률" hint="최소 사업비 기준 · 미만이면 🔴">
              <PctInput value={input.minRate} disabled={readOnly} onChange={(v) => set({ minRate: v ?? 0 })} />
            </Field>
            <Field label="제안가 (사업비, 부가세 제외)" hint={p?.contractAmt ? `프로젝트 계약금액 ${fullWon(p.contractAmt)}` : '입력하면 예상 이익률을 판정합니다'}>
              <MoneyInput value={input.proposedAmt ?? null} disabled={readOnly} placeholder="(선택)" onChange={(v) => set({ proposedAmt: v })} />
            </Field>
            <Field label="메모" full>
              <textarea rows={2} value={memo} disabled={readOnly} maxLength={500} onChange={(e) => setMemo(e.target.value)} placeholder="가정·전제 조건, 리스크 등" />
            </Field>
          </div>
        </Card>

        <RowsCard input={input} result={r} opt={opt} readOnly={readOnly} prjCd={d.prjCd} setRow={setRow} set={set} />
        <ExpensesCard input={input} readOnly={readOnly} set={set} />

        <div className="grid cols-2">
          <CostCard r={r} input={input} />
          <SensitivityCard r={r} input={input} />
        </div>
        <MonthlyCard r={r} />
      </div>

      {confirming && (
        <ConfirmDialog
          d={d}
          dirty={dirty}
          save={save}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function RowsCard({ input, result, opt, readOnly, prjCd, setRow, set }: { input: SimInput; result: SimResult; opt: Options | null; readOnly: boolean; prjCd: string; setRow: (i: number, p: Partial<SimRow>) => void; set: (p: Partial<SimInput>) => void }) {
  const toast = useToast();
  const ownGrades = opt?.ownGrades.map((g) => g.grade) ?? [];
  const newRow = (type: SimRow['type']): SimRow => ({
    type,
    grade: type === 'OWN' ? ownGrades[0] ?? '' : '중급',
    roleCd: 'DEV',
    jobNm: opt?.roleJobs.DEV ?? null,
    headcount: 1,
    startDt: input.startDt,
    endDt: input.endDt,
    allocRate: 100,
    monthlyRate: null,
    note: null,
  });
  const loadAssignments = async () => {
    try {
      const rows = await api.get<SimRow[]>(`/profit/assignments/${prjCd}`);
      if (!rows.length) return toast('이 프로젝트에 배정된 인력이 없습니다.', 'bad');
      if (input.rows.length && !window.confirm(`배정 ${rows.length}건을 기존 행 뒤에 추가할까요?`)) return;
      set({ rows: [...input.rows, ...rows] });
      toast(`배정 ${rows.length}건을 불러왔습니다.`);
    } catch (e) {
      toast(errMsg(e), 'bad');
    }
  };
  const remove = (i: number) => set({ rows: input.rows.filter((_, j) => j !== i) });
  const dup = (i: number) => set({ rows: [...input.rows.slice(0, i + 1), { ...input.rows[i] }, ...input.rows.slice(i + 1)] });

  return (
    <Card
      title={`인력 투입 (${input.rows.length}행 · ${mmText(result.totals.mm)})`}
      actions={
        !readOnly && (
          <span className="row no-print" style={{ gap: 6 }}>
            <button className="btn sm" onClick={loadAssignments}>
              현재 배정 불러오기
            </button>
            <button className="btn sm" onClick={() => set({ rows: [...input.rows, newRow('PARTNER')] })}>
              + 협력사
            </button>
            <button className="btn sm primary" onClick={() => set({ rows: [...input.rows, newRow('OWN')] })}>
              + 자사
            </button>
          </span>
        )
      }
    >
      <datalist id="sim-kosa-jobs">
        {(opt?.kosaJobs ?? []).map((j) => (
          <option key={j} value={j} />
        ))}
      </datalist>
      {!input.rows.length ? (
        <Empty>투입 인력이 없습니다. 자사·협력사 행을 추가하거나 현재 배정을 불러오세요.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl sim-rows">
            <thead>
              <tr>
                <th>구분</th>
                <th>직급/등급</th>
                <th>역할</th>
                <th>KOSA 직무</th>
                <th className="r">인원</th>
                <th>투입 시작</th>
                <th>투입 종료</th>
                <th className="r">투입률</th>
                <th className="r">월단가</th>
                <th className="r">MM</th>
                <th className="r">원가</th>
                <th>비고</th>
                {!readOnly && <th className="no-print" />}
              </tr>
            </thead>
            <tbody>
              {input.rows.map((row, i) => {
                const res = result.rows[i];
                const grades = row.type === 'OWN' ? [...new Set([...ownGrades, row.grade].filter(Boolean))] : SKILL_LEVELS;
                return (
                  <tr key={i} className={row.type === 'PARTNER' ? 'sim-partner' : ''}>
                    <td>
                      <select
                        value={row.type}
                        disabled={readOnly}
                        onChange={(e) => {
                          const type = e.target.value as SimRow['type'];
                          setRow(i, { type, grade: type === 'OWN' ? ownGrades[0] ?? '' : '중급', monthlyRate: null });
                        }}
                      >
                        <option value="OWN">자사</option>
                        <option value="PARTNER">협력사</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.grade} disabled={readOnly} onChange={(e) => setRow(i, { grade: e.target.value })}>
                        {!row.grade && <option value="">선택</option>}
                        {grades.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={row.roleCd} disabled={readOnly} onChange={(e) => setRow(i, { roleCd: e.target.value, jobNm: opt?.roleJobs[e.target.value] ?? row.jobNm })}>
                        {Object.entries(ASG_ROLE).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input list="sim-kosa-jobs" value={row.jobNm ?? ''} disabled={readOnly} onChange={(e) => setRow(i, { jobNm: e.target.value || null })} style={{ minWidth: 120 }} />
                    </td>
                    <td className="r">
                      <input type="number" min={0.1} step={0.5} value={row.headcount} disabled={readOnly} onChange={(e) => setRow(i, { headcount: Number(e.target.value) || 0 })} style={{ width: 64 }} />
                    </td>
                    <td>
                      <input type="date" value={row.startDt} disabled={readOnly} onChange={(e) => e.target.value && setRow(i, { startDt: e.target.value })} />
                    </td>
                    <td>
                      <input type="date" value={row.endDt} disabled={readOnly} onChange={(e) => e.target.value && setRow(i, { endDt: e.target.value })} />
                    </td>
                    <td className="r">
                      <PctInput value={row.allocRate} disabled={readOnly} onChange={(v) => setRow(i, { allocRate: v ?? 0 })} />
                    </td>
                    <td className="r">
                      {readOnly ? (
                        fullWon(res?.unit)
                      ) : (
                        <MoneyInput value={row.monthlyRate ?? null} placeholder={res?.unit != null ? `${res.unit.toLocaleString('ko-KR')} (기준)` : '기준 없음'} onChange={(v) => setRow(i, { monthlyRate: v })} />
                      )}
                    </td>
                    <td className="r nowrap">{res ? res.mm.toLocaleString('ko-KR') : '-'}</td>
                    <td className="r nowrap">{res ? fullWon(res.cost) : '-'}</td>
                    <td>
                      <input value={row.note ?? ''} disabled={readOnly} placeholder="(성명 등)" maxLength={100} onChange={(e) => setRow(i, { note: e.target.value || null })} style={{ minWidth: 90 }} />
                    </td>
                    {!readOnly && (
                      <td className="nowrap no-print">
                        <button className="btn sm ghost" onClick={() => dup(i)} title="행 복제" aria-label="행 복제">
                          ⧉
                        </button>
                        <button className="btn sm ghost" onClick={() => remove(i)} title="행 삭제" aria-label="행 삭제">
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        월단가를 비워 두면 원가 기준의 값(자사: 그 달 적용 중인 직급 표준원가 / 협력사: 등급 기본단가)을 씁니다. MM = 인원 × 투입률 × 투입일수 ÷ 그 달 일수.
      </p>
    </Card>
  );
}

function ExpensesCard({ input, readOnly, set }: { input: SimInput; readOnly: boolean; set: (p: Partial<SimInput>) => void }) {
  const setE = (i: number, patch: Partial<SimInput['expenses'][number]>) => set({ expenses: input.expenses.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const total = input.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  return (
    <Card
      title={`직접경비 (${krw(total)})`}
      actions={
        !readOnly && (
          <button className="btn sm no-print" onClick={() => set({ expenses: [...input.expenses, { category: 'TRAVEL', amount: 0, memo: null }] })}>
            + 경비
          </button>
        )
      }
    >
      {!input.expenses.length ? (
        <Empty>직접경비가 없습니다. (출장·체재, 장비, SW 라이선스, 인력 외 외주 용역 등)</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>항목</th>
                <th className="r">금액</th>
                <th>내용</th>
                {!readOnly && <th className="no-print" />}
              </tr>
            </thead>
            <tbody>
              {input.expenses.map((e, i) => (
                <tr key={i}>
                  <td>
                    <select value={e.category} disabled={readOnly} onChange={(ev) => setE(i, { category: ev.target.value })}>
                      {Object.entries(EXPENSE_TYPE).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="r">{readOnly ? fullWon(e.amount) : <MoneyInput value={e.amount} onChange={(v) => setE(i, { amount: v ?? 0 })} />}</td>
                  <td>
                    <input value={e.memo ?? ''} disabled={readOnly} maxLength={100} onChange={(ev) => setE(i, { memo: ev.target.value || null })} />
                  </td>
                  {!readOnly && (
                    <td className="no-print">
                      <button className="btn sm ghost" onClick={() => set({ expenses: input.expenses.filter((_, j) => j !== i) })} aria-label="경비 삭제">
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 원가 구성 + 사업비 비교 막대 */
function CostCard({ r, input }: { r: SimResult; input: SimInput }) {
  const t = r.totals;
  const parts = [
    { label: '자사 인건비', v: t.ownLabor, cls: 'own' },
    { label: '협력사 인건비', v: t.partnerLabor, cls: 'partner' },
    { label: '직접경비', v: t.expense, cls: 'exp' },
    { label: `예비비 (${input.reserveRate}%)`, v: t.reserve, cls: 'reserve' },
  ];
  const prices = [
    { label: '총원가 (손익분기)', v: t.totalCost, cls: 'cost' },
    { label: `최소 사업비 (${input.minRate}%)`, v: t.minPrice, cls: 'min' },
    { label: `적정 사업비 (${input.targetRate}%)`, v: t.fairPrice, cls: 'fair' },
    ...(r.kosa ? [{ label: `대가산정 예산 (${r.kosa.year})`, v: r.kosa.budget, cls: 'kosa' }] : []),
    ...(r.proposed ? [{ label: `제안가 ${JUDGE[r.proposed.judge].icon}`, v: r.proposed.amount, cls: `prop ${r.proposed.judge.toLowerCase()}` }] : []),
  ];
  const max = Math.max(1, ...prices.map((p) => p.v ?? 0));
  return (
    <Card title="원가 구성 · 사업비 비교">
      <div className="sim-stack" aria-label="원가 구성">
        {parts.map((p) => (t.totalCost > 0 && p.v > 0 ? <span key={p.label} className={p.cls} style={{ flex: p.v }} title={`${p.label} ${fullWon(p.v)}`} /> : null))}
      </div>
      <ul className="sim-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i className={p.cls} />
            {p.label}
            <span>
              {fullWon(p.v)} <span className="muted">({t.totalCost ? pctText((p.v / t.totalCost) * 100) : '-'})</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="sim-bars">
        {prices.map((p) => (
          <div key={p.label} className="sim-bar">
            <span className="sim-bar-label">{p.label}</span>
            <span className="sim-bar-track">
              <span className={`sim-bar-fill ${p.cls}`} style={{ width: `${((p.v ?? 0) / max) * 100}%` }} />
            </span>
            <span className="sim-bar-val">{krw(p.v)}</span>
          </div>
        ))}
      </div>
      {r.kosa && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          대가산정: 직접인건비 {krw(r.kosa.direct)} + 제경비 {krw(r.kosa.overhead)} + 기술료 {krw(r.kosa.techFee)} + 직접경비 {krw(r.kosa.expense)}
        </p>
      )}
    </Card>
  );
}

function SensitivityCard({ r, input }: { r: SimResult; input: SimInput }) {
  const base = r.proposed ? `제안가 ${krw(r.proposed.amount)}` : `적정 사업비 ${krw(r.totals.fairPrice)}`;
  const judge = (m: number | null) => (m == null ? '' : m >= input.targetRate ? JUDGE.GOOD.icon : m >= input.minRate ? JUDGE.COND.icon : JUDGE.BAD.icon);
  return (
    <Card title="민감도 (투입 변동 시)">
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>인력 투입</th>
              <th className="r">총원가</th>
              <th className="r">이익률</th>
            </tr>
          </thead>
          <tbody>
            {r.sensitivity.map((s) => (
              <tr key={s.pct} className={s.pct === 0 ? 'sim-current' : ''}>
                <td>{s.pct === 0 ? '계획대로' : `${s.pct > 0 ? '+' : ''}${s.pct}%`}</td>
                <td className="r">{krw(s.totalCost)}</td>
                <td className="r">
                  {judge(s.margin)} {pctText(s.margin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {base} 기준. 인건비만 늘거나 줄고 경비는 그대로, 예비비는 비율대로 다시 계산합니다.
      </p>
    </Card>
  );
}

function MonthlyCard({ r }: { r: SimResult }) {
  const max = Math.max(1, ...r.monthly.map((m) => m.labor));
  if (!r.monthly.length) return null;
  return (
    <Card title="월별 투입 · 인건비">
      <div className="sim-month-chart" aria-hidden>
        {r.monthly.map((m) => (
          <div key={m.ym} className="sim-month-col" title={`${m.ym}: ${mmText(m.mm)} · ${fullWon(m.labor)}`}>
            <span style={{ height: `${(m.labor / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="tbl sim-month-tbl">
          <thead>
            <tr>
              <th />
              {r.monthly.map((m) => (
                <th key={m.ym} className="r">
                  {m.ym.slice(2).replace('-', '.')}
                </th>
              ))}
              <th className="r">합계</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>MM</th>
              {r.monthly.map((m) => (
                <td key={m.ym} className="r">
                  {m.mm ? m.mm.toLocaleString('ko-KR') : '-'}
                </td>
              ))}
              <td className="r">
                <strong>{r.totals.mm.toLocaleString('ko-KR')}</strong>
              </td>
            </tr>
            <tr>
              <th>인건비</th>
              {r.monthly.map((m) => (
                <td key={m.ym} className="r">
                  {m.labor ? krw(m.labor) : '-'}
                </td>
              ))}
              <td className="r">
                <strong>{krw(r.totals.labor)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** 기준선 확정: 저장 → 확정 (잠금·버전) */
function ConfirmDialog({ d, dirty, save, onClose, onDone }: { d: Detail; dirty: boolean; save: () => Promise<boolean>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const next = (d.latestBaseline ?? 0) + 1;
  const go = async () => {
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      const r = await api.post<{ version: number }>(`/profit/sims/${d.simId}/confirm`, {});
      toast(`실행예산 기준선 v${r.version}으로 확정했습니다.`);
      onDone();
    } catch (e) {
      toast(errMsg(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="실행예산 기준선으로 확정"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={go} disabled={busy}>
            {dirty ? '저장하고 확정' : '확정'}
          </button>
        </>
      }
    >
      <p>
        <strong>{d.project?.prjNm}</strong>의 실행예산을 <strong>'{d.name}'</strong> 안으로 확정합니다. 기준선 <strong>v{next}</strong>가 되고, 이후 실적 비교의 기준이 됩니다.
      </p>
      <ul className="small">
        <li>확정하면 이 시뮬레이션은 수정·삭제할 수 없습니다 (변경계약 등은 복사해서 v{next + 1}로 다시 확정).</li>
        <li>확정 당시의 원가 기준(직급 인건비·비율·KOSA 단가)으로 금액을 고정해 보관합니다.</li>
        {d.latestBaseline != null && <li>현재 실행예산 v{d.latestBaseline}은 이전 버전으로 이력에 남습니다.</li>}
      </ul>
    </Modal>
  );
}
