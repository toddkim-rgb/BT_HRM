import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { MENUS, ROLES, getPermissions, savePermissions } from '../lib/permissions.js';
import { requireMenu } from '../lib/permissions.js';
import { HttpError, prisma } from '../db.js';
import { DEFAULT_SETTINGS, getSettings } from '../lib/settings.js';
import { dateStr, parse } from '../lib/validate.js';

// F-034 기준값 설정 · 공휴일 캘린더
export const adminRouter = Router();

adminRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

adminRouter.put('/settings', requireMenu('settings', 'EDIT'), async (req, res) => {
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

adminRouter.post('/holidays', requireMenu('settings', 'EDIT'), async (req, res) => {
  const body = parse(z.object({ dt: dateStr, name: z.string().min(1) }), req.body);
  await prisma.holiday.upsert({ where: { dt: body.dt }, create: body, update: { name: body.name } });
  res.status(201).json({ ok: true });
});

adminRouter.delete('/holidays/:dt', requireMenu('settings', 'EDIT'), async (req, res) => {
  await prisma.holiday.deleteMany({ where: { dt: String(req.params.dt) } });
  res.json({ ok: true });
});

// ---- 메뉴 권한 (시스템관리자 전용, 고정) ----
adminRouter.get('/permissions', requireRole('ADMIN'), async (_req, res) => {
  res.json({ roles: ROLES, menus: MENUS, permissions: await getPermissions() });
});

adminRouter.put('/permissions', requireRole('ADMIN'), async (req, res) => {
  const body = parse(z.record(z.string(), z.record(z.string(), z.enum(['NONE', 'VIEW', 'EDIT']))), req.body);
  await savePermissions(body);
  res.json({ roles: ROLES, menus: MENUS, permissions: await getPermissions() });
});
