import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { type AuthUser, isPmOf, me, pmProjectCodes, pmScoped, staffOnly } from '../auth.js';
import { assertMenu, requireMenu } from '../lib/permissions.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { businessDays, isValidWeek, isoWeek, shiftWeek, today, weekDays } from '../lib/dates.js';
import { holidaySet } from '../lib/settings.js';
import { dateStr, optStr, parse } from '../lib/validate.js';

// 10장 주간 업무보고 (F-002, F-005, F-011)
// 승인 절차 없음: 제출 = 확정, 제출된 보고서만 가동률·MM에 집계
export const weeklyWorksRouter = Router();

type Tx = Prisma.TransactionClient;

const SM_WORK_TYPES = ['PERIODIC', 'REQUEST', 'INCIDENT', 'IMPROVE', 'ETC'] as const;

const itemSchema = z.object({
  prjCd: z.string().min(1),
  msId: z.number().int().nullish(),
  workNm: z.string().trim().min(1, '작업 항목을 입력하세요'),
  content: optStr,
  progressBefore: z.number().int().min(0).max(100).nullish(),
  progressAfter: z.number().int().min(0).max(100).nullish(),
  targetProgress: z.number().int().min(0).max(100).nullish(),
  dueDt: dateStr.nullish().or(z.literal('').transform(() => null)),
  delayReason: optStr,
  smWorkType: z.enum(SM_WORK_TYPES).nullish(),
  smCount: z.number().int().min(0).nullish(),
});

const issueSchema = z.object({
  prjCd: z.string().min(1),
  issueType: z.enum(['ISSUE', 'RISK', 'REQUEST']),
  severity: z.enum(['H', 'M', 'L']),
  content: z.string().trim().min(1, '이슈 내용을 입력하세요'),
  actionPlan: optStr,
  supportReqYn: z.boolean().default(false),
});

const reportSchema = z.object({
  remark: optStr,
  timesheet: z.array(z.object({ prjCd: z.string().min(1), md: z.record(z.string(), z.number().nullable()) })),
  actualItems: z.array(itemSchema),
  planItems: z.array(itemSchema),
  issues: z.array(issueSchema),
});

type ReportInput = z.infer<typeof reportSchema>;
type ItemInput = z.infer<typeof itemSchema>;

/** 실적 상태 자동 판정: 100% = 완료, 목표 미달 = 지연, 그 외 정상 (10.3) */
function judgeStatus(it: ItemInput, isSm: boolean): string | null {
  if (isSm) return null;
  if (it.progressAfter === 100) return 'DONE';
  if (it.targetProgress != null && it.progressAfter != null && it.progressAfter < it.targetProgress) return 'DELAY';
  return 'NORMAL';
}

/** 조회 권한: 본인 / '제출 현황' 조회 권한자 (PM은 해당 주 담당 프로젝트에 배정·입력된 인력만) */
async function assertCanView(u: AuthUser, empId: string, week: string) {
  if (u.empId === empId) return;
  await assertMenu(u, 'submissions', 'VIEW');
  if (!pmScoped(u)) return;
  const mine = pmProjectCodes(u);
  const days = weekDays(week);
  const hit =
    (await prisma.assignment.count({ where: { empId, prjCd: { in: mine }, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } } })) +
    (await prisma.timesheet.count({ where: { empId, prjCd: { in: mine }, workDt: { gte: days[0], lte: days[6] } } }));
  if (!hit) throw forbidden();
}

/** 전주 '차주 계획' → 금주 실적 이월 (F-005) */
async function carryOver(empId: string, week: string) {
  const prev = await prisma.weeklyWork.findUnique({
    where: { empId_reportWeek: { empId, reportWeek: shiftWeek(week, -1) } },
    include: { workItems: true },
  });
  if (!prev) return [];
  const prevActual = prev.workItems.filter((w) => w.itemType === 'ACTUAL');
  return prev.workItems
    .filter((w) => w.itemType === 'PLAN')
    .map((p) => {
      const before = prevActual.find((a) => a.prjCd === p.prjCd && a.workNm === p.workNm);
      return {
        prjCd: p.prjCd,
        msId: p.msId,
        workNm: p.workNm,
        content: p.content,
        progressBefore: before?.progressAfter ?? 0,
        progressAfter: null,
        targetProgress: p.targetProgress,
        dueDt: p.dueDt,
        delayReason: null,
        smWorkType: p.smWorkType,
        smCount: null,
      };
    });
}

