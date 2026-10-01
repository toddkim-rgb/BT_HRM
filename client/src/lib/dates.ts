// 서버(lib/dates.ts)와 같은 규칙: 'YYYY-MM-DD', ISO 주차(월~일)

const toDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function today(): string {
  const n = new Date();
  return fmt(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function isoWeek(s: string): string {
  const d = toDate(s);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekDays(week: string): string[] {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (w - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(fmt(monday), i));
}

export const shiftWeek = (week: string, n: number) => isoWeek(addDays(weekDays(week)[0], n * 7));

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  return fmt(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const dow = (s: string) => DOW[toDate(s).getUTCDay()];
export const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

export function weekLabel(week: string): string {
  const d = weekDays(week);
  return `${week} (${md(d[0])}~${md(d[6])})`;
}
