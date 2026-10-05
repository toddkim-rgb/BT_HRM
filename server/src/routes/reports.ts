import { Router } from 'express';
import { z } from 'zod';
import { assertProjectManager, isManager, me, requireRole } from '../auth.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { addDays, businessDays, isValidWeek, shiftWeek, today, weekDays } from '../lib/dates.js';
import { workforce } from '../lib/workforce.js';
import { holidaySet, mdPerMm } from '../lib/settings.js';
import { dateStr, optStr, parse } from '../lib/validate.js';
import { weeklyUtilization } from '../lib/weeklyUtil.js';

// 주간보고 자동화 (명세 10·11장)
// 개인 주간 업무보고(제출분) → 프로젝트 주간보고(자동 취합 + PM 의견) → 전사 One-Page
// 확정 전에는 조회할 때마다 최신 데이터로 계산하고, 확정하면 snapshot으로 고정한다.

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function checkWeek(week: string) {
  if (!isValidWeek(week)) throw new HttpError(400, '주차 형식은 YYYY-Www 입니다.');
}

/** 마일스톤 상태: 완료 / 지연(계획일 경과·미완료) / 예정 */
function msStatus(m: { planDt: string; doneDt: string | null }, at = today()) {
  if (m.doneDt) return 'DONE';
  return m.planDt && m.planDt < at ? 'DELAY' : 'PLANNED';
}

function milestoneSummary(list: { msNm: string; planDt: string; doneDt: string | null }[]) {
  const withStatus = list.map((m) => ({ ...m, status: msStatus(m) }));
  const next = withStatus.filter((m) => m.status !== 'DONE').sort((a, b) => a.planDt.localeCompare(b.planDt))[0] ?? null;
  return {
    msTotal: list.length,
    msDone: withStatus.filter((m) => m.status === 'DONE').length,
    msDelayed: withStatus.filter((m) => m.status === 'DELAY').length,
    progress: list.length ? Math.round((withStatus.filter((m) => m.status === 'DONE').length / list.length) * 100) : null,
    next: next ? { msNm: next.msNm, planDt: next.planDt, status: next.status } : null,
  };
}

// ====================== 프로젝트 주간보고 ======================

