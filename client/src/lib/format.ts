export const num = (n: number | null | undefined, digits = 1) =>
  n == null ? '-' : n.toLocaleString('ko-KR', { maximumFractionDigits: digits });

export const pct = (n: number | null | undefined) => (n == null ? '-' : `${num(n)}%`);

export const won = (n: number | null | undefined) => (n == null ? '-' : `${Math.round(n).toLocaleString('ko-KR')}원`);

export const label = (map: Record<string, string>, v: string | null | undefined) => (v ? map[v] ?? v : '-');

export const dateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
