import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { HttpError, prisma } from '../db.js';
import { DEFAULT_SETTINGS, getSettings } from '../lib/settings.js';
import { dateStr, parse } from '../lib/validate.js';

// F-034 기준값 설정 · 공휴일 캘린더
export const adminRouter = Router();

adminRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

adminRouter.put('/settings', requireRole('ADMIN'), async (req, res) => {
  const body = parse(z.record(z.string(), z.string()), req.body);
  for (const [key, value] of Object.entries(body)) {
    if (!(key in DEFAULT_SETTINGS)) throw new HttpError(400, `알 수 없는 설정: ${key}`);
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  res.json(await getSettings());
});

adminRouter.get('/holidays', async (req, res) => {
  const year = String(req.query.year ?? '');
  res.json(await prisma.holiday.findMany({ where: year ? { dt: { startsWith: year } } : {}, orderBy: { dt: 'asc' } }));
});

adminRouter.post('/holidays', requireRole('ADMIN'), async (req, res) => {
  const body = parse(z.object({ dt: dateStr, name: z.string().min(1) }), req.body);
  await prisma.holiday.upsert({ where: { dt: body.dt }, create: body, update: { name: body.name } });
  res.status(201).json({ ok: true });
});

adminRouter.delete('/holidays/:dt', requireRole('ADMIN'), async (req, res) => {
  await prisma.holiday.deleteMany({ where: { dt: String(req.params.dt) } });
  res.json({ ok: true });
});
