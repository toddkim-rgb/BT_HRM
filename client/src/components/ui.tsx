import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {desc && <p className="muted">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

const BADGE_TONE: Record<string, string> = {
  ACTIVE: 'good', DONE: 'good', NORMAL: 'good',
  SUBMITTED: 'info', PLANNED: 'info', PROPOSAL: 'warn',
  DRAFT: 'neutral', NEW: 'neutral', NONE: 'warn', ENDED: 'neutral', CANCELED: 'neutral', SALES: 'warn',
  DELAY: 'bad', STOP: 'bad', RETIRED: 'neutral', LEAVE: 'warn', STOPPED: 'neutral',
  H: 'bad', M: 'warn', L: 'neutral',
};

export function Badge({ code, children, tone }: { code?: string; children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone ?? BADGE_TONE[code ?? ''] ?? 'neutral'}`}>{children}</span>;
}

export function Loading() {
  return <div className="loading">불러오는 중…</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="alert bad">{error}</div>;
}

export function Empty({ children = '데이터가 없습니다.' }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Field({ label, required, hint, children, full }: { label: string; required?: boolean; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">
        {label}
        {required && <em>*</em>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, placeholder, ...rest }: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: Record<string, string> | [string, string][];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
}) {
  const entries = Array.isArray(options) ? options : Object.entries(options);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {entries.map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* 토스트 알림 */
type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function ProgressBar({ value, tone }: { value: number | null; tone?: 'good' | 'warn' | 'bad' }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const t = tone ?? (value == null ? 'neutral' : value >= 100 ? 'bad' : value >= 80 ? 'warn' : 'good');
  return (
    <div className="progress" title={value == null ? '-' : `${value}%`}>
      <div className={`progress-fill ${t}`} style={{ width: `${v}%` }} />
    </div>
  );
}
