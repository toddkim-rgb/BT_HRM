import { prisma } from '../db.js';
import { addMonths, daysBetween, monthRange, overlap } from './dates.js';
import { getSettings } from './settings.js';

/**
 * 사업비 시뮬레이션 계산 (수익성 분석) — 계산은 서버 한 곳에서만
 * - 행 MM = 인원 × 투입률 × Σ(월별 투입일수 ÷ 그 달 일수)
 * - 인건비 = Σ 월별 MM × 월단가 (자사: 그 달 적용 중인 직급 표준원가 / 협력사: 등급 기본단가, 행에서 덮어쓰기)
 * - 예비비 = (인건비 + 직접경비) × 예비비율, 총원가 = 인건비 + 직접경비 + 예비비
 * - 적정 사업비 = 총원가 ÷ (1 − 목표 이익률), 최소 사업비 = 총원가 ÷ (1 − 최소 이익률)
 * - 대가산정 예산 = 직접인건비(KOSA 월 평균임금, 없으면 일 평균임금 × 월 근무일) + 제경비 + 기술료 + 직접경비
 */

export interface SimRow {
  type: 'OWN' | 'PARTNER';
  grade: string; // 자사: 직급, 협력사: 등급(초급~특급)
  roleCd: string;
  jobNm?: string | null; // KOSA 직무
  headcount: number;
  startDt: string;
  endDt: string;
  allocRate: number; // %
  monthlyRate?: number | null; // 월단가 직접 입력 (없으면 기준값)
  note?: string | null;
}
export interface SimExpense {
  category: string; // TRAVEL/EQUIP/LICENSE/OUTSOURCE/ETC
  amount: number;
  memo?: string | null;
}
export interface SimInput {
  startDt: string;
  endDt: string;
  reserveRate: number;
  targetRate: number;
  minRate: number;
  proposedAmt?: number | null;
  rows: SimRow[];
  expenses: SimExpense[];
}

/** 계산에 쓰는 기준값 (확정 시 그대로 스냅샷) */
export interface Basis {
  mdPerMm: number;
  legalRate: number;
  overheadRate: number;
  gradeSalaries: Record<string, { applyStartDt: string; monthlySalary: number }[]>; // 적용일 내림차순
  partnerRates: Record<string, number>;
  kosaYear: number | null;
  kosaWages: Record<string, { dailyWage: number; monthlyWage: number | null }>;
  kosaOverheadRate: number | null;
  kosaTechFeeRate: number | null;
}

export async function loadBasis(): Promise<Basis> {
  const [settings, config, grades, partners] = await Promise.all([getSettings(), prisma.costConfig.findMany(), prisma.costGrade.findMany({ orderBy: { applyStartDt: 'desc' } }), prisma.partnerGradeRate.findMany()]);
  const c = (k: string) => config.find((r) => r.key === k)?.value ?? null;
  const kosaYear = c('KOSA_YEAR');
  const kosa = kosaYear ? await prisma.kosaWage.findMany({ where: { year: kosaYear } }) : [];
  const gradeSalaries: Basis['gradeSalaries'] = {};
  for (const g of grades) (gradeSalaries[g.gradeCd] ??= []).push({ applyStartDt: g.applyStartDt, monthlySalary: g.monthlySalary });
  return {
    mdPerMm: Number(settings.MD_PER_MM) || 22,
    legalRate: c('LEGAL_RATE') ?? 0,
    overheadRate: c('OVERHEAD_RATE') ?? 0,
    gradeSalaries,
    partnerRates: Object.fromEntries(partners.map((p) => [p.gradeCd, p.monthlyRate])),
    kosaYear,
    kosaWages: Object.fromEntries(kosa.map((k) => [k.jobNm, { dailyWage: k.dailyWage, monthlyWage: k.monthlyWage }])),
    kosaOverheadRate: c('KOSA_OVERHEAD_RATE'),
    kosaTechFeeRate: c('KOSA_TECH_FEE_RATE'),
  };
}

