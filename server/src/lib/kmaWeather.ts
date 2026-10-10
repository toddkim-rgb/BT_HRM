/**
 * 기상청 단기예보 조회서비스 (공공데이터포털 VilageFcstInfoService_2.0) — 서울 날씨
 * - 초단기실황(getUltraSrtNcst): 현재 기온(T1H)·강수형태(PTY)
 * - 단기예보(getVilageFcst): 오늘 최저·최고(TMN·TMX), 하늘상태(SKY), 강수확률(POP)
 * - 인증키: 환경변수 KMA_SERVICE_KEY (공공데이터포털 '일반 인증키', Encoding·Decoding 어느 쪽이든 가능)
 * - 30분 캐시, 키가 없거나 실패하면 null (인사말은 날씨 없이 표시)
 */

export type Sky = 'clear' | 'partly' | 'cloudy' | 'rain' | 'snow' | 'sleet';
export interface Weather {
  temp: number; // 현재 기온 (℃)
  sky: Sky;
  max: number | null; // 오늘 최고
  min: number | null; // 오늘 최저
  rainProb: number | null; // 지금 이후 오늘 최대 강수확률 (%)
}

const BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
const SEOUL = { nx: 60, ny: 127 }; // 기상청 격자 (서울특별시)

interface KmaItem {
  category: string;
  obsrValue?: string; // 실황
  fcstDate?: string; // 예보
  fcstTime?: string;
  fcstValue?: string;
}

/** 한국 시간 (서버가 UTC여도) → YYYYMMDD, HHmm */
function kst(offsetMin = 0) {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetMin * 60_000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10).replace(/-/g, ''), hhmm: iso.slice(11, 16).replace(':', '') };
}

/** 초단기실황 발표 시각: 매시 정각 자료, 40분 이후 조회 가능 */
export function ncstBase() {
  const n = kst(-40);
  return { base_date: n.date, base_time: `${n.hhmm.slice(0, 2)}00` };
}

/** 단기예보 발표 시각: 오늘 최저·최고가 모두 담긴 02시 발표 (02:10 이전이면 전날 23시 발표) */
export function fcstBase() {
  const n = kst();
  if (n.hhmm >= '0210') return { base_date: n.date, base_time: '0200' };
  return { base_date: kst(-24 * 60).date, base_time: '2300' };
}

async function call(op: string, base: { base_date: string; base_time: string }, key: string): Promise<KmaItem[]> {
  // Decoding 키(특수문자 포함)는 인코딩, Encoding 키(이미 %xx)는 그대로
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const url = `${BASE}/${op}?serviceKey=${serviceKey}&pageNo=1&numOfRows=1000&dataType=JSON&base_date=${base.base_date}&base_time=${base.base_time}&nx=${SEOUL.nx}&ny=${SEOUL.ny}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`KMA ${op} ${r.status}`);
  const d = (await r.json()) as { response?: { header?: { resultCode?: string }; body?: { items?: { item?: KmaItem[] } } } };
  if (d.response?.header?.resultCode !== '00') throw new Error(`KMA ${op} ${d.response?.header?.resultCode}`);
  return d.response.body?.items?.item ?? [];
}

const num = (v: string | undefined) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** PTY(강수형태) → 비·눈 / SKY(하늘상태) → 맑음·구름많음·흐림 */
function skyOf(pty: number | null, sky: number | null): Sky {
  if (pty === 1 || pty === 4 || pty === 5) return 'rain';
  if (pty === 3 || pty === 7) return 'snow';
  if (pty === 2 || pty === 6) return 'sleet';
  if (sky === 3) return 'partly';
  if (sky === 4) return 'cloudy';
  return 'clear';
}

/** 응답 → Weather (now: 'YYYYMMDDHHmm' 한국 시간) */
export function toWeather(ncst: KmaItem[], fcst: KmaItem[], now: string): Weather | null {
  const obs = (c: string) => num(ncst.find((i) => i.category === c)?.obsrValue);
  const temp = obs('T1H');
  if (temp == null) return null;
  const date = now.slice(0, 8);
  const todays = fcst.filter((i) => i.fcstDate === date);
  const val = (c: string) => num(todays.find((i) => i.category === c)?.fcstValue);
  const hour = `${now.slice(8, 10)}00`;
  // 지금 시각 이후 가장 가까운 예보의 하늘상태
  const skyNow = todays.filter((i) => i.category === 'SKY' && (i.fcstTime ?? '') >= hour).sort((a, b) => (a.fcstTime ?? '').localeCompare(b.fcstTime ?? ''))[0];
  const pops = todays.filter((i) => i.category === 'POP' && (i.fcstTime ?? '') >= hour).map((i) => num(i.fcstValue) ?? 0);
  return {
    temp: Math.round(temp),
    sky: skyOf(obs('PTY'), num(skyNow?.fcstValue)),
    max: val('TMX') != null ? Math.round(val('TMX')!) : null,
    min: val('TMN') != null ? Math.round(val('TMN')!) : null,
    rainProb: pops.length ? Math.max(...pops) : null,
  };
}

let cache: { at: number; value: Weather | null } | null = null;
export async function seoulWeather(): Promise<Weather | null> {
  const key = process.env.KMA_SERVICE_KEY;
  if (!key) return null;
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache.value;
  let value: Weather | null = null;
  try {
    const [ncst, fcst] = await Promise.all([call('getUltraSrtNcst', ncstBase(), key), call('getVilageFcst', fcstBase(), key)]);
    const n = kst();
    value = toWeather(ncst, fcst, n.date + n.hhmm);
  } catch (e) {
    console.warn('[weather]', (e as Error).message);
  }
  // 실패는 5분 뒤 다시 시도
  cache = { at: value ? Date.now() : Date.now() - 25 * 60_000, value };
  return value;
}
