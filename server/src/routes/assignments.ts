import { Router } from 'express';
import { z } from 'zod';
import { assertProjectManager, isManager, me, pmProjectCodes } from '../auth.js';
import { HttpError, notFound, prisma } from '../db.js';
import { assignmentStatus, maxAllocation } from '../lib/alloc.js';
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
  if (u.role === 'EMP') scope = { empId: u.empId };
  else if (u.role === 'PM') {
    // 담당 프로젝트 배정 + 특정 인력 조회 시 그 인력의 전체 배정(과투입 판단용)
    scope = empId ? {} : { prjCd: { in: await pmProjectCodes(u.empId) } };
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

async function validateTarget(empId: string, prjCd: string) {
  const emp = await prisma.employee.findUnique({ where: { empId } });
  if (!emp || emp.statusCd === 'RETIRED') throw new HttpError(400, '배정할 수 없는 인력입니다.');
  const prj = await prisma.project.findUnique({ where: { prjCd } });
  if (!prj || prj.prjType === 'NP') throw new HttpError(400, '배정할 수 없는 프로젝트입니다.');
  if (['DONE', 'STOP', 'LOST'].includes(prj.statusCd)) throw new HttpError(400, '종료된 프로젝트에는 배정할 수 없습니다.');
}

assignmentsRouter.post('/', async (req, res) => {
  const u = me(req);
  const body = parse(asgSchema, req.body);
  await assertProjectManager(u, body.prjCd);
  await validateTarget(body.empId, body.prjCd);
  const created = await prisma.assignment.create({ data: { ...body, createdBy: u.empId } });
  const max = await maxAllocation(body.empId, body.startDt, body.endDt);
  res.status(201).json({ asgId: created.asgId, maxAlloc: max, overAlloc: Math.max(0, max - 100) });
});

assignmentsRouter.put('/:id', async (req, res) => {
  const u = me(req);
  const cur = await prisma.assignment.findUnique({ where: { asgId: Number(req.params.id) } });
  if (!cur) throw notFound('배정');
  await assertProjectManager(u, cur.prjCd);
  const body = parse(asgSchema, req.body);
  if (body.prjCd !== cur.prjCd) throw new HttpError(400, '프로젝트는 변경할 수 없습니다. 새로 배정하세요.');
  await validateTarget(body.empId, body.prjCd);
  await prisma.assignment.update({ where: { asgId: cur.asgId }, data: body });
  const max = await maxAllocation(body.empId, body.startDt, body.endDt);
  res.json({ ok: true, maxAlloc: max, overAlloc: Math.max(0, max - 100) });
});

assignmentsRouter.post('/:id/cancel', async (req, res) => {
  const u = me(req);
  const cur = await prisma.assignment.findUnique({ where: { asgId: Number(req.params.id) } });
  if (!cur) throw notFound('배정');
  await assertProjectManager(u, cur.prjCd);
  await prisma.assignment.update({ where: { asgId: cur.asgId }, data: { canceled: true } });
  res.json({ ok: true });
});

/** 등록 전 과투입 미리보기 */
assignmentsRouter.get('/preview/overalloc', async (req, res) => {
  const u = me(req);
  if (!(u.role === 'PM' || isManager(u))) throw new HttpError(403, '권한이 없습니다.');
  const q = parse(z.object({ empId: z.string(), startDt: dateStr, endDt: dateStr, allocRate: z.coerce.number() }), req.query);
  const existing = await maxAllocation(q.empId, q.startDt, q.endDt);
  const total = existing + q.allocRate;
  res.json({ existing, total, overAlloc: Math.max(0, total - 100) });
});