async function projectMap(codes: string[]) {
  const rows = await prisma.project.findMany({ where: { prjCd: { in: codes } }, select: { prjCd: true, prjNm: true, prjType: true } });
  return new Map(rows.map((r) => [r.prjCd, r]));
}

/**
 * 다중 프로젝트 투입: 프로젝트별 해당 주 계획 MD (배정 투입률 기준)
 * days = 영업일별 투입률 합계(%) — 같은 프로젝트 중복 배정은 합산
 */
async function weekPlan(empId: string, week: string, holidays: Set<string>) {
  const days = weekDays(week);
  const bdays = businessDays(days[0], days[6], holidays);
  const asg = await prisma.assignment.findMany({
    where: { empId, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    select: { prjCd: true, allocRate: true, roleCd: true, startDt: true, endDt: true },
    orderBy: { allocRate: 'desc' },
  });
  const plan = new Map<string, { prjCd: string; roles: string[]; days: Record<string, number>; plannedMd: number }>();
  for (const a of asg) {
    if (!plan.has(a.prjCd)) plan.set(a.prjCd, { prjCd: a.prjCd, roles: [], days: {}, plannedMd: 0 });
    const p = plan.get(a.prjCd)!;
    if (!p.roles.includes(a.roleCd)) p.roles.push(a.roleCd);
    for (const d of bdays) {
      if (d < a.startDt || d > a.endDt) continue;
      p.days[d] = (p.days[d] ?? 0) + a.allocRate;
      p.plannedMd += a.allocRate / 100;
    }
  }
  const out = [...plan.values()].map((p) => ({ ...p, plannedMd: Math.round(p.plannedMd * 100) / 100 }));
  const dayAlloc = Object.fromEntries(bdays.map((d) => [d, out.reduce((s, p) => s + (p.days[d] ?? 0), 0)]));
  return { plan: out, dayAlloc };
}

async function buildView(empId: string, week: string) {
  const days = weekDays(week);
  const holidays = await holidaySet();
  const bdays = businessDays(days[0], days[6], holidays);
  const ww = await prisma.weeklyWork.findUnique({
    where: { empId_reportWeek: { empId, reportWeek: week } },
    include: { timesheets: true, workItems: { orderBy: { seq: 'asc' } }, issues: true },
  });
  const { plan, dayAlloc } = await weekPlan(empId, week, holidays);

  let tsRows: { prjCd: string; md: Record<string, number | null> }[];
  let actualItems: unknown[];
  let planItems: unknown[];
  let issues: unknown[];
  if (ww) {
    const byPrj = new Map<string, Record<string, number | null>>();
    for (const t of ww.timesheets) {
      if (!byPrj.has(t.prjCd)) byPrj.set(t.prjCd, {});
      byPrj.get(t.prjCd)![t.workDt] = t.md;
    }
    tsRows = [...byPrj].map(([prjCd, md]) => ({ prjCd, md }));
    actualItems = ww.workItems.filter((w) => w.itemType === 'ACTUAL');
    planItems = ww.workItems.filter((w) => w.itemType === 'PLAN');
    issues = ww.issues;
  } else {
    tsRows = [];
    actualItems = await carryOver(empId, week);
    planItems = [];
    issues = [];
  }
  // 배정된 프로젝트(해당 주 배정기간 내) 행 자동 생성 — 투입률 높은 순
  for (const p of plan) if (!tsRows.some((r) => r.prjCd === p.prjCd)) tsRows.push({ prjCd: p.prjCd, md: {} });

  const pm = await projectMap(tsRows.map((r) => r.prjCd));
  const emp = await prisma.employee.findUnique({ where: { empId }, select: { empId: true, name: true, gradeCd: true, deptCd: true, skillLevel: true, jobCd: true } });
  return {
    week,
    days,
    businessDays: bdays,
    holidays: days.filter((d) => holidays.has(d)),
    employee: emp,
    wwId: ww?.wwId ?? null,
    statusCd: ww?.statusCd ?? 'NEW',
    remark: ww?.remark ?? null,
    submittedAt: ww?.submittedAt ?? null,
    timesheet: tsRows.map((r) => ({ ...r, prjNm: pm.get(r.prjCd)?.prjNm, prjType: pm.get(r.prjCd)?.prjType })),
    plan,
    dayAlloc,
    actualItems,
    planItems,
    issues,
  };
}

function checkWeek(week: string) {
  if (!isValidWeek(week)) throw new HttpError(400, '주차 형식은 YYYY-Www 입니다.');
}

weeklyWorksRouter.get('/:empId/:week', async (req, res) => {
  const u = me(req);
  const { empId, week } = req.params;
  checkWeek(week);
  await assertCanView(u, empId, week);
  res.json(await buildView(empId, week));
});

weeklyWorksRouter.get('/:empId/:week/carryover', async (req, res) => {
  const u = me(req);
  const { empId, week } = req.params;
  checkWeek(week);
  if (u.empId !== empId) throw forbidden();
  res.json(await carryOver(empId, week));
});

/** 입력값 검증 후 보고서를 통째로 저장 (트랜잭션 내) */
async function writeReport(tx: Tx, empId: string, week: string, body: ReportInput, statusCd: 'DRAFT' | 'SUBMITTED') {
  const days = weekDays(week);
  const codes = [...new Set([...body.timesheet.map((t) => t.prjCd), ...body.actualItems.map((i) => i.prjCd), ...body.planItems.map((i) => i.prjCd), ...body.issues.map((i) => i.prjCd)])];
  const prjRows = await tx.project.findMany({ where: { prjCd: { in: codes } }, select: { prjCd: true, prjType: true } });
  const pm = new Map(prjRows.map((r) => [r.prjCd, r]));
  for (const c of codes) if (!pm.has(c)) throw new HttpError(400, `존재하지 않는 프로젝트 코드: ${c}`);

  // 투입시간: 0.5 단위, 1일 합계 ≤ 1.0 (10.3) — 여러 프로젝트에 나눠 입력해도 하루 합계 기준
  const daySum: Record<string, number> = {};
  const tsData: { prjCd: string; workDt: string; md: number }[] = [];
  const seen = new Set<string>();
  for (const row of body.timesheet) {
    for (const [dt, md] of Object.entries(row.md)) {
      if (md == null || md === 0) continue;
      if (!days.includes(dt)) throw new HttpError(400, `해당 주차가 아닌 날짜입니다: ${dt}`);
      if (md < 0 || md > 1 || Math.round(md * 2) !== md * 2) throw new HttpError(400, `투입 MD는 0.5 단위(0~1)로 입력하세요: ${row.prjCd} ${dt}`);
      const k = `${row.prjCd}|${dt}`;
      if (seen.has(k)) throw new HttpError(400, `같은 프로젝트·날짜가 중복 입력되었습니다: ${row.prjCd} ${dt}`);
      seen.add(k);
      daySum[dt] = (daySum[dt] ?? 0) + md;
      tsData.push({ prjCd: row.prjCd, workDt: dt, md });
    }
  }
  const overDays = Object.entries(daySum).filter(([, s]) => s > 1);
  if (overDays.length) throw new HttpError(400, `1일 투입 합계는 1.0MD를 넘을 수 없습니다: ${overDays.map(([d]) => d).join(', ')}`);

  // SI 마일스톤은 해당 프로젝트의 것이어야 함
  const allItems = [...body.actualItems, ...body.planItems];
  const msIds = allItems.map((i) => i.msId).filter((x): x is number => x != null);
  if (msIds.length) {
    const ms = await tx.milestone.findMany({ where: { msId: { in: msIds } }, select: { msId: true, prjCd: true } });
    for (const it of allItems) {
      if (it.msId != null && ms.find((m) => m.msId === it.msId)?.prjCd !== it.prjCd) throw new HttpError(400, `마일스톤이 프로젝트와 맞지 않습니다: ${it.workNm}`);
    }
  }

  const toItem = (it: ItemInput, itemType: 'ACTUAL' | 'PLAN', seq: number) => {
    const isSm = pm.get(it.prjCd)?.prjType === 'SM';
    return {
      prjCd: it.prjCd,
      msId: isSm ? null : it.msId ?? null,
      itemType,
      seq,
      workNm: it.workNm,
      content: it.content ?? null,
      progressBefore: isSm || itemType === 'PLAN' ? null : it.progressBefore ?? 0,
      progressAfter: isSm || itemType === 'PLAN' ? null : it.progressAfter ?? null,
      targetProgress: isSm ? null : it.targetProgress ?? null,
      dueDt: it.dueDt ?? null,
      statusCd: itemType === 'ACTUAL' ? judgeStatus(it, isSm) : null,
      delayReason: it.delayReason ?? null,
      smWorkType: isSm ? it.smWorkType ?? 'ETC' : null,
      smCount: isSm && itemType === 'ACTUAL' ? it.smCount ?? 0 : null,
    };
  };

  const cur = await tx.weeklyWork.findUnique({ where: { empId_reportWeek: { empId, reportWeek: week } } });
  const data = { remark: body.remark, statusCd, submittedAt: statusCd === 'SUBMITTED' ? new Date() : null };
  const ww = cur ? await tx.weeklyWork.update({ where: { wwId: cur.wwId }, data }) : await tx.weeklyWork.create({ data: { ...data, empId, reportWeek: week } });
  await tx.timesheet.deleteMany({ where: { wwId: ww.wwId } });
  await tx.workItem.deleteMany({ where: { wwId: ww.wwId } });
  await tx.weeklyIssue.deleteMany({ where: { wwId: ww.wwId } });
  if (tsData.length) await tx.timesheet.createMany({ data: tsData.map((t) => ({ ...t, wwId: ww.wwId, empId })) });
  const items = [...body.actualItems.map((it, i) => toItem(it, 'ACTUAL', i)), ...body.planItems.map((it, i) => toItem(it, 'PLAN', i))];
  if (items.length) await tx.workItem.createMany({ data: items.map((it) => ({ ...it, wwId: ww.wwId })) });
  if (body.issues.length) await tx.weeklyIssue.createMany({ data: body.issues.map((it) => ({ ...it, actionPlan: it.actionPlan ?? null, wwId: ww.wwId })) });
  return ww.wwId;
}

/** 제출 검증 (10.3): errors = 제출 불가, warnings = 확인 후 제출 */
async function validateForSubmit(tx: Tx, wwId: number, week: string) {
  const ww = await tx.weeklyWork.findUniqueOrThrow({
    where: { wwId },
    include: { timesheets: true, workItems: { include: { project: { select: { prjType: true } } } } },
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const it of ww.workItems) {
    if (it.itemType === 'ACTUAL' && it.statusCd === 'DELAY' && !it.delayReason?.trim()) errors.push(`지연 항목의 사유를 입력하세요: ${it.workNm}`);
    if (it.itemType === 'ACTUAL' && it.project.prjType !== 'SM' && it.progressAfter == null) errors.push(`금주 진척률을 입력하세요: ${it.workNm}`);
  }
  const days = weekDays(week);
  const bdays = businessDays(days[0], days[6], await holidaySet());
  const total = ww.timesheets.reduce((s, t) => s + t.md, 0);
  if (Math.abs(total - bdays.length) > 0.001) warnings.push(`투입 MD 합계(휴가 포함) ${total}MD가 해당 주 영업일 ${bdays.length}일과 다릅니다.`);
  if (!ww.workItems.some((w) => w.itemType === 'PLAN')) warnings.push('차주 계획이 없습니다. (차주 전일 휴가인 경우만 생략 가능)');
  return { errors, warnings };
}

// 임시저장 (제출 전에만)
weeklyWorksRouter.put('/:empId/:week', async (req, res) => {
  const u = me(req);
  const { empId, week } = req.params;
  checkWeek(week);
  if (u.empId !== empId) throw forbidden();
  await assertMenu(u, 'weekly', 'EDIT');
  const body = parse(reportSchema, req.body);
  const cur = await prisma.weeklyWork.findUnique({ where: { empId_reportWeek: { empId, reportWeek: week } } });
  if (cur?.statusCd === 'SUBMITTED') throw new HttpError(409, '제출된 보고서는 임시저장할 수 없습니다. 수정 후 바로 제출하세요.');
  await prisma.$transaction((tx) => writeReport(tx, empId, week, body, 'DRAFT'));
  res.json({ ok: true, view: await buildView(empId, week) });
});

class ValidationAbort extends Error {
  constructor(public result: { errors: string[]; warnings: string[] }) {
    super('validation');
  }
}

// 제출 (= 확정). 제출된 보고서도 언제든 수정 후 다시 제출할 수 있음
weeklyWorksRouter.post('/:empId/:week/submit', async (req, res) => {
  const u = me(req);
  const { empId, week } = req.params;
  checkWeek(week);
  if (u.empId !== empId) throw forbidden();
  await assertMenu(u, 'weekly', 'EDIT');
  const body = parse(reportSchema.extend({ confirmWarnings: z.boolean().default(false) }), req.body);
  try {
    // 저장·검증을 한 트랜잭션으로: 검증에 걸리면 기존(제출된) 내용이 그대로 유지됨
    await prisma.$transaction(async (tx) => {
      const id = await writeReport(tx, empId, week, body, 'SUBMITTED');
      const v = await validateForSubmit(tx, id, week);
      if (v.errors.length || (v.warnings.length && !body.confirmWarnings)) throw new ValidationAbort(v);
    });
  } catch (e) {
    if (!(e instanceof ValidationAbort)) throw e;
    const { errors, warnings } = e.result;
    if (errors.length) throw new HttpError(422, errors.join('\n'), { errors, warnings });
    throw new HttpError(422, '확인이 필요한 항목이 있습니다.', { errors, warnings, needConfirm: true });
  }
  res.json({ ok: true, statusCd: 'SUBMITTED', view: await buildView(empId, week) });
});

// 제출된 보고서 목록 (PM: 담당 프로젝트가 포함된 보고서)
weeklyWorksRouter.get('/', requireMenu('submissions'), async (req, res) => {
  const u = me(req);
  const { status, week, prjCd } = req.query as Record<string, string | undefined>;
  const where: Prisma.WeeklyWorkWhereInput = { statusCd: { in: (status ?? 'SUBMITTED').split(',') }, ...(week ? { reportWeek: week } : {}) };
  let scope: string[] | null = null;
  if (pmScoped(u)) scope = pmProjectCodes(u);
  if (prjCd) scope = scope ? scope.filter((c) => c === prjCd) : [prjCd];
  if (scope) where.OR = [{ timesheets: { some: { prjCd: { in: scope } } } }, { workItems: { some: { prjCd: { in: scope } } } }];
  const rows = await prisma.weeklyWork.findMany({
    where,
    include: {
      employee: { select: { name: true, gradeCd: true, deptCd: true } },
      timesheets: { select: { prjCd: true, md: true, project: { select: { prjNm: true } } } },
      issues: { select: { severity: true, supportReqYn: true, prjCd: true } },
      workItems: { where: { itemType: 'ACTUAL' }, select: { statusCd: true, prjCd: true } },
    },
    orderBy: [{ reportWeek: 'desc' }, { submittedAt: 'desc' }],
    take: 300,
  });
  res.json(
    rows.map((r) => {
      const byPrj: Record<string, number> = {};
      for (const t of r.timesheets) byPrj[t.prjCd] = (byPrj[t.prjCd] ?? 0) + t.md;
      const inScope = <T extends { prjCd: string }>(x: T) => !scope || scope.includes(x.prjCd);
      return {
        wwId: r.wwId,
        empId: r.empId,
        name: r.employee.name,
        gradeCd: r.employee.gradeCd,
        deptCd: r.employee.deptCd,
        reportWeek: r.reportWeek,
        statusCd: r.statusCd,
        submittedAt: r.submittedAt,
        totalMd: r.timesheets.reduce((s, t) => s + t.md, 0),
        mdByProject: byPrj,
        mdProjects: Object.entries(byPrj).map(([prjCd, md]) => ({ prjCd, prjNm: r.timesheets.find((t) => t.prjCd === prjCd)?.project.prjNm ?? prjCd, md })),
        delayCount: r.workItems.filter((w) => w.statusCd === 'DELAY' && inScope(w)).length,
        issueCount: r.issues.filter(inScope).length,
        highIssueCount: r.issues.filter((i) => i.severity === 'H' && inScope(i)).length,
        supportReqCount: r.issues.filter((i) => i.supportReqYn && inScope(i)).length,
      };
    }),
  );
});

/** 프로젝트별 주간 제출 현황 요약 (PM 담당 / 사업관리자·시스템관리자 전체) */
weeklyWorksRouter.get('/project-summary', requireMenu(['submissions', 'dashboard']), async (req, res) => {
  const u = me(req);
  if (staffOnly(u)) throw forbidden();
  const week = String(req.query.week ?? isoWeek(today()));
  checkWeek(week);
  const days = weekDays(week);
  const projects = await prisma.project.findMany({
    where: { prjType: { not: 'NP' }, statusCd: 'ACTIVE', ...(pmScoped(u) ? { prjCd: { in: pmProjectCodes(u) } } : {}) },
    select: { prjCd: true, prjNm: true },
    orderBy: { prjCd: 'asc' },
  });
  const asg = await prisma.assignment.findMany({
    where: { prjCd: { in: projects.map((p) => p.prjCd) }, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    select: { prjCd: true, empId: true, employee: { select: { name: true } } },
  });
  const submitted = new Set(
    (await prisma.weeklyWork.findMany({ where: { reportWeek: week, statusCd: 'SUBMITTED', empId: { in: asg.map((a) => a.empId) } }, select: { empId: true } })).map((w) => w.empId),
  );
  res.json(
    projects.map((p) => {
      const members = [...new Map(asg.filter((a) => a.prjCd === p.prjCd).map((a) => [a.empId, a.employee.name])).entries()];
      return {
        prjCd: p.prjCd,
        prjNm: p.prjNm,
        assigned: members.length,
        submitted: members.filter(([id]) => submitted.has(id)).length,
        missing: members.filter(([id]) => !submitted.has(id)).map(([, name]) => name),
      };
    }),
  );
});

// 프로젝트별 주간 제출 현황 (배정 인력 기준, 다중 투입 인력은 이 프로젝트 MD만)
weeklyWorksRouter.get('/project/:prjCd/:week/status', async (req, res) => {
  const u = me(req);
  const { prjCd, week } = req.params;
  checkWeek(week);
  const prj = await prisma.project.findUnique({ where: { prjCd } });
  if (!prj) throw notFound('프로젝트');
  await assertMenu(u, 'submissions', 'VIEW');
  if (pmScoped(u) && !isPmOf(u, prj.prjCd)) throw forbidden();
  const days = weekDays(week);
  const holidays = await holidaySet();
  const asg = await prisma.assignment.findMany({
    where: { prjCd, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    include: { employee: { select: { name: true, gradeCd: true } } },
  });
  const empIds = [...new Set(asg.map((a) => a.empId))];
  const wws = await prisma.weeklyWork.findMany({
    where: { reportWeek: week, empId: { in: empIds } },
    include: { timesheets: { where: { prjCd } } },
  });
  // 다른 프로젝트 동시 투입 현황
  const others = await prisma.assignment.findMany({
    where: { empId: { in: empIds }, prjCd: { not: prjCd }, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    select: { empId: true, prjCd: true, allocRate: true, project: { select: { prjNm: true } } },
  });
  const bdays = businessDays(days[0], days[6], holidays);
  res.json(
    empIds.map((empId) => {
      const mine = asg.filter((a) => a.empId === empId);
      const ww = wws.find((w) => w.empId === empId);
      const plannedMd = mine.reduce((s, a) => s + bdays.filter((d) => d >= a.startDt && d <= a.endDt).length * (a.allocRate / 100), 0);
      return {
        empId,
        name: mine[0].employee.name,
        gradeCd: mine[0].employee.gradeCd,
        roleCd: mine.map((a) => a.roleCd).join(', '),
        allocRate: mine.reduce((s, a) => s + a.allocRate, 0),
        otherProjects: others.filter((o) => o.empId === empId).map((o) => ({ prjCd: o.prjCd, prjNm: o.project.prjNm, allocRate: o.allocRate })),
        wwId: ww?.wwId ?? null,
        statusCd: ww?.statusCd ?? 'NONE',
        plannedMd: Math.round(plannedMd * 100) / 100,
        projectMd: ww?.timesheets.reduce((s, t) => s + t.md, 0) ?? 0,
      };
    }),
  );
});
