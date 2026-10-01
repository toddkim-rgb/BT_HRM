import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useAuth } from '../lib/auth';

/** 초기·임시 비밀번호로 로그인한 경우: 새 비밀번호 설정 전까지 다른 화면 이용 불가 */
export default function ForceChangePassword() {
  const { user, logout } = useAuth();
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand login-brand">
          BT<span>·</span>HRM
        </div>
        <div>
          <h2>새 비밀번호 설정</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {user?.name}님, 초기 또는 임시 비밀번호로 로그인했습니다. 계속하려면 새 비밀번호를 설정하세요.
          </p>
        </div>
        <ChangePasswordForm currentLabel="현재(임시) 비밀번호" submitLabel="비밀번호 변경 후 시작" />
        <button type="button" className="btn ghost" onClick={logout}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
