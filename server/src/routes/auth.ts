import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { me, requireAuth, signToken, type Role } from '../auth.js';
import { HttpError, prisma } from '../db.js';
import { parse } from '../lib/validate.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) }), req.body);
  const emp = await prisma.employee.findUnique({ where: { email: body.email } });
  if (!emp || emp.statusCd === 'RETIRED' || !(await bcrypt.compare(body.password, emp.passwordHash))) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  const user = { empId: emp.empId, name: emp.name, role: emp.role as Role };
  res.json({ token: signToken(user), user });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const u = me(req);
  const emp = await prisma.employee.findUnique({
    where: { empId: u.empId },
    include: { partner: { select: { partnerNm: true } } },
  });
  if (!emp) throw new HttpError(401, '사용자를 찾을 수 없습니다.');
  const { passwordHash: _, ...rest } = emp;
  res.json(rest);
});

authRouter.put('/me/password', requireAuth, async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ current: z.string(), next: z.string().min(4, '4자 이상') }), req.body);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { empId: u.empId } });
  if (!(await bcrypt.compare(body.current, emp.passwordHash))) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다.');
  await prisma.employee.update({ where: { empId: u.empId }, data: { passwordHash: await bcrypt.hash(body.next, 10) } });
  res.json({ ok: true });
});
