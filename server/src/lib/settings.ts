import { prisma } from '../db.js';

// 기준값 (F-034). DB Setting 테이블 값이 우선.
export const DEFAULT_SETTINGS = {
  MD_PER_MM: '22',
  HOURS_PER_MD: '8',
  ALERT_RELEASE_DAYS: '30,7', // AL-01
  ALERT_MM_BURN: '80,100', // AL-03
  ALERT_PARTNER_END_DAYS: '30', // AL-04
  ALERT_BENCH_WEEKS: '2', // AL-05
  ALERT_PROGRESS_DELAY_PP: '-10', // AL-06
};

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

/** 기준값이 DB에 없으면 기본값으로 채워 둔다 (서버 시작 시 실행) — 화면·계산은 DB 값을 사용 */
export async function ensureDefaultSettings(): Promise<number> {
  const have = new Set((await prisma.setting.findMany({ select: { key: true } })).map((r) => r.key));
  const missing = Object.entries(DEFAULT_SETTINGS).filter(([k]) => !have.has(k));
  for (const [key, value] of missing) await prisma.setting.create({ data: { key, value } });
  // 더 이상 쓰지 않는 기준값은 DB에서 정리 (예: v1.8 가동률 재정의로 폐지된 저가동 기준)
  await prisma.setting.deleteMany({ where: { key: { notIn: Object.keys(DEFAULT_SETTINGS) } } });
  return missing.length;
}

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
