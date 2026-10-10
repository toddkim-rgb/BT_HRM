import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Field, Loading, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ASG_ROLE, PRJ_TYPE, SKILL_LEVELS } from '../lib/codes';
import { today } from '../lib/dates';
import { won } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { MoneyInput, PctInput } from '../components/NumInputs';

type ConfigKey = 'LEGAL_RATE' | 'OVERHEAD_RATE' | 'RESERVE_RATE' | 'KOSA_OVERHEAD_RATE' | 'KOSA_TECH_FEE_RATE' | 'KOSA_YEAR';
interface GradeRow {
  id: number;
  gradeCd: string;
  monthlySalary: number;
  applyStartDt: string;
}
interface KosaRow {
  year: number;
  jobNm: string;
  dailyWage: number;
  monthlyWage: number | null;
}
interface Basis {
  mdPerMm: number;
  config: Record<ConfigKey, number | null>;
  grades: GradeRow[];
  gradesInUse: { gradeCd: string; count: number }[];
  margins: { prjType: string; targetRate: number | null; minRate: number | null }[];
  partnerRates: { gradeCd: string; monthlyRate: number }[];
  kosa: KosaRow[];
  roleJobs: { roleCd: string; jobNm: string }[];
}

/** 직급 표시 순서 (목록에 없는 직급은 뒤에 가나다순) */
const GRADE_ORDER = ['대표', '사장', '부사장', '전무', '상무', '이사', '수석', '부장', '책임', '차장', '과장', '선임', '대리', '주임', '사원', '연구원'];
const gradeRank = (g: string) => {
  const i = GRADE_ORDER.indexOf(g);
  return i < 0 ? 100 : i;
};
/** KOSA SW기술자 직무 (기본 목록 — 해당 연도 공표표와 대조해 수정하세요) */
const KOSA_JOBS = ['IT기획자', 'IT컨설턴트', '정보보호컨설턴트', '업무분석가', '데이터분석가', 'IT PM', 'IT아키텍트', 'UI/UX기획/개발자', 'UI/UX디자이너', '응용SW개발자', '시스템SW개발자', '정보시스템운용자', 'IT지원기술자', 'IT마케터', 'IT품질관리자', 'IT테스터', 'IT감리', '정보보호관리자', '침해사고대응전문가'];

const useSaver = (reload: () => void) => {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, msg = '저장했습니다.') => {
    try {
      await fn();
      toast(msg);
      reload();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
      return false;
    }
  };
};

/** 월 표준원가 = 월 인건비 × (1 + 법정부담률) × (1 + 간접비율) */
export const standardCost = (salary: number, legal: number | null, overhead: number | null) => salary * (1 + (legal ?? 0) / 100) * (1 + (overhead ?? 0) / 100);

export default function CostBasis() {
  const editable = useAuth().can('costBasis', 'EDIT');
  const { data, error, reload } = useFetch<Basis>('/cost/basis');
  return (
    <div>
      <PageHeader
        title="원가 기준"
        desc="수익성 분석(사업비 시뮬레이션·실행예산)에 쓰는 원가·단가 기준입니다. 개인 연봉은 저장하지 않고 직급 평균 인건비만 관리합니다."
        actions={!editable && <Badge tone="neutral">조회 전용</Badge>}
      />
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="stack">
          <Readiness d={data} />
          <div className="grid cols-2">
            <RatesCard d={data} editable={editable} reload={reload} />
            <MarginCard d={data} editable={editable} reload={reload} />
          </div>
          <GradeCostCard d={data} editable={editable} reload={reload} />
          <div className="grid cols-2">
            <PartnerRateCard d={data} editable={editable} reload={reload} />
            <RoleJobCard d={data} editable={editable} reload={reload} />
          </div>
          <KosaCard d={data} editable={editable} reload={reload} />
        </div>
      )}
    </div>
  );
}

type CardProps = { d: Basis; editable: boolean; reload: () => void };

