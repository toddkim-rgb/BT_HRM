import { Router } from 'express';
import { me } from '../auth.js';
import { prisma } from '../db.js';
import { addDays, isoWeek, shiftWeek, today } from '../lib/dates.js';

/**
 * 대시보드 인사말 재료: 날씨(서울) · 내 주간보고 상태 · 지연 항목 · 배정률 · 다가오는 공휴일
 * - 문구는 화면에서 만들고, 서버는 사실(숫자)만 내려줌
 */
export const greetingRouter = Router();

interface Weather {
  temp: number; // 현재 기온 (℃)
  code: number; // WMO 날씨 코드
  max: number | null; // 오늘 최고
  min: number | null; // 오늘 최저
  rainProb: number | null; // 오늘 최대 강수확률 (%)
}

// 서울 기준, 30분 캐시 (실패해도 인사말은 날씨 없이 표시)
const SEOUL = { lat: 37.5665, lon: 126.978 };
let weatherCache: { at: number; value: Weather | null } | null = null;
async function seoulWeather(): Promise<Weather | null> {
  if (weatherCache && Date.now() - weatherCache.at < 30 * 60_000) return weatherCache.value;
  let value: Weather | null = null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${SEOUL.lat}&longitude=${SEOUL.lon}` +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=1';
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const d = (await r.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
        daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[] };
      };
      if (d.current?.temperature_2m != null && d.current.weather_code != null) {
        value = {
          temp: Math.round(d.current.temperature_2m),
          code: d.current.weather_code,
          max: d.daily?.temperature_2m_max?.[0] != null ? Math.round(d.daily.temperature_2m_max[0]) : null,
          min: d.daily?.temperature_2m_min?.[0] != null ? Math.round(d.daily.temperature_2m_min[0]) : null,
          rainProb: d.daily?.precipitation_probability_max?.[0] ?? null,
        };
      }
    }
  } catch {
    // 네트워크 오류·시간 초과 → 날씨 없이
  }
  weatherCache = { at: Date.now(), value };
  return value;
}

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
