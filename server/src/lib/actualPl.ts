import { prisma } from '../db.js';
import { plannedMd } from './alloc.js';
import { addDays, addMonths, isoWeek, monthRange, shiftWeek, today, weekDays } from './dates.js';
import { holidaySet } from './settings.js';
import { judgeOf, loadBasis, standardCost, type Basis, type Judge, type SimResult } from './simCalc.js';

/**
 * 실적 손익 (수익성 분석 2차) — 실행예산 기준선 대비 실적 원가와 종료 시 예상 이익률
 * - 실적 인건비 = 제출된 주간보고 투입 MD × 1인 일 원가 (자사: 그날 적용 중인 직급 표준원가 ÷ 월 근무일 / 협력사: 계약 월단가 또는 등급 기본단가 ÷ 월 근무일)
 * - 남은 인건비 = 내일부터 배정 계획 MD(영업일 × 배정률) × 1인 일 원가  ※ 프로젝트 투입률과 같은 규칙
 * - 직접경비: 실적 = 경비 입력, 예상 = max(실적, 기준선 경비)
 * - 예상 최종 원가 = 실적 인건비 + 남은 인건비 + 예상 경비
 * - 사업비(매출) = 프로젝트 계약금액, 없으면 기준선 제안가
 * - 예상 이익률 = (사업비 − 예상 최종 원가) ÷ 사업비, 판정은 기준선(없으면 사업구분) 목표·최소 이익률
 */

