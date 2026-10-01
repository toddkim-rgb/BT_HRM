import { useState, type KeyboardEvent } from 'react';

/** 비밀번호 입력: 보기/숨기기 토글 + Caps Lock 경고 */
export function PasswordInput({
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder,
  autoFocus,
  required,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <span className="pw-wrap">
      <span className="pw-field">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCaps(false)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          required={required}
          spellCheck={false}
          autoCapitalize="off"
        />
        <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={show} title={show ? '숨기기' : '보기'}>
          {show ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.2 4.3M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 4.4-1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </button>
      </span>
      {caps && (
        <span className="caps-warn" role="status">
          ⚠ Caps Lock이 켜져 있습니다.
        </span>
      )}
    </span>
  );
}

/** 새 비밀번호 규칙 (서버와 동일): 8자 이상, 영문·숫자 포함 */
export function passwordRuleChecks(pw: string) {
  return [
    { ok: pw.length >= 8, label: '8자 이상' },
    { ok: /[A-Za-z]/.test(pw), label: '영문 포함' },
    { ok: /\d/.test(pw), label: '숫자 포함' },
  ];
}

export function PasswordRules({ value, confirm }: { value: string; confirm?: string }) {
  const checks = passwordRuleChecks(value);
  return (
    <div className="pw-rules">
      {checks.map((c) => (
        <span key={c.label} className={c.ok ? 'good-text' : 'muted'}>
          {c.ok ? '✓' : '○'} {c.label}
        </span>
      ))}
      {confirm !== undefined && confirm !== '' && <span className={confirm === value ? 'good-text' : 'bad-text'}>{confirm === value ? '✓ 확인 일치' : '✕ 확인 불일치'}</span>}
    </div>
  );
}
