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

export interface CurrentAlloc {
  prjCd: string;
  prjNm: string;
  roleCd: string;
  allocRate: number;
  endDt: string;
}

/** 오늘 기준 인력별 투입 중인 배정 (다중 프로젝트 투입 현황) */
export async function currentAllocations(): Promise<Map<string, CurrentAlloc[]>> {
  const t = today();
  const rows = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: t }, endDt: { gte: t } },
    select: { empId: true, prjCd: true, roleCd: true, allocRate: true, endDt: true, project: { select: { prjNm: true } } },
    orderBy: { allocRate: 'desc' },
  });
  const m = new Map<string, CurrentAlloc[]>();
  for (const r of rows) {
    if (!m.has(r.empId)) m.set(r.empId, []);
    m.get(r.empId)!.push({ prjCd: r.prjCd, prjNm: r.project.prjNm, roleCd: r.roleCd, allocRate: r.allocRate, endDt: r.endDt });
  }
  return m;
}

/** 아직 시작 전인 예정 배정: 인력별 투입률 합계와 가장 빠른 시작일 */
export async function plannedAllocations(): Promise<Map<string, { alloc: number; startDt: string }>> {
  const t = today();
  const rows = await prisma.assignment.findMany({ where: { canceled: false, startDt: { gt: t } }, select: { empId: true, allocRate: true, startDt: true } });
  const m = new Map<string, { alloc: number; startDt: string }>();
  for (const r of rows) {
    const cur = m.get(r.empId);
    m.set(r.empId, { alloc: (cur?.alloc ?? 0) + r.allocRate, startDt: cur && cur.startDt < r.startDt ? cur.startDt : r.startDt });
  }
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
