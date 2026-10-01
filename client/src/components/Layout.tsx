import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL, type Role } from '../lib/codes';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: Role[];
}

const ALL_MANAGERS: Role[] = ['PM', 'EXEC', 'ADMIN', 'SALES'];

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: '업무',
    items: [
      { to: '/', label: '대시보드', icon: '◧' },
      { to: '/weekly', label: '주간 업무보고', icon: '✎' },
      { to: '/approvals', label: '주간보고 승인', icon: '✔', roles: ['PM', 'ADMIN'] },
      { to: '/assignments', label: '투입 배정', icon: '⇄', roles: ALL_MANAGERS },
    ],
  },
  {
    group: '현황',
    items: [
      { to: '/utilization', label: '가동률', icon: '▤' },
      { to: '/project-mm', label: '프로젝트 MM', icon: '▥', roles: ALL_MANAGERS },
    ],
  },
  {
    group: '기준정보',
    items: [
      { to: '/employees', label: '인력', icon: '☺', roles: ALL_MANAGERS },
      { to: '/projects', label: '프로젝트', icon: '▣', roles: ALL_MANAGERS },
      { to: '/partners', label: '협력사', icon: '⚑', roles: ['EXEC', 'ADMIN'] },
      { to: '/settings', label: '기준값 설정', icon: '⚙', roles: ['ADMIN'] },
    ],
  },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!user) return null;

  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(user.role)) })).filter((g) => g.items.length);

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
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
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
