import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type User } from '../lib/auth';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { ROLE_LABEL } from '../lib/codes';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  menu: string; // 메뉴 권한 키 (관리자 '메뉴 권한' 화면에서 역할별 설정)
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: '업무',
    items: [
      { to: '/', label: '대시보드', icon: '◧', menu: 'dashboard' },
      { to: '/weekly', label: '주간 업무보고', icon: '✎', menu: 'weekly' },
      { to: '/assignments', label: '투입 배정', icon: '⇄', menu: 'assignments' },
    ],
  },
  {
    group: '주간보고',
    items: [
      { to: '/submissions', label: '제출 현황', icon: '✔', menu: 'submissions' },
      { to: '/project-weekly', label: '프로젝트 주간보고', icon: '▦', menu: 'projectWeekly' },
      { to: '/onepage', label: '전사 One-Page', icon: '▭', menu: 'onepage' },
    ],
  },
  {
    group: '현황',
    items: [
      { to: '/staffing', label: '프로젝트별 투입현황', icon: '▩', menu: 'staffing' },
      { to: '/utilization', label: '가동률', icon: '▤', menu: 'utilization' },
      { to: '/project-mm', label: '프로젝트 MM', icon: '▥', menu: 'projectMm' },
    ],
  },
  {
    group: '기준정보',
    items: [
      { to: '/employees', label: '인력', icon: '☺', menu: 'employees' },
      { to: '/projects', label: '프로젝트', icon: '▣', menu: 'projects' },
      { to: '/partners', label: '협력사', icon: '⚑', menu: 'partners' },
      { to: '/settings', label: '기준값 설정', icon: '⚙', menu: 'settings' },
      { to: '/account-requests', label: '계정 요청', icon: '✉', menu: 'accountRequests' },
      { to: '/permissions', label: '메뉴 권한', icon: '⚿', menu: 'permissions' },
    ],
  },
];

export function Layout() {
  const { user, logout, can, applySession, reloadPerms } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  // 관리자: 처리 대기 중인 계정 요청 수 (화면 이동 시 갱신)
  const { data: reqCount, reload: reloadCount } = useFetch<{ open: number }>(can('accountRequests') ? '/admin/account-requests/count' : null);
  useEffect(() => {
    if (can('accountRequests')) reloadCount();
  }, [loc.pathname, can, reloadCount]);
  if (!user) return null;

  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.menu)) })).filter((g) => g.items.length);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={() => setOpen((v) => !v)} aria-label="메뉴">
          ☰
        </button>
        <div className="brand">
          BT<span>·</span>HRM
        </div>
        <NavLink to="/me" className="topbar-user">
          {user.name}
        </NavLink>
      </header>
      <aside className="sidebar">
        <div className="brand side-brand">
          BT<span>·</span>HRM
          <small>SM·SI 인력관리</small>
        </div>
        <nav>
          {nav.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-group-title">{g.group}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link">
                  <span className="nav-icon" aria-hidden>
                    {i.icon}
                  </span>
                  {i.label}
                  {i.to === '/account-requests' && !!reqCount?.open && <span className="nav-badge">{reqCount.open}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {user.tester && <TestRoleSwitch user={user} onSwitched={(token, u) => { applySession(token, { ...user, ...u, testPm: u.testPm ?? null }); reloadPerms(); navigate('/'); }} />}
        <div className="side-user">
          <NavLink to="/me" className="side-user-name">
            <strong>{user.name}</strong>
            <span>{ROLE_LABEL[user.role]}</span>
          </NavLink>
          <button className="btn ghost sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

/** 화면 접근 가드: 메뉴 조회 권한이 없으면 안내 (주소 직접 입력 차단) */
export function Guard({ menu, children }: { menu: string; children: ReactNode }) {
  const { can } = useAuth();
  if (can(menu)) return <>{children}</>;
  const first = NAV.flatMap((g) => g.items).find((i) => can(i.menu));
  return (
    <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>접근 권한이 없습니다</h2>
      <p className="muted">이 메뉴를 볼 수 있는 권한이 없습니다. 필요하면 시스템관리자에게 메뉴 권한을 요청하세요.</p>
      {first && (
        <NavLink className="btn primary" to={first.to}>
          {first.label}(으)로 이동
        </NavLink>
      )}
    </div>
  );
}

/** 첫 화면: 대시보드 권한이 없으면 볼 수 있는 첫 메뉴로 이동 */
export function Home({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  if (can('dashboard')) return <>{children}</>;
  const first = NAV.flatMap((g) => g.items).find((i) => can(i.menu));
  return first ? <Navigate to={first.to} replace /> : <Guard menu="dashboard">{children}</Guard>;
}

/** 테스트 계정 전용: 역할을 바꿔 가며 화면·권한 시험 (프로젝트 PM은 시험할 프로젝트 선택) */
function TestRoleSwitch({ user, onSwitched }: { user: User; onSwitched: (token: string, u: User) => void }) {
  const { data: projects } = useFetch<{ prjCd: string; prjNm: string }[]>('/projects?status=ACTIVE,PROPOSAL');
  const cur = user.testPm ? 'PM' : user.role;
  const [busy, setBusy] = useState(false);
  const switchTo = async (role: string, prjCd?: string) => {
    if (role === 'PM' && !prjCd) prjCd = user.testPm ?? projects?.[0]?.prjCd;
    setBusy(true);
    try {
      const r = await api.post<{ token: string; user: User }>('/auth/test-role', { role, prjCd });
      onSwitched(r.token, r.user);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="test-role">
      <div className="test-role-title">테스트 역할</div>
      <select value={cur} disabled={busy} onChange={(e) => switchTo(e.target.value)} aria-label="테스트 역할">
        <option value="ADMIN">시스템관리자</option>
        <option value="EXEC">사업관리자</option>
        <option value="PM">프로젝트 PM</option>
        <option value="EMP">수행인력</option>
      </select>
      {cur === 'PM' && (
        <select value={user.testPm ?? ''} disabled={busy} onChange={(e) => switchTo('PM', e.target.value)} aria-label="PM으로 시험할 프로젝트">
          {(projects ?? []).map((p) => (
            <option key={p.prjCd} value={p.prjCd}>
              {p.prjNm}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
