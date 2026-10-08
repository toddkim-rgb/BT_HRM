import { Badge } from './ui';

/**
 * 프로젝트 투입률 (v1.12) — 누적 실적 MD ÷ 기준 MD, 종료 시 100% 목표
 * 기준 MD = 계약 MM × 1MM 환산 MD (계약 MM이 없으면 배정 계획 MD)
 */
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
  status: 'NOT_STARTED' | 'NORMAL' | 'UNDER' | 'OVER' | 'DONE' | 'NO_BASE';
}

/** 상태: 경과율 대비 ±10%p 기준 (색만으로 구분하지 않도록 글자 배지로 표시) */
export const RATE_STATUS: Record<ProjectRate['status'], { label: string; tone: string }> = {
  NORMAL: { label: '정상', tone: 'good' },
  UNDER: { label: '과소', tone: 'warn' },
  OVER: { label: '과다', tone: 'bad' },
  NOT_STARTED: { label: '시작 전', tone: 'neutral' },
  DONE: { label: '완료', tone: 'neutral' },
  NO_BASE: { label: '기준 없음', tone: 'neutral' },
};

export const baseLabel = (pr: ProjectRate) => (pr.baseType === 'CONTRACT' ? '계약' : pr.baseType === 'PLAN' ? '배정 계획' : '-');

/** 투입률 막대: 채움 = 투입률(100% 초과는 빨강), 세로선 = 오늘 기준 경과율 */
export function RateBar({ pr, compact }: { pr: ProjectRate | null | undefined; compact?: boolean }) {
  if (!pr) return null;
  const st = RATE_STATUS[pr.status];
  const title = `투입률 = 실적 ${pr.actualMd}MD ÷ 기준 ${pr.baseMd ?? '-'}MD(${baseLabel(pr)})${pr.elapsed != null ? ` · 기간 경과 ${pr.elapsed}%` : ''}${pr.forecast != null ? ` · 종료 예상 ${pr.forecast}%` : ''}`;
  return (
    <div className={`rate ${compact ? 'compact' : ''}`} title={title}>
      <div className="rate-head">
        <span>
          투입률 <strong>{pr.rate != null ? `${pr.rate}%` : '-'}</strong>
          {pr.elapsed != null && <span className="rate-elapsed"> · 경과 {pr.elapsed}%</span>}
        </span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="rate-bar" role="img" aria-label={title}>
        <div className={`rate-fill ${pr.rate != null && pr.rate > 100 ? 'over' : ''}`} style={{ width: `${Math.min(100, pr.rate ?? 0)}%` }} />
        {pr.elapsed != null && <div className="rate-mark" style={{ left: `${pr.elapsed}%` }} />}
      </div>
    </div>
  );
}
