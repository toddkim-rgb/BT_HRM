import { Router } from 'express';
import { z } from 'zod';
import { assertProjectManager, me, pmProjectCodes, pmScoped, staffOnly } from '../auth.js';
import { assertMenu, can } from '../lib/permissions.js';
import { HttpError, notFound, prisma } from '../db.js';
import { assignmentStatus, maxAllocation, plannedMd } from '../lib/alloc.js';
import { today } from '../lib/dates.js';
import { projectRates } from '../lib/projectRate.js';
import { holidaySet, mdPerMm } from '../lib/settings.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { requireMenu } from '../lib/permissions.js';
import { nextEmpId } from './employees.js';
import { usableEmp } from '../lib/empFilter.js';
import { dateStr, parse } from '../lib/validate.js';

// 5.2 투입 배정 (F-010) — 승인 절차 없음, 등록 즉시 확정
export const assignmentsRouter = Router();

const asgSchema = z
  .object({
    empId: z.string().min(1),
    prjCd: z.string().min(1),
    roleCd: z.string().min(1),
    startDt: dateStr,
    endDt: dateStr,
    allocRate: z.number().int().min(1).max(100),
    residentType: z.enum(['ONSITE', 'OFFSITE']).default('ONSITE'),
  })
  .refine((v) => v.startDt <= v.endDt, { message: '종료일이 시작일보다 빠릅니다.', path: ['endDt'] });

assignmentsRouter.get('/', async (req, res) => {
  const u = me(req);
  const { prjCd, empId, status } = req.query as Record<string, string | undefined>;
  let scope = {};
  if (staffOnly(u)) scope = { empId: u.empId };
  else if (pmScoped(u)) {
    // 프로젝트 PM: 담당 프로젝트 배정 + 본인 배정, 특정 인력 조회 시 그 인력의 전체 배정(과투입 판단용)
    scope = empId ? {} : { OR: [{ prjCd: { in: pmProjectCodes(u) } }, { empId: u.empId }] };
  }
  const rows = await prisma.assignment.findMany({
    where: { ...scope, ...(prjCd ? { prjCd } : {}), ...(empId ? { empId } : {}) },
    include: {
      employee: { select: { name: true, gradeCd: true, skillLevel: true, employType: true, deptCd: true } },
      project: { select: { prjNm: true, prjType: true, pmEmpId: true } },
    },
    orderBy: [{ startDt: 'desc' }],
  });
  // 과투입: 같은 인력의 전체 배정(다른 프로젝트 포함) 기준 기간 내 최대 배정률 합계
  const all = await prisma.assignment.findMany({
    where: { empId: { in: [...new Set(rows.map((r) => r.empId))] }, canceled: false },
    select: { empId: true, startDt: true, endDt: true, allocRate: true },
  });
  const maxAlloc = (a: { empId: string; startDt: string; endDt: string }) => {
    const mine = all.filter((b) => b.empId === a.empId && b.startDt <= a.endDt && b.endDt >= a.startDt);
    const points = [a.startDt, ...mine.map((b) => b.startDt).filter((d) => d > a.startDt && d <= a.endDt)];
    return Math.max(0, ...points.map((p) => mine.filter((b) => b.startDt <= p && b.endDt >= p).reduce((s, b) => s + b.allocRate, 0)));
  };
  const out = rows.map((a) => ({ ...a, status: assignmentStatus(a), overAlloc: a.canceled ? 0 : Math.max(0, maxAlloc(a) - 100) }));
  res.json(status ? out.filter((a) => status.split(',').includes(a.status)) : out);
});

/**
 * PM 지정 = 배정 역할 'PM' (프로젝트당 1명). 프로젝트의 PM(pmEmpId)을 배정에 맞춘다.
 * - 새로 PM으로 지정하면 그 프로젝트의 기존 PM 배정은 일반 역할(SM: 운영, 그 외: 개발)로 바뀜
 * - PM 배정을 다른 역할로 바꾸면 프로젝트 PM은 비게 됨 (취소는 cancel 라우트에서 처리)
 */