async function projectWeeklyData(prjCd: string, week: string) {
  const prj = await prisma.project.findUnique({ where: { prjCd }, include: { pm: { select: { name: true } } } });
  if (!prj || prj.prjType === 'NP') throw notFound('프로젝트');
  const days = weekDays(week);
  const holidays = await holidaySet();
  const bdays = businessDays(days[0], days[6], holidays);
  const mdmm = await mdPerMm();

  const asg = await prisma.assignment.findMany({
    where: { prjCd, canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] } },
    select: { empId: true, roleCd: true, allocRate: true, startDt: true, endDt: true },
  });
  // 배정 없이 이 프로젝트에 MD를 입력한 인력도 포함
  const extra = await prisma.timesheet.findMany({
    where: { prjCd, workDt: { gte: days[0], lte: days[6] }, weeklyWork: { statusCd: 'SUBMITTED' } },
    select: { empId: true },
  });
  const empIds = [...new Set([...asg.map((a) => a.empId), ...extra.map((t) => t.empId)])];
  const emps = await prisma.employee.findMany({ where: { empId: { in: empIds } }, select: { empId: true, name: true, gradeCd: true, employType: true } });
  const wws = await prisma.weeklyWork.findMany({
    where: { reportWeek: week, empId: { in: empIds } },
    include: {
      timesheets: { where: { prjCd } },
      workItems: { where: { prjCd }, orderBy: { seq: 'asc' } },
      issues: { where: { prjCd } },
    },
  });

  const members = emps
    .map((e) => {
      const mine = asg.filter((a) => a.empId === e.empId);
      const ww = wws.find((w) => w.empId === e.empId);
      const submitted = ww?.statusCd === 'SUBMITTED';
      const plannedMd = mine.reduce((s, a) => s + bdays.filter((d) => d >= a.startDt && d <= a.endDt).length * (a.allocRate / 100), 0);
      const items = submitted ? ww!.workItems : [];
      return {
        empId: e.empId,
        name: e.name,
        gradeCd: e.gradeCd,
        employType: e.employType,
        roleCd: [...new Set(mine.map((a) => a.roleCd))].join(', ') || '-',
        allocRate: mine.reduce((s, a) => s + a.allocRate, 0),
        statusCd: ww?.statusCd ?? 'NONE',
        plannedMd: round2(plannedMd),
        md: submitted ? ww!.timesheets.reduce((s, t) => s + t.md, 0) : 0,
        actual: items
          .filter((i) => i.itemType === 'ACTUAL')
          .map((i) => ({ workNm: i.workNm, content: i.content, progressBefore: i.progressBefore, progressAfter: i.progressAfter, targetProgress: i.targetProgress, statusCd: i.statusCd, delayReason: i.delayReason, smWorkType: i.smWorkType, smCount: i.smCount })),
        plan: items.filter((i) => i.itemType === 'PLAN').map((i) => ({ workNm: i.workNm, content: i.content, targetProgress: i.targetProgress, dueDt: i.dueDt, smWorkType: i.smWorkType })),
      };
    })
    .sort((a, b) => b.allocRate - a.allocRate || a.name.localeCompare(b.name));

  const issues = wws
    .filter((w) => w.statusCd === 'SUBMITTED')
    .flatMap((w) => w.issues.map((i) => ({ wisId: i.wisId, author: emps.find((e) => e.empId === w.empId)?.name ?? '', issueType: i.issueType, severity: i.severity, content: i.content, actionPlan: i.actionPlan, supportReqYn: i.supportReqYn, onepageYn: i.onepageYn })))
    .sort((a, b) => 'HML'.indexOf(a.severity) - 'HML'.indexOf(b.severity));

  const cum = await prisma.timesheet.aggregate({ where: { prjCd, workDt: { lte: days[6] }, weeklyWork: { statusCd: 'SUBMITTED' } }, _sum: { md: true } });
  const cumMm = (cum._sum.md ?? 0) / mdmm;
  const milestones = (await prisma.milestone.findMany({ where: { prjCd }, orderBy: [{ planDt: 'asc' }, { seq: 'asc' }] })).map((m) => ({ ...m, status: msStatus(m) }));
  const ms = milestoneSummary(milestones);
  const assigned = members.filter((m) => m.allocRate > 0);

  return {
    week,
    days,
    businessDays: bdays.length,
    project: { prjCd: prj.prjCd, prjNm: prj.prjNm, prjType: prj.prjType, customerNm: prj.customerNm, pmEmpId: prj.pmEmpId, pmName: prj.pm?.name ?? null, startDt: prj.startDt, endDt: prj.endDt, contractMm: prj.contractMm, statusCd: prj.statusCd },
    kpi: {
      headcount: assigned.length,
      submitted: assigned.filter((m) => m.statusCd === 'SUBMITTED').length,
      notSubmitted: assigned.filter((m) => m.statusCd !== 'SUBMITTED').map((m) => m.name),
      weekMd: members.reduce((s, m) => s + m.md, 0),
      plannedMd: round2(members.reduce((s, m) => s + m.plannedMd, 0)),
      cumMm: round2(cumMm),
      burnRate: prj.contractMm ? round1((cumMm / prj.contractMm) * 100) : null,
      delayItems: members.reduce((s, m) => s + m.actual.filter((a) => a.statusCd === 'DELAY').length, 0),
      issueCount: issues.length,
      highIssueCount: issues.filter((i) => i.severity === 'H').length,
      ...ms,
    },
    milestones,
    members,
    issues,
  };
}

async function projectWeeklyView(prjCd: string, week: string) {
  const c = await prisma.weeklyComment.findUnique({ where: { reportWeek_prjCd: { reportWeek: week, prjCd } } });
  const meta = { pmOpinion: c?.pmOpinion ?? null, confirmedYn: c?.confirmedYn ?? false, confirmedBy: c?.confirmedBy ?? null, confirmedAt: c?.confirmedAt ?? null };
  // 확정된 보고는 확정 시점 내용 그대로
  if (c?.confirmedYn && c.snapshot) return { ...(JSON.parse(c.snapshot) as Awaited<ReturnType<typeof projectWeeklyData>>), ...meta };
  return { ...(await projectWeeklyData(prjCd, week)), ...meta };
}

