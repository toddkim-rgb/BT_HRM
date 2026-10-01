// 다중 프로젝트 투입: '배정대로 채우기' — 배정 투입률에 맞춰 요일별 MD를 0.5 단위로 배분

export interface WeekPlan {
  prjCd: string;
  plannedMd: number;
  days: Record<string, number>; // 영업일별 투입률(%)
}

export interface TsRowLike {
  prjCd: string;
  md: Record<string, number | null>;
}

/**
 * - 배정 프로젝트 행은 새로 계산해 덮어쓰고, 그 외 행(휴가·교육 등 공통코드)은 유지
 * - 프로젝트별 목표 = 계획 MD를 0.5 단위로 반올림
 * - 투입률 높은 프로젝트부터, 배정된 날짜에 0.5씩 돌아가며 배분 (하루 합계 1.0 이하)
 */
export function fillByAssignment<T extends TsRowLike>(rows: T[], plan: WeekPlan[], businessDays: string[]): T[] {
  const planned = new Set(plan.map((p) => p.prjCd));
  // 남은 용량(0.5 단위 개수): 공통코드 등 배정 외 입력을 먼저 차감
  const cap: Record<string, number> = {};
  for (const d of businessDays) {
    const used = rows.filter((r) => !planned.has(r.prjCd)).reduce((s, r) => s + (r.md[d] ?? 0), 0);
    cap[d] = Math.max(0, 2 - Math.round(used * 2));
  }
  const result = new Map<string, Record<string, number | null>>();
  for (const p of [...plan].sort((a, b) => b.plannedMd - a.plannedMd)) {
    const md: Record<string, number | null> = {};
    let halves = Math.round(p.plannedMd * 2);
    const days = businessDays.filter((d) => (p.days[d] ?? 0) > 0);
    let progressed = true;
    while (halves > 0 && progressed) {
      progressed = false;
      for (const d of days) {
        if (halves <= 0) break;
        if (cap[d] > 0 && (md[d] ?? 0) < 1) {
          md[d] = (md[d] ?? 0) + 0.5;
          cap[d]--;
          halves--;
          progressed = true;
        }
      }
    }
    result.set(p.prjCd, md);
  }
  const out = rows.map((r) => (planned.has(r.prjCd) ? { ...r, md: result.get(r.prjCd) ?? {} } : r));
  for (const p of plan) if (!out.some((r) => r.prjCd === p.prjCd)) out.push({ prjCd: p.prjCd, md: result.get(p.prjCd) ?? {} } as T);
  return out;
}
