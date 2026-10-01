import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { HttpError, notFound, prisma } from '../db.js';
import { optDate, optStr, parse } from '../lib/validate.js';

// 7장 협력사 마스터 (F-033) — 계약·단가 관리는 손익 단계에서 확장
export const partnersRouter = Router();

const partnerSchema = z.object({
  partnerNm: z.string().min(1),
  bizRegNo: optStr,
  contactNm: optStr,
  contactPhone: optStr,
  contractStartDt: optDate,
  contractEndDt: optDate,
  statusCd: z.enum(['ACTIVE', 'STOPPED']).default('ACTIVE'),
});

// 목록은 인력 등록 화면에서도 쓰므로 PM 이상 조회 허용 (단가 정보 없음)
partnersRouter.get('/', requireRole('PM', 'EXEC', 'ADMIN', 'SALES'), async (_req, res) => {
  const rows = await prisma.partner.findMany({
    include: { _count: { select: { employees: { where: { statusCd: { not: 'RETIRED' } } } } } },
    orderBy: { partnerNm: 'asc' },
  });
  res.json(rows.map(({ _count, ...p }) => ({ ...p, headcount: _count.employees })));
});

partnersRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const body = parse(partnerSchema, req.body);
  const rows = await prisma.partner.findMany({ select: { partnerId: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.partnerId.replace(/\D/g, '')) || 0), 0);
  const partnerId = `PT-${String(max + 1).padStart(3, '0')}`;
  await prisma.partner.create({ data: { ...body, partnerId } });
  res.status(201).json({ partnerId });
});

partnersRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  const body = parse(partnerSchema, req.body);
  if (!(await prisma.partner.findUnique({ where: { partnerId: String(req.params.id) } }))) throw notFound('협력사');
  await prisma.partner.update({ where: { partnerId: String(req.params.id) }, data: body });
  res.json({ ok: true });
});

partnersRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const used = await prisma.employee.count({ where: { partnerId: String(req.params.id) } });
  if (used) throw new HttpError(409, '소속 인력이 있는 협력사는 삭제할 수 없습니다. 거래중지로 변경하세요.');
  await prisma.partner.delete({ where: { partnerId: String(req.params.id) } });
  res.json({ ok: true });
});