export const projectWeeklyRouter = Router();

async function assertCanViewProject(u: ReturnType<typeof me>, prjCd: string) {
  if (isManager(u)) return;
  const p = await prisma.project.findUnique({ where: { prjCd }, select: { pmEmpId: true } });
  if (!p) throw notFound('프로젝트');
  if (!(u.role === 'PM' && p.pmEmpId === u.empId)) throw forbidden();
}

projectWeeklyRouter.get('/:prjCd/weekly/:week', async (req, res) => {
  const u = me(req);
  const prjCd = String(req.params.prjCd);
  const week = String(req.params.week);
  checkWeek(week);
  await assertCanViewProject(u, prjCd);
  res.json(await projectWeeklyView(prjCd, week));
});

// PM 종합 의견 저장 / 확정(snapshot 고정) / 확정 취소
projectWeeklyRouter.put('/:prjCd/weekly/:week/comment', async (req, res) => {
  const u = me(req);
  const prjCd = String(req.params.prjCd);
  const week = String(req.params.week);
  checkWeek(week);
  await assertProjectManager(u, prjCd);
  const body = parse(z.object({ pmOpinion: optStr, confirm: z.boolean().optional() }), req.body);
  const cur = await prisma.weeklyComment.findUnique({ where: { reportWeek_prjCd: { reportWeek: week, prjCd } } });
  if (cur?.confirmedYn && body.confirm !== false) throw new HttpError(409, '확정된 주간보고입니다. 수정하려면 확정을 취소하세요.');
  const confirm = body.confirm === true;
  const data = {
    pmOpinion: body.pmOpinion ?? cur?.pmOpinion ?? null,
    confirmedYn: confirm,
    confirmedBy: confirm ? u.empId : null,
    confirmedAt: confirm ? new Date() : null,
    snapshot: confirm ? JSON.stringify(await projectWeeklyData(prjCd, week)) : null,
  };
  await prisma.weeklyComment.upsert({ where: { reportWeek_prjCd: { reportWeek: week, prjCd } }, create: { reportWeek: week, prjCd, ...data }, update: data });
  res.json(await projectWeeklyView(prjCd, week));
});

// 이슈의 전사 One-Page 반영 선택 (PM)
projectWeeklyRouter.patch('/:prjCd/weekly/:week/issues/:id/onepage', async (req, res) => {
  const u = me(req);
  const prjCd = String(req.params.prjCd);
  const week = String(req.params.week);
  await assertProjectManager(u, prjCd);
  const body = parse(z.object({ onepageYn: z.boolean() }), req.body);
  const issue = await prisma.weeklyIssue.findUnique({ where: { wisId: Number(req.params.id) }, include: { weeklyWork: { select: { reportWeek: true } } } });
  if (!issue || issue.prjCd !== prjCd || issue.weeklyWork.reportWeek !== week) throw notFound('이슈');
  const c = await prisma.weeklyComment.findUnique({ where: { reportWeek_prjCd: { reportWeek: week, prjCd } } });
  if (c?.confirmedYn) throw new HttpError(409, '확정된 주간보고입니다. 변경하려면 확정을 취소하세요.');
  await prisma.weeklyIssue.update({ where: { wisId: issue.wisId }, data: { onepageYn: body.onepageYn } });
  res.json({ ok: true });
});

// ---- 주요 마일스톤 (PM 입력) ----
const msSchema = z.object({ msNm: z.string().trim().min(1, '마일스톤명을 입력하세요'), planDt: dateStr, doneDt: dateStr.nullish().or(z.literal('').transform(() => null)), note: optStr });

projectWeeklyRouter.get('/:prjCd/milestones', async (req, res) => {
  const list = await prisma.milestone.findMany({ where: { prjCd: String(req.params.prjCd) }, orderBy: [{ planDt: 'asc' }, { seq: 'asc' }] });
  res.json({ milestones: list.map((m) => ({ ...m, status: msStatus(m) })), ...milestoneSummary(list) });
});

