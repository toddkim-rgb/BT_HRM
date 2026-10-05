import { useState, type FormEvent } from 'react';
import { PasswordInput } from '../components/PasswordInput';
import { ErrorBox, Field, Modal } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'id' | 'pw' | null>(null);

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
        <div className="field">
          <label className="field-label" htmlFor="login-pw">
            비밀번호
          </label>
          <PasswordInput id="login-pw" value={password} onChange={setPassword} required />
        </div>
        {error && <div className="alert bad">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
          처음 로그인할 때 비밀번호는 이메일 주소와 같습니다.
        </p>
        <div className="login-links">
          <button type="button" onClick={() => setDialog('id')}>
            아이디(이메일) 찾기
          </button>
          <span aria-hidden>|</span>
          <button type="button" onClick={() => setDialog('pw')}>
            비밀번호 재설정 요청
          </button>
        </div>
      </form>
      {dialog === 'id' && <FindIdDialog onClose={() => setDialog(null)} />}
      {dialog === 'pw' && <ResetRequestDialog initialEmail={email} onClose={() => setDialog(null)} />}
    </div>
  );
}

function FindIdDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'lookup' | 'inquiry'>('lookup');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [masked, setMasked] = useState<string[] | null>(null);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const lookup = () => run(async () => setMasked((await api.post<{ maskedEmails: string[] }>('/auth/id-lookup', { name, phone })).maskedEmails));
  const inquire = () =>
    run(async () => {
      await api.post('/auth/id-inquiry', { name, contact, message: message || null });
      setSent(true);
    });

  return (
    <Modal
      title="아이디(이메일) 찾기"
      onClose={onClose}
      footer={
        tab === 'lookup' ? (
          masked ? (
            <button className="btn primary" onClick={onClose}>
              로그인으로
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !name.trim() || !phone.trim()} onClick={lookup}>
              찾기
            </button>
          )
        ) : sent ? (
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        ) : (
          <button className="btn primary" disabled={busy || !name.trim() || !contact.trim()} onClick={inquire}>
            문의 남기기
          </button>
        )
      }
    >
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'lookup'} className={tab === 'lookup' ? 'active' : ''} onClick={() => setTab('lookup')}>
          성명·연락처로 찾기
        </button>
        <button role="tab" aria-selected={tab === 'inquiry'} className={tab === 'inquiry' ? 'active' : ''} onClick={() => setTab('inquiry')}>
          관리자에게 문의
        </button>
      </div>
      <ErrorBox error={err} />
      {tab === 'lookup' ? (
        masked ? (
          <div className="stack" style={{ gap: 10 }}>
            <p style={{ margin: 0 }}>등록된 로그인 이메일입니다. 일부는 보안을 위해 가렸습니다.</p>
            {masked.map((m) => (
              <div key={m} className="temp-pw" style={{ fontSize: 18, userSelect: 'text' }}>
                {m}
              </div>
            ))}
            <p className="muted small" style={{ margin: 0 }}>
              기억나지 않으면 '관리자에게 문의' 탭에서 문의를 남겨 주세요.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <Field label="성명" required>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="연락처" required hint="인력 정보에 등록된 휴대전화 번호 (- 없이 입력해도 됩니다)">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="010-0000-0000" />
            </Field>
          </div>
        )
      ) : sent ? (
        <div className="alert good" style={{ marginBottom: 0 }}>
          문의를 접수했습니다. 시스템관리자가 확인 후 남겨 주신 연락처로 안내드립니다.
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <Field label="성명" required>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="연락받을 연락처" required hint="전화번호 또는 메신저 ID">
            <input value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="문의 내용">
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function ResetRequestDialog({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/password-reset-request', { email, name, message: message || null });
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="비밀번호 재설정 요청"
      onClose={onClose}
      footer={
        sent ? (
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        ) : (
          <button className="btn primary" disabled={busy || !email.trim() || !name.trim()} onClick={send}>
            요청하기
          </button>
        )
      }
    >
      <ErrorBox error={err} />
      {sent ? (
        <div className="alert good" style={{ marginBottom: 0 }}>
          요청을 접수했습니다. 시스템관리자가 본인 확인 후 비밀번호를 초기화합니다. 초기화되면 이메일 주소를 비밀번호로 입력해 로그인하고, 새 비밀번호를 설정하게 됩니다.
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0 }}>
            메일로 재설정 링크를 보내지 않고, 시스템관리자가 확인 후 비밀번호를 이메일 주소로 초기화합니다.
          </p>
          <Field label="로그인 이메일" required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!initialEmail} />
          </Field>
          <Field label="성명" required>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!initialEmail} />
          </Field>
          <Field label="요청 메모" hint="연락받을 방법 등 (선택)">
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
