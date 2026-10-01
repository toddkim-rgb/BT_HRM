import { Router } from 'express';
import { z } from 'zod';
import { isManager, me, requireRole } from '../auth.js';
import { HttpError, forbidden, notFound, prisma } from '../db.js';
import { today } from '../lib/dates.js';
import { optDate, optStr, parse } from '../lib/validate.js';

// 4장 프로젝트 코드 (F-031, F-040)
export const projectsRouter = Router();

export const PRJ_TYPES = ['SM', 'SI', 'IN', 'PS', 'ETC'] as const;
export const PAID_TYPES = ['SM', 'SI'];
export const WORK_TYPES = ['SM', 'SI', 'IN', 'PS', 'ETC']; // 가동률 분자(총 가동)

const projectSchema = z.object({
  prjType: z.enum(PRJ_TYPES),
  prjNm: z.string().min(1),
  customerNm: optStr,
  contractType: z.enum(['PRIME', 'SUB']).nullish(),
  primeContractor: optStr,
  startDt: optDate,
  endDt: optDate,
  contractMm: z.number().nonnegative().nullish(),
  contractAmt: z.number().int().nonnegative().nullish(),
  revenueMethod: z.enum(['MONTHLY', 'MM']).nullish(),
  winProb: z.number().int().min(0).max(100).nullish(),
  plOpenYn: z.boolean().default(false),
  pmEmpId: optStr,
  residentType: z.enum(['ONSITE', 'OFFSITE', 'MIXED']).nullish(),
  statusCd: z.enum(['SALES', 'WON', 'ACTIVE', 'DONE', 'STOP', 'LOST']).default('ACTIVE'),
});

/** 금액 정보 노출 여부: 경영진·관리자·영업, 또는 손익 공개된 프로젝트의 PM */
function canSeeAmount(u: { role: string; empId: string }, p: { pmEmpId: string | null; plOpenYn: boolean }) {
  return isManager(u as never) || u.role === 'SALES' || (u.role === 'PM' && p.pmEmpId === u.empId && p.plOpenYn);
}

async function nextPrjCd(type: string, year: string): Promise<string> {
  const prefix = `${type}-${year}-`;
  const rows = await prisma.project.findMany({ where: { prjCd: { startsWith: prefix } }, select: { prjCd: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.prjCd.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

projectsRouter.get('/', async (req, res) => {
  const u = me(req);
  const { type, status, mine, includeNp } = req.query as Record<string, string | undefined>;
  const rows = await prisma.project.findMany({
    where: {
      ...(type ? { prjType: type } : includeNp === 'Y' ? {} : { prjType: { not: 'NP' } }),
      ...(status ? { statusCd: { in: status.split(',') } } : {}),
      ...(mine === 'Y' ? { pmEmpId: u.empId } : {}),
    },
    include: { pm: { select: { name: true } }, _count: { select: { assignments: { where: { canceled: false, startDt: { lte: today() }, endDt: { gte: today() } } } } } },
    orderBy: [{ prjType: 'asc' }, { prjCd: 'desc' }],
  });
  res.json(
    rows.map(({ _count, pm, ...p }) => ({
      ...p,
      pmName: pm?.name ?? null,
      headcount: _count.assignments,
      ...(canSeeAmount(u, p) ? {} : { contractAmt: null }),
      amountVisible: canSeeAmount(u, p),
    })),
  );
});

projectsRouter.get('/:prjCd', async (req, res) => {
  const u = me(req);
  const p = await prisma.project.findUnique({ where: { prjCd: String(req.params.prjCd) }, include: { pm: { select: { name: true } } } });
  if (!p) throw notFound('프로젝트');
  const { pm, ...rest } = p;
  res.json({ ...rest, pmName: pm?.name ?? null, ...(canSeeAmount(u, p) ? {} : { contractAmt: null }), amountVisible: canSeeAmount(u, p) });
});

projectsRouter.post('/', requireRole('ADMIN', 'SALES'), async (req, res) => {
  const u = me(req);
  const body = parse(projectSchema, req.body);
  if (u.role === 'SALES' && body.statusCd !== 'SALES') throw new HttpError(403, '영업담당은 영업중 프로젝트만 등록할 수 있습니다.');
  if (body.startDt && body.endDt && body.startDt > body.endDt) throw new HttpError(400, '종료일이 시작일보다 빠릅니다.');
  const year = (body.startDt ?? today()).slice(0, 4);
  const prjCd = await nextPrjCd(body.prjType, year);
  await prisma.project.create({
    data: { ...body, prjCd, revenueMethod: body.revenueMethod ?? (body.prjType === 'SM' ? 'MONTHLY' : body.prjType === 'SI' ? 'MM' : null) },
  });
  res.status(201).json({ prjCd });
});

projectsRouter.put('/:prjCd', requireRole('ADMIN', 'SALES'), async (req, res) => {
  const u = me(req);
  const cur = await prisma.project.findUnique({ where: { prjCd: String(req.params.prjCd) } });
  if (!cur || cur.prjType === 'NP') throw notFound('프로젝트');
  const body = parse(projectSchema, req.body);
  if (u.role === 'SALES' && cur.statusCd !== 'SALES') throw forbidden();
  if (body.prjType !== cur.prjType) throw new HttpError(400, '사업구분은 변경할 수 없습니다 (코드 체계 유지).');
  await prisma.project.update({ where: { prjCd: cur.prjCd }, data: body });
  res.json({ ok: true });
});
