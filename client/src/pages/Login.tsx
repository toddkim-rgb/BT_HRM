import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

const DEMO = [
  ['admin@example.com', 'admin1234', '시스템관리자'],
  ['ceo.kim@example.com', '1234', '경영진'],
  ['sujin.lee@example.com', '1234', 'SI PM'],
  ['junho.park@example.com', '1234', 'SM PM'],
  ['gildong.hong@example.com', '1234', '투입인력'],
  ['minsu.jung@example.com', '1234', '다중 투입'],
  ['sales.choi@example.com', '1234', '영업담당'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          BT<span>·</span>HRM
        </div>
        <p className="muted">SM·SI 사업부문 인력관리 시스템</p>
        <label className="field">
          <span className="field-label">이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="name@company.com" autoFocus required />
        </label>
        <label className="field">
          <span className="field-label">비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="alert bad">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        {import.meta.env.DEV && (
          <div className="demo-accounts">
            <div className="muted small">개발용 데모 계정 (클릭하면 입력)</div>
            <div className="chips">
              {DEMO.map(([id, pw, label]) => (
                <button
                  type="button"
                  key={id}
                  className="chip"
                  onClick={() => {
                    setEmail(id);
                    setPassword(pw);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
