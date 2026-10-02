import { Router } from 'express';
import { isManager, me, pmProjectCodes } from '../auth.js';
import { forbidden, notFound, prisma } from '../db.js';
import { plannedMd } from '../lib/alloc.js';
import { addMonths, businessDays, monthRange, today } from '../lib/dates.js';
import { getSettings, holidaySet, mdPerMm } from '../lib/settings.js';
import { usableEmp } from '../lib/empFilter.js';
import { parse, ymStr } from '../lib/validate.js';
import { z } from 'zod';
import { PAID_TYPES, WORK_TYPES } from './projects.js';

// 5.3 가동률·MM 산식 (F-012, F-020)
export const statsRouter = Router();

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 제출된(=확정) 주간 업무보고의 타임시트만 집계 */
async function submittedTimesheets(start: string, end: string, extra: Record<string, unknown> = {}) {
  return prisma.timesheet.findMany({
    where: { workDt: { gte: start, lte: end }, weeklyWork: { statusCd: 'SUBMITTED' }, ...extra },
    select: { empId: true, prjCd: true, md: true, workDt: true, project: { select: { prjType: true, prjCd: true } } },
  });
}

/** 인력별 월 가동률 */
export async function utilizationFor(ym: string, empIds?: string[]) {
  const month = monthRange(ym);
  return utilizationRange(month.start, month.end, empIds);
}

/** 인력별 기간 가동률 (월·주 공용). 진행 중인 기간은 오늘까지의 영업일만 가용 MD로 계산 */
export async function utilizationRange(start: string, rangeEnd: string, empIds?: string[]) {
  const t = today();
  const end = rangeEnd > t ? t : rangeEnd;
  const holidays = await holidaySet();
  const ts = start <= end ? await submittedTimesheets(start, end, empIds ? { empId: { in: empIds } } : {}) : [];
  // 대상: 퇴사자 제외. 단, 퇴사자도 해당 월 실적이 있으면 포함
  const reported = [...new Set(ts.map((t) => t.empId))];
  const emps = await prisma.employee.findMany({
    where: {
      ...(empIds ? { empId: { in: empIds } } : { utilTarget: true }),
      // 퇴사·삭제 인력은 제외하되, 해당 월 실적이 있으면 포함
      OR: [usableEmp, { empId: { in: reported } }],
    },
    select: { empId: true, name: true, deptCd: true, gradeCd: true, employType: true, statusCd: true, deletedAt: true },
    orderBy: [{ deptCd: 'asc' }, { name: 'asc' }],
  });
  const bd = start <= end ? businessDays(start, end, holidays).length : 0;
  return emps.map((e) => {
    const mine = ts.filter((t) => t.empId === e.empId);
    // 다중 프로젝트 투입: 프로젝트별 투입 MD
    const byPrj = new Map<string, number>();
    for (const t of mine) if (WORK_TYPES.includes(t.project.prjType)) byPrj.set(t.prjCd, (byPrj.get(t.prjCd) ?? 0) + t.md);
    const leave = mine.filter((t) => t.prjCd === 'NP-LV').reduce((s, t) => s + t.md, 0);
    const total = mine.filter((t) => WORK_TYPES.includes(t.project.prjType)).reduce((s, t) => s + t.md, 0);
    const paid = mine.filter((t) => PAID_TYPES.includes(t.project.prjType)).reduce((s, t) => s + t.md, 0);
    const avail = Math.max(0, bd - leave);
    const { deletedAt, ...emp } = e;
    return {
      ...emp,
      inactive: !!deletedAt || e.statusCd === 'RETIRED', // 삭제·퇴사 인력 (해당 기간 실적이 있어 포함됨)
      businessDays: bd,
      leaveMd: leave,
      availMd: avail,
      totalMd: total,
      paidMd: paid,
      reportedMd: mine.reduce((s, t) => s + t.md, 0),
      byProject: [...byPrj].map(([prjCd, md]) => ({ prjCd, md })).sort((a, b) => b.md - a.md),
      util: avail ? round1((total / avail) * 100) : null,
      paidUtil: avail ? round1((paid / avail) * 100) : null,
    };
  });
}

export function summarize(rows: Awaited<ReturnType<typeof utilizationFor>>) {
  const avail = rows.reduce((s, r) => s + r.availMd, 0);
  const total = rows.reduce((s, r) => s + r.totalMd, 0);
  const paid = rows.reduce((s, r) => s + r.paidMd, 0);
  return { headcount: rows.length, availMd: avail, totalMd: total, paidMd: paid, util: avail ? round1((total / avail) * 100) : null, paidUtil: avail ? round1((paid / avail) * 100) : null };
}