projectWeeklyRouter.post('/:prjCd/milestones', async (req, res) => {
  const prjCd = String(req.params.prjCd);
  await assertProjectManager(me(req), prjCd);
  const body = parse(msSchema, req.body);
  const seq = (await prisma.milestone.count({ where: { prjCd } })) + 1;
  const m = await prisma.milestone.create({ data: { prjCd, seq, msNm: body.msNm, planDt: body.planDt, doneDt: body.doneDt ?? null, note: body.note } });
  res.status(201).json(m);
});

projectWeeklyRouter.put('/:prjCd/milestones/:msId', async (req, res) => {
  const prjCd = String(req.params.prjCd);
  await assertProjectManager(me(req), prjCd);
  const body = parse(msSchema, req.body);
  const cur = await prisma.milestone.findUnique({ where: { msId: Number(req.params.msId) } });
  if (!cur || cur.prjCd !== prjCd) throw notFound('마일스톤');
  res.json(await prisma.milestone.update({ where: { msId: cur.msId }, data: { msNm: body.msNm, planDt: body.planDt, doneDt: body.doneDt ?? null, note: body.note } }));
});

projectWeeklyRouter.delete('/:prjCd/milestones/:msId', async (req, res) => {
  const prjCd = String(req.params.prjCd);
  await assertProjectManager(me(req), prjCd);
  const cur = await prisma.milestone.findUnique({ where: { msId: Number(req.params.msId) } });
  if (!cur || cur.prjCd !== prjCd) throw notFound('마일스톤');
  await prisma.workItem.updateMany({ where: { msId: cur.msId }, data: { msId: null } });
  await prisma.milestone.delete({ where: { msId: cur.msId } });
  res.json({ ok: true });
});

// ====================== 전사 주간 One-Page ======================