/** 입력 현황: 시뮬레이션에 필요한 기준값이 다 들어왔는지 */
function Readiness({ d }: { d: Basis }) {
  const t = today();
  const priced = new Set(d.grades.filter((g) => g.applyStartDt <= t).map((g) => g.gradeCd));
  const missing = d.gradesInUse.filter((g) => !priced.has(g.gradeCd)).map((g) => g.gradeCd);
  const kosaYear = d.config.KOSA_YEAR;
  const items: { ok: boolean; label: string }[] = [
    { ok: !missing.length && d.gradesInUse.length > 0, label: missing.length ? `직급 인건비 미등록 ${missing.length}개 (${missing.join(', ')})` : '직급 인건비' },
    { ok: d.config.LEGAL_RATE != null && d.config.OVERHEAD_RATE != null, label: '법정부담률·간접비율' },
    { ok: d.margins.every((m) => m.targetRate != null && m.minRate != null), label: '이익률 판정 기준' },
    { ok: d.partnerRates.length === SKILL_LEVELS.length, label: `협력사 등급 단가 ${d.partnerRates.length}/${SKILL_LEVELS.length}` },
    { ok: !!kosaYear && d.kosa.some((k) => k.year === kosaYear) && d.config.KOSA_OVERHEAD_RATE != null && d.config.KOSA_TECH_FEE_RATE != null, label: kosaYear ? `대가산정 (${kosaYear}년 KOSA 단가·제경비·기술료)` : '대가산정 적용 연도' },
  ];
  return (
    <div className="cost-ready">
      <strong>입력 현황</strong>
      {items.map((i) => (
        <span key={i.label} className={`cost-ready-item ${i.ok ? 'ok' : ''}`}>
          {i.ok ? '✓' : '○'} {i.label}
        </span>
      ))}
    </div>
  );
}

function RatesCard({ d, editable, reload }: CardProps) {
  const save = useSaver(reload);
  const [f, setF] = useState(d.config);
  useEffect(() => setF(d.config), [d.config]);
  const keys: { k: ConfigKey; label: string; hint: string }[] = [
    { k: 'LEGAL_RATE', label: '법정부담률', hint: '4대보험·퇴직급여 등 회사 부담분 (직접인건비 대비)' },
    { k: 'OVERHEAD_RATE', label: '간접비율', hint: '판관비 등 간접비 배부 (인건비+법정부담 대비)' },
    { k: 'RESERVE_RATE', label: '기본 예비비율', hint: '시뮬레이션 리스크 예비비 기본값 (시뮬레이션마다 수정 가능)' },
  ];
  return (
    <Card
      title="원가 비율"
      actions={
        editable && (
          <button className="btn sm primary" onClick={() => save(() => api.put('/cost/config', Object.fromEntries(keys.map(({ k }) => [k, f[k]]))))}>
            저장
          </button>
        )
      }
    >
      <div className="form-grid">
        {keys.map(({ k, label, hint }) => (
          <Field key={k} label={label} hint={hint}>
            <PctInput value={f[k]} disabled={!editable} onChange={(v) => setF((s) => ({ ...s, [k]: v }))} />
          </Field>
        ))}
        <Field label="월 근무일 (MD/MM)" hint="기준값 설정에서 변경">
          <input value={`${d.mdPerMm}일`} disabled />
        </Field>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        1인 월 표준원가 = 1인 월 직접인건비(급여) × (1 + 법정부담률) × (1 + 간접비율) · 1인 일 원가 = 월 표준원가 ÷ {d.mdPerMm}일
      </p>
    </Card>
  );
}