statsRouter.get('/utilization', async (req, res) => {
  const u = me(req);
  const { ym } = parse(z.object({ ym: ymStr.default(today().slice(0, 7)) }), req.query);
  let empIds: string[] | undefined;
  if (u.role === 'EMP') empIds = [u.empId];
  else if (u.role === 'PM') {
    const { start, end } = monthRange(ym);
    const asg = await prisma.assignment.findMany({
      where: { prjCd: { in: await pmProjectCodes(u.empId) }, canceled: false, startDt: { lte: end }, endDt: { gte: start } },
      select: { empId: true },
    });
    empIds = [...new Set([u.empId, ...asg.map((a) => a.empId)])];
  }
  const base = await utilizationFor(ym, empIds);

  // 현재 투입률(오늘 기준)과 다음 달 예상 가동률(배정 기준)
  const holidays = await holidaySet();
  const t = today();
  const nextYm = addMonths(ym, 1);
  const next = monthRange(nextYm);
  const nextBd = businessDays(next.start, next.end, holidays).length;
  const asgs = await prisma.assignment.findMany({
    where: { empId: { in: base.map((r) => r.empId) }, canceled: false, endDt: { gte: t < next.start ? t : next.start } },
    select: { empId: true, startDt: true, endDt: true, allocRate: true, project: { select: { prjType: true } } },
  });
  const rows = base.map((r) => {
    const mine = asgs.filter((a) => a.empId === r.empId);
    const nextMd = mine.reduce((s2, a) => s2 + plannedMd(a, next.start, next.end, holidays), 0);
    const nextPaidMd = mine.filter((a) => PAID_TYPES.includes(a.project.prjType)).reduce((s2, a) => s2 + plannedMd(a, next.start, next.end, holidays), 0);
    return {
      ...r,
      currentAlloc: mine.filter((a) => a.startDt <= t && a.endDt >= t).reduce((s2, a) => s2 + a.allocRate, 0),
      nextUtil: nextBd ? round1((nextMd / nextBd) * 100) : null,
      nextPaidUtil: nextBd ? round1((nextPaidMd / nextBd) * 100) : null,
    };
  });
  const lowUtilPct = Number((await getSettings()).LOW_UTIL_PCT) || 70;
  const groups = (key: 'deptCd' | 'employType') =>
    Object.entries(
      rows.reduce<Record<string, typeof rows>>((m, r) => {
        (m[r[key]] ??= []).push(r);
        return m;
      }, {}),
    ).map(([k, v]) => ({ key: k, ...summarize(v) }));
  const nextAvg = rows.length && nextBd ? round1(rows.reduce((s2, r) => s2 + (r.nextUtil ?? 0), 0) / rows.length) : null;
  res.json({ ym, nextYm, lowUtilPct, summary: { ...summarize(rows), nextUtil: nextAvg }, byDept: groups('deptCd'), byEmployType: groups('employType'), rows });
});

/** 인력별 최근 N개월 가동률 추이 */
statsRouter.get('/utilization/:empId/trend', async (req, res) => {
  const u = me(req);
  if (u.role === 'EMP' && u.empId !== String(req.params.empId)) throw forbidden();
  const months = Math.min(12, Number(req.query.months) || 6);
  const cur = today().slice(0, 7);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(cur, -i);
    const [r] = await utilizationFor(ym, [String(req.params.empId)]);
    out.push({ ym, util: r?.util ?? null, paidUtil: r?.paidUtil ?? null, totalMd: r?.totalMd ?? 0 });
  }
  res.json(out);
});

