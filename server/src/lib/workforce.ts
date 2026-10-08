import { prisma } from '../db.js';
import { today } from './dates.js';
import { usableEmp } from './empFilter.js';

/**
 * 인원·투입 구분의 단일 기준 (대시보드·전사 One-Page·투입현황·가동률 공통)
 * - 대상 인원: 삭제·퇴사·휴직이 아니고 '투입 대상'인 인력 (상태 미지정은 재직으로 간주)
 * - 투입: 기준일에 진행 중인 배정이 있음
 * - 투입 예정: 기준일에는 배정이 없지만 기준일 이후 시작하는 배정이 있음
 * - 대기: 진행 중·예정 배정 모두 없음
 */
export type WorkforceCategory = 'ASSIGNED' | 'PLANNED' | 'BENCH';

export interface WorkforceRow {
  empId: string;
  name: string;
  deptCd: string;
  employType: string;
  current: number; // 기준일 배정률 합계(%)
  planned: number; // 기준일 이후 시작하는 배정의 배정률 합계(%)
  plannedStartDt: string | null; // 가장 빠른 예정 시작일
  category: WorkforceCategory;
}

/** 대상 인원(등록된 전체 인원): 삭제·퇴사·휴직이 아니고 '투입 대상'인 인력 */
export function targetEmployees() {
  return prisma.employee.findMany({
    where: { AND: [usableEmp, { utilTarget: true }, { OR: [{ statusCd: null }, { statusCd: { not: 'LEAVE' } }] }] },
    select: { empId: true, name: true, deptCd: true, gradeCd: true, employType: true },
    orderBy: [{ deptCd: 'asc' }, { name: 'asc' }],
  });
}

export async function workforce(ref: string = today()) {
  const emps = await targetEmployees();
  const asg = await prisma.assignment.findMany({
    where: { canceled: false, endDt: { gte: ref }, empId: { in: emps.map((e) => e.empId) } },
    select: { empId: true, startDt: true, endDt: true, allocRate: true },
  });
  const rows: WorkforceRow[] = emps.map((e) => {
    const mine = asg.filter((a) => a.empId === e.empId);
    const current = mine.filter((a) => a.startDt <= ref).reduce((s, a) => s + a.allocRate, 0);
    const future = mine.filter((a) => a.startDt > ref);
    const planned = future.reduce((s, a) => s + a.allocRate, 0);
    const plannedStartDt = future.length ? future.map((a) => a.startDt).sort()[0] : null;
    return { empId: e.empId, name: e.name, deptCd: e.deptCd, employType: e.employType, current, planned, plannedStartDt, category: current > 0 ? 'ASSIGNED' : planned > 0 ? 'PLANNED' : 'BENCH' };
  });
  const isOwn = (t: string) => t === 'REG' || t === 'CONT';
  return {
    ref,
    rows,
    summary: {
      total: rows.length,
      own: rows.filter((r) => isOwn(r.employType)).length,
      partner: rows.filter((r) => !isOwn(r.employType)).length,
      assigned: rows.filter((r) => r.category === 'ASSIGNED').length,
      planned: rows.filter((r) => r.category === 'PLANNED').length,
      bench: rows.filter((r) => r.category === 'BENCH').length,
      overAllocated: rows.filter((r) => r.current > 100).length,
    },
  };
}
