import { Router } from 'express';
import { z } from 'zod';
import { type AuthUser, isManager, me, pmProjectCodes } from '../auth.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { businessDays, isValidWeek, shiftWeek, today, weekDays } from '../lib/dates.js';
import { holidaySet } from '../lib/settings.js';
import { dateStr, optStr, parse } from '../lib/validate.js';

// 10장 주간 업무보고 (F-002, F-003, F-005, F-011)
export const weeklyWorksRouter = Router();

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

const saveSchema = z.object({
  remark: optStr,
  timesheet: z.array(z.object({ prjCd: z.string().min(1), md: z.record(z.string(), z.number().nullable()) })),
  actualItems: z.array(itemSchema),
  planItems: z.array(itemSchema),
  issues: z.array(issueSchema),
});

type ItemInput = z.infer<typeof itemSchema>;

/** 실적 상태 자동 판정: 100% = 완료, 목표 미달 = 지연, 그 외 정상 (10.3) */
function judgeStatus(it: ItemInput, isSm: boolean): string | null {
  if (isSm) return null;
  if (it.progressAfter === 100) return 'DONE';
  if (it.targetProgress != null && it.progressAfter != null && it.progressAfter < it.targetProgress) return 'DELAY';
  return 'NORMAL';
}

/** 보고서 승인권자 = 보고서에 포함된 프로젝트의 PM들 (+관리자) */
async function approversOf(wwId: number): Promise<Set<string>> {
  const [ts, wi] = await Promise.all([
    prisma.timesheet.findMany({ where: { wwId }, select: { project: { select: { pmEmpId: true } } } }),
    prisma.workItem.findMany({ where: { wwId }, select: { project: { select: { pmEmpId: true } } } }),
  ]);
  return new Set([...ts, ...wi].map((r) => r.project.pmEmpId).filter((x): x is string => !!x));
}

