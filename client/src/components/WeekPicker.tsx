import { useEffect, useRef, useState } from 'react';
import { addDays, addMonths, isoWeek, shiftWeek, today, weekDays, weekLabel } from '../lib/dates';

/** 'YYYY-MM' 달력에 보일 주(월요일 시작) 목록: 그 달과 겹치는 ISO 주차 */
function monthWeeks(ym: string): string[] {
  const first = `${ym}-01`;
  const weeks: string[] = [];
  for (let w = isoWeek(first); weekDays(w)[0].slice(0, 7) <= ym; w = isoWeek(addDays(weekDays(w)[0], 7))) weeks.push(w);
  return weeks;
}
/** 주차가 주로 속한 달 (ISO 기준: 목요일이 있는 달) */
const monthOf = (week: string) => weekDays(week)[3].slice(0, 7);

/**
 * 주차 선택: 현재 주차 라벨을 누르면 달력이 열리고, 주(한 줄) 단위로 골라 선택
 * - 선택된 주·이번 주·오늘을 달력에 표시, '이번 주로' 바로가기
 */
export function WeekPicker({ week, onChange, label }: { week: string; onChange: (week: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(monthOf(week));
  const [alignRight, setAlignRight] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const now = today();
  const thisWeek = isoWeek(now);

  useEffect(() => {
    if (!open) return;
    setYm(monthOf(week));
    // 화면 오른쪽에 여유가 없으면 버튼 오른쪽 끝에 맞춰 펼침
    const rect = box.current?.getBoundingClientRect();
    setAlignRight(!!rect && rect.left + 300 > window.innerWidth - 16);
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, week]);

  const pick = (w: string) => {
    setOpen(false);
    if (w !== week) onChange(w);
  };
  const [y, m] = ym.split('-').map(Number);

  return (
    <div className="week-picker" ref={box}>
      <button type="button" className="btn week-picker-step" onClick={() => onChange(shiftWeek(week, -1))} aria-label="이전 주" title="이전 주">
        ◀
      </button>
      <button type="button" className={`btn week-picker-btn ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <span aria-hidden>📅</span>
        <strong>{label ?? weekLabel(week)}</strong>
        {week === thisWeek && <span className="week-picker-now">이번 주</span>}
        <span aria-hidden className="week-picker-caret">▾</span>
      </button>
      <button type="button" className="btn week-picker-step" onClick={() => onChange(shiftWeek(week, 1))} aria-label="다음 주" title="다음 주">
        ▶
      </button>
      {open && (
        <div className={`week-picker-pop ${alignRight ? 'right' : ''}`} role="dialog" aria-label="주차 선택">
          <div className="week-picker-head">
            <button type="button" className="btn sm ghost" onClick={() => setYm(addMonths(ym, -1))} aria-label="이전 달">
              ◀
            </button>
            <strong>
              {y}년 {m}월
            </strong>
            <button type="button" className="btn sm ghost" onClick={() => setYm(addMonths(ym, 1))} aria-label="다음 달">
              ▶
            </button>
          </div>
          <div className="week-picker-grid">
            <div className="week-picker-row head">
              <span>주</span>
              {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            {monthWeeks(ym).map((w) => (
              <button
                type="button"
                key={w}
                className={`week-picker-row ${w === week ? 'selected' : ''} ${w === thisWeek ? 'current' : ''}`}
                onClick={() => pick(w)}
                title={weekLabel(w)}
                aria-pressed={w === week}
              >
                <span className="wk">W{w.slice(-2)}</span>
                {weekDays(w).map((d, i) => (
                  <span key={d} className={`${d.slice(0, 7) !== ym ? 'out' : ''} ${d === now ? 'today' : ''} ${i >= 5 ? 'weekend' : ''}`}>
                    {Number(d.slice(8))}
                  </span>
                ))}
              </button>
            ))}
          </div>
          <div className="week-picker-foot">
            <span className="small muted">{weekLabel(week)}</span>
            <button type="button" className="btn sm" onClick={() => pick(thisWeek)} disabled={week === thisWeek}>
              이번 주로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