async function syncProjectPm(prjCd: string, asgId: number, empId: string, roleCd: string, prev?: { empId: string; roleCd: string }) {
  if (roleCd === 'PM') {
    const prj = await prisma.project.findUnique({ where: { prjCd }, select: { prjType: true } });
    await prisma.assignment.updateMany({
      where: { prjCd, roleCd: 'PM', asgId: { not: asgId }, empId: { not: empId } },
      data: { roleCd: prj?.prjType === 'SM' ? 'OPS' : 'DEV' },
    });
    await prisma.project.update({ where: { prjCd }, data: { pmEmpId: empId } });
  } else if (prev?.roleCd === 'PM') {
    await prisma.project.updateMany({ where: { prjCd, pmEmpId: prev.empId }, data: { pmEmpId: null } });
  }
}

// ---- 프로젝트 상태(진행/완료) 변경 · 최종 MD ----

/**
 * 배정 보드에서 프로젝트 상태 변경: 기간과 무관하게 완료 처리하거나 다시 진행으로 표기
 * 권한: 프로젝트 '편집' 권한, 또는 투입 배정 '편집' 권한(프로젝트 PM은 담당 프로젝트만)
 * 완료 처리 시 closeAssignments=true면 진행 중 배정은 오늘 종료, 시작 전 배정은 취소
 */
assignmentsRouter.patch('/projects/:prjCd/status', async (req, res) => {
  const u = me(req);
  const prjCd = String(req.params.prjCd);
  if (!(await can(u, 'projects', 'EDIT'))) await assertProjectManager(u, prjCd, 'assignments');
  const body = parse(z.object({ statusCd: z.enum(['ACTIVE', 'DONE']), closeAssignments: z.boolean().default(false) }), req.body);
  const prj = await prisma.project.findUnique({ where: { prjCd } });
  if (!prj || prj.prjType === 'NP') throw notFound('프로젝트');
  const t = today();
  let closed = 0;
  let canceled = 0;
  if (body.statusCd === 'DONE' && body.closeAssignments) {
    canceled = (await prisma.assignment.updateMany({ where: { prjCd, canceled: false, startDt: { gt: t } }, data: { canceled: true } })).count;
    closed = (await prisma.assignment.updateMany({ where: { prjCd, canceled: false, startDt: { lte: t }, endDt: { gt: t } }, data: { endDt: t } })).count;
  }
  await prisma.project.update({ where: { prjCd }, data: { statusCd: body.statusCd } });
  res.json({ ok: true, closed, canceled });
});

/**
 * 프로젝트별 MD 산정 (배정 보드의 종료 프로젝트 최종 MD)
 * - 계획 MD = Σ(배정 기간 영업일 × 배정률), 실적 MD = 제출된 주간 업무보고의 투입 MD
 * - 인력별 계획/실적 MD 포함, MM = MD ÷ 1MM 환산 MD(기준값)
 */
assignmentsRouter.get('/project-md', requireMenu('assignments'), async (req, res) => {
  const u = me(req);
  const scope = pmScoped(u) ? pmProjectCodes(u) : null;
  const holidays = await holidaySet();
  const mdmm = await mdPerMm();
  const asg = await prisma.assignment.findMany({ where: { canceled: false, ...(scope ? { prjCd: { in: scope } } : {}) }, select: { prjCd: true, empId: true, startDt: true, endDt: true, allocRate: true } });
  const ts = await prisma.timesheet.groupBy({
    by: ['prjCd', 'empId'],
    where: { weeklyWork: { statusCd: 'SUBMITTED' }, ...(scope ? { prjCd: { in: scope } } : {}) },
    _sum: { md: true },
  });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: Record<string, { planMd: number; actualMd: number; planMm: number; actualMm: number; byEmp: Record<string, { planMd: number; actualMd: number }> }> = {};
  const get = (prjCd: string) => (out[prjCd] ??= { planMd: 0, actualMd: 0, planMm: 0, actualMm: 0, byEmp: {} });
  for (const a of asg) {
    const md = plannedMd(a, a.startDt, a.endDt, holidays);
    const p = get(a.prjCd);
    p.planMd += md;
    (p.byEmp[a.empId] ??= { planMd: 0, actualMd: 0 }).planMd += md;
  }
  for (const x of ts) {
    const md = x._sum.md ?? 0;
    const p = get(x.prjCd);
    p.actualMd += md;
    (p.byEmp[x.empId] ??= { planMd: 0, actualMd: 0 }).actualMd += md;
  }
  for (const p of Object.values(out)) {
    p.planMd = r2(p.planMd);
    p.actualMd = r2(p.actualMd);
    p.planMm = r2(p.planMd / mdmm);
    p.actualMm = r2(p.actualMd / mdmm);
    for (const e of Object.values(p.byEmp)) {
      e.planMd = r2(e.planMd);
      e.actualMd = r2(e.actualMd);
    }
  }
  const rates = await projectRates(Object.keys(out));
  res.json(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...v, pr: rates.get(k) ?? null }])));
});