/** 조회 권한: 본인 / 경영진·관리자 / 해당 주 담당 프로젝트에 배정·입력된 인력의 PM */
async function assertCanView(u: AuthUser, empId: string, week: string) {
  if (u.empId === empId || isManager(u)) return;
  if (u.role !== 'PM') throw forbidden();
  const mine = await pmProjectCodes(u.empId);
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

async function buildView(empId: string, week: string) {
  const days = weekDays(week);
  const holidays = await holidaySet();
  const bdays = businessDays(days[0], days[6], holidays);
  const ww = await prisma.weeklyWork.findUnique({
    where: { empId_reportWeek: { empId, reportWeek: week } },
    include: { timesheets: true, workItems: { orderBy: { seq: 'asc' } }, issues: true },
  });
  const assigned = await prisma.assignment.findMany({
    where: { empId, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    select: { prjCd: true, allocRate: true, roleCd: true },
  });

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
  // 배정된 프로젝트(해당 주 배정기간 내) 행 자동 생성
  for (const a of assigned) if (!tsRows.some((r) => r.prjCd === a.prjCd)) tsRows.push({ prjCd: a.prjCd, md: {} });

  const codes = [...new Set([...tsRows.map((r) => r.prjCd), ...assigned.map((a) => a.prjCd)])];
  const pm = await projectMap(codes);
  const emp = await prisma.employee.findUnique({ where: { empId }, select: { empId: true, name: true, gradeCd: true, skillLevel: true, jobCd: true } });
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
    approvedBy: ww?.approvedBy ?? null,
    approvedAt: ww?.approvedAt ?? null,
    rejectReason: ww?.rejectReason ?? null,
    timesheet: tsRows.map((r) => ({ ...r, prjNm: pm.get(r.prjCd)?.prjNm, prjType: pm.get(r.prjCd)?.prjType })),
    assigned,
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

// 임시저장
weeklyWorksRouter.put('/:empId/:week', async (req, res) => {
  const u = me(req);
  const { empId, week } = req.params;
  checkWeek(week);
  if (u.empId !== empId) throw forbidden();
  const body = parse(saveSchema, req.body);
  const days = weekDays(week);

  const cur = await prisma.weeklyWork.findUnique({ where: { empId_reportWeek: { empId, reportWeek: week } } });
  if (cur?.statusCd === 'APPROVED') throw new HttpError(409, '승인된 보고서는 수정할 수 없습니다. PM에게 반려를 요청하세요.');

  // 프로젝트 존재 확인
  const codes = [...new Set([...body.timesheet.map((t) => t.prjCd), ...body.actualItems.map((i) => i.prjCd), ...body.planItems.map((i) => i.prjCd), ...body.issues.map((i) => i.prjCd)])];
  const pm = await projectMap(codes);
  for (const c of codes) if (!pm.has(c)) throw new HttpError(400, `존재하지 않는 프로젝트 코드: ${c}`);

  // 투입시간: 0.5 단위, 1일 합계 ≤ 1.0 (10.3)
  const daySum: Record<string, number> = {};
  const tsData: { prjCd: string; workDt: string; md: number }[] = [];
  for (const row of body.timesheet) {
    for (const [dt, md] of Object.entries(row.md)) {
      if (md == null || md === 0) continue;
      if (!days.includes(dt)) throw new HttpError(400, `해당 주차가 아닌 날짜입니다: ${dt}`);
      if (md < 0 || md > 1 || Math.round(md * 2) !== md * 2) throw new HttpError(400, `투입 MD는 0.5 단위(0~1)로 입력하세요: ${row.prjCd} ${dt}`);
      daySum[dt] = (daySum[dt] ?? 0) + md;
      tsData.push({ prjCd: row.prjCd, workDt: dt, md });
    }
  }
  const overDays = Object.entries(daySum).filter(([, s]) => s > 1);
  if (overDays.length) throw new HttpError(400, `1일 투입 합계는 1.0MD를 넘을 수 없습니다: ${overDays.map(([d]) => d).join(', ')}`);
  const dup = new Set<string>();
  for (const t of tsData) {
    const k = `${t.prjCd}|${t.workDt}`;
    if (dup.has(k)) throw new HttpError(400, `같은 프로젝트·날짜가 중복 입력되었습니다: ${t.prjCd} ${t.workDt}`);
    dup.add(k);
  }

  // SI 마일스톤은 해당 프로젝트의 것이어야 함
  const msIds = [...body.actualItems, ...body.planItems].map((i) => i.msId).filter((x): x is number => x != null);
  if (msIds.length) {
    const ms = await prisma.milestone.findMany({ where: { msId: { in: msIds } }, select: { msId: true, prjCd: true } });
    for (const it of [...body.actualItems, ...body.planItems]) {
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

  const wwId = await prisma.$transaction(async (tx) => {
    const ww = cur
      ? await tx.weeklyWork.update({
          where: { wwId: cur.wwId },
          // 제출 후 수정하면 다시 제출해야 함 (승인 전 자유 수정, 10.7)
          data: { remark: body.remark, statusCd: cur.statusCd === 'REJECTED' ? 'REJECTED' : 'DRAFT', submittedAt: null },
        })
      : await tx.weeklyWork.create({ data: { empId, reportWeek: week, remark: body.remark } });
    await tx.timesheet.deleteMany({ where: { wwId: ww.wwId } });
    await tx.workItem.deleteMany({ where: { wwId: ww.wwId } });
    await tx.weeklyIssue.deleteMany({ where: { wwId: ww.wwId } });
    if (tsData.length) await tx.timesheet.createMany({ data: tsData.map((t) => ({ ...t, wwId: ww.wwId, empId })) });
    const items = [...body.actualItems.map((it, i) => toItem(it, 'ACTUAL', i)), ...body.planItems.map((it, i) => toItem(it, 'PLAN', i))];
    if (items.length) await tx.workItem.createMany({ data: items.map((it) => ({ ...it, wwId: ww.wwId })) });
    if (body.issues.length) await tx.weeklyIssue.createMany({ data: body.issues.map((it) => ({ ...it, actionPlan: it.actionPlan ?? null, wwId: ww.wwId })) });
    return ww.wwId;
  });
  res.json({ ok: true, wwId, view: await buildView(empId, week) });
});

/** 제출 전 검증 (10.3): errors = 제출 불가, warnings = 확인 후 제출 */
async function validateForSubmit(wwId: number, week: string) {
  const ww = await prisma.weeklyWork.findUniqueOrThrow({
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

weeklyWorksRouter.post('/:empId/:week/submit', async (req, res) => {
  const u = me(req);
  const { empId, week } = req.params;
  checkWeek(week);
  if (u.empId !== empId) throw forbidden();
  const { confirmWarnings } = parse(z.object({ confirmWarnings: z.boolean().default(false) }), req.body ?? {});
  const ww = await prisma.weeklyWork.findUnique({ where: { empId_reportWeek: { empId, reportWeek: week } } });
  if (!ww) throw new HttpError(400, '먼저 임시저장하세요.');
  if (ww.statusCd === 'APPROVED') throw new HttpError(409, '이미 승인된 보고서입니다.');
  if (ww.statusCd === 'SUBMITTED') throw new HttpError(409, '이미 제출된 보고서입니다.');
  const { errors, warnings } = await validateForSubmit(ww.wwId, week);
  if (errors.length) throw new HttpError(422, errors.join('\n'), { errors, warnings });
  if (warnings.length && !confirmWarnings) throw new HttpError(422, '확인이 필요한 항목이 있습니다.', { errors, warnings, needConfirm: true });

  // 승인할 PM이 없는 보고서(공통코드만 입력)는 자동 승인
  const approvers = await approversOf(ww.wwId);
  const autoApprove = approvers.size === 0;
  await prisma.weeklyWork.update({
    where: { wwId: ww.wwId },
    data: {
      statusCd: autoApprove ? 'APPROVED' : 'SUBMITTED',
      submittedAt: new Date(),
      rejectReason: null,
      ...(autoApprove ? { approvedBy: 'SYSTEM', approvedAt: new Date() } : {}),
    },
  });
  res.json({ ok: true, statusCd: autoApprove ? 'APPROVED' : 'SUBMITTED' });
});

// 승인 대기 목록 (PM: 담당 프로젝트가 포함된 제출 보고서)
weeklyWorksRouter.get('/', async (req, res) => {
  const u = me(req);
  if (!(u.role === 'PM' || isManager(u))) throw forbidden();
  const { status, week } = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = { ...(status ? { statusCd: { in: status.split(',') } } : {}), ...(week ? { reportWeek: week } : {}) };
  if (u.role === 'PM') {
    const mine = await pmProjectCodes(u.empId);
    where.OR = [{ timesheets: { some: { prjCd: { in: mine } } } }, { workItems: { some: { prjCd: { in: mine } } } }];
  }
  const rows = await prisma.weeklyWork.findMany({
    where,
    include: {
      employee: { select: { name: true, gradeCd: true, deptCd: true } },
      timesheets: { select: { prjCd: true, md: true } },
      issues: { select: { severity: true, supportReqYn: true } },
      workItems: { where: { itemType: 'ACTUAL' }, select: { statusCd: true } },
    },
    orderBy: [{ reportWeek: 'desc' }, { submittedAt: 'asc' }],
  });
  res.json(
    rows.map((r) => {
      const byPrj: Record<string, number> = {};
      for (const t of r.timesheets) byPrj[t.prjCd] = (byPrj[t.prjCd] ?? 0) + t.md;
      return {
        wwId: r.wwId,
        empId: r.empId,
        name: r.employee.name,
        gradeCd: r.employee.gradeCd,
        deptCd: r.employee.deptCd,
        reportWeek: r.reportWeek,
        statusCd: r.statusCd,
        submittedAt: r.submittedAt,
        approvedBy: r.approvedBy,
        totalMd: r.timesheets.reduce((s, t) => s + t.md, 0),
        mdByProject: byPrj,
        delayCount: r.workItems.filter((w) => w.statusCd === 'DELAY').length,
        issueCount: r.issues.length,
        highIssueCount: r.issues.filter((i) => i.severity === 'H').length,
        supportReqCount: r.issues.filter((i) => i.supportReqYn).length,
      };
    }),
  );
});

// 승인/반려 (일괄 가능)
weeklyWorksRouter.patch('/approve', async (req, res) => {
  const u = me(req);
  const body = parse(
    z.object({ wwIds: z.array(z.number().int()).min(1), action: z.enum(['APPROVE', 'REJECT']), reason: optStr }).refine((v) => v.action === 'APPROVE' || !!v.reason?.trim(), {
      message: '반려 사유를 입력하세요.',
      path: ['reason'],
    }),
    req.body,
  );
  const results: { wwId: number; ok: boolean; error?: string }[] = [];
  for (const wwId of body.wwIds) {
    const ww = await prisma.weeklyWork.findUnique({ where: { wwId } });
    if (!ww) {
      results.push({ wwId, ok: false, error: '보고서 없음' });
      continue;
    }
    const approvers = await approversOf(wwId);
    if (u.role !== 'ADMIN' && !(u.role === 'PM' && approvers.has(u.empId))) {
      results.push({ wwId, ok: false, error: '승인 권한 없음' });
      continue;
    }
    const canApprove = ww.statusCd === 'SUBMITTED';
    const canReject = ww.statusCd === 'SUBMITTED' || ww.statusCd === 'APPROVED';
    if (body.action === 'APPROVE' ? !canApprove : !canReject) {
      results.push({ wwId, ok: false, error: `처리할 수 없는 상태: ${ww.statusCd}` });
      continue;
    }
    await prisma.weeklyWork.update({
      where: { wwId },
      data:
        body.action === 'APPROVE'
          ? { statusCd: 'APPROVED', approvedBy: u.empId, approvedAt: new Date(), rejectReason: null }
          : { statusCd: 'REJECTED', rejectReason: body.reason, approvedBy: null, approvedAt: null },
    });
    if (body.action === 'APPROVE') await onApproved(wwId);
    results.push({ wwId, ok: true });
  }
  res.json({ results });
});

/** 승인 후처리: 연결 작업 항목 첫 승인 시 마일스톤 자동 진행중 (10.4.3) */
async function onApproved(wwId: number) {
  const items = await prisma.workItem.findMany({ where: { wwId, itemType: 'ACTUAL', msId: { not: null } }, select: { msId: true } });
  const ids = [...new Set(items.map((i) => i.msId!))];
  if (!ids.length) return;
  await prisma.milestone.updateMany({ where: { msId: { in: ids }, statusCd: 'PLANNED' }, data: { statusCd: 'IN_PROGRESS', actualStartDt: today() } });
}

// 프로젝트별 주간 제출 현황 (배정 인력 기준)
weeklyWorksRouter.get('/project/:prjCd/:week/status', async (req, res) => {
  const u = me(req);
  const { prjCd, week } = req.params;
  checkWeek(week);
  const prj = await prisma.project.findUnique({ where: { prjCd } });
  if (!prj) throw notFound('프로젝트');
  if (!isManager(u) && !(u.role === 'PM' && prj.pmEmpId === u.empId)) throw forbidden();
  const days = weekDays(week);
  const asg = await prisma.assignment.findMany({
    where: { prjCd, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    include: { employee: { select: { name: true, gradeCd: true } } },
  });
  const emps = [...new Map(asg.map((a) => [a.empId, a])).values()];
  const wws = await prisma.weeklyWork.findMany({
    where: { reportWeek: week, empId: { in: emps.map((e) => e.empId) } },
    include: { timesheets: { where: { prjCd } } },
  });
  res.json(
    emps.map((a) => {
      const ww = wws.find((w) => w.empId === a.empId);
      return {
        empId: a.empId,
        name: a.employee.name,
        gradeCd: a.employee.gradeCd,
        roleCd: a.roleCd,
        allocRate: a.allocRate,
        wwId: ww?.wwId ?? null,
        statusCd: ww?.statusCd ?? 'NONE',
        projectMd: ww?.timesheets.reduce((s, t) => s + t.md, 0) ?? 0,
      };
    }),
  );
});
