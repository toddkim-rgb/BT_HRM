// 날짜는 모두 'YYYY-MM-DD' 문자열(UTC 기준 계산)로 다룬다.

export function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  const now = new Date();
  return fmt(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function dayOfWeek(s: string): number {
  return toDate(s).getUTCDay(); // 0=일 ... 6=토
}

/** ISO 주차 'YYYY-Www' (월~일) */
export function isoWeek(s: string): string {
  const d = toDate(s);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // 해당 주 목요일
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function isValidWeek(week: string): boolean {
  return /^\d{4}-W\d{2}$/.test(week);
}

/** 주차의 월요일~일요일 */
export function weekDays(week: string): string[] {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (w - 1) * 7);
  const start = fmt(monday);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function shiftWeek(week: string, n: number): string {
  return isoWeek(addDays(weekDays(week)[0], n * 7));
}

export function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = fmt(new Date(Date.UTC(y, m - 1, 1)));
  const end = fmt(new Date(Date.UTC(y, m, 0)));
  return { start, end };
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return fmt(d).slice(0, 7);
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 영업일: 주말·공휴일 제외 */
export function businessDays(start: string, end: string, holidays: Set<string>): string[] {
  return daysBetween(start, end).filter((d) => {
    const w = dayOfWeek(d);
    return w !== 0 && w !== 6 && !holidays.has(d);
  });
}

/** 두 기간의 겹치는 구간 (없으면 null) */
export function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): { start: string; end: string } | null {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return start <= end ? { start, end } : null;
}