async function companyWeeklyData(week: string) {
  const days = weekDays(week);
  const [start, end] = [days[0], days[6]];
  const t = today();
  const ref = end > t ? t : end; // 인원·배정 기준일
  const mdmm = await mdPerMm();
  const holidays = await holidaySet();

  // 가동률 (주간 인원 기준: 그 주 배정 인원 ÷ 등록 인원) — 해당 주 / 전주
  const util = await weeklyUtilization(week);
  const prevUtil = await weeklyUtilization(shiftWeek(week, -1));

  // 인원·배정 (대시보드·투입현황·가동률과 같은 기준: lib/workforce)
  const wf = await workforce(ref);
  const working = wf.rows;
  const emps = wf.rows;
  const active = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: ref }, endDt: { gte: ref } },
    select: { empId: true, prjCd: true, allocRate: true, endDt: true, roleCd: true, employee: { select: { name: true } }, project: { select: { prjType: true, prjNm: true } } },
  });
  const allocBy = new Map<string, number>();
  for (const a of active) allocBy.set(a.empId, (allocBy.get(a.empId) ?? 0) + a.allocRate);
  const nameOf = new Map(emps.map((e) => [e.empId, e.name]));

  // 제출 현황
  const submittedIds = new Set((await prisma.weeklyWork.findMany({ where: { reportWeek: week, statusCd: 'SUBMITTED' }, select: { empId: true } })).map((w) => w.empId));
  const notSubmitted = working.filter((e) => !submittedIds.has(e.empId)).map((e) => e.name);

  // 금주·월누계 투입 MD (제출분)
  const monthStart = `${ref.slice(0, 7)}-01`;
  const ts = await prisma.timesheet.findMany({
    where: { workDt: { gte: monthStart < start ? monthStart : start, lte: end }, weeklyWork: { statusCd: 'SUBMITTED' }, project: { prjType: { not: 'NP' } } },
    select: { prjCd: true, md: true, workDt: true, project: { select: { prjType: true } } },
  });
  const inWeek = (d: string) => d >= start && d <= end;
  const inMonth = (d: string) => d >= monthStart && d <= ref;

  const TYPES = [
    ['SM', 'SM'],
    ['SI', 'SI'],
    ['IN', '내부'],
    ['PS', '제안'],
    ['ETC', '기타'],
  ] as const;
  const byType = TYPES.map(([type, label]) => ({
    type,
    label,
    headcount: new Set(active.filter((a) => a.project.prjType === type).map((a) => a.empId)).size,
    weekMd: ts.filter((x) => x.project.prjType === type && inWeek(x.workDt)).reduce((s, x) => s + x.md, 0),
    monthMm: round2(ts.filter((x) => x.project.prjType === type && inMonth(x.workDt)).reduce((s, x) => s + x.md, 0) / mdmm),
  })).filter((r) => r.headcount || r.weekMd || r.monthMm);

  // 프로젝트별 투입인력·MM·마일스톤
  const prjs = await prisma.project.findMany({
    where: { prjType: { not: 'NP' }, statusCd: 'ACTIVE' },
    include: { pm: { select: { name: true } }, milestones: true },
  });
  const cum = await prisma.timesheet.groupBy({ by: ['prjCd'], where: { workDt: { lte: end }, weeklyWork: { statusCd: 'SUBMITTED' } }, _sum: { md: true } });
  const comments = await prisma.weeklyComment.findMany({ where: { reportWeek: week } });
  const weekAsg = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: end }, endDt: { gte: start } },
    select: { empId: true, prjCd: true, allocRate: true, employee: { select: { name: true } } },
  });
  const projects = prjs
    .map((p) => {
      const mem = [...new Map(weekAsg.filter((a) => a.prjCd === p.prjCd).map((a) => [a.empId, a])).values()];
      const cumMm = (cum.find((c) => c.prjCd === p.prjCd)?._sum.md ?? 0) / mdmm;
      const c = comments.find((x) => x.prjCd === p.prjCd);
      return {
        prjCd: p.prjCd,
        prjNm: p.prjNm,
        prjType: p.prjType,
        pmName: p.pm?.name ?? null,
        headcount: mem.length,
        members: mem.map((a) => ({ name: a.employee.name, allocRate: weekAsg.filter((x) => x.prjCd === p.prjCd && x.empId === a.empId).reduce((s, x) => s + x.allocRate, 0) })).sort((a, b) => b.allocRate - a.allocRate),
        submitted: mem.filter((a) => submittedIds.has(a.empId)).length,
        weekMd: ts.filter((x) => x.prjCd === p.prjCd && inWeek(x.workDt)).reduce((s, x) => s + x.md, 0),
        cumMm: round2(cumMm),
        contractMm: p.contractMm,
        burnRate: p.contractMm ? round1((cumMm / p.contractMm) * 100) : null,
        ...milestoneSummary(p.milestones),
        pmOpinion: c?.pmOpinion ?? null,
        confirmedYn: c?.confirmedYn ?? false,
      };
    })
    .filter((p) => p.headcount || p.weekMd)
    .sort((a, b) => b.headcount - a.headcount || b.weekMd - a.weekMd);

  // 주의 사항
  const in30 = addDays(ref, 30);
  const attention = {
    overAllocated: wf.rows.filter((r) => r.current > 100).map((r) => ({ name: r.name, total: r.current })),
    bench: wf.rows.filter((r) => r.category === 'BENCH').map((r) => r.name),
    planned: wf.rows.filter((r) => r.category === 'PLANNED').map((r) => ({ name: r.name, startDt: r.plannedStartDt, alloc: r.planned })),
    notAssigned: util.rows.filter((r) => !r.assigned).map((r) => r.name), // 그 주 배정이 없어 가동률에서 빠진 인원
    releasing: active
      .filter((a) => a.endDt <= in30 && nameOf.has(a.empId))
      .map((a) => ({ name: a.employee.name, prjCd: a.prjCd, prjNm: a.project.prjNm, endDt: a.endDt }))
      .sort((a, b) => a.endDt.localeCompare(b.endDt)),
    notSubmitted,
    delayedMilestones: prjs.flatMap((p) => p.milestones.filter((m) => msStatus(m) === 'DELAY').map((m) => ({ prjCd: p.prjCd, prjNm: p.prjNm, msNm: m.msNm, planDt: m.planDt }))),
    burnOver80: projects.filter((p) => p.burnRate != null && p.burnRate >= 80).map((p) => ({ prjCd: p.prjCd, prjNm: p.prjNm, burnRate: p.burnRate })),
  };

  // 주요 이슈: PM이 'One-Page 반영'으로 선택한 건
  const issues = (
    await prisma.weeklyIssue.findMany({
      where: { onepageYn: true, weeklyWork: { reportWeek: week, statusCd: 'SUBMITTED' } },
      include: { weeklyWork: { select: { employee: { select: { name: true } } } }, project: { select: { prjNm: true } } },
    })
  )
    .map((i) => ({ prjCd: i.prjCd, prjNm: i.project.prjNm, issueType: i.issueType, severity: i.severity, content: i.content, actionPlan: i.actionPlan, author: i.weeklyWork.employee.name }))
    .sort((a, b) => 'HML'.indexOf(a.severity) - 'HML'.indexOf(b.severity));
  const highIssues = await prisma.weeklyIssue.count({ where: { severity: 'H', weeklyWork: { reportWeek: week, statusCd: 'SUBMITTED' } } });

  return {
    week,
    days,
    businessDays: businessDays(start, end, holidays).length,
    refDt: ref,
    kpi: {
      total: wf.summary.total,
      own: wf.summary.own,
      partner: wf.summary.partner,
      assigned: wf.summary.assigned,
      planned: wf.summary.planned,
      bench: wf.summary.bench,
      util: util.rate,
      utilAssigned: util.assigned,
      utilTotal: util.total,
      utilDiff: util.rate != null && prevUtil.rate != null ? round1(util.rate - prevUtil.rate) : null,
      submitted: working.length - notSubmitted.length,
      submitTarget: working.length,
      highIssues,
    },
    byType,
    projects,
    attention,
    issues,
  };
}