/** 프로젝트 MM 요약 계산 */
async function projectMm(prjCds: string[]) {
  const holidays = await holidaySet();
  const mdmm = await mdPerMm();
  const projects = await prisma.project.findMany({ where: { prjCd: { in: prjCds } }, include: { pm: { select: { name: true } } } });
  const asg = await prisma.assignment.findMany({ where: { prjCd: { in: prjCds }, canceled: false } });
  const ts = await prisma.timesheet.groupBy({
    by: ['prjCd'],
    where: { prjCd: { in: prjCds }, weeklyWork: { statusCd: 'SUBMITTED' } },
    _sum: { md: true },
  });
  const t = today();
  return projects.map((p) => {
    const pa = asg.filter((a) => a.prjCd === p.prjCd);
    const planMd = pa.reduce((s, a) => s + plannedMd(a, a.startDt, a.endDt, holidays), 0);
    const planToDateMd = pa.reduce((s, a) => s + plannedMd(a, a.startDt, a.endDt < t ? a.endDt : t, holidays), 0);
    const actualMd = ts.find((x) => x.prjCd === p.prjCd)?._sum.md ?? 0;
    const actualMm = actualMd / mdmm;
    return {
      prjCd: p.prjCd,
      prjNm: p.prjNm,
      prjType: p.prjType,
      customerNm: p.customerNm,
      statusCd: p.statusCd,
      startDt: p.startDt,
      endDt: p.endDt,
      pmName: p.pm?.name ?? null,
      headcount: new Set(pa.filter((a) => a.startDt <= t && a.endDt >= t).map((a) => a.empId)).size,
      contractMm: p.contractMm,
      planMm: round2(planMd / mdmm),
      planToDateMm: round2(planToDateMd / mdmm),
      actualMm: round2(actualMm),
      burnRate: p.contractMm ? round1((actualMm / p.contractMm) * 100) : null,
    };
  });
}

statsRouter.get('/projects', async (req, res) => {
  const u = me(req);
  let codes: string[];
  if (u.role === 'PM') codes = await pmProjectCodes(u.empId);
  else if (isManager(u) || u.role === 'SALES') codes = (await prisma.project.findMany({ where: { prjType: { not: 'NP' } }, select: { prjCd: true } })).map((p) => p.prjCd);
  else throw forbidden();
  res.json(await projectMm(codes));
});

statsRouter.get('/projects/:prjCd/mm', async (req, res) => {
  const u = me(req);
  const p = await prisma.project.findUnique({ where: { prjCd: String(req.params.prjCd) } });
  if (!p) throw notFound('프로젝트');
  if (!(isManager(u) || u.role === 'SALES' || (u.role === 'PM' && p.pmEmpId === u.empId))) throw forbidden();
  const [summary] = await projectMm([p.prjCd]);
  const holidays = await holidaySet();
  const mdmm = await mdPerMm();
  const asg = await prisma.assignment.findMany({
    where: { prjCd: p.prjCd, canceled: false },
    include: { employee: { select: { name: true, gradeCd: true, skillLevel: true, employType: true } } },
    orderBy: { startDt: 'asc' },
  });
  const ts = await submittedTimesheets('0000-01-01', '9999-12-31', { prjCd: p.prjCd });

  // 월별 계획 vs 실적 MM
  const startYm = (p.startDt ?? asg[0]?.startDt ?? today()).slice(0, 7);
  const endYm = (p.endDt ?? asg.reduce((m, a) => (a.endDt > m ? a.endDt : m), today())).slice(0, 7);
  const monthly = [];
  for (let ym = startYm; ym <= endYm && monthly.length < 60; ym = addMonths(ym, 1)) {
    const { start, end } = monthRange(ym);
    const plan = asg.reduce((s, a) => s + plannedMd(a, start, end, holidays), 0) / mdmm;
    const actual = ts.filter((x) => x.workDt >= start && x.workDt <= end).reduce((s, x) => s + x.md, 0) / mdmm;
    monthly.push({ ym, planMm: round2(plan), actualMm: round2(actual) });
  }
  const members = asg.map((a) => {
    const md = ts.filter((x) => x.empId === a.empId).reduce((s, x) => s + x.md, 0);
    return { ...a, planMm: round2(plannedMd(a, a.startDt, a.endDt, holidays) / mdmm), actualMmByEmp: round2(md / mdmm) };
  });
  res.json({ ...summary, monthly, members });
});