// ---- 협력사를 바로 수행인력으로 배정 ----

/** 협력사로 만들 수행인력 이름: 개인 협력사는 '(개인)'을 뺀 이름, 업체는 '업체명 인력' */
const staffNameOf = (p: { partnerNm: string }) => (p.partnerNm.startsWith('(개인)') ? p.partnerNm.replace(/^\(개인\)\s*/, '').trim() || p.partnerNm : `${p.partnerNm} 인력`);

/** 배정 화면용 협력사 목록 (거래중) + 등록된 소속 인력 수 */
assignmentsRouter.get('/partners', requireMenu('assignments'), async (_req, res) => {
  const rows = await prisma.partner.findMany({
    where: { statusCd: 'ACTIVE' },
    select: { partnerId: true, partnerNm: true, contactNm: true, employees: { where: usableEmp, select: { empId: true } } },
    orderBy: { partnerNm: 'asc' },
  });
  res.json(rows.map(({ employees, ...p }) => ({ ...p, staffName: staffNameOf(p), staffCount: employees.length })));
});

/**
 * 협력사 소속 수행인력 확보: 이미 등록된 소속 인력이 있으면 그 사람, 없으면 새로 만든다.
 * 새 인력은 로그인할 수 없는 상태(임의 비밀번호)로 만들고, 이메일·연락처는 인력 화면에서 보완한다.
 */
assignmentsRouter.post('/partners/:partnerId/staff', requireMenu('assignments', 'EDIT'), async (req, res) => {
  const partnerId = String(req.params.partnerId);
  const p = await prisma.partner.findUnique({ where: { partnerId }, include: { employees: { where: usableEmp, select: { empId: true, name: true } } } });
  if (!p) throw notFound('협력사');
  if (p.employees.length) {
    res.json({ empId: p.employees[0].empId, name: p.employees[0].name, created: false });
    return;
  }
  const individual = p.partnerNm.startsWith('(개인)');
  const name = staffNameOf(p);
  const created = await prisma.employee.create({
    data: {
      empId: await nextEmpId(),
      name,
      deptCd: p.partnerNm,
      gradeCd: '-',
      skillLevel: '중급',
      employType: individual ? 'FREE' : 'PARTNER',
      partnerId,
      email: `${partnerId.toLowerCase()}.${Date.now().toString(36)}@partner.bt-hrm.local`, // 임시 (인력 화면에서 실제 이메일로 수정)
      phone: p.contactPhone,
      role: 'EMP',
      utilTarget: true,
      mustChangePw: true,
      passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10), // 로그인 불가 상태
    },
  });
  res.status(201).json({ empId: created.empId, name, created: true });
});

