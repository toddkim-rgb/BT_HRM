import { prisma } from '../db.js';

// 기준값 (F-034). DB Setting 테이블 값이 우선.
export const DEFAULT_SETTINGS = {
  MD_PER_MM: '22',
  HOURS_PER_MD: '8',
  OVERHEAD_RATE: '0.2', // 자사 원가단가 간접비율
  ALERT_RELEASE_DAYS: '30,7', // AL-01
  ALERT_MM_BURN: '80,100', // AL-03
  ALERT_PARTNER_END_DAYS: '30', // AL-04
  ALERT_BENCH_WEEKS: '2', // AL-05
  ALERT_PROGRESS_DELAY_PP: '-10', // AL-06
  LOW_UTIL_PCT: '70', // 저가동 기준
};

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.setting.findMany();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in out) out[r.key as SettingKey] = r.value;
  return out;
}

export async function mdPerMm(): Promise<number> {
  return Number((await getSettings()).MD_PER_MM) || 22;
}

export async function holidaySet(): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany();
  return new Set(rows.map((r) => r.dt));
}
