import { Router } from 'express';
import { me } from '../auth.js';
import { prisma } from '../db.js';
import { addDays, isoWeek, shiftWeek, today } from '../lib/dates.js';
import { seoulWeather } from '../lib/kmaWeather.js';

/**
 * 대시보드 인사말 재료: 날씨(서울, 기상청) · 내 주간보고 상태 · 지연 항목 · 배정률 · 다가오는 공휴일
 * - 문구는 화면에서 만들고, 서버는 사실(숫자)만 내려줌
 */
export const greetingRouter = Router();

greetingRouter.get('/', async (req, res) => {
  const u = me(req);
  const now = today();
  const week = isoWeek(now);
  const [weather, works, assignments, holidays, upcoming] = await Promise.all([
    seoulWeather(),
    prisma.weeklyWork.findMany({
      where: { empId: u.empId, reportWeek: { in: [week, shiftWeek(week, -1)] } },
      select: { reportWeek: true, statusCd: true, workItems: { where: { itemType: 'ACTUAL', statusCd: 'DELAY' }, select: { wiId: true } } },
    }),
    prisma.assignment.findMany({
      where: { empId: u.empId, canceled: false, startDt: { lte: now }, endDt: { gte: now } },
      select: { allocRate: true, endDt: true },
    }),
    prisma.holiday.findMany({ where: { dt: { gt: now, lte: addDays(now, 14) } }, orderBy: { dt: 'asc' } }),
    prisma.assignment.count({ where: { empId: u.empId, canceled: false, startDt: { gt: now } } }),
  ]);
  const cur = works.find((w) => w.reportWeek === week);
  const prev = works.find((w) => w.reportWeek !== week);
  res.json({
    today: now,
    weather,
    report: {
      thisWeek: cur?.statusCd ?? 'NONE', // NONE/DRAFT/SUBMITTED
      lastWeek: prev?.statusCd ?? 'NONE',
      delayItems: cur?.workItems.length ?? 0,
    },
    projects: assignments.length,
    allocSum: assignments.reduce((s, a) => s + a.allocRate, 0),
    upcoming, // 시작 전 배정
    endingSoon: assignments.filter((a) => a.endDt <= addDays(now, 14)).length, // 2주 안에 철수 예정
    nextHoliday: holidays[0] ? { dt: holidays[0].dt, name: holidays[0].name } : null,
  });
});
