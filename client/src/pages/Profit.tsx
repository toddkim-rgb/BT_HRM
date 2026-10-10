import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, PrjTypeBadge, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PRJ_STATUS, PRJ_TYPE } from '../lib/codes';
import { dateTime, label } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { JUDGE, krw, mmText, pctText, type Judge, type SimProject, type SimResult } from '../lib/profit';
import { ProfitTabs } from './ProfitActual';

interface SimSummary {
  simId: number;
  prjCd: string;
  project: SimProject | null;
  name: string;
  statusCd: 'DRAFT' | 'BASELINE';
  version: number | null;
  startDt: string;
  endDt: string;
  targetRate: number;
  mm: number;
  totalCost: number;
  fairPrice: number | null;
  kosaBudget: number | null;
  proposed: { amount: number; margin: number; judge: Judge } | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export default function Profit() {
  const editable = useAuth().can('profit', 'EDIT');
  const { data, error } = useFetch<SimSummary[]>('/profit/sims');
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);

  // 프로젝트별로 묶고, 각 프로젝트의 최신 기준선을 위에 요약
  const groups = useMemo(() => {
    const m = new Map<string, SimSummary[]>();
    for (const s of data ?? []) m.set(s.prjCd, [...(m.get(s.prjCd) ?? []), s]);
    return [...m.values()].map((sims) => {
      const baselines = sims.filter((s) => s.statusCd === 'BASELINE').sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
      return { project: sims[0].project, prjCd: sims[0].prjCd, sims, current: baselines[0] ?? null };
    });
  }, [data]);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));

  return (
    <div>
      <PageHeader
        title="수익성 분석"
        desc="내부 인건비로 적정 사업비를 시뮬레이션하고, 확정한 안을 프로젝트의 실행예산 기준선으로 관리합니다. 시나리오를 2~3개 골라 비교할 수 있습니다."
        actions={
          <>
            <button className="btn" disabled={picked.length < 2} onClick={() => setComparing(true)} title="시나리오를 2~3개 선택하세요">
              비교 {picked.length ? `(${picked.length})` : ''}
            </button>
            {editable && (
              <button className="btn primary" onClick={() => setCreating(true)}>
                + 새 시뮬레이션
              </button>
            )}
          </>
        }
      />
      <ProfitTabs />
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !groups.length ? (
        <Empty>
          아직 시뮬레이션이 없습니다. {editable ? "'새 시뮬레이션'으로 프로젝트(제안 상태 포함)를 골라 시작하세요." : ''}
        </Empty>
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <Card
              key={g.prjCd}
              title={
                <span className="row" style={{ gap: 8 }}>
                  {g.project && <PrjTypeBadge type={g.project.prjType}>{label(PRJ_TYPE, g.project.prjType)}</PrjTypeBadge>}
                  <span>{g.project?.prjNm ?? g.prjCd}</span>
                  {g.project && <span className="small muted">{[g.project.customerNm, label(PRJ_STATUS, g.project.statusCd)].filter(Boolean).join(' · ')}</span>}
                </span>
              }
              actions={
                g.current ? (
                  <span className="small">
                    실행예산 <strong>v{g.current.version}</strong> · 총원가 <strong>{krw(g.current.totalCost)}</strong>
                    {g.current.proposed && (
                      <>
                        {' '}
                        · 사업비 {krw(g.current.proposed.amount)} {JUDGE[g.current.proposed.judge].icon} {pctText(g.current.proposed.margin)}
                      </>
                    )}
                  </span>
                ) : (
                  <Badge tone="neutral">기준선 없음</Badge>
                )
              }
            >
              <div className="table-wrap">
                <table className="tbl sim-tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }} />
                      <th>시나리오</th>
                      <th>상태</th>
                      <th>기간</th>
                      <th className="r">투입</th>
                      <th className="r">총원가</th>
                      <th className="r">적정 사업비</th>
                      <th className="r">제안가 · 이익률</th>
                      <th className="r">대가산정 예산</th>
                      <th>작성·확정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.sims.map((s) => (
                      <tr key={s.simId} className={g.current?.simId === s.simId ? 'sim-current' : ''}>
                        <td>
                          <input type="checkbox" checked={picked.includes(s.simId)} onChange={() => toggle(s.simId)} aria-label={`${s.name} 비교 선택`} />
                        </td>
                        <td>
                          <Link to={`/profit/sim/${s.simId}`}>
                            <strong>{s.name}</strong>
                          </Link>
                        </td>
                        <td className="nowrap">
                          {s.statusCd === 'BASELINE' ? <Badge tone={g.current?.simId === s.simId ? 'good' : 'neutral'}>기준선 v{s.version}{g.current?.simId === s.simId ? ' (현재)' : ''}</Badge> : <Badge tone="info">작성 중</Badge>}
                        </td>
                        <td className="nowrap small">
                          {s.startDt} ~ {s.endDt}
                        </td>
                        <td className="r nowrap">{mmText(s.mm)}</td>
                        <td className="r nowrap">{krw(s.totalCost)}</td>
                        <td className="r nowrap">
                          {krw(s.fairPrice)} <span className="small muted">({s.targetRate}%)</span>
                        </td>
                        <td className="r nowrap">
                          {s.proposed ? (
                            <>
                              {krw(s.proposed.amount)} {JUDGE[s.proposed.judge].icon} {pctText(s.proposed.margin)}
                            </>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="r nowrap">{krw(s.kosaBudget)}</td>
                        <td className="small muted nowrap">{s.statusCd === 'BASELINE' ? `${s.confirmedBy ?? ''} 확정 ${dateTime(s.confirmedAt)}` : `${s.createdBy} · ${dateTime(s.updatedAt)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
      {creating && <NewSimDialog existing={data ?? []} onClose={() => setCreating(false)} />}
      {comparing && <CompareDialog ids={picked} onClose={() => setComparing(false)} />}
    </div>
  );
}

/** 새 시뮬레이션: 프로젝트(제안 포함) + 시나리오명 */
function NewSimDialog({ existing, onClose }: { existing: SimSummary[]; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data: projects } = useFetch<SimProject[]>('/profit/projects');
  const [prjCd, setPrjCd] = useState('');
  const [name, setName] = useState('A안');
  useEffect(() => {
    // 같은 프로젝트에 이미 있는 안 다음 글자로 (A안 → B안 …)
    const used = new Set(existing.filter((s) => s.prjCd === prjCd).map((s) => s.name));
    const next = 'ABCDEFGHIJ'.split('').map((c) => `${c}안`).find((n) => !used.has(n)) ?? '새 안';
    setName(next);
  }, [prjCd, existing]);
  const submit = async () => {
    try {
      const r = await api.post<{ simId: number }>('/profit/sims', { prjCd, name });
      nav(`/profit/sim/${r.simId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  return (
    <Modal
      title="새 사업비 시뮬레이션"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!prjCd || !name.trim()} onClick={submit}>
            만들기
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="프로젝트" required full hint="제안 단계 사업은 프로젝트 화면에서 상태 '제안'으로 먼저 등록하세요.">
          <Select
            value={prjCd}
            onChange={setPrjCd}
            placeholder="프로젝트 선택"
            options={(projects ?? []).map((p) => [p.prjCd, `[${label(PRJ_STATUS, p.statusCd)}] ${p.customerNm ? `${p.customerNm} · ` : ''}${p.prjNm}`] as [string, string])}
          />
        </Field>
        <Field label="시나리오명" required full>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        기간은 프로젝트 기간, 목표·최소 이익률은 사업구분 기준, 예비비율은 원가 기준의 기본값으로 시작합니다.
      </p>
    </Modal>
  );
}

interface SimDetail {
  simId: number;
  name: string;
  statusCd: string;
  version: number | null;
  project: SimProject | null;
  input: { startDt: string; endDt: string; reserveRate: number; targetRate: number; minRate: number; proposedAmt: number | null };
  result: SimResult;
}

/** 시나리오 비교 (2~3개 나란히) */
function CompareDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const [list, setList] = useState<SimDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(ids.map((id) => api.get<SimDetail>(`/profit/sims/${id}`)))
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ids]);
  const rows: { label: string; v: (s: SimDetail) => string | number | null; best?: 'min' | 'max'; num?: (s: SimDetail) => number | null }[] = [
    { label: '프로젝트', v: (s) => s.project?.prjNm ?? '-' },
    { label: '상태', v: (s) => (s.statusCd === 'BASELINE' ? `기준선 v${s.version}` : '작성 중') },
    { label: '기간', v: (s) => `${s.input.startDt} ~ ${s.input.endDt}` },
    { label: '총 투입', v: (s) => `${mmText(s.result.totals.mm)} (자사 ${s.result.totals.ownMm} · 협력 ${s.result.totals.partnerMm})` },
    { label: '인건비', v: (s) => krw(s.result.totals.labor) },
    { label: '직접경비', v: (s) => krw(s.result.totals.expense) },
    { label: '예비비', v: (s) => `${krw(s.result.totals.reserve)} (${s.input.reserveRate}%)` },
    { label: '총원가', v: (s) => krw(s.result.totals.totalCost), best: 'min', num: (s) => s.result.totals.totalCost },
    { label: '적정 사업비', v: (s) => `${krw(s.result.totals.fairPrice)} (목표 ${s.input.targetRate}%)`, best: 'min', num: (s) => s.result.totals.fairPrice },
    { label: '최소 사업비', v: (s) => `${krw(s.result.totals.minPrice)} (최소 ${s.input.minRate}%)` },
    { label: '대가산정 예산', v: (s) => (s.result.kosa ? `${krw(s.result.kosa.budget)} (여유 ${pctText(s.result.kosa.headroom)})` : '-') },
    { label: '제안가', v: (s) => krw(s.result.proposed?.amount) },
    { label: '이익률', v: (s) => (s.result.proposed ? `${JUDGE[s.result.proposed.judge].icon} ${pctText(s.result.proposed.margin)} (${krw(s.result.proposed.profit)})` : '-'), best: 'max', num: (s) => s.result.proposed?.margin ?? null },
  ];
  const bestOf = (r: (typeof rows)[number]) => {
    if (!list || !r.best || !r.num) return null;
    const vals = list.map((s) => r.num!(s)).filter((x): x is number => x != null);
    if (vals.length < 2) return null;
    return r.best === 'min' ? Math.min(...vals) : Math.max(...vals);
  };
  return (
    <Modal title="시나리오 비교" onClose={onClose} wide>
      <ErrorBox error={error} />
      {!list ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="tbl compare-tbl">
            <thead>
              <tr>
                <th />
                {list.map((s) => (
                  <th key={s.simId}>
                    <Link to={`/profit/sim/${s.simId}`}>{s.name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const best = bestOf(r);
                return (
                  <tr key={r.label}>
                    <th>{r.label}</th>
                    {list.map((s) => (
                      <td key={s.simId} className={best != null && r.num?.(s) === best ? 'compare-best' : ''}>
                        {r.v(s)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
