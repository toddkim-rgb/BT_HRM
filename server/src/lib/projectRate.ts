import { prisma } from '../db.js';
import { plannedMd } from './alloc.js';
import { addDays, today } from './dates.js';
import { holidaySet, mdPerMm } from './settings.js';

/**
 * 프로젝트 투입률 (v1.12) — 프로젝트 전체 기간에 MD가 얼마나 쓰였는지, 종료 시 100% 목표
 *   투입률 = 누적 실적 MD ÷ 기준 MD × 100
 * - 기준 MD: 계약 MM × 1MM 환산 MD(기준값). 계약 MM이 없으면 배정 계획 MD(Σ 배정 기간 영업일 × 배정률)
 * - 실적 MD: 제출된 주간 업무보고의 투입 MD
 * - 경과율: 프로젝트 기간(달력일) 중 오늘까지 지난 비율
 * - 상태: 투입률이 경과율보다 10%p 넘게 낮으면 미달, 높으면 초과, 그 외 정상 (완료·중단은 완료, 시작 전은 시작 전)
 * - 종료 예상 투입률: (실적 MD + 오늘 이후 남은 배정 계획 MD) ÷ 기준 MD
 */
export type RateStatus = 'NOT_STARTED' | 'NORMAL' | 'UNDER' | 'OVER' | 'DONE' | 'NO_BASE';
export interface ProjectRate {
  prjCd: string;
  baseType: 'CONTRACT' | 'PLAN' | null;
  baseMd: number | null;
  actualMd: number;
  planMd: number;
  remainingPlanMd: number;
  rate: number | null;
  elapsed: number | null;
  forecast: number | null;
  status: RateStatus;
}

export const RATE_GAP = 10; // 경과율 대비 허용 차이(%p)

const r1 = (n: number) => Math.round(n * 10) / 10;
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

export async function projectRates(prjCds?: string[]): Promise<Map<string, ProjectRate>> {
  const holidays = await holidaySet();
  const mdmm = await mdPerMm();
  const t = today();
  const where = { prjType: { not: 'NP' }, ...(prjCds ? { prjCd: { in: prjCds } } : {}) };
  const projects = await prisma.project.findMany({ where, select: { prjCd: true, statusCd: true, startDt: true, endDt: true, contractMm: true } });
  const codes = projects.map((p) => p.prjCd);
  const asg = await prisma.assignment.findMany({ where: { canceled: false, prjCd: { in: codes } }, select: { prjCd: true, startDt: true, endDt: true, allocRate: true } });
  const ts = await prisma.timesheet.groupBy({ by: ['prjCd'], where: { prjCd: { in: codes }, weeklyWork: { statusCd: 'SUBMITTED' } }, _sum: { md: true } });
  const tomorrow = addDays(t, 1);
  const out = new Map<string, ProjectRate>();
  for (const p of projects) {
    const pa = asg.filter((a) => a.prjCd === p.prjCd);
    const planMd = pa.reduce((s, a) => s + plannedMd(a, a.startDt, a.endDt, holidays), 0);
    const remainingPlanMd = pa.reduce((s, a) => s + (a.endDt >= tomorrow ? plannedMd(a, tomorrow, a.endDt, holidays) : 0), 0);
    const actualMd = ts.find((x) => x.prjCd === p.prjCd)?._sum.md ?? 0;
    const baseType = p.contractMm ? 'CONTRACT' : planMd > 0 ? 'PLAN' : null;
    const baseMd = p.contractMm ? p.contractMm * mdmm : planMd > 0 ? planMd : null;
    const rate = baseMd ? r1((actualMd / baseMd) * 100) : null;
    let elapsed: number | null = null;
    if (p.startDt && p.endDt && p.endDt >= p.startDt) {
      const span = dayNo(p.endDt) - dayNo(p.startDt) + 1;
      elapsed = r1(Math.min(100, Math.max(0, ((dayNo(t) - dayNo(p.startDt) + 1) / span) * 100)));
    }
    const forecast = baseMd ? r1(((actualMd + remainingPlanMd) / baseMd) * 100) : null;
    let status: RateStatus;
    if (['DONE', 'STOP'].includes(p.statusCd)) status = 'DONE';
    else if (!baseMd) status = 'NO_BASE';
    else if (p.startDt && p.startDt > t) status = 'NOT_STARTED';
    else if (elapsed == null || rate == null) status = 'NORMAL';
    else status = rate < elapsed - RATE_GAP ? 'UNDER' : rate > elapsed + RATE_GAP ? 'OVER' : 'NORMAL';
    out.set(p.prjCd, { prjCd: p.prjCd, baseType, baseMd: baseMd == null ? null : r1(baseMd), actualMd: r1(actualMd), planMd: r1(planMd), remainingPlanMd: r1(remainingPlanMd), rate, elapsed, forecast, status });
  }
  return out;
}
