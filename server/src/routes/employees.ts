import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { me, requireRole } from '../auth.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { assignmentStatus, currentAllocations } from '../lib/alloc.js';
import { optDate, optStr, parse } from '../lib/validate.js';

export const employeesRouter = Router();

const EMPLOY_TYPES = ['REG', 'CONT', 'FREE', 'PARTNER'] as const;
const ROLES = ['EMP', 'PM', 'EXEC', 'ADMIN', 'SALES'] as const;

const employeeSchema = z.object({
  empId: optStr, // 자사 사번 (협력사·프리랜서는 비우면 P-xxxx 자동부여)
  name: z.string().min(1),
  deptCd: z.string().min(1),
  gradeCd: z.string().min(1),
  jobCd: optStr,
  skillLevel: z.enum(['초급', '중급', '고급', '특급']),
  skillStack: optStr,
  employType: z.enum(EMPLOY_TYPES),
  partnerId: optStr,
  careerStartDt: optDate,
  email: z.string().trim().toLowerCase().email('이메일 형식이 올바르지 않습니다'), // 로그인 ID
  phone: optStr,
  statusCd: z.enum(['ACTIVE', 'LEAVE', 'RETIRED']).default('ACTIVE'),
  role: z.enum(ROLES).default('EMP'),
  utilTarget: z.boolean().default(true),
  initialPassword: optStr,
});

function careerYears(start: string | null): number | null {
  if (!start) return null;
  const ms = Date.now() - new Date(start).getTime();
  return Math.max(0, Math.floor((ms / (365.25 * 86400000)) * 10) / 10);
}

async function nextPartnerEmpId(): Promise<string> {
  const rows = await prisma.employee.findMany({ where: { empId: { startsWith: 'P-' } }, select: { empId: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.empId.slice(2)) || 0), 0);
  return `P-${String(max + 1).padStart(4, '0')}`;
}

async function checkEmail(email: string, empId?: string) {
  const dup = await prisma.employee.findUnique({ where: { email }, select: { empId: true, name: true } });
  if (dup && dup.empId !== empId) throw new HttpError(409, `이미 사용 중인 이메일입니다: ${email} (${dup.name})`);
}

async function checkPartner(employType: string, partnerId: string | null | undefined) {
  if (employType === 'PARTNER' || employType === 'FREE') {
    if (!partnerId) throw new HttpError(400, '협력사·프리랜서 인력은 협력사를 지정해야 합니다.');
    if (!(await prisma.partner.findUnique({ where: { partnerId } }))) throw new HttpError(400, '존재하지 않는 협력사입니다.');
  }
}

// F-030 인력 목록 (R-02 이상)
employeesRouter.get('/', requireRole('PM', 'EXEC', 'ADMIN', 'SALES'), async (req, res) => {
  const { status, employType, q, includeRetired } = req.query as Record<string, string | undefined>;
  const rows = await prisma.employee.findMany({
    where: {
      ...(status ? { statusCd: status } : includeRetired === 'Y' ? {} : { statusCd: { not: 'RETIRED' } }),
      ...(employType ? { employType } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { empId: { contains: q } }, { deptCd: { contains: q } }, { email: { contains: q.toLowerCase() } }, { skillStack: { contains: q } }] } : {}),
    },
    include: { partner: { select: { partnerNm: true } } },
    orderBy: [{ deptCd: 'asc' }, { name: 'asc' }],
  });
  const alloc = await currentAllocations();
  res.json(
    rows.map(({ passwordHash: _, ...e }) => {
      const cur = alloc.get(e.empId) ?? [];
      const total = cur.reduce((s, a) => s + a.allocRate, 0);
      return {
        ...e,
        careerYears: careerYears(e.careerStartDt),
        allocTotal: total,
        overAlloc: Math.max(0, total - 100),
        projectCount: new Set(cur.map((a) => a.prjCd)).size,
        currentAssignments: cur,
      };
    }),
  );
});

// F-001 인력 상세 (본인 또는 R-02 이상)
employeesRouter.get('/:empId', async (req, res) => {
  const u = me(req);
  const { empId } = req.params;
  if (u.empId !== empId && u.role === 'EMP') throw forbidden();
  const emp = await prisma.employee.findUnique({
    where: { empId },
    include: {
      partner: { select: { partnerNm: true } },
      assignments: { include: { project: { select: { prjNm: true, prjType: true } } }, orderBy: { startDt: 'desc' } },
    },
  });
  if (!emp) throw notFound('인력');
  const { passwordHash: _, assignments, ...rest } = emp;
  res.json({
    ...rest,
    careerYears: careerYears(emp.careerStartDt),
    assignments: assignments.map((a) => ({ ...a, status: assignmentStatus(a) })),
  });
});

employeesRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const body = parse(employeeSchema, req.body);
  await checkPartner(body.employType, body.partnerId);
  await checkEmail(body.email);
  let empId = body.empId;
  if (!empId) {
    if (body.employType === 'PARTNER' || body.employType === 'FREE') empId = await nextPartnerEmpId();
    else throw new HttpError(400, '자사 인력은 사번을 입력해야 합니다.');
  }
  if (await prisma.employee.findUnique({ where: { empId } })) throw new HttpError(409, `이미 존재하는 사번입니다: ${empId}`);
  const { initialPassword, empId: _e, ...data } = body;
  const created = await prisma.employee.create({
    data: { ...data, empId, passwordHash: await bcrypt.hash(initialPassword || empId, 10) },
  });
  res.status(201).json({ empId: created.empId });
});

employeesRouter.put('/:empId', requireRole('ADMIN'), async (req, res) => {
  const body = parse(employeeSchema, req.body);
  await checkPartner(body.employType, body.partnerId);
  const { initialPassword: _p, empId: _e, ...data } = body;
  const empId = String(req.params.empId);
  if (!(await prisma.employee.findUnique({ where: { empId } }))) throw notFound('인력');
  await checkEmail(body.email, empId);
  await prisma.employee.update({ where: { empId }, data });
  res.json({ ok: true });
});

employeesRouter.post('/:empId/reset-password', requireRole('ADMIN'), async (req, res) => {
  const body = parse(z.object({ password: z.string().min(4) }), req.body);
  await prisma.employee.update({ where: { empId: String(req.params.empId) }, data: { passwordHash: await bcrypt.hash(body.password, 10) } });
  res.json({ ok: true });
});

// F-030 엑셀(CSV) 일괄 등록: 클라이언트에서 파싱한 행 배열을 받는다
employeesRouter.post('/import', requireRole('ADMIN'), async (req, res) => {
  const rows = parse(z.array(z.record(z.string(), z.unknown())).max(2000), req.body?.rows);
  const results: { row: number; empId?: string; error?: string }[] = [];
  for (const [i, raw] of rows.entries()) {
    try {
      const body = parse(employeeSchema, raw);
      await checkPartner(body.employType, body.partnerId);
      await checkEmail(body.email);
      const empId = body.empId || (body.employType === 'PARTNER' || body.employType === 'FREE' ? await nextPartnerEmpId() : null);
      if (!empId) throw new HttpError(400, '사번 누락');
      if (await prisma.employee.findUnique({ where: { empId } })) throw new HttpError(409, '사번 중복');
      const { initialPassword, empId: _e, ...data } = body;
      await prisma.employee.create({ data: { ...data, empId, passwordHash: await bcrypt.hash(initialPassword || empId, 10) } });
      results.push({ row: i + 1, empId });
    } catch (e) {
      results.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
  res.json({ created: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results });
});
