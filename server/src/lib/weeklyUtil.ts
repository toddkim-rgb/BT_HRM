import { prisma } from '../db.js';
import { businessDays, isoWeek, shiftWeek, today, weekDays } from './dates.js';
import { holidaySet } from './settings.js';
import { targetEmployees } from './workforce.js';

/**
 * 가동률 (v1.8 재정의, 주 단위)
 *   가동률(주) = 그 주에 프로젝트 배정이 있는 인원 ÷ 등록된 전체 인원(대상 인원) × 100
 * - 투입 판단: 투입 배정 기준. 그 주 영업일 중 하루라도 진행 중인 프로젝트 배정이 있으면 투입
 * - 부분 투입(50% 배정 등)도 1명으로 셈 (인원수 기준)
 * - 대상 인원: 삭제·퇴사·휴직이 아니고 '투입 대상'인 인력 (lib/workforce 와 동일)
 * - 기본 집계 주: 지난주
 */

export const lastWeek = () => shiftWeek(isoWeek(today()), -1);

export interface WeekUtilRow {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  employType: string;
  assigned: boolean;
  allocTotal: number; // 그 주 배정 투입률 합계 (참고)
  projects: { prjCd: string; prjNm: string; allocRate: number; roleCd: string }[];
  reportedMd: number; // 그 주 제출된 주간보고의 프로젝트 투입 MD (참고)
}

function rate(assigned: number, total: number) {
  return total ? Math.round((assigned / total) * 1000) / 10 : null;
}

export async function weeklyUtilization(week: string) {
  const days = weekDays(week);
  const holidays = await holidaySet();
  const bdays = businessDays(days[0], days[6], holidays);
  const checkDays = bdays.length ? bdays : days; // 영업일이 없는 주는 달력 기준
  const emps = await targetEmployees();
  const asg = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: days[6] }, endDt: { gte: days[0] }, empId: { in: emps.map((e) => e.empId) }, project: { prjType: { not: 'NP' } } },
    select: { empId: true, prjCd: true, roleCd: true, allocRate: true, startDt: true, endDt: true, project: { select: { prjNm: true } } },
  });
  const md = await prisma.timesheet.groupBy({
    by: ['empId'],
    where: { workDt: { gte: days[0], lte: days[6] }, weeklyWork: { statusCd: 'SUBMITTED' }, project: { prjType: { not: 'NP' } } },
    _sum: { md: true },
  });
  const rows: WeekUtilRow[] = emps.map((e) => {
    const mine = asg.filter((a) => a.empId === e.empId && checkDays.some((d) => d >= a.startDt && d <= a.endDt));
    return {
      empId: e.empId,
      name: e.name,
      deptCd: e.deptCd,
      gradeCd: e.gradeCd,
      employType: e.employType,
      assigned: mine.length > 0,
      allocTotal: mine.reduce((s, a) => s + a.allocRate, 0),
      projects: mine.map((a) => ({ prjCd: a.prjCd, prjNm: a.project.prjNm, allocRate: a.allocRate, roleCd: a.roleCd })),
      reportedMd: md.find((m) => m.empId === e.empId)?._sum.md ?? 0,
    };
  });
  const total = rows.length;
  const assigned = rows.filter((r) => r.assigned).length;
  const group = (key: 'deptCd' | 'employType') =>
    [...new Set(rows.map((r) => r[key]))].map((k) => {
      const g = rows.filter((r) => r[key] === k);
      const a = g.filter((r) => r.assigned).length;
      return { key: k, total: g.length, assigned: a, rate: rate(a, g.length) };
    });
  return { week, days, total, assigned, notAssigned: total - assigned, rate: rate(assigned, total), rows, byDept: group('deptCd'), byEmployType: group('employType') };
}

/** 주간 가동률 추이: 기준 주까지 과거 N주 + (선택) 이후 M주 예상(배정 기준) */
export async function weeklyTrend(week: string, past = 12, future = 0) {
  const cur = isoWeek(today());
  const out = [];
  for (let i = -(past - 1); i <= future; i++) {
    const w = shiftWeek(week, i);
    const u = await weeklyUtilization(w);
    out.push({ week: w, start: u.days[0], total: u.total, assigned: u.assigned, rate: u.rate, projected: w >= cur });
  }
  return out;
}