export interface PlPerson {
  empId: string;
  name: string;
  grade: string;
  partner: boolean;
  roles: string[];
  startDt: string | null;
  endDt: string | null;
  allocRate: number | null; // 배정률 (여러 배정이면 최대)
  planMd: number;
  planToDateMd: number;
  actualToDateMd: number;
  fulfillment: number | null;
  missingWeeks: number;
  unplanned: boolean; // 배정 없이 실적만 있음
  actualMd: number;
  actualCost: number;
  remainingMd: number;
  remainingCost: number;
}
export type PlStatus = 'OK' | 'RESERVE' | 'OVER' | 'NO_BASE';
export interface ProjectPl {
  prjCd: string;
  prjNm: string;
  prjType: string;
  customerNm: string | null;
  statusCd: string;
  startDt: string | null;
  endDt: string | null;
  elapsed: number | null;
  revenue: { amount: number; source: 'CONTRACT' | 'PROPOSED' } | null;
  baseline: { simId: number; version: number; name: string; mm: number; labor: number; expense: number; reserve: number; totalCost: number; targetRate: number; minRate: number; confirmedAt: Date | null } | null;
  actual: { md: number; labor: number; ownLabor: number; partnerLabor: number; expense: number; cost: number };
  remaining: { md: number; labor: number; expense: number };
  forecast: { cost: number; profit: number | null; margin: number | null; judge: Judge | null };
  burn: number | null; // 실적 원가 ÷ 기준선 원가(예비비 제외) %
  variance: number | null; // 예상 최종 원가 − 기준선 총원가 (양수 = 초과)
  status: PlStatus;
  monthly: { ym: string; baseline: number; actual: number; plan: number }[];
  people: PlPerson[];
  /** 인력 투입 지표: 계획(기준선·배정) 대비 실적 */
  staffing: {
    cutoff: string; // 이행률 기준일 (지난주 일요일)
    baselineMm: number | null;
    baselineHeadcount: number | null;
    planMm: number; // 배정 계획 전체
    planHeadcount: number;
    planToDateMm: number; // 기준일까지 배정 계획
    actualToDateMm: number; // 기준일까지 실적
    fulfillment: number | null; // 투입 이행률 = 실적 ÷ 계획 (기준일까지)
    actualMm: number;
    actualHeadcount: number;
    forecastMm: number; // 실적 + 남은 배정
    forecastVsBaseline: number | null; // 예상 MM − 기준선 MM
    ownShare: { baseline: number | null; plan: number | null; actual: number | null }; // 자사 MM 비율 %
    missingWeeks: number; // 배정됐는데 주간보고를 제출하지 않은 인력·주 수 (실적에서 빠짐)
    unplanned: number; // 배정 없이 실적이 있는 인원
  };
  /** 직급(자사)·등급(협력사)별 기준선 vs 배정 계획 vs 예상 MM */
  grades: { partner: boolean; grade: string; baselineMm: number; planMm: number; forecastMm: number }[];
  warnings: string[];
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

export async function projectPl(prjCds?: string[]): Promise<ProjectPl[]> {
  const t = today();
  const tomorrow = addDays(t, 1);
  const [basis, holidays] = await Promise.all([loadBasis(), holidaySet()]);
  const projects = await prisma.project.findMany({
    where: { prjType: { not: 'NP' }, statusCd: { not: 'STOP' }, ...(prjCds ? { prjCd: { in: prjCds } } : {}) },
    select: { prjCd: true, prjNm: true, prjType: true, customerNm: true, statusCd: true, startDt: true, endDt: true, contractAmt: true },
    orderBy: { prjNm: 'asc' },
  });
  const codes = projects.map((p) => p.prjCd);
  const [baselines, margins, ts, asg, expenses, contracts] = await Promise.all([
    prisma.simulation.findMany({ where: { prjCd: { in: codes }, statusCd: 'BASELINE' }, orderBy: { version: 'desc' } }),
    prisma.marginRule.findMany(),
    prisma.timesheet.findMany({ where: { prjCd: { in: codes }, weeklyWork: { statusCd: 'SUBMITTED' } }, select: { prjCd: true, empId: true, workDt: true, md: true } }),
    prisma.assignment.findMany({ where: { prjCd: { in: codes }, canceled: false }, select: { prjCd: true, empId: true, roleCd: true, startDt: true, endDt: true, allocRate: true } }),
    prisma.projectExpense.findMany({ where: { prjCd: { in: codes } } }),
    prisma.partnerContract.findMany({ where: { statusCd: { not: 'ENDED' } }, select: { empId: true, prjCd: true, startDt: true, endDt: true, monthlyRate: true } }),
  ]);
  const empIds = [...new Set([...ts.map((x) => x.empId), ...asg.map((a) => a.empId)])];
  const [empRows, submittedRows] = await Promise.all([
    prisma.employee.findMany({ where: { empId: { in: empIds } }, select: { empId: true, name: true, gradeCd: true, employType: true, skillLevel: true } }),
    prisma.weeklyWork.findMany({ where: { empId: { in: empIds }, statusCd: 'SUBMITTED' }, select: { empId: true, reportWeek: true } }),
  ]);
  const emps = new Map(empRows.map((e) => [e.empId, e]));
  const submitted = new Set(submittedRows.map((w) => `${w.empId}|${w.reportWeek}`));
  const cutoff = weekDays(shiftWeek(isoWeek(t), -1))[6]; // 지난주 일요일 — 이행률은 지난주까지로 비교

  return projects.map((p) => {
    const warnings = new Set<string>();
    /** 그날 1인 일 원가 */
    const daily = (empId: string, date: string): number => {
      const e = emps.get(empId);
      if (!e) return 0;
      let monthly: number | null;
      if (e.employType === 'PARTNER') {
        const c = contracts.find((k) => k.empId === empId && k.startDt <= date && k.endDt >= date && (!k.prjCd || k.prjCd === p.prjCd));
        monthly = c?.monthlyRate ?? basis.partnerRates[e.skillLevel] ?? null;
        if (monthly == null) warnings.add(`협력사 ${e.name}(${e.skillLevel || '등급 없음'})의 단가가 없습니다 (0원으로 계산).`);
      } else {
        monthly = standardCost(basis, e.gradeCd, date);
        if (monthly == null) warnings.add(`직급 '${e.gradeCd}'(${e.name})의 인건비가 원가 기준에 없습니다 (0원으로 계산).`);
      }
      return (monthly ?? 0) / basis.mdPerMm;
    };

    const bl = baselines.find((b) => b.prjCd === p.prjCd);
    const blResult: SimResult | null = bl?.snapshot ? JSON.parse(bl.snapshot).result : null;
    const rule = margins.find((m) => m.prjType === p.prjType);
    const targetRate = bl?.targetRate ?? rule?.targetRate ?? null;
    const minRate = bl?.minRate ?? rule?.minRate ?? null;

    // 월 구간: 프로젝트 기간 + 기준선 + 실적이 있는 달
    const pts = ts.filter((x) => x.prjCd === p.prjCd);
    const pas = asg.filter((a) => a.prjCd === p.prjCd);
    const pex = expenses.filter((x) => x.prjCd === p.prjCd);
    const yms = [p.startDt, p.endDt, ...pts.map((x) => x.workDt), ...pas.flatMap((a) => [a.startDt, a.endDt]), ...pex.map((x) => `${x.expenseYm}-01`), ...(blResult?.months.map((m) => `${m}-01`) ?? [])]
      .filter((x): x is string => !!x)
      .map((x) => x.slice(0, 7));
    const months: string[] = [];
    if (yms.length) {
      const first = yms.reduce((a, x) => (x < a ? x : a));
      const last = yms.reduce((a, x) => (x > a ? x : a));
      for (let m = first; m <= last && months.length < 120; m = addMonths(m, 1)) months.push(m);
    }
    const monthly = months.map((ym) => ({ ym, baseline: 0, actual: 0, plan: 0 }));
    const mIdx = new Map(months.map((m, i) => [m, i]));
    for (const m of blResult?.monthly ?? []) {
      const i = mIdx.get(m.ym);
      if (i != null) monthly[i].baseline += m.labor;
    }
    if (blResult) {
      // 기준선 경비·예비비는 기간에 고르게 (월별 비교용)
      const extra = blResult.totals.expense + blResult.totals.reserve;
      const blMonths = blResult.monthly.filter((m) => mIdx.has(m.ym));
      for (const m of blMonths) monthly[mIdx.get(m.ym)!].baseline += extra / blMonths.length;
    }

    // 실적 인건비
    const people = new Map<string, { actualMd: number; actualCost: number; remainingMd: number; remainingCost: number }>();
    const person = (id: string) => people.get(id) ?? (people.set(id, { actualMd: 0, actualCost: 0, remainingMd: 0, remainingCost: 0 }), people.get(id)!);
    let ownLabor = 0;
    let partnerLabor = 0;
    let actualMd = 0;
    for (const x of pts) {
      const c = x.md * daily(x.empId, x.workDt);
      actualMd += x.md;
      if (emps.get(x.empId)?.employType === 'PARTNER') partnerLabor += c;
      else ownLabor += c;
      const pp = person(x.empId);
      pp.actualMd += x.md;
      pp.actualCost += c;
      const i = mIdx.get(x.workDt.slice(0, 7));
      if (i != null) monthly[i].actual += c;
    }
    // 남은 인건비 (내일부터 배정 계획, 월 단위로 단가 적용)
    let remMd = 0;
    let remLabor = 0;
    for (const a of pas) {
      if (a.endDt < tomorrow) continue;
      for (let m = (a.startDt > tomorrow ? a.startDt : tomorrow).slice(0, 7); m <= a.endDt.slice(0, 7); m = addMonths(m, 1)) {
        const r = monthRange(m);
        const from = r.start > tomorrow ? r.start : tomorrow;
        const md = plannedMd(a, from, r.end, holidays);
        if (!md) continue;
        const c = md * daily(a.empId, from > a.startDt ? from : a.startDt);
        remMd += md;
        remLabor += c;
        const pp = person(a.empId);
        pp.remainingMd += md;
        pp.remainingCost += c;
        const i = mIdx.get(m);
        if (i != null) monthly[i].plan += c;
      }
    }
    // 인력 투입 지표: 배정 계획(전체·기준일까지) vs 실적, 주간보고 미제출 주
    type PlanAcc = { planMd: number; planToDateMd: number; actualToDateMd: number; roles: Set<string>; startDt: string | null; endDt: string | null; allocRate: number; missing: Set<string> };
    const plan = new Map<string, PlanAcc>();
    const planOf = (id: string) => plan.get(id) ?? (plan.set(id, { planMd: 0, planToDateMd: 0, actualToDateMd: 0, roles: new Set(), startDt: null, endDt: null, allocRate: 0, missing: new Set() }), plan.get(id)!);
    for (const a of pas) {
      const v = planOf(a.empId);
      person(a.empId);
      v.planMd += plannedMd(a, a.startDt, a.endDt, holidays);
      v.roles.add(a.roleCd);
      v.startDt = !v.startDt || a.startDt < v.startDt ? a.startDt : v.startDt;
      v.endDt = !v.endDt || a.endDt > v.endDt ? a.endDt : v.endDt;
      v.allocRate = Math.max(v.allocRate, a.allocRate);
      if (a.startDt > cutoff) continue;
      const until = a.endDt < cutoff ? a.endDt : cutoff;
      v.planToDateMd += plannedMd(a, a.startDt, until, holidays);
      for (let w = isoWeek(a.startDt); w <= isoWeek(until); w = shiftWeek(w, 1)) {
        const days = weekDays(w);
        if (plannedMd(a, days[0], days[6], holidays) > 0 && !submitted.has(`${a.empId}|${w}`)) v.missing.add(w);
      }
    }
    for (const x of pts) if (x.workDt <= cutoff) planOf(x.empId).actualToDateMd += x.md;

    // 경비
    const actualExpense = pex.reduce((s, x) => s + x.amount, 0);
    for (const x of pex) {
      const i = mIdx.get(x.expenseYm);
      if (i != null) monthly[i].actual += x.amount;
    }
    const blExpense = blResult?.totals.expense ?? 0;
    const remExpense = Math.max(0, blExpense - actualExpense);

    const labor = ownLabor + partnerLabor;
    const actualCost = labor + actualExpense;
    const fcCost = labor + remLabor + actualExpense + remExpense;
    const revenue = p.contractAmt ? { amount: p.contractAmt, source: 'CONTRACT' as const } : bl?.proposedAmt ? { amount: bl.proposedAmt, source: 'PROPOSED' as const } : null;
    const margin = revenue ? ((revenue.amount - fcCost) / revenue.amount) * 100 : null;
    const blDirect = blResult ? blResult.totals.labor + blResult.totals.expense : null;
    let status: PlStatus = 'NO_BASE';
    if (blResult) status = fcCost > blResult.totals.totalCost ? 'OVER' : blDirect != null && fcCost > blDirect ? 'RESERVE' : 'OK';
    if (!revenue) warnings.add('계약금액(또는 기준선 제안가)이 없어 이익률을 계산하지 않았습니다.');
    if (!bl) warnings.add('실행예산 기준선이 없어 계획 대비 비교를 하지 않았습니다.');

    const mm = (md: number) => md / basis.mdPerMm;
    const isPartner = (id: string) => emps.get(id)?.employType === 'PARTNER';
    const gradeOf = (id: string) => (isPartner(id) ? emps.get(id)?.skillLevel : emps.get(id)?.gradeCd) || '-';
    const sumPlan = (f: (v: PlanAcc) => number, only?: (id: string) => boolean) => [...plan.entries()].filter(([id]) => !only || only(id)).reduce((acc, [, v]) => acc + f(v), 0);
    const planMdAll = sumPlan((v) => v.planMd);
    const planToDate = sumPlan((v) => v.planToDateMd);
    const actualToDate = sumPlan((v) => v.actualToDateMd);
    const blInput: { type: string; grade: string; headcount: number }[] = bl ? JSON.parse(bl.rows) : [];
    const blMm = blResult?.totals.mm ?? null;
    const ownPct = (own: number, all: number) => (all > 0 ? r1((own / all) * 100) : null);
    const staffing = {
      cutoff,
      baselineMm: blMm,
      baselineHeadcount: bl ? r1(blInput.reduce((acc, x) => acc + x.headcount, 0)) : null,
      planMm: r1(mm(planMdAll)),
      planHeadcount: [...plan.values()].filter((v) => v.roles.size > 0).length,
      planToDateMm: r1(mm(planToDate)),
      actualToDateMm: r1(mm(actualToDate)),
      fulfillment: planToDate > 0 ? r1((actualToDate / planToDate) * 100) : null,
      actualMm: r1(mm(actualMd)),
      actualHeadcount: new Set(pts.filter((x) => x.md > 0).map((x) => x.empId)).size,
      forecastMm: r1(mm(actualMd + remMd)),
      forecastVsBaseline: blMm != null ? r1(mm(actualMd + remMd) - blMm) : null,
      ownShare: {
        baseline: blResult ? ownPct(blResult.totals.ownMm, blResult.totals.mm) : null,
        plan: ownPct(sumPlan((v) => v.planMd, (id) => !isPartner(id)), planMdAll),
        actual: ownPct(pts.filter((x) => !isPartner(x.empId)).reduce((acc, x) => acc + x.md, 0), actualMd),
      },
      missingWeeks: [...plan.values()].reduce((acc, v) => acc + v.missing.size, 0),
      unplanned: [...plan.entries()].filter(([id, v]) => v.roles.size === 0 && (people.get(id)?.actualMd ?? 0) > 0).length,
    };
    if (staffing.missingWeeks > 0) warnings.add(`배정됐지만 주간보고를 제출하지 않은 주가 ${staffing.missingWeeks}건 있어 실적에서 빠져 있습니다 (지난주까지).`);
    if (staffing.unplanned > 0) warnings.add(`배정 없이 실적이 있는 인력이 ${staffing.unplanned}명 있습니다 (배정 외 투입).`);
    // 직급·등급별 MM
    const gmap = new Map<string, { partner: boolean; grade: string; baselineMm: number; planMm: number; forecastMm: number }>();
    const gOf = (partner: boolean, grade: string) => {
      const k = `${partner ? 'P' : 'O'}|${grade}`;
      return gmap.get(k) ?? (gmap.set(k, { partner, grade, baselineMm: 0, planMm: 0, forecastMm: 0 }), gmap.get(k)!);
    };
    blInput.forEach((row, i) => (gOf(row.type === 'PARTNER', row.grade).baselineMm += blResult?.rows[i]?.mm ?? 0));
    for (const [id, v] of plan) gOf(isPartner(id), gradeOf(id)).planMm += mm(v.planMd);
    for (const [id, v] of people) gOf(isPartner(id), gradeOf(id)).forecastMm += mm(v.actualMd + v.remainingMd);
    const grades = [...gmap.values()]
      .map((x) => ({ ...x, baselineMm: r1(x.baselineMm), planMm: r1(x.planMm), forecastMm: r1(x.forecastMm) }))
      .sort((a, b) => Number(a.partner) - Number(b.partner) || b.baselineMm + b.forecastMm - (a.baselineMm + a.forecastMm));

    let elapsed: number | null = null;
    if (p.startDt && p.endDt && p.endDt >= p.startDt) elapsed = r1(Math.min(100, Math.max(0, ((dayNo(t) - dayNo(p.startDt) + 1) / (dayNo(p.endDt) - dayNo(p.startDt) + 1)) * 100)));

    return {
      prjCd: p.prjCd,
      prjNm: p.prjNm,
      prjType: p.prjType,
      customerNm: p.customerNm,
      statusCd: p.statusCd,
      startDt: p.startDt,
      endDt: p.endDt,
      elapsed,
      revenue,
      baseline:
        bl && blResult
          ? { simId: bl.simId, version: bl.version ?? 0, name: bl.name, mm: blResult.totals.mm, labor: blResult.totals.labor, expense: blResult.totals.expense, reserve: blResult.totals.reserve, totalCost: blResult.totals.totalCost, targetRate: bl.targetRate, minRate: bl.minRate, confirmedAt: bl.confirmedAt }
          : null,
      actual: { md: r1(actualMd), labor: r0(labor), ownLabor: r0(ownLabor), partnerLabor: r0(partnerLabor), expense: r0(actualExpense), cost: r0(actualCost) },
      remaining: { md: r1(remMd), labor: r0(remLabor), expense: r0(remExpense) },
      forecast: {
        cost: r0(fcCost),
        profit: revenue ? r0(revenue.amount - fcCost) : null,
        margin: margin != null ? r1(margin) : null,
        judge: margin != null && targetRate != null && minRate != null ? judgeOf(margin, targetRate, minRate) : null,
      },
      burn: blDirect ? r1((actualCost / blDirect) * 100) : null,
      variance: blResult ? r0(fcCost - blResult.totals.totalCost) : null,
      status,
      monthly: monthly.map((m) => ({ ym: m.ym, baseline: r0(m.baseline), actual: r0(m.actual), plan: r0(m.plan) })),
      people: [...people.entries()]
        .map(([empId, v]): PlPerson => {
          const e = emps.get(empId);
          const partner = e?.employType === 'PARTNER';
          const pl = plan.get(empId);
          return {
            empId,
            name: e?.name ?? empId,
            grade: (partner ? e?.skillLevel : e?.gradeCd) ?? '',
            partner,
            roles: pl ? [...pl.roles] : [],
            startDt: pl?.startDt ?? null,
            endDt: pl?.endDt ?? null,
            allocRate: pl?.allocRate || null,
            planMd: r1(pl?.planMd ?? 0),
            planToDateMd: r1(pl?.planToDateMd ?? 0),
            actualToDateMd: r1(pl?.actualToDateMd ?? 0),
            fulfillment: pl && pl.planToDateMd > 0 ? r1((pl.actualToDateMd / pl.planToDateMd) * 100) : null,
            missingWeeks: pl?.missing.size ?? 0,
            unplanned: !pl || pl.roles.size === 0,
            actualMd: r1(v.actualMd),
            actualCost: r0(v.actualCost),
            remainingMd: r1(v.remainingMd),
            remainingCost: r0(v.remainingCost),
          };
        })
        .sort((a, b) => Number(a.unplanned) - Number(b.unplanned) || b.actualCost + b.remainingCost - (a.actualCost + a.remainingCost)),
      staffing,
      grades,
      warnings: [...warnings],
    };
  });
}

