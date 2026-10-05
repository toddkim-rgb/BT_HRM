import { Router } from 'express';
import { me, pmProjectCodes } from '../auth.js';
import { requireMenu } from '../lib/permissions.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { plannedMd } from '../lib/alloc.js';
import { addDays, addMonths, businessDays, isValidWeek, monthRange, shiftWeek, today } from '../lib/dates.js';
import { getSettings, holidaySet, mdPerMm } from '../lib/settings.js';
import { usableEmp } from '../lib/empFilter.js';
import { workforce } from '../lib/workforce.js';
import { lastWeek, weeklyTrend, weeklyUtilization } from '../lib/weeklyUtil.js';
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
    select: { empId: true, prjCd: true, md: true, workDt: true, project: { select: { prjType: true, prjCd: true, prjNm: true } } },
  });
}

// ---- 가동률 (v1.8 재정의): 주 단위, 그 주 배정 인원 ÷ 등록 인원 (lib/weeklyUtil) ----

statsRouter.get('/utilization', requireMenu('utilization'), async (req, res) => {
  const u = me(req);
  const week = String(req.query.week ?? lastWeek());
  if (!isValidWeek(week)) throw new HttpError(400, '주차 형식은 YYYY-Www 입니다.');
  const cur = await weeklyUtilization(week);
  const prev = await weeklyUtilization(shiftWeek(week, -1));
  const wf = new Map((await workforce(today())).rows.map((w) => [w.empId, w]));
  const rows = cur.rows.map((r) => ({ ...r, status: wf.get(r.empId)?.category ?? null, plannedStartDt: wf.get(r.empId)?.plannedStartDt ?? null }));
  const { rows: _r, ...summary } = cur;
  res.json({
    ...summary,
    prevRate: prev.rate,
    diff: cur.rate != null && prev.rate != null ? Math.round((cur.rate - prev.rate) * 10) / 10 : null,
    // 투입인력은 본인 행만, 그 외(PM·경영진·관리자·영업)는 전체
    rows: u.role === 'EMP' ? rows.filter((r) => r.empId === u.empId) : rows,
    trend: await weeklyTrend(week, 12, 4),
  });
});

/** 인력별 최근 12주 투입 여부 */
statsRouter.get('/utilization/:empId/trend', requireMenu('utilization'), async (req, res) => {
  const u = me(req);
  const empId = String(req.params.empId);
  if (u.role === 'EMP' && u.empId !== empId) throw forbidden();
  const end = String(req.query.week ?? lastWeek());
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const w = shiftWeek(end, -i);
    const r = (await weeklyUtilization(w)).rows.find((x) => x.empId === empId);
    out.push({ week: w, assigned: r?.assigned ?? false, projects: r?.projects ?? [], reportedMd: r?.reportedMd ?? 0 });
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

statsRouter.get('/projects', requireMenu(['projectMm', 'dashboard']), async (req, res) => {
  const u = me(req);
  // PM은 담당 프로젝트만, 그 외 권한 보유자는 전체
  const codes = u.role === 'PM' ? await pmProjectCodes(u.empId) : (await prisma.project.findMany({ where: { prjType: { not: 'NP' } }, select: { prjCd: true } })).map((p) => p.prjCd);
  res.json(await projectMm(codes));
});

statsRouter.get('/projects/:prjCd/mm', requireMenu('projectMm'), async (req, res) => {
  const u = me(req);
  const p = await prisma.project.findUnique({ where: { prjCd: String(req.params.prjCd) } });
  if (!p) throw notFound('프로젝트');
  if (u.role === 'PM' && p.pmEmpId !== u.empId) throw forbidden();
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
statsRouter.get('/summary', requireMenu('dashboard'), async (req, res) => {
  // 전사 요약: 대시보드 권한 + 투입인력 역할 제외 (투입인력 대시보드는 본인 정보만)
  if (me(req).role === 'EMP') throw forbidden();
  const t = today();
  // 인원·투입 구분은 전사 One-Page·투입현황·가동률과 같은 기준 (lib/workforce)
  const wf = await workforce(t);
  const lw = lastWeek();
  const util = await weeklyUtilization(lw);
  const prevUtil = await weeklyUtilization(shiftWeek(lw, -1));
  const in30 = addDays(t, 30);
  const releasing = await prisma.assignment.count({ where: { canceled: false, endDt: { gte: t, lte: in30 }, empId: { in: wf.rows.map((r) => r.empId) } } });
  res.json({
    totalHeadcount: wf.summary.total,
    ownHeadcount: wf.summary.own,
    partnerHeadcount: wf.summary.partner,
    assigned: wf.summary.assigned,
    planned: wf.summary.planned,
    plannedNames: wf.rows.filter((r) => r.category === 'PLANNED').map((r) => ({ name: r.name, startDt: r.plannedStartDt })),
    bench: wf.summary.bench,
    overAllocated: wf.summary.overAllocated,
    releasingIn30: releasing,
    util: { week: lw, rate: util.rate, total: util.total, assigned: util.assigned },
    prevUtil: { week: prevUtil.week, rate: prevUtil.rate },
  });
});

/**
 * 프로젝트별 투입인력 현황판 (v1.0 핵심 ①)
 * - projects: 프로젝트 → 투입인력(역할·투입률·기간·해당 월 계획/실적 MD)
 * - people: 인력 → 투입 프로젝트 (다중 투입·과투입·대기)
 * - timeline: 인력 × 월 투입률 (배정 기준)
 */
statsRouter.get('/staffing', requireMenu('staffing'), async (req, res) => {
  const u = me(req);
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

  const wfMap = new Map((await workforce(t)).rows.map((w) => [w.empId, w]));
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
      const w = wfMap.get(empId);
      return {
        empId,
        name: e.name,
        inWorkforce: !!w, // 대상 인원(휴직·투입 대상 아님 제외) — 인원 집계는 이 인력만
        plannedAlloc: w?.planned ?? 0,
        plannedStartDt: w?.plannedStartDt ?? null,
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
            .map((a) => ({ prjCd: a.prjCd, prjNm: a.project.prjNm, pct: bd ? Math.round((plannedMd(a, m.start, m.end, holidays) / bd) * 100) : 0 }))
            .filter((x) => x.pct > 0);
          return { ym, total: items.reduce((s2, x) => s2 + x.pct, 0), items };
        }),
      };
    })
    .sort((a, b) => a.deptCd.localeCompare(b.deptCd) || a.name.localeCompare(b.name));

  res.json({ ym: q.ym, months, projects, people });
});
