import { useEffect, useMemo, useState } from 'react';
import { displayName, useAuth } from '../lib/auth';
import { dow, isoWeek, md, today, weekLabel } from '../lib/dates';
import { useFetch } from '../lib/hooks';

interface GreetingData {
  today: string;
  weather: { temp: number; sky: Sky; max: number | null; min: number | null; rainProb: number | null } | null;
  report: { thisWeek: string; lastWeek: string; delayItems: number };
  projects: number;
  allocSum: number;
  upcoming: number;
  endingSoon: number;
  nextHoliday: { dt: string; name: string } | null;
}

type Sky = 'clear' | 'partly' | 'cloudy' | 'rain' | 'snow' | 'sleet';
/** 기상청 하늘상태·강수형태 → 아이콘 */
const SKY_ICON: Record<Sky, string> = { clear: '☀️', partly: '⛅', cloudy: '☁️', rain: '🌧️', snow: '❄️', sleet: '🌨️' };

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
    const kind = w.sky;
    if (kind === 'rain') out.push('밖에 비가 내리고 있어요 ☔ 우산 꼭 챙기시고, 차분한 하루 보내세요.');
    else if (kind === 'snow' || kind === 'sleet') out.push('눈이 내려요 ❄️ 길이 미끄러우니 이동할 때 조심하세요.');
    else if (w.rainProb != null && w.rainProb >= 60) out.push(`오늘 비 소식이 있어요 (강수확률 ${w.rainProb}%). 퇴근길 우산 잊지 마세요 ☂️`);
    if (w.temp >= 30) out.push(`${w.temp}℃, 무더운 날이에요 🥵 시원한 물 자주 드세요.`);
    else if (w.temp <= 0) out.push(`${w.temp}℃, 꽤 쌀쌀해요 🧣 따뜻하게 챙겨 입으세요.`);
    else if (w.max != null && w.min != null && w.max - w.min >= 10) out.push(`일교차가 ${w.max - w.min}℃나 돼요. 겉옷 하나 챙기면 좋겠어요 🧥`);
    if (kind === 'clear' && w.temp > 0 && w.temp < 30) out.push(`하늘이 맑아요 ${SKY_ICON.clear} 상쾌한 ${w.temp}℃, 기분 좋은 하루 되세요.`);
    if (kind === 'cloudy') out.push('하늘이 흐리네요 ☁️ 그래도 마음만은 맑게, 힘내세요!');
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

/** 대시보드 인사: '안녕하세요, 이름 직급님!' 뒤에 같은 줄·같은 글꼴로 상황별 한마디 (여러 개면 번갈아 표시) */
export function Greeting() {
  const { user } = useAuth();
  const { data } = useFetch<GreetingData>('/greeting');
  const [seed] = useState(() => Math.random());
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const t = today();
  const w = data?.weather;

  // 업무 한마디(있으면 먼저) + 분위기 한마디(들어올 때마다 순서를 섞음)
  const lines = useMemo(() => {
    if (!data) return [];
    const moods = moodLines(data)
      .map((m, i) => ({ m, k: (Math.sin((i + 1) * 9301 * (seed + 0.1)) + 1) % 1 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.m);
    return [workLine(data, user?.role ?? 'EMP'), ...moods].filter((l): l is string => !!l);
  }, [data, seed, user?.role]);

  useEffect(() => {
    if (lines.length < 2 || paused) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % lines.length), 7000);
    return () => window.clearInterval(id);
  }, [lines.length, paused]);

  const line = lines.length ? lines[idx % lines.length] : null;
  return (
    <div className="page-header">
      <div>
        <h1 className="greet-title" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          안녕하세요, {displayName(user)}님!
          {line && (
            <span key={line} className="greet-line">
              {' '}
              {line}
            </span>
          )}
        </h1>
        <p className="muted">
          {t} ({dow(t)}) · {weekLabel(isoWeek(t))}
          {w && (
            <span className="greet-weather" title="서울 기준 (기상청 단기예보)">
              {' '}
              · {SKY_ICON[w.sky]} 서울 {w.temp}℃{w.min != null && w.max != null ? ` (${w.min}~${w.max}℃)` : ''}
              {w.rainProb != null && w.rainProb >= 30 ? ` · 강수확률 ${w.rainProb}%` : ''}
            </span>
          )}
          {lines.length > 1 && (
            <span className="greet-dots" aria-hidden>
              {lines.map((l, i) => (
                <button key={l} type="button" className={i === idx % lines.length ? 'on' : ''} onClick={() => setIdx(i)} tabIndex={-1} />
              ))}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
