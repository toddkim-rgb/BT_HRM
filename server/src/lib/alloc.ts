import { prisma } from '../db.js';
import { businessDays, overlap, today } from './dates.js';

export type AsgStatus = 'PLANNED' | 'ACTIVE' | 'ENDED' | 'CANCELED';

/** 배정 상태는 날짜로 계산 (명세 13.2 assignment.status_cd) */
export function assignmentStatus(a: { startDt: string; endDt: string; canceled: boolean }, at = today()): AsgStatus {
  if (a.canceled) return 'CANCELED';
  if (at < a.startDt) return 'PLANNED';
  if (at > a.endDt) return 'ENDED';
  return 'ACTIVE';
}

/** 기간 중 일자별 투입률 합계의 최댓값 (100 초과분 = 과투입 %) */
export async function maxAllocation(empId: string, start: string, end: string): Promise<number> {
  const rows = await prisma.assignment.findMany({
    where: { empId, canceled: false, startDt: { lte: end }, endDt: { gte: start } },
    select: { startDt: true, endDt: true, allocRate: true },
  });
  // 투입률 합계는 배정 시작일에서만 증가하므로 시작 지점들만 확인
  const points = new Set([start, ...rows.map((r) => r.startDt).filter((d) => d >= start && d <= end)]);
  let max = 0;
  for (const p of points) {
    const sum = rows.filter((r) => r.startDt <= p && r.endDt >= p).reduce((s, r) => s + r.allocRate, 0);
    max = Math.max(max, sum);
  }
  return max;
}

/** 오늘 기준 인력별 투입률 합계 */
export async function currentAllocations(): Promise<Map<string, number>> {
  const t = today();
  const rows = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: t }, endDt: { gte: t } },
    select: { empId: true, allocRate: true },
  });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.empId, (m.get(r.empId) ?? 0) + r.allocRate);
  return m;
}

/** 배정의 기간 내 계획 MD = 영업일 × 투입률 */
export function plannedMd(
  a: { startDt: string; endDt: string; allocRate: number },
  rangeStart: string,
  rangeEnd: string,
  holidays: Set<string>,
): number {
  const o = overlap(a.startDt, a.endDt, rangeStart, rangeEnd);
  if (!o) return 0;
  return (businessDays(o.start, o.end, holidays).length * a.allocRate) / 100;
}