/** 그 날짜에 적용 중인 직급 월 표준원가 (없으면 null) */
export function standardCost(b: Basis, grade: string, date: string): number | null {
  const s = b.gradeSalaries[grade]?.find((r) => r.applyStartDt <= date) ?? b.gradeSalaries[grade]?.at(-1); // 적용일 이전 투입이면 가장 오래된 값
  return s ? s.monthlySalary * (1 + b.legalRate / 100) * (1 + b.overheadRate / 100) : null;
}

export type Judge = 'GOOD' | 'COND' | 'BAD';
export const judgeOf = (margin: number, target: number, min: number): Judge => (margin >= target ? 'GOOD' : margin >= min ? 'COND' : 'BAD');

export interface SimResult {
  months: string[];
  rows: { mm: number; cost: number; unit: number | null; kosaUnit: number | null; perMonth: number[] }[];
  monthly: { ym: string; mm: number; labor: number }[];
  totals: {
    mm: number;
    ownMm: number;
    partnerMm: number;
    ownLabor: number;
    partnerLabor: number;
    labor: number;
    expense: number;
    reserve: number;
    totalCost: number;
    fairPrice: number | null;
    minPrice: number | null;
  };
  kosa: { year: number; direct: number; overhead: number; techFee: number; expense: number; budget: number; headroom: number | null } | null;
  proposed: { amount: number; profit: number; margin: number; judge: Judge } | null;
  sensitivity: { pct: number; totalCost: number; margin: number | null }[];
  warnings: string[];
}

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function calculate(input: SimInput, b: Basis): SimResult {
  const warnings = new Set<string>();
  const starts = [input.startDt, ...input.rows.map((r) => r.startDt)];
  const ends = [input.endDt, ...input.rows.map((r) => r.endDt)];
  const first = starts.reduce((a, x) => (x < a ? x : a)).slice(0, 7);
  const last = ends.reduce((a, x) => (x > a ? x : a)).slice(0, 7);
  const months: string[] = [];
  for (let m = first; m <= last && months.length < 120; m = addMonths(m, 1)) months.push(m);

  const monthly = months.map((ym) => ({ ym, mm: 0, labor: 0 }));
  let ownLabor = 0;
  let partnerLabor = 0;
  let ownMm = 0;
  let partnerMm = 0;
  let kosaDirect = 0;
  const kosaOn = !!b.kosaYear && Object.keys(b.kosaWages).length > 0;

  const rows = input.rows.map((row, idx) => {
    const label = `${idx + 1}행(${row.grade})`;
    if (row.startDt > row.endDt) warnings.add(`${label}: 종료일이 시작일보다 빠릅니다.`);
    if (row.startDt < input.startDt || row.endDt > input.endDt) warnings.add(`${label}: 사업기간 밖의 투입이 있습니다.`);
    let mmSum = 0;
    let cost = 0;
    let unitShown: number | null = null;
    const perMonth = months.map((ym, i) => {
      const range = monthRange(ym);
      const ov = overlap(row.startDt, row.endDt, range.start, range.end);
      if (!ov) return 0;
      const mm = row.headcount * (row.allocRate / 100) * (daysBetween(ov.start, ov.end).length / daysBetween(range.start, range.end).length);
      let unit: number | null;
      if (row.monthlyRate) unit = row.monthlyRate;
      else if (row.type === 'OWN') unit = standardCost(b, row.grade, ov.start);
      else unit = b.partnerRates[row.grade] ?? null;
      if (unit == null) warnings.add(row.type === 'OWN' ? `직급 '${row.grade}'의 인건비가 원가 기준에 없습니다 (0원으로 계산).` : `협력사 등급 '${row.grade}'의 기본 단가가 없습니다 (0원으로 계산).`);
      unitShown ??= unit;
      const c = mm * (unit ?? 0);
      mmSum += mm;
      cost += c;
      monthly[i].mm += mm;
      monthly[i].labor += c;
      return r2(mm);
    });
    if (row.type === 'OWN') {
      ownLabor += cost;
      ownMm += mmSum;
    } else {
      partnerLabor += cost;
      partnerMm += mmSum;
    }
    // 대가산정 직접인건비
    let kosaUnit: number | null = null;
    if (kosaOn) {
      const w = row.jobNm ? b.kosaWages[row.jobNm] : undefined;
      if (!row.jobNm) warnings.add(`${label}: KOSA 직무가 없어 대가산정에서 빠졌습니다.`);
      else if (!w) warnings.add(`KOSA ${b.kosaYear}년 단가에 '${row.jobNm}' 직무가 없습니다.`);
      if (w) {
        kosaUnit = w.monthlyWage ?? w.dailyWage * b.mdPerMm;
        kosaDirect += mmSum * kosaUnit;
      }
    }
    return { mm: r2(mmSum), cost: r0(cost), unit: unitShown != null ? r0(unitShown) : null, kosaUnit, perMonth };
  });

  const labor = ownLabor + partnerLabor;
  const expense = input.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const costOf = (laborCost: number) => (laborCost + expense) * (1 + input.reserveRate / 100);
  const totalCost = costOf(labor);
  const price = (rate: number) => (rate < 100 ? totalCost / (1 - rate / 100) : null);
  const fairPrice = price(input.targetRate);
  const minPrice = price(input.minRate);

  let kosa: SimResult['kosa'] = null;
  if (kosaOn) {
    if (b.kosaOverheadRate == null || b.kosaTechFeeRate == null) warnings.add('대가산정 제경비율·기술료율이 설정되지 않았습니다.');
    const overhead = kosaDirect * ((b.kosaOverheadRate ?? 0) / 100);
    const techFee = (kosaDirect + overhead) * ((b.kosaTechFeeRate ?? 0) / 100);
    const budget = kosaDirect + overhead + techFee + expense;
    kosa = { year: b.kosaYear!, direct: r0(kosaDirect), overhead: r0(overhead), techFee: r0(techFee), expense: r0(expense), budget: r0(budget), headroom: fairPrice ? r2((budget / fairPrice) * 100) : null };
  } else warnings.add('대가산정 적용 연도·KOSA 단가가 없어 대가산정 비교를 생략했습니다.');

  const proposed =
    input.proposedAmt && input.proposedAmt > 0 && totalCost > 0 // 원가가 없으면 판정하지 않음
      ? (() => {
          const margin = ((input.proposedAmt - totalCost) / input.proposedAmt) * 100;
          return { amount: input.proposedAmt, profit: r0(input.proposedAmt - totalCost), margin: r2(margin), judge: judgeOf(margin, input.targetRate, input.minRate) };
        })()
      : null;
  // 민감도: 인력 투입(인건비)이 늘거나 줄 때 — 제안가가 있으면 제안가, 없으면 적정 사업비 기준 이익률
  const basePrice = proposed?.amount ?? fairPrice;
  const sensitivity = [-10, 0, 10, 20].map((pct) => {
    const c = costOf(labor * (1 + pct / 100));
    return { pct, totalCost: r0(c), margin: basePrice ? r2(((basePrice - c) / basePrice) * 100) : null };
  });
  if (!input.rows.length) warnings.add('인력 투입 행이 없습니다.');

  return {
    months,
    rows,
    monthly: monthly.map((m) => ({ ym: m.ym, mm: r2(m.mm), labor: r0(m.labor) })),
    totals: {
      mm: r2(ownMm + partnerMm),
      ownMm: r2(ownMm),
      partnerMm: r2(partnerMm),
      ownLabor: r0(ownLabor),
      partnerLabor: r0(partnerLabor),
      labor: r0(labor),
      expense: r0(expense),
      reserve: r0(totalCost - labor - expense),
      totalCost: r0(totalCost),
      fairPrice: fairPrice != null ? r0(fairPrice) : null,
      minPrice: minPrice != null ? r0(minPrice) : null,
    },
    kosa,
    proposed,
    sensitivity,
    warnings: [...warnings],
  };
}
