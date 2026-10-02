import { Router } from 'express';
import { isManager, me, pmProjectCodes } from '../auth.js';
import { forbidden, notFound, prisma } from '../db.js';
import { plannedMd } from '../lib/alloc.js';
import { addMonths, businessDays, monthRange, today } from '../lib/dates.js';
import { holidaySet, mdPerMm } from '../lib/settings.js';
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
    select: { empId: true, name: true, deptCd: true, gradeCd: true, employType: true, statusCd: true },
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
    return {
      ...e,
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
  const rows = await utilizationFor(ym, empIds);
  const groups = (key: 'deptCd' | 'employType') =>
    Object.entries(
      rows.reduce<Record<string, typeof rows>>((m, r) => {
        (m[r[key]] ??= []).push(r);
        return m;
      }, {}),
    ).map(([k, v]) => ({ key: k, ...summarize(v) }));
  res.json({ ym, summary: summarize(rows), byDept: groups('deptCd'), byEmployType: groups('employType'), rows });
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
