import { Router } from 'express';
import { z } from 'zod';
import { assertProjectManager, me, pmProjectCodes, pmScoped, staffOnly } from '../auth.js';
import { assertMenu } from '../lib/permissions.js';
import { HttpError, notFound, prisma } from '../db.js';
import { assignmentStatus, maxAllocation } from '../lib/alloc.js';
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
    scope = empId ? {} : { OR: [{ prjCd: { in: await pmProjectCodes(u.empId) } }, { empId: u.empId }] };
  }
  const rows = await prisma.assignment.findMany({
    where: { ...scope, ...(prjCd ? { prjCd } : {}), ...(empId ? { empId } : {}) },
    include: {
      employee: { select: { name: true, gradeCd: true, skillLevel: true, employType: true, deptCd: true } },
      project: { select: { prjNm: true, prjType: true, pmEmpId: true } },
    },
    orderBy: [{ startDt: 'desc' }],
  });
  // 과투입: 같은 인력의 전체 배정(다른 프로젝트 포함) 기준 기간 내 최대 투입률 합계
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
  // 기간 중 기존 배정 투입률 합계의 최댓값 (시작 지점 기준)
  const points = [q.startDt, ...overlapping.map((o) => o.startDt).filter((d) => d > q.startDt && d <= q.endDt)];
  const existing = Math.max(0, ...points.map((p) => overlapping.filter((o) => o.startDt <= p && o.endDt >= p).reduce((s, o) => s + o.allocRate, 0)));
  const total = existing + q.allocRate;
  res.json({ existing, total, overAlloc: Math.max(0, total - 100), overlapping });
});