/** 대시보드 요약 (F-020 일부) */
statsRouter.get('/summary', async (req, res) => {
  const u = me(req);
  if (!(isManager(u) || u.role === 'SALES' || u.role === 'PM')) throw forbidden();
  const t = today();
  const emps = await prisma.employee.findMany({ where: { AND: [usableEmp, { utilTarget: true }] }, select: { empId: true, employType: true, statusCd: true } });
  const active = await prisma.assignment.findMany({ where: { canceled: false, startDt: { lte: t }, endDt: { gte: t } }, select: { empId: true, allocRate: true } });
  const allocBy = new Map<string, number>();
  for (const a of active) allocBy.set(a.empId, (allocBy.get(a.empId) ?? 0) + a.allocRate);
  const working = emps.filter((e) => e.statusCd !== 'LEAVE'); // 상태 미지정은 재직으로 간주
  const lastYm = addMonths(t.slice(0, 7), -1);
  const util = summarize(await utilizationFor(t.slice(0, 7)));
  const prevUtil = summarize(await utilizationFor(lastYm));
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const releasing = await prisma.assignment.count({ where: { canceled: false, endDt: { gte: t, lte: in30 } } });
  res.json({
    totalHeadcount: working.length,
    ownHeadcount: working.filter((e) => e.employType === 'REG' || e.employType === 'CONT').length,
    partnerHeadcount: working.filter((e) => e.employType === 'PARTNER' || e.employType === 'FREE').length,
    assigned: working.filter((e) => allocBy.has(e.empId)).length,
    bench: working.filter((e) => !allocBy.has(e.empId)).length,
    overAllocated: [...allocBy.values()].filter((v) => v > 100).length,
    releasingIn30: releasing,
    util,
    prevUtil,
  });
});

/**
 * 프로젝트별 투입인력 현황판 (v1.0 핵심 ①)
 * - projects: 프로젝트 → 투입인력(역할·투입률·기간·해당 월 계획/실적 MD)
 * - people: 인력 → 투입 프로젝트 (다중 투입·과투입·대기)
 * - timeline: 인력 × 월 투입률 (배정 기준)
 */
