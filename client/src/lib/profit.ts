// 수익성 분석 (사업비 시뮬레이션) — 화면 공통 타입·표시 형식. 계산은 서버(/profit/calc)에서만 한다.

export type Judge = 'GOOD' | 'COND' | 'BAD';
export interface SimRow {
  type: 'OWN' | 'PARTNER';
  grade: string;
  roleCd: string;
  jobNm?: string | null;
  headcount: number;
  startDt: string;
  endDt: string;
  allocRate: number;
  monthlyRate?: number | null;
  note?: string | null;
}
export interface SimExpense {
  category: string;
  amount: number;
  memo?: string | null;
}
export interface SimInput {
  startDt: string;
  endDt: string;
  reserveRate: number;
  targetRate: number;
  minRate: number;
  proposedAmt?: number | null;
  rows: SimRow[];
  expenses: SimExpense[];
}
export interface SimResult {
  months: string[];
  rows: { mm: number; cost: number; unit: number | null; kosaUnit: number | null; perMonth: number[] }[];
  monthly: { ym: string; mm: number; labor: number }[];
  totals: { mm: number; ownMm: number; partnerMm: number; ownLabor: number; partnerLabor: number; labor: number; expense: number; reserve: number; totalCost: number; fairPrice: number | null; minPrice: number | null };
  kosa: { year: number; direct: number; overhead: number; techFee: number; expense: number; budget: number; headroom: number | null } | null;
  proposed: { amount: number; profit: number; margin: number; judge: Judge } | null;
  sensitivity: { pct: number; totalCost: number; margin: number | null }[];
  warnings: string[];
}
export interface SimProject {
  prjCd: string;
  prjNm: string;
  prjType: string;
  customerNm: string | null;
  statusCd: string;
  startDt?: string | null;
  endDt?: string | null;
  contractAmt: number | null;
}

export const SIM_STATUS: Record<string, string> = { DRAFT: '작성 중', BASELINE: '기준선' };
export const EXPENSE_TYPE: Record<string, string> = { TRAVEL: '출장·체재', EQUIP: '장비', LICENSE: 'SW 라이선스', OUTSOURCE: '외주 용역(인력 외)', ETC: '기타' };
export const JUDGE: Record<Judge, { icon: string; label: string; tone: 'good' | 'warn' | 'bad' }> = {
  GOOD: { icon: '🟢', label: '승인', tone: 'good' },
  COND: { icon: '🟡', label: '조건부', tone: 'warn' },
  BAD: { icon: '🔴', label: '재검토', tone: 'bad' },
};

/** 요약용 금액: 1억 이상 '5.25억', 그 아래 '8,855만원' */
export function krw(n: number | null | undefined): string {
  if (n == null) return '-';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 100_000_000) return `${s}${(a / 100_000_000).toFixed(a >= 10_000_000_000 ? 0 : 2).replace(/\.?0+$/, '')}억`;
  if (a >= 10_000) return `${s}${Math.round(a / 10_000).toLocaleString('ko-KR')}만원`;
  return `${s}${Math.round(a).toLocaleString('ko-KR')}원`;
}
export const fullWon = (n: number | null | undefined) => (n == null ? '-' : `${Math.round(n).toLocaleString('ko-KR')}원`);
export const mmText = (n: number | null | undefined) => (n == null ? '-' : `${(Math.round(n * 100) / 100).toLocaleString('ko-KR')} MM`);
export const pctText = (n: number | null | undefined) => (n == null ? '-' : `${(Math.round(n * 10) / 10).toLocaleString('ko-KR')}%`);
