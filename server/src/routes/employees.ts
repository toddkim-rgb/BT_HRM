import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { me, requireRole } from '../auth.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { assignmentStatus, currentAllocations } from '../lib/alloc.js';
import { tempPassword } from '../lib/password.js';
import { optDate, optStr, parse } from '../lib/validate.js';

export const employeesRouter = Router();

const EMPLOY_TYPES = ['REG', 'CONT', 'FREE', 'PARTNER'] as const;
const ROLES = ['EMP', 'PM', 'EXEC', 'ADMIN', 'SALES'] as const;

const employeeSchema = z.object({
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

/** 내부 관리 번호 (사번 아님, 화면에 표시하지 않음) — 다른 테이블과 연결하는 키 */
async function nextEmpId(): Promise<string> {
  const rows = await prisma.employee.findMany({ where: { empId: { startsWith: 'U' } }, select: { empId: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.empId.slice(1)) || 0), 0);
  return `U${String(max + 1).padStart(5, '0')}`;
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
      ...(q ? { OR: [{ name: { contains: q } }, { deptCd: { contains: q } }, { email: { contains: q.toLowerCase() } }, { skillStack: { contains: q } }] } : {}),
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
  const { initialPassword, ...data } = body;
  // 초기 비밀번호를 비우면 임시 비밀번호 자동 발급 (응답으로 1회 표시), 첫 로그인 시 변경 강제
  const password = initialPassword || tempPassword();
  const created = await prisma.employee.create({
    data: { ...data, empId: await nextEmpId(), passwordHash: await bcrypt.hash(password, 10), mustChangePw: true },
  });
  res.status(201).json({ empId: created.empId, tempPassword: initialPassword ? null : password });
});

employeesRouter.put('/:empId', requireRole('ADMIN'), async (req, res) => {
  const body = parse(employeeSchema, req.body);
  await checkPartner(body.employType, body.partnerId);
  const { initialPassword: _p, ...data } = body;
  const empId = String(req.params.empId);
  if (!(await prisma.employee.findUnique({ where: { empId } }))) throw notFound('인력');
  await checkEmail(body.email, empId);
  await prisma.employee.update({ where: { empId }, data });
  res.json({ ok: true });
});

// 관리자 비밀번호 초기화: 임시 비밀번호 발급(1회 표시) → 첫 로그인 시 변경 강제
employeesRouter.post('/:empId/reset-password', requireRole('ADMIN'), async (req, res) => {
  const empId = String(req.params.empId);
  if (!(await prisma.employee.findUnique({ where: { empId } }))) throw notFound('인력');
  const password = tempPassword();
  await prisma.employee.update({ where: { empId }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePw: true } });
  res.json({ ok: true, tempPassword: password });
});

// F-030 엑셀(CSV) 일괄 등록: 클라이언트에서 파싱한 행 배열을 받는다
employeesRouter.post('/import', requireRole('ADMIN'), async (req, res) => {
  const rows = parse(z.array(z.record(z.string(), z.unknown())).max(2000), req.body?.rows);
  const results: { row: number; email?: string; name?: string; tempPassword?: string; error?: string }[] = [];
  for (const [i, raw] of rows.entries()) {
    try {
      const body = parse(employeeSchema, raw);
      await checkPartner(body.employType, body.partnerId);
      await checkEmail(body.email);
      const { initialPassword, ...data } = body;
      const password = initialPassword || tempPassword();
      await prisma.employee.create({ data: { ...data, empId: await nextEmpId(), passwordHash: await bcrypt.hash(password, 10), mustChangePw: true } });
      results.push({ row: i + 1, email: body.email, name: body.name, tempPassword: password });
    } catch (e) {
      results.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
  res.json({ created: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results });
});