statsRouter.get('/staffing', async (req, res) => {
  const u = me(req);
  if (u.role === 'EMP') throw forbidden();
  const q = parse(z.object({ ym: ymStr.default(today().slice(0, 7)), months: z.coerce.number().int().min(1).max(12).default(6) }), req.query);
  const { start, end } = monthRange(q.ym);
  const holidays = await holidaySet();
  const mdmm = await mdPerMm();
  const t = today();
  const months = Array.from({ length: q.months }, (_, i) => addMonths(q.ym, i));
  const last = monthRange(months[months.length - 1]);

  // PM은 담당 프로젝트만
  const scope = u.role === 'PM' ? await pmProjectCodes(u.empId) : null;
  const asg = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: last.end }, endDt: { gte: start }, ...(scope ? { prjCd: { in: scope } } : {}) },
    include: {
      employee: { select: { name: true, deptCd: true, gradeCd: true, skillLevel: true, employType: true, deletedAt: true } },
      project: { select: { prjNm: true, prjType: true, statusCd: true, customerNm: true, startDt: true, endDt: true, contractMm: true, pm: { select: { name: true } } } },
    },
    orderBy: [{ allocRate: 'desc' }, { startDt: 'asc' }],
  });
  const ts = await prisma.timesheet.groupBy({
    by: ['empId', 'prjCd'],
    where: { workDt: { gte: start, lte: end }, weeklyWork: { statusCd: 'SUBMITTED' }, ...(scope ? { prjCd: { in: scope } } : {}) },
    _sum: { md: true },
  });
  // 프로젝트별 누적 소요 MD (제출분 전체)
  const cum = await prisma.timesheet.groupBy({ by: ['prjCd'], where: { weeklyWork: { statusCd: 'SUBMITTED' }, ...(scope ? { prjCd: { in: scope } } : {}) }, _sum: { md: true } });
  const actualOf = (empId: string, prjCd: string) => ts.find((x) => x.empId === empId && x.prjCd === prjCd)?._sum.md ?? 0;
  const inMonth = asg.filter((a) => a.startDt <= end && a.endDt >= start);

  // 프로젝트 기준
  const prjCodes = [...new Set(inMonth.map((a) => a.prjCd))];
  const projects = prjCodes
    .map((prjCd) => {
      const list = inMonth.filter((a) => a.prjCd === prjCd);
      const p = list[0].project;
      const members = list.map((a) => ({
        asgId: a.asgId,
        empId: a.empId,
        name: a.employee.name,
        gradeCd: a.employee.gradeCd,
        skillLevel: a.employee.skillLevel,
        employType: a.employee.employType,
        roleCd: a.roleCd,
        allocRate: a.allocRate,
        startDt: a.startDt,
        endDt: a.endDt,
        active: a.startDt <= t && a.endDt >= t,
        planMd: round1(plannedMd(a, start, end, holidays)),
      }));
      const empIds = [...new Set(list.map((a) => a.empId))];
      const planMd = members.reduce((s2, m) => s2 + m.planMd, 0);
      const actualMd = empIds.reduce((s2, id) => s2 + actualOf(id, prjCd), 0);
      return {
        prjCd,
        prjNm: p.prjNm,
        prjType: p.prjType,
        statusCd: p.statusCd,
        customerNm: p.customerNm,
        pmName: p.pm?.name ?? null,
        startDt: p.startDt,
        endDt: p.endDt,
        contractMm: p.contractMm,
        headcount: empIds.length,
        allocTotal: members.reduce((s2, m) => s2 + m.allocRate, 0), // 투입률 합계 (100% = 1명 전일)
        cumMd: cum.find((c) => c.prjCd === prjCd)?._sum.md ?? 0,
        planMd: round1(planMd),
        actualMd,
        planMm: round2(planMd / mdmm),
        actualMm: round2(actualMd / mdmm),
        members: members.map((m) => ({ ...m, actualMd: actualOf(m.empId, prjCd) })),
      };
    })
    .sort((a, b) => b.headcount - a.headcount || a.prjCd.localeCompare(b.prjCd));

  // 진행중인데 해당 월에 배정된 인력이 없는 프로젝트도 카드에 표시 (투입 필요 여부 확인용)
  const idle = await prisma.project.findMany({
    where: { statusCd: 'ACTIVE', prjType: { not: 'NP' }, prjCd: { notIn: prjCodes, ...(scope ? { in: scope } : {}) } },
    include: { pm: { select: { name: true } } },
    orderBy: { prjCd: 'asc' },
  });
  for (const p of idle) {
    projects.push({
      prjCd: p.prjCd,
      prjNm: p.prjNm,
      prjType: p.prjType,
      statusCd: p.statusCd,
      customerNm: p.customerNm,
      pmName: p.pm?.name ?? null,
      startDt: p.startDt,
      endDt: p.endDt,
      contractMm: p.contractMm,
      headcount: 0,
      allocTotal: 0,
      cumMd: cum.find((c) => c.prjCd === p.prjCd)?._sum.md ?? 0,
      planMd: 0,
      actualMd: 0,
      planMm: 0,
      actualMm: 0,
      members: [],
    });
  }

  // 인력 기준 (전사 조회 권한이면 대기 인력도 포함)
  const involved = new Map(asg.map((a) => [a.empId, a.employee]));
  if (!scope) {
    const all = await prisma.employee.findMany({ where: { AND: [usableEmp, { utilTarget: true }] }, select: { empId: true, name: true, deptCd: true, gradeCd: true, skillLevel: true, employType: true, deletedAt: true } });
    for (const e of all) if (!involved.has(e.empId)) involved.set(e.empId, e);
  }
  const people = [...involved]
    .filter(([, e]) => !e.deletedAt)
    .map(([empId, e]) => {
      const mine = inMonth.filter((a) => a.empId === empId);
      const currentAlloc = asg.filter((a) => a.empId === empId && a.startDt <= t && a.endDt >= t).reduce((s2, a) => s2 + a.allocRate, 0);
      return {
        empId,
        name: e.name,
        deptCd: e.deptCd,
        gradeCd: e.gradeCd,
        skillLevel: e.skillLevel,
        employType: e.employType,
        currentAlloc,
        overAlloc: Math.max(0, currentAlloc - 100),
        projectCount: new Set(mine.map((a) => a.prjCd)).size,
        assignments: mine.map((a) => ({ asgId: a.asgId, prjCd: a.prjCd, prjNm: a.project.prjNm, roleCd: a.roleCd, allocRate: a.allocRate, startDt: a.startDt, endDt: a.endDt, planMd: round1(plannedMd(a, start, end, holidays)), actualMd: actualOf(empId, a.prjCd) })),
        // 월별 투입률(%) = Σ(배정 영업일 × 투입률) ÷ 그 달 영업일
        timeline: months.map((ym) => {
          const m = monthRange(ym);
          const bd = businessDays(m.start, m.end, holidays).length;
          const items = asg
            .filter((a) => a.empId === empId && a.startDt <= m.end && a.endDt >= m.start)
            .map((a) => ({ prjCd: a.prjCd, pct: bd ? Math.round((plannedMd(a, m.start, m.end, holidays) / bd) * 100) : 0 }))
            .filter((x) => x.pct > 0);
          return { ym, total: items.reduce((s2, x) => s2 + x.pct, 0), items };
        }),
      };
    })
    .sort((a, b) => a.deptCd.localeCompare(b.deptCd) || a.name.localeCompare(b.name));

  res.json({ ym: q.ym, months, projects, people });
});