async function validateTarget(empId: string, prjCd: string) {
  const emp = await prisma.employee.findUnique({ where: { empId } });
  if (!emp || emp.deletedAt || emp.statusCd === 'RETIRED') throw new HttpError(400, '배정할 수 없는 인력입니다. (퇴사 또는 삭제된 인력)');
  const prj = await prisma.project.findUnique({ where: { prjCd } });
  if (!prj || prj.prjType === 'NP') throw new HttpError(400, '배정할 수 없는 프로젝트입니다.');
  // 완료·중단·기간이 지난 프로젝트도 배정 등록·수정 가능 (지난 투입 이력 정정)
}

assignmentsRouter.post('/', async (req, res) => {
  const u = me(req);
  const body = parse(asgSchema, req.body);
  await assertProjectManager(u, body.prjCd, 'assignments');
  await validateTarget(body.empId, body.prjCd);
  const created = await prisma.assignment.create({ data: { ...body, createdBy: u.empId } });
  await syncProjectPm(body.prjCd, created.asgId, body.empId, body.roleCd);
  const max = await maxAllocation(body.empId, body.startDt, body.endDt);
  res.status(201).json({ asgId: created.asgId, maxAlloc: max, overAlloc: Math.max(0, max - 100) });
});

assignmentsRouter.put('/:id', async (req, res) => {
  const u = me(req);
  const cur = await prisma.assignment.findUnique({ where: { asgId: Number(req.params.id) } });
  if (!cur) throw notFound('배정');
  await assertProjectManager(u, cur.prjCd, 'assignments');
  const body = parse(asgSchema, req.body);
  if (body.prjCd !== cur.prjCd) throw new HttpError(400, '프로젝트는 변경할 수 없습니다. 새로 배정하세요.');
  await validateTarget(body.empId, body.prjCd);
  await prisma.assignment.update({ where: { asgId: cur.asgId }, data: body });
  await syncProjectPm(cur.prjCd, cur.asgId, body.empId, body.roleCd, cur);
  const max = await maxAllocation(body.empId, body.startDt, body.endDt);
  res.json({ ok: true, maxAlloc: max, overAlloc: Math.max(0, max - 100) });
});

assignmentsRouter.post('/:id/cancel', async (req, res) => {
  const u = me(req);
  const cur = await prisma.assignment.findUnique({ where: { asgId: Number(req.params.id) } });
  if (!cur) throw notFound('배정');
  await assertProjectManager(u, cur.prjCd, 'assignments');
  await prisma.assignment.update({ where: { asgId: cur.asgId }, data: { canceled: true } });
  if (cur.roleCd === 'PM') await prisma.project.updateMany({ where: { prjCd: cur.prjCd, pmEmpId: cur.empId }, data: { pmEmpId: null } });
  res.json({ ok: true });
});

/** 등록 전 과투입 미리보기 + 같은 기간 다른 투입 현황 (다중 프로젝트 투입) */
assignmentsRouter.get('/preview/overalloc', async (req, res) => {
  const u = me(req);
  await assertMenu(u, 'assignments', 'EDIT');
  const q = parse(
    z.object({ empId: z.string(), startDt: dateStr, endDt: dateStr, allocRate: z.coerce.number(), excludeAsgId: z.coerce.number().optional() }),
    req.query,
  );
  const overlapping = await prisma.assignment.findMany({
    where: { empId: q.empId, canceled: false, startDt: { lte: q.endDt }, endDt: { gte: q.startDt }, ...(q.excludeAsgId ? { asgId: { not: q.excludeAsgId } } : {}) },
    select: { asgId: true, prjCd: true, roleCd: true, startDt: true, endDt: true, allocRate: true, project: { select: { prjNm: true } } },
    orderBy: { startDt: 'asc' },
  });
  // 기간 중 기존 배정률 합계의 최댓값 (시작 지점 기준)
  const points = [q.startDt, ...overlapping.map((o) => o.startDt).filter((d) => d > q.startDt && d <= q.endDt)];
  const existing = Math.max(0, ...points.map((p) => overlapping.filter((o) => o.startDt <= p && o.endDt >= p).reduce((s, o) => s + o.allocRate, 0)));
  const total = existing + q.allocRate;
  res.json({ existing, total, overAlloc: Math.max(0, total - 100), overlapping });
});