function MarginCard({ d, editable, reload }: CardProps) {
  const save = useSaver(reload);
  const [rows, setRows] = useState(d.margins);
  useEffect(() => setRows(d.margins), [d.margins]);
  const set = (i: number, patch: Partial<Basis['margins'][number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = rows.every((r) => r.targetRate != null && r.minRate != null);
  return (
    <Card
      title="이익률 판정 기준"
      actions={
        editable && (
          <button className="btn sm primary" disabled={!ready} title={ready ? '' : '목표·최소 이익률을 모두 입력하세요'} onClick={() => save(() => api.put('/cost/margins', { rows }))}>
            저장
          </button>
        )
      }
    >
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>사업구분</th>
              <th>목표 이익률</th>
              <th>최소 이익률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.prjType}>
                <td>
                  <strong>{PRJ_TYPE[r.prjType] ?? r.prjType}</strong>
                </td>
                <td>
                  <PctInput value={r.targetRate} disabled={!editable} onChange={(v) => set(i, { targetRate: v })} />
                </td>
                <td>
                  <PctInput value={r.minRate} disabled={!editable} onChange={(v) => set(i, { minRate: v })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="margin-legend small">
        <span>🟢 목표 이상 = 승인</span>
        <span>🟡 최소 ~ 목표 = 조건부</span>
        <span>🔴 최소 미만 = 재검토</span>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        이익률 = (사업비 − 총원가) ÷ 사업비 (매출 대비). 내부·제안·기타 프로젝트는 원가만 집계합니다.
      </p>
    </Card>
  );
}

function GradeCostCard({ d, editable, reload }: CardProps) {
  const save = useSaver(reload);
  const t = today();
  const [editing, setEditing] = useState(false);
  const [applyDt, setApplyDt] = useState(`${t.slice(0, 8)}01`);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [newGrade, setNewGrade] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const byGrade = useMemo(() => {
    const m = new Map<string, GradeRow[]>();
    for (const g of d.grades) m.set(g.gradeCd, [...(m.get(g.gradeCd) ?? []), g]);
    return m;
  }, [d.grades]);
  const inUse = new Map(d.gradesInUse.map((g) => [g.gradeCd, g.count]));
  const names = [...new Set([...inUse.keys(), ...byGrade.keys(), ...Object.keys(draft)])].sort((a, b) => gradeRank(a) - gradeRank(b) || a.localeCompare(b));
  /** 오늘 적용 중인 인건비 / 예정된 변경 */
  const current = (g: string) => (byGrade.get(g) ?? []).find((r) => r.applyStartDt <= t);
  const upcoming = (g: string) => (byGrade.get(g) ?? []).filter((r) => r.applyStartDt > t);

  const startEdit = () => {
    setDraft(Object.fromEntries(names.map((g) => [g, current(g)?.monthlySalary ?? null])));
    setEditing(true);
  };
  const submit = async () => {
    const rows = Object.entries(draft)
      .filter(([g, v]) => v != null && v > 0 && v !== current(g)?.monthlySalary)
      .map(([gradeCd, monthlySalary]) => ({ gradeCd, monthlySalary: monthlySalary!, applyStartDt: applyDt }));
    if (!rows.length) return setEditing(false);
    if (await save(() => api.put('/cost/grades', { rows }), `${rows.length}개 직급 인건비를 ${applyDt}부터 적용합니다.`)) setEditing(false);
  };
  const legal = d.config.LEGAL_RATE;
  const overhead = d.config.OVERHEAD_RATE;

  return (
    <Card
      title="직급별 1인 표준 원가 (자사)"
      actions={
        editable &&
        (editing ? (
          <span className="row" style={{ gap: 6 }}>
            <label className="small row" style={{ gap: 4 }}>
              적용 시작일
              <input type="date" value={applyDt} onChange={(e) => setApplyDt(e.target.value)} style={{ width: 150 }} />
            </label>
            <button className="btn sm" onClick={() => setEditing(false)}>
              취소
            </button>
            <button className="btn sm primary" onClick={submit} disabled={!applyDt}>
              저장
            </button>
          </span>
        ) : (
          <button className="btn sm primary" onClick={startEdit}>
            인건비 변경
          </button>
        ))
      }
    >
      {(legal == null || overhead == null) && <div className="alert warn">법정부담률·간접비율이 설정되지 않아 표준원가에 0%로 계산됩니다.</div>}
      {!names.length ? (
        <Empty>자사 인력의 직급이 없습니다. 인력 화면에서 직급을 입력하거나 아래에서 직급을 추가하세요.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl cost-grade-tbl">
            <thead>
              <tr>
                <th>직급</th>
                <th className="r" title="참고: 이 직급의 자사 인력 수 (원가 계산에는 쓰지 않음)">
                  보유 인원
                </th>
                <th className="r">
                  1인 월 직접인건비
                  <div className="th-sub">월 급여 (연봉 ÷ 12)</div>
                </th>
                <th>적용 시작일</th>
                <th className="r">
                  1인 월 표준원가
                  <div className="th-sub">+ 법정부담 {d.config.LEGAL_RATE ?? 0}% · 간접비 {d.config.OVERHEAD_RATE ?? 0}%</div>
                </th>
                <th className="r">
                  1인 일 원가
                  <div className="th-sub">÷ {d.mdPerMm}일</div>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {names.map((g) => {
                const cur = current(g);
                const up = upcoming(g);
                const salary = editing ? draft[g] ?? null : cur?.monthlySalary ?? null;
                const std = salary != null ? standardCost(salary, legal, overhead) : null;
                const history = byGrade.get(g) ?? [];
                return [
                  <tr key={g} className={!cur && !editing ? 'cost-missing' : ''}>
                    <td>
                      <strong>{g}</strong>
                    </td>
                    <td className="r">{inUse.get(g) ? `${inUse.get(g)}명` : '-'}</td>
                    <td className="r">
                      {editing ? (
                        <MoneyInput value={draft[g] ?? null} placeholder="1인 월 급여" onChange={(v) => setDraft((s) => ({ ...s, [g]: v }))} />
                      ) : cur ? (
                        won(cur.monthlySalary)
                      ) : (
                        <Badge tone="warn">미등록</Badge>
                      )}
                    </td>
                    <td className="nowrap">
                      {cur?.applyStartDt ?? '-'}
                      {up.map((u) => (
                        <Badge key={u.id} tone="info">
                          {u.applyStartDt}부터 {won(u.monthlySalary)}
                        </Badge>
                      ))}
                    </td>
                    <td className="r">{std != null ? won(std) : '-'}</td>
                    <td className="r">{std != null ? won(std / d.mdPerMm) : '-'}</td>
                    <td className="r">
                      {history.length > 0 && (
                        <button className="btn sm ghost" onClick={() => setOpen(open === g ? null : g)}>
                          이력 {history.length}
                        </button>
                      )}
                    </td>
                  </tr>,
                  open === g && (
                    <tr key={`${g}-h`} className="cost-history">
                      <td colSpan={7}>
                        <ul>
                          {history.map((h) => (
                            <li key={h.id}>
                              <span>{h.applyStartDt}부터</span>
                              <span>{won(h.monthlySalary)}</span>
                              <span className="muted">표준원가 {won(standardCost(h.monthlySalary, legal, overhead))}</span>
                              {editable && (
                                <button className="btn sm danger" onClick={() => window.confirm(`${g} ${h.applyStartDt} 인건비 이력을 삭제할까요?`) && save(() => api.del(`/cost/grades/${h.id}`), '삭제했습니다.')}>
                                  삭제
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <input placeholder="직급 추가 (예: 수석)" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} style={{ maxWidth: 200 }} />
          <button
            className="btn sm"
            disabled={!newGrade.trim() || names.includes(newGrade.trim())}
            onClick={() => {
              setDraft((s) => ({ ...s, [newGrade.trim()]: null }));
              setNewGrade('');
            }}
          >
            추가
          </button>
          <span className="small muted">바꾼 직급만 새 이력으로 저장됩니다. 같은 적용 시작일이면 덮어씁니다.</span>
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        모든 금액은 <strong>직급별 1인 기준</strong>입니다 (보유 인원은 참고용). 프로젝트 원가는 <strong>1인 월 표준원가 × 인원 × 투입률</strong>(투입 기간은 일할)로 나눠 잡힙니다 — 예: 과장 1명을 50%로 한 달 투입하면 0.5 MM, 표준원가의 절반.
        <br />
        시뮬레이션은 투입 시점에 적용 중인 값을 사용하고, 확정된 실행예산은 확정 당시 값을 그대로 유지합니다.
      </p>
    </Card>
  );
}

function PartnerRateCard({ d, editable, reload }: CardProps) {
  const save = useSaver(reload);
  const init = () => Object.fromEntries(SKILL_LEVELS.map((g) => [g, d.partnerRates.find((r) => r.gradeCd === g)?.monthlyRate ?? null]));
  const [f, setF] = useState<Record<string, number | null>>(init);
  useEffect(() => setF(init()), [d.partnerRates]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card
      title="협력사 등급별 기본 월단가"
      actions={
        editable && (
          <button className="btn sm primary" onClick={() => save(() => api.put('/cost/partner-rates', { rows: SKILL_LEVELS.map((g) => ({ gradeCd: g, monthlyRate: f[g] })) }))}>
            저장
          </button>
        )
      }
    >
      <div className="form-grid">
        {SKILL_LEVELS.map((g) => (
          <Field key={g} label={g}>
            <MoneyInput value={f[g]} disabled={!editable} placeholder="월단가 (원)" onChange={(v) => setF((s) => ({ ...s, [g]: v }))} />
          </Field>
        ))}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        시뮬레이션의 협력사 행에 기본으로 들어가며, 행마다 실제 협상 단가로 바꿀 수 있습니다. 협력사 단가는 계약 월단가 그대로 원가로 봅니다.
      </p>
    </Card>
  );
}

function RoleJobCard({ d, editable, reload }: CardProps) {
  const save = useSaver(reload);
  const init = () => Object.fromEntries(Object.keys(ASG_ROLE).map((r) => [r, d.roleJobs.find((x) => x.roleCd === r)?.jobNm ?? '']));
  const [f, setF] = useState<Record<string, string>>(init);
  useEffect(() => setF(init()), [d.roleJobs]); // eslint-disable-line react-hooks/exhaustive-deps
  const jobs = [...new Set([...d.kosa.filter((k) => k.year === d.config.KOSA_YEAR).map((k) => k.jobNm), ...KOSA_JOBS])];
  return (
    <Card
      title="역할 → KOSA 직무 매핑"
      actions={
        editable && (
          <button className="btn sm primary" onClick={() => save(() => api.put('/cost/role-jobs', { rows: Object.entries(f).map(([roleCd, jobNm]) => ({ roleCd, jobNm })) }))}>
            저장
          </button>
        )
      }
    >
      <datalist id="kosa-jobs">
        {jobs.map((j) => (
          <option key={j} value={j} />
        ))}
      </datalist>
      <div className="form-grid">
        {Object.entries(ASG_ROLE).map(([r, label]) => (
          <Field key={r} label={label}>
            <input list="kosa-jobs" value={f[r] ?? ''} disabled={!editable} placeholder="직무 선택" onChange={(e) => setF((s) => ({ ...s, [r]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        시뮬레이션에서 역할을 고르면 이 직무가 자동으로 들어가고, 행마다 바꿀 수 있습니다.
      </p>
    </Card>
  );
}

function KosaCard({ d, editable, reload }: CardProps) {
  const save = useSaver(reload);
  const toast = useToast();
  const thisYear = Number(today().slice(0, 4));
  const years = [...new Set([thisYear + 1, thisYear, thisYear - 1, ...d.kosa.map((k) => k.year)])].sort((a, b) => b - a);
  const [year, setYear] = useState<number>(d.config.KOSA_YEAR ?? thisYear);
  const rowsOf = (y: number) => d.kosa.filter((k) => k.year === y).map((k) => ({ jobNm: k.jobNm, dailyWage: k.dailyWage as number | null, monthlyWage: k.monthlyWage }));
  const [rows, setRows] = useState(rowsOf(year));
  useEffect(() => setRows(rowsOf(year)), [year, d.kosa]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rates, setRates] = useState({ KOSA_OVERHEAD_RATE: d.config.KOSA_OVERHEAD_RATE, KOSA_TECH_FEE_RATE: d.config.KOSA_TECH_FEE_RATE });
  useEffect(() => setRates({ KOSA_OVERHEAD_RATE: d.config.KOSA_OVERHEAD_RATE, KOSA_TECH_FEE_RATE: d.config.KOSA_TECH_FEE_RATE }), [d.config]);
  const [paste, setPaste] = useState<string | null>(null);

  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const fillJobs = () => setRows((rs) => [...rs, ...KOSA_JOBS.filter((j) => !rs.some((r) => r.jobNm === j)).map((jobNm) => ({ jobNm, dailyWage: null, monthlyWage: null }))]);
  /** 표 붙여넣기: 줄마다 '직무 [탭] 일 평균임금 [탭] 월 평균임금' (쉼표·원 기호 무시) */
  const applyPaste = () => {
    const parsed = (paste ?? '')
      .split(/\r?\n/)
      .map((l) => l.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean))
      .filter((c) => c.length >= 2)
      .map((c) => {
        const n = (s?: string) => (s && /\d/.test(s) ? Number(s.replace(/[^\d]/g, '')) : null);
        return { jobNm: c[0], dailyWage: n(c[1]), monthlyWage: n(c[2]) };
      })
      .filter((r) => r.dailyWage);
    if (!parsed.length) return toast('붙여넣은 내용에서 "직무 / 일 평균임금" 줄을 찾지 못했습니다.', 'bad');
    setRows((rs) => {
      const m = new Map(rs.map((r) => [r.jobNm, r]));
      for (const p of parsed) m.set(p.jobNm, p);
      return [...m.values()];
    });
    setPaste(null);
    toast(`${parsed.length}개 직무를 채웠습니다. 확인 후 저장하세요.`);
  };
  const saveAll = async () => {
    const bad = rows.filter((r) => r.jobNm.trim() && !r.dailyWage);
    if (bad.length) return toast(`일 평균임금이 비어 있는 직무가 있습니다: ${bad.map((b) => b.jobNm).join(', ')}`, 'bad');
    await save(async () => {
      await api.put(`/cost/kosa/${year}`, { rows: rows.filter((r) => r.jobNm.trim()).map((r) => ({ jobNm: r.jobNm.trim(), dailyWage: r.dailyWage, monthlyWage: r.monthlyWage })) });
      await api.put('/cost/config', { ...rates });
    });
  };
  const isApplied = d.config.KOSA_YEAR === year;

  return (
    <Card
      title="공공 SW사업 대가산정 기준 (KOSA 노임단가)"
      actions={
        <span className="row" style={{ gap: 6 }}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년{d.config.KOSA_YEAR === y ? ' (적용 중)' : d.kosa.some((k) => k.year === y) ? '' : ' (미입력)'}
              </option>
            ))}
          </select>
          {editable && !isApplied && (
            <button className="btn sm" disabled={!d.kosa.some((k) => k.year === year)} onClick={() => save(() => api.put('/cost/config', { KOSA_YEAR: year }), `${year}년 단가를 적용합니다.`)}>
              이 연도 적용
            </button>
          )}
          {editable && (
            <button className="btn sm primary" onClick={saveAll}>
              저장
            </button>
          )}
        </span>
      }
    >
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="제경비율" hint="직접인건비 대비 (가이드 범위 110~120%)">
          <PctInput value={rates.KOSA_OVERHEAD_RATE} disabled={!editable} onChange={(v) => setRates((s) => ({ ...s, KOSA_OVERHEAD_RATE: v }))} />
        </Field>
        <Field label="기술료율" hint="(직접인건비 + 제경비) 대비 (가이드 범위 20~40%)">
          <PctInput value={rates.KOSA_TECH_FEE_RATE} disabled={!editable} onChange={(v) => setRates((s) => ({ ...s, KOSA_TECH_FEE_RATE: v }))} />
        </Field>
      </div>
      <p className="small muted">
        대가산정 예상 예산 = 직접인건비(직무별 일 평균임금 × 투입일) + 제경비 + 기술료 + 직접경비 (부가세 제외). 단가는 한국소프트웨어산업협회가 매년 공표하는 SW기술자 평균임금을 입력하세요.
        {!isApplied && d.config.KOSA_YEAR && ` 현재 적용 연도: ${d.config.KOSA_YEAR}년`}
      </p>
      {editable && (
        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          <button className="btn sm" onClick={fillJobs}>
            기본 직무 목록 채우기
          </button>
          <button className="btn sm" onClick={() => setPaste(paste == null ? '' : null)}>
            표 붙여넣기
          </button>
          <button className="btn sm" onClick={() => setRows((rs) => [...rs, { jobNm: '', dailyWage: null, monthlyWage: null }])}>
            + 직무 추가
          </button>
        </div>
      )}
      {paste != null && (
        <div className="kosa-paste">
          <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'공표표에서 복사해 붙여넣으세요. 한 줄에 한 직무:\n직무명 [탭] 일 평균임금 [탭] 월 평균임금\n예) IT PM\t(일 평균임금)\t(월 평균임금)'} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={applyPaste} disabled={!paste.trim()}>
              채우기
            </button>
            <button className="btn sm" onClick={() => setPaste(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {!rows.length ? (
        <Empty>{year}년 단가가 없습니다.{editable ? ' 기본 직무 목록을 채우거나 공표표를 붙여넣으세요.' : ''}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>직무</th>
                <th className="r">일 평균임금</th>
                <th className="r">월 평균임금</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{editable ? <input value={r.jobNm} onChange={(e) => set(i, { jobNm: e.target.value })} /> : r.jobNm}</td>
                  <td className="r">{editable ? <MoneyInput value={r.dailyWage} onChange={(v) => set(i, { dailyWage: v })} /> : won(r.dailyWage)}</td>
                  <td className="r">{editable ? <MoneyInput value={r.monthlyWage} placeholder="(선택)" onChange={(v) => set(i, { monthlyWage: v })} /> : won(r.monthlyWage)}</td>
                  {editable && (
                    <td className="r">
                      <button className="btn sm ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="삭제">
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
      <p className="small muted" style={{ marginBottom: 0 }}>
        기본 직무 목록은 참고용입니다. 해당 연도 공표표의 직무명·단가와 대조해 맞춰 주세요.
      </p>
    </Card>
  );
}
