import { Router } from 'express';
import { z } from 'zod';
import { me, requireRole } from '../auth.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { assignmentStatus, currentAllocations } from '../lib/alloc.js';
import { notRetired } from '../lib/empFilter.js';
import { initialPasswordHash } from '../lib/password.js';
import { today } from '../lib/dates.js';
import { optDate, optStr, parse } from '../lib/validate.js';

export const employeesRouter = Router();

const EMPLOY_TYPES = ['REG', 'CONT', 'FREE', 'PARTNER'] as const;
const ROLES = ['EMP', 'PM', 'EXEC', 'ADMIN', 'SALES'] as const;

const employeeSchema = z.object({
  name: z.string({ error: '성명을 입력하세요' }).trim().min(1, '성명을 입력하세요'),
  deptCd: z.string({ error: '소속을 입력하세요' }).trim().min(1, '소속을 입력하세요'),
  gradeCd: z.string({ error: '직급을 입력하세요' }).trim().min(1, '직급을 입력하세요'),
  jobCd: optStr,
  skillLevel: z.enum(['초급', '중급', '고급', '특급']),
  skillStack: optStr,
  employType: z.enum(EMPLOY_TYPES),
  partnerId: optStr,
  careerStartDt: optDate,
  email: z.string({ error: '업무 이메일을 입력하세요' }).trim().toLowerCase().email('이메일 형식이 올바르지 않습니다'), // 로그인 ID
  phone: z.string({ error: '연락처를 입력하세요' }).trim().min(1, '연락처를 입력하세요'), // 필수 (ID 찾기 본인 확인)
  statusCd: z.preprocess((v) => (v === '' ? null : v), z.enum(['ACTIVE', 'LEAVE', 'RETIRED']).nullish()).transform((v) => v ?? null), // 선택
  role: z.enum(ROLES).default('EMP'),
  utilTarget: z.boolean().default(true),
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
  const dup = await prisma.employee.findUnique({ where: { email }, select: { empId: true, name: true, deletedAt: true } });
  if (dup && dup.empId !== empId) {
    throw new HttpError(409, dup.deletedAt ? `삭제 처리된 인력(${dup.name})이 사용 중인 이메일입니다. '삭제된 인력'에서 복구하세요: ${email}` : `이미 사용 중인 이메일입니다: ${email} (${dup.name})`);
  }
}

async function checkPartner(employType: string, partnerId: string | null | undefined) {
  if (employType === 'PARTNER' || employType === 'FREE') {
    if (!partnerId) throw new HttpError(400, '협력사·프리랜서 인력은 협력사를 지정해야 합니다.');
    if (!(await prisma.partner.findUnique({ where: { partnerId } }))) throw new HttpError(400, '존재하지 않는 협력사입니다.');
  }
}

// F-030 인력 목록 (R-02 이상)
employeesRouter.get('/', requireRole('PM', 'EXEC', 'ADMIN', 'SALES'), async (req, res) => {
  const u = me(req);
  const { status, employType, q, includeRetired, deleted } = req.query as Record<string, string | undefined>;
  if (deleted === 'Y' && u.role !== 'ADMIN') throw forbidden();
  const rows = await prisma.employee.findMany({
    where: {
      deletedAt: deleted === 'Y' ? { not: null } : null,
      ...(status === 'NONE' ? { statusCd: null } : status ? { statusCd: status } : includeRetired === 'Y' || deleted === 'Y' ? {} : notRetired),
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
  // 초기 비밀번호 = 본인 이메일 주소, 첫 로그인 시 변경 강제
  const created = await prisma.employee.create({
    data: { ...body, empId: await nextEmpId(), passwordHash: await initialPasswordHash(body.email), mustChangePw: true },
  });
  res.status(201).json({ empId: created.empId });
});

employeesRouter.put('/:empId', requireRole('ADMIN'), async (req, res) => {
  const body = parse(employeeSchema, req.body);
  await checkPartner(body.employType, body.partnerId);
  const empId = String(req.params.empId);
  const cur = await prisma.employee.findUnique({ where: { empId } });
  if (!cur) throw notFound('인력');
  await checkEmail(body.email, empId);
  // 아직 초기 비밀번호 상태(첫 로그인 전)에서 이메일을 바꾸면 초기 비밀번호도 새 이메일로 맞춘다
  const resetPw = cur.mustChangePw && cur.email !== body.email;
  await prisma.employee.update({ where: { empId }, data: { ...body, ...(resetPw ? { passwordHash: await initialPasswordHash(body.email) } : {}) } });
  res.json({ ok: true });
});

// 관리자 비밀번호 초기화: 비밀번호를 본인 이메일 주소로 되돌림 → 첫 로그인 시 변경 강제
employeesRouter.post('/:empId/reset-password', requireRole('ADMIN'), async (req, res) => {
  const empId = String(req.params.empId);
  const emp = await prisma.employee.findUnique({ where: { empId } });
  if (!emp) throw notFound('인력');
  await prisma.employee.update({ where: { empId }, data: { passwordHash: await initialPasswordHash(emp.email), mustChangePw: true } });
  res.json({ ok: true, email: emp.email });
});

// F-030 엑셀(CSV) 일괄 등록: 클라이언트에서 파싱한 행 배열을 받는다
employeesRouter.post('/import', requireRole('ADMIN'), async (req, res) => {
  const rows = parse(z.array(z.record(z.string(), z.unknown())).max(2000), req.body?.rows);
  const results: { row: number; email?: string; name?: string; error?: string }[] = [];
  for (const [i, raw] of rows.entries()) {
    try {
      const body = parse(employeeSchema, raw);
      await checkPartner(body.employType, body.partnerId);
      await checkEmail(body.email);
      await prisma.employee.create({ data: { ...body, empId: await nextEmpId(), passwordHash: await initialPasswordHash(body.email), mustChangePw: true } });
      results.push({ row: i + 1, email: body.email, name: body.name });
    } catch (e) {
      results.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
  res.json({ created: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results });
});

// ---- 인력 삭제 (F-030): 이력 없으면 완전 삭제, 이력 있으면 삭제 처리(보관) ----

/** 삭제 영향 확인: 연결된 이력·차단 사유 */
async function deleteImpact(empId: string, actor: string) {
  const emp = await prisma.employee.findUnique({ where: { empId } });
  if (!emp) throw notFound('인력');
  const t = today();
  const [asg, weeklyWorks, timesheets, contracts, costRates, alerts, pmProjects, admins] = await Promise.all([
    prisma.assignment.findMany({ where: { empId }, select: { asgId: true, prjCd: true, startDt: true, endDt: true, canceled: true } }),
    prisma.weeklyWork.count({ where: { empId } }),
    prisma.timesheet.count({ where: { empId } }),
    prisma.partnerContract.count({ where: { empId } }),
    prisma.costRate.count({ where: { empId } }),
    prisma.alert.count({ where: { targetEmpId: empId } }),
    prisma.project.findMany({ where: { pmEmpId: empId }, select: { prjCd: true, prjNm: true, statusCd: true } }),
    prisma.employee.count({ where: { role: 'ADMIN', deletedAt: null, NOT: { empId } } }),
  ]);
  const live = asg.filter((a) => !a.canceled);
  const blockers: string[] = [];
  if (empId === actor) blockers.push('본인 계정은 삭제할 수 없습니다.');
  if (emp.role === 'ADMIN' && admins === 0) blockers.push('마지막 시스템관리자 계정은 삭제할 수 없습니다.');
  const pmActive = pmProjects.filter((p) => p.statusCd === 'ACTIVE' || p.statusCd === 'PROPOSAL');
  if (pmActive.length) blockers.push(`PM으로 지정된 진행중·제안 프로젝트가 있습니다. 먼저 PM을 변경하세요: ${pmActive.map((p) => p.prjNm).join(', ')}`);
  const history = asg.length + weeklyWorks + timesheets + contracts + costRates + alerts + pmProjects.length;
  return {
    emp,
    mode: history ? ('ARCHIVE' as const) : ('HARD' as const),
    counts: {
      assignmentsActive: live.filter((a) => a.startDt <= t && a.endDt >= t).length,
      assignmentsPlanned: live.filter((a) => a.startDt > t).length,
      assignmentsTotal: asg.length,
      weeklyWorks,
      pmProjects: pmProjects.length,
    },
    blockers,
  };
}

employeesRouter.get('/:empId/delete-impact', requireRole('ADMIN'), async (req, res) => {
  const { emp: _e, ...rest } = await deleteImpact(String(req.params.empId), me(req).empId);
  res.json(rest);
});

employeesRouter.delete('/:empId', requireRole('ADMIN'), async (req, res) => {
  const u = me(req);
  const empId = String(req.params.empId);
  const impact = await deleteImpact(empId, u.empId);
  if (impact.emp.deletedAt) throw new HttpError(409, '이미 삭제 처리된 인력입니다.');
  if (impact.blockers.length) throw new HttpError(409, impact.blockers.join('\n'), { blockers: impact.blockers });
  if (impact.mode === 'HARD') {
    await prisma.$transaction([
      prisma.accountRequest.updateMany({ where: { matchedEmpId: empId }, data: { matchedEmpId: null } }),
      prisma.employee.delete({ where: { empId } }),
    ]);
    res.json({ ok: true, mode: 'HARD' });
    return;
  }
  // 보관: 진행 중 배정은 오늘 종료, 예정 배정은 취소. 과거 이력·집계는 유지
  const t = today();
  await prisma.$transaction([
    prisma.assignment.updateMany({ where: { empId, canceled: false, startDt: { gt: t } }, data: { canceled: true } }),
    prisma.assignment.updateMany({ where: { empId, canceled: false, startDt: { lte: t }, endDt: { gt: t } }, data: { endDt: t } }),
    prisma.employee.update({ where: { empId }, data: { deletedAt: new Date(), deletedBy: u.empId } }),
  ]);
  res.json({ ok: true, mode: 'ARCHIVE' });
});

employeesRouter.post('/:empId/restore', requireRole('ADMIN'), async (req, res) => {
  const empId = String(req.params.empId);
  const emp = await prisma.employee.findUnique({ where: { empId } });
  if (!emp) throw notFound('인력');
  if (!emp.deletedAt) throw new HttpError(409, '삭제 처리된 인력이 아닙니다.');
  await prisma.employee.update({ where: { empId }, data: { deletedAt: null, deletedBy: null } });
  res.json({ ok: true });
});
