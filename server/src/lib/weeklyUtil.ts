import { prisma } from '../db.js';
import { plannedMd } from './alloc.js';
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
 * - 보조 지표 FTE 가동률(v1.12) = Σ(인력별 그 주 배정률, 최대 100%) ÷ 대상 인원 — 반만 투입된 인력까지 드러남
 * - 주 단위 확정(v1.12): 지난 주는 처음 집계할 때 확정·저장(UtilSnapshot). 이후 배정을 고쳐도 과거 기록은 유지
 */

export const lastWeek = () => shiftWeek(isoWeek(today()), -1);

export interface WeekUtilRow {
  empId: string;
  name: string;
  deptCd: string;
  gradeCd: string;
  employType: string;
  assigned: boolean;
  allocTotal: number; // 그 주 배정률 합계 (참고)
  fte: number; // 그 주 실제 배정 비중 (영업일 가중, 0~1, 최대 1)
  projects: { prjCd: string; prjNm: string; allocRate: number; roleCd: string }[];
  reportedMd: number; // 그 주 제출된 주간보고의 프로젝트 투입 MD (참고)
}

function rate(assigned: number, total: number) {
  return total ? Math.round((assigned / total) * 1000) / 10 : null;
}

async function computeWeek(week: string) {
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
      fte: Math.round(Math.min(1, mine.reduce((s, a) => s + plannedMd(a, days[0], days[6], holidays), 0) / (bdays.length || 1)) * 100) / 100,
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
  const fteSum = rows.reduce((s, r) => s + r.fte, 0);
  const fteRate = total ? Math.round((fteSum / total) * 1000) / 10 : null;
  return { week, days, total, assigned, notAssigned: total - assigned, rate: rate(assigned, total), fte: Math.round(fteSum * 10) / 10, fteRate, rows, byDept: group('deptCd'), byEmployType: group('employType') };
}

export type WeekUtil = Awaited<ReturnType<typeof computeWeek>> & { confirmedAt: string | null };

/**
 * 주간 가동률: 지난 주는 확정 기록(UtilSnapshot)을 쓰고, 없으면 지금 집계해 확정·저장
 * 이번 주·이후 주는 배정 기준 실시간(예상)
 */
export async function weeklyUtilization(week: string): Promise<WeekUtil> {
  const past = week < isoWeek(today());
  if (past) {
    const snap = await prisma.utilSnapshot.findUnique({ where: { week } });
    if (snap) return { ...(JSON.parse(snap.data) as Awaited<ReturnType<typeof computeWeek>>), confirmedAt: snap.confirmedAt.toISOString() };
  }
  const r = await computeWeek(week);
  if (!past) return { ...r, confirmedAt: null };
  const saved = await prisma.utilSnapshot.upsert({
    where: { week },
    create: { week, total: r.total, assigned: r.assigned, rate: r.rate, fteRate: r.fteRate, data: JSON.stringify(r) },
    update: {},
  });
  return { ...r, confirmedAt: saved.confirmedAt.toISOString() };
}

/** 지난 주 확정 기록 다시 집계 (배정을 정정한 뒤 과거 기록을 바로잡을 때, 관리자) */
export async function reconfirmWeek(week: string): Promise<WeekUtil> {
  const r = await computeWeek(week);
  const saved = await prisma.utilSnapshot.upsert({
    where: { week },
    create: { week, total: r.total, assigned: r.assigned, rate: r.rate, fteRate: r.fteRate, data: JSON.stringify(r) },
    update: { total: r.total, assigned: r.assigned, rate: r.rate, fteRate: r.fteRate, data: JSON.stringify(r), confirmedAt: new Date() },
  });
  return { ...r, confirmedAt: saved.confirmedAt.toISOString() };
}

/** 주간 가동률 추이: 기준 주까지 과거 N주 + (선택) 이후 M주 예상(배정 기준) */
export async function weeklyTrend(week: string, past = 12, future = 0) {
  const cur = isoWeek(today());
  const out = [];
  for (let i = -(past - 1); i <= future; i++) {
    const w = shiftWeek(week, i);
    const u = await weeklyUtilization(w);
    out.push({ week: w, start: u.days[0], total: u.total, assigned: u.assigned, rate: u.rate, fteRate: u.fteRate ?? null, projected: w >= cur, confirmed: !!u.confirmedAt });
  }
  return out;
}
