import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { me, requireAuth, signToken, type Role } from '../auth.js';
import { HttpError, prisma } from '../db.js';
import { assertPasswordPolicy, maskEmail, rateLimit } from '../lib/password.js';
import { optStr, parse } from '../lib/validate.js';

export const authRouter = Router();

type EmpLike = { empId: string; name: string; role: string; mustChangePw: boolean };
const ip = (req: Request) => req.ip ?? 'unknown';
const userOf = (emp: EmpLike) => ({ empId: emp.empId, name: emp.name, role: emp.role as Role, mustChangePw: emp.mustChangePw });

authRouter.post('/login', async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) }), req.body);
  // 계정별 무차별 대입 방지 (사내 NAT 환경을 고려해 IP+이메일 기준)
  rateLimit(`login:${ip(req)}:${body.email}`, 10, 5 * 60 * 1000);
  const emp = await prisma.employee.findUnique({ where: { email: body.email } });
  if (!emp || emp.statusCd === 'RETIRED' || !(await bcrypt.compare(body.password, emp.passwordHash))) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  const user = userOf(emp);
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

// 비밀번호 변경 (초기·임시 비밀번호 변경 강제 포함) → 변경 강제 해제된 새 토큰 발급
authRouter.put('/me/password', requireAuth, async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { empId: u.empId } });
  if (!(await bcrypt.compare(body.current, emp.passwordHash))) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다.');
  assertPasswordPolicy(body.next);
  if (body.next === body.current) throw new HttpError(400, '현재 비밀번호와 다른 비밀번호를 입력하세요.');
  const updated = await prisma.employee.update({
    where: { empId: u.empId },
    data: { passwordHash: await bcrypt.hash(body.next, 10), mustChangePw: false },
  });
  const user = userOf(updated);
  res.json({ ok: true, token: signToken(user), user });
});

// ---- 로그인 전 공개 API: 비밀번호 재설정 요청, ID 찾기·문의 (메일 발송 없이 관리자가 처리) ----

// 비밀번호 재설정 요청. 계정 존재 여부는 응답으로 알리지 않음
authRouter.post('/password-reset-request', async (req, res) => {
  rateLimit(`pwreq:${ip(req)}`, 5, 10 * 60 * 1000);
  const body = parse(
    z.object({ email: z.string().trim().toLowerCase().email('이메일 형식이 올바르지 않습니다'), name: z.string().trim().min(1, '성명을 입력하세요'), message: optStr }),
    req.body,
  );
  const emp = await prisma.employee.findUnique({ where: { email: body.email }, select: { empId: true, name: true, statusCd: true } });
  const matched = emp && emp.name === body.name && emp.statusCd !== 'RETIRED' ? emp.empId : null;
  const dup = await prisma.accountRequest.findFirst({ where: { reqType: 'PW_RESET', email: body.email, statusCd: 'OPEN' } });
  if (!dup) await prisma.accountRequest.create({ data: { reqType: 'PW_RESET', name: body.name, email: body.email, message: body.message, matchedEmpId: matched } });
  res.json({ ok: true });
});

// ID(이메일) 찾기: 성명 + 사번이 일치하면 일부를 가린 이메일
authRouter.post('/id-lookup', async (req, res) => {
  rateLimit(`idlookup:${ip(req)}`, 10, 10 * 60 * 1000);
  const body = parse(z.object({ name: z.string().trim().min(1, '성명을 입력하세요'), empId: z.string().trim().min(1, '사번을 입력하세요') }), req.body);
  const emp = await prisma.employee.findUnique({ where: { empId: body.empId }, select: { name: true, email: true, statusCd: true } });
  if (!emp || emp.name !== body.name || emp.statusCd === 'RETIRED') throw new HttpError(404, '일치하는 계정이 없습니다. 관리자에게 문의를 남겨 주세요.');
  res.json({ maskedEmail: maskEmail(emp.email) });
});

// ID 문의 → 관리자 처리 대기
authRouter.post('/id-inquiry', async (req, res) => {
  rateLimit(`idinq:${ip(req)}`, 5, 10 * 60 * 1000);
  const body = parse(
    z.object({ name: z.string().trim().min(1, '성명을 입력하세요'), empId: optStr, contact: z.string().trim().min(1, '연락받을 연락처를 입력하세요'), message: optStr }),
    req.body,
  );
  const cand = body.empId ? await prisma.employee.findUnique({ where: { empId: body.empId }, select: { empId: true, name: true } }) : null;
  await prisma.accountRequest.create({
    data: { reqType: 'ID_INQUIRY', name: body.name, empId: body.empId, contact: body.contact, message: body.message, matchedEmpId: cand?.name === body.name ? cand.empId : null },
  });
  res.json({ ok: true });
});
