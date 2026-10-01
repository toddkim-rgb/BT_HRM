import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { me, requireRole } from '../auth.js';
import { HttpError, notFound, prisma } from '../db.js';
import { tempPassword } from '../lib/password.js';
import { optStr, parse } from '../lib/validate.js';

// 로그인 화면에서 들어온 비밀번호 재설정 요청·ID 문의 처리 (시스템관리자)
export const accountRequestsRouter = Router();
accountRequestsRouter.use(requireRole('ADMIN'));

accountRequestsRouter.get('/', async (req, res) => {
  const status = String(req.query.status ?? 'OPEN');
  const rows = await prisma.accountRequest.findMany({
    where: status === 'ALL' ? {} : { statusCd: status },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const ids = [...new Set(rows.map((r) => r.matchedEmpId).filter((x): x is string => !!x))];
  const emps = await prisma.employee.findMany({ where: { empId: { in: ids } }, select: { empId: true, name: true, email: true, deptCd: true, phone: true } });
  res.json(rows.map((r) => ({ ...r, matched: emps.find((e) => e.empId === r.matchedEmpId) ?? null })));
});

accountRequestsRouter.get('/count', async (_req, res) => {
  res.json({ open: await prisma.accountRequest.count({ where: { statusCd: 'OPEN' } }) });
});

// 비밀번호 재설정 요청 처리: 임시 비밀번호 발급(응답으로 1회만 표시) → 첫 로그인 시 변경 강제
accountRequestsRouter.post('/:id/issue-temp-password', async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ empId: z.string().min(1) }), req.body);
  const r = await prisma.accountRequest.findUnique({ where: { reqId: Number(req.params.id) } });
  if (!r) throw notFound('요청');
  if (r.statusCd !== 'OPEN') throw new HttpError(409, '이미 처리된 요청입니다.');
  const emp = await prisma.employee.findUnique({ where: { empId: body.empId } });
  if (!emp || emp.statusCd === 'RETIRED') throw new HttpError(400, '임시 비밀번호를 발급할 수 없는 인력입니다.');
  const password = tempPassword();
  await prisma.$transaction([
    prisma.employee.update({ where: { empId: emp.empId }, data: { passwordHash: await bcrypt.hash(password, 10), mustChangePw: true } }),
    prisma.accountRequest.update({
      where: { reqId: r.reqId },
      data: { statusCd: 'DONE', handledBy: u.empId, handledAt: new Date(), handleNote: `임시 비밀번호 발급 (${emp.name})`, matchedEmpId: emp.empId },
    }),
  ]);
  res.json({ ok: true, tempPassword: password, email: emp.email, name: emp.name, phone: emp.phone });
});

// 완료(ID 안내 등)·반려 처리
accountRequestsRouter.post('/:id/close', async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ statusCd: z.enum(['DONE', 'REJECTED']), note: optStr }), req.body);
  const r = await prisma.accountRequest.findUnique({ where: { reqId: Number(req.params.id) } });
  if (!r) throw notFound('요청');
  if (r.statusCd !== 'OPEN') throw new HttpError(409, '이미 처리된 요청입니다.');
  await prisma.accountRequest.update({ where: { reqId: r.reqId }, data: { statusCd: body.statusCd, handledBy: u.empId, handledAt: new Date(), handleNote: body.note } });
  res.json({ ok: true });
});