export const reportsRouter = Router();
const VIEWERS = ['PM', 'EXEC', 'ADMIN', 'SALES'] as const;

reportsRouter.get('/weekly/:week', requireRole(...VIEWERS), async (req, res) => {
  const week = String(req.params.week);
  checkWeek(week);
  const r = await prisma.weeklyReport.findUnique({ where: { reportWeek: week } });
  const confirmed = r?.statusCd === 'CONFIRMED' && !!r.snapshot;
  const by = r?.confirmedBy ? await prisma.employee.findUnique({ where: { empId: r.confirmedBy }, select: { name: true } }) : null;
  res.json({
    week,
    statusCd: confirmed ? 'CONFIRMED' : 'DRAFT',
    execNote: r?.execNote ?? null,
    nextPlan: r?.nextPlan ?? null,
    confirmedByName: by?.name ?? null,
    confirmedAt: r?.confirmedAt ?? null,
    data: confirmed ? JSON.parse(r!.snapshot!) : await companyWeeklyData(week),
  });
});

const noteSchema = z.object({ execNote: optStr, nextPlan: optStr });

// 사업부장 입력(이슈 종합·차주 계획) 저장
reportsRouter.put('/weekly/:week', requireRole('EXEC', 'ADMIN'), async (req, res) => {
  const week = String(req.params.week);
  checkWeek(week);
  const body = parse(noteSchema, req.body);
  const cur = await prisma.weeklyReport.findUnique({ where: { reportWeek: week } });
  if (cur?.statusCd === 'CONFIRMED') throw new HttpError(409, '확정된 리포트입니다. 수정하려면 확정을 취소하세요.');
  await prisma.weeklyReport.upsert({ where: { reportWeek: week }, create: { reportWeek: week, ...body }, update: body });
  res.json({ ok: true });
});

// 확정: 그 시점 집계를 snapshot으로 고정
reportsRouter.post('/weekly/:week/confirm', requireRole('EXEC', 'ADMIN'), async (req, res) => {
  const u = me(req);
  const week = String(req.params.week);
  checkWeek(week);
  const body = parse(noteSchema, req.body ?? {});
  const data = { ...body, statusCd: 'CONFIRMED', snapshot: JSON.stringify(await companyWeeklyData(week)), confirmedBy: u.empId, confirmedAt: new Date() };
  await prisma.weeklyReport.upsert({ where: { reportWeek: week }, create: { reportWeek: week, ...data }, update: data });
  res.json({ ok: true });
});

reportsRouter.post('/weekly/:week/unconfirm', requireRole('EXEC', 'ADMIN'), async (req, res) => {
  const week = String(req.params.week);
  checkWeek(week);
  await prisma.weeklyReport.updateMany({ where: { reportWeek: week }, data: { statusCd: 'DRAFT', snapshot: null, confirmedBy: null, confirmedAt: null } });
  res.json({ ok: true });
});
