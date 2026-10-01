import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth, type User } from '../lib/auth';
import { PasswordInput, PasswordRules, passwordRuleChecks } from './PasswordInput';
import { ErrorBox } from './ui';

/** 비밀번호 변경 폼 (내 정보, 초기 비밀번호 변경 강제 화면 공용) */
export function ChangePasswordForm({ currentLabel = '현재 비밀번호', submitLabel = '변경', onDone }: { currentLabel?: string; submitLabel?: string; onDone?: () => void }) {
  const { applySession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = passwordRuleChecks(next).every((c) => c.ok) && next === confirm && !!current;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.put<{ token: string; user: User }>('/auth/me/password', { current, next });
      applySession(r.token, r.user);
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone?.();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="field">
        <label className="field-label" htmlFor="pw-current">
          {currentLabel}
        </label>
        <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="pw-next">
          새 비밀번호
        </label>
        <PasswordInput id="pw-next" value={next} onChange={setNext} autoComplete="new-password" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="pw-confirm">
          새 비밀번호 확인
        </label>
        <PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </div>
      <PasswordRules value={next} confirm={confirm} />
      <button className="btn primary" disabled={!valid || busy}>
        {submitLabel}
      </button>
    </form>
  );
}
