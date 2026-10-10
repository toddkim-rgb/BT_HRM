import { useState } from 'react';
import { PageHeader } from './ui';
import { displayName, useAuth } from '../lib/auth';
import { dow, isoWeek, md, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface GreetingData {
  today: string;
  weather: { temp: number; code: number; max: number | null; min: number | null; rainProb: number | null } | null;
  report: { thisWeek: string; lastWeek: string; delayItems: number };
  projects: number;
  allocSum: number;
  upcoming: number;
  endingSoon: number;
  nextHoliday: { dt: string; name: string } | null;
}

/** WMO 날씨 코드 → 아이콘·종류 */
function sky(code: number): { icon: string; kind: 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' } {
  if (code === 0) return { icon: '☀️', kind: 'clear' };
  if (code <= 2) return { icon: '🌤️', kind: 'clear' };
  if (code === 3) return { icon: '☁️', kind: 'cloudy' };
  if (code === 45 || code === 48) return { icon: '🌫️', kind: 'fog' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '❄️', kind: 'snow' };
  if (code >= 95) return { icon: '⛈️', kind: 'storm' };
  if (code >= 51) return { icon: '🌧️', kind: 'rain' };
  return { icon: '⛅', kind: 'cloudy' };
}

const daysUntil = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** 업무 관련 한마디 (중요한 것 하나) */
function workLine(d: GreetingData, role: string): string | null {
  const { report, allocSum, projects, endingSoon } = d;
  const day = new Date().getDay();
  if (projects > 0 && report.lastWeek !== 'SUBMITTED') return '지난주 업무보고가 아직이에요. 기억이 생생할 때 먼저 정리해 두면 마음이 가벼워져요 📝';
  if (report.delayItems > 0) return `지연 중인 작업이 ${report.delayItems}건 있어요. 한 번에 하나씩 차근차근 풀어가요 💪`;
  if (allocSum > 100) return `현재 배정률 합계가 ${allocSum}%예요. 바쁜 날들이지만 쉬어가는 것도 잊지 마세요 ☕`;
  if (day === 5 && projects > 0 && report.thisWeek !== 'SUBMITTED') return '금요일이에요! 이번 주 업무보고로 한 주를 깔끔하게 마무리해요 🗂️';
  if (report.thisWeek === 'SUBMITTED') return '이번 주 업무보고 제출 완료! 한 주 동안 정말 수고 많으셨어요 🎉';
  if (endingSoon > 0) return '곧 마무리되는 프로젝트가 있어요. 끝까지 멋지게 마무리해요 🏁';
  if (projects >= 3) return `${projects}개 프로젝트를 함께 챙기고 계시네요. 오늘도 든든합니다 👏`;
  if (projects === 0 && d.upcoming > 0) return '곧 시작할 프로젝트가 기다리고 있어요. 미리 준비하며 컨디션 조절해요 🚀';
  if (projects === 0 && role === 'EMP') return '다음 프로젝트를 준비하는 시간이에요. 재충전하며 새 기술도 살펴봐요 🌱';
  return null;
}

/** 분위기 한마디 후보 (날씨·공휴일·요일·시간대) → 들어올 때마다 그중 하나 */
function moodLines(d: GreetingData): string[] {
  const out: string[] = [];
  const w = d.weather;
  if (w) {
    const { kind } = sky(w.code);
    if (kind === 'rain' || kind === 'storm') out.push('밖에 비가 내리고 있어요 ☔ 우산 꼭 챙기시고, 차분한 하루 보내세요.');
    else if (kind === 'snow') out.push('눈이 내려요 ❄️ 길이 미끄러우니 이동할 때 조심하세요.');
    else if (w.rainProb != null && w.rainProb >= 60) out.push(`오늘 비 소식이 있어요 (강수확률 ${w.rainProb}%). 퇴근길 우산 잊지 마세요 ☂️`);
    if (w.temp >= 30) out.push(`${w.temp}℃, 무더운 날이에요 🥵 시원한 물 자주 드세요.`);
    else if (w.temp <= 0) out.push(`${w.temp}℃, 꽤 쌀쌀해요 🧣 따뜻하게 챙겨 입으세요.`);
    else if (w.max != null && w.min != null && w.max - w.min >= 10) out.push(`일교차가 ${w.max - w.min}℃나 돼요. 겉옷 하나 챙기면 좋겠어요 🧥`);
    if (kind === 'clear' && w.temp > 0 && w.temp < 30) out.push(`하늘이 맑아요 ${sky(w.code).icon} 상쾌한 ${w.temp}℃, 기분 좋은 하루 되세요.`);
    if (kind === 'fog') out.push('안개가 짙어요 🌫️ 이동할 때 조심하세요.');
  }
  if (d.nextHoliday) {
    const n = daysUntil(d.today, d.nextHoliday.dt);
    if (n === 1) out.push(`내일은 ${d.nextHoliday.name}이에요! 조금만 더 힘내요 🎈`);
    else if (n <= 7) out.push(`${md(d.nextHoliday.dt)} ${d.nextHoliday.name}까지 ${n}일 남았어요 🗓️`);
  }
  const now = new Date();
  const h = now.getHours();
  const day = now.getDay();
  if (day === 0 || day === 6) out.push('주말에도 들르셨네요. 쉬는 것도 일이에요, 푹 쉬세요 🛋️');
  else if (day === 1) out.push('새로운 한 주의 시작이에요! 이번 주도 잘 부탁드려요 🚀');
  else if (day === 5) out.push('어느새 금요일! 남은 하루도 즐겁게 보내요 🎈');
  if (h < 9) out.push('이른 아침부터 힘내시네요 🌅 따뜻한 커피 한 잔 어떠세요?');
  else if (h >= 11 && h < 13) out.push('곧 점심시간이에요. 맛있는 거 드세요 🍚');
  else if (h >= 13 && h < 16) out.push('나른한 오후, 잠깐 스트레칭 한 번 어때요? 🙆');
  else if (h >= 19) out.push('늦은 시간까지 수고 많으세요. 무리하지 마세요 🌙');
  if (!out.length)
    out.push(
      '오늘도 좋은 일만 가득하길 바라요 😊',
      '작은 성취가 모여 큰 결과가 됩니다. 오늘도 화이팅 ✨',
      '함께해서 든든한 하루예요 🤝',
      '바쁜 와중에도 커피 한 잔의 여유 잊지 마세요 ☕',
    );
  return out;
}

/** 대시보드 인사: 이름·직급 + 날씨·업무 상황에 맞춘 한두 마디 */
export function Greeting() {
  const { user } = useAuth();
  const { data } = useFetch<GreetingData>('/greeting');
  const [seed] = useState(() => Math.random());
  const t = today();
  const w = data?.weather;
  const desc = (
    <>
      {t} ({dow(t)}) · {weekLabel(isoWeek(t))}
      {w && (
        <span className="greet-weather" title="서울 기준 (Open-Meteo)">
          {' '}
          · {sky(w.code).icon} 서울 {w.temp}℃{w.min != null && w.max != null ? ` (${w.min}~${w.max}℃)` : ''}
        </span>
      )}
    </>
  );
  const lines = data ? [workLine(data, user?.role ?? 'EMP'), (() => { const m = moodLines(data); return m[Math.floor(seed * m.length)]; })()].filter(Boolean) : [];
  return (
    <>
      <PageHeader title={`안녕하세요, ${displayName(user)}님`} desc={desc} />
      {lines.length > 0 && (
        <div className="greet-msgs">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
    </>
  );
}
