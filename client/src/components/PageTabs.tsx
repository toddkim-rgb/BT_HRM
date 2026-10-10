import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export interface PageTab {
  to: string;
  label: string;
  menu: string; // 메뉴 권한 키 — 권한이 있는 탭만 보임
}

/** 기준정보 > 인력 및 협력사 */
export const PEOPLE_TABS: PageTab[] = [
  { to: '/employees', label: '인력', menu: 'employees' },
  { to: '/partners', label: '협력사', menu: 'partners' },
];
/** 기준정보 > 기준값 · 원가 기준 */
export const BASIS_TABS: PageTab[] = [
  { to: '/settings', label: '기준값', menu: 'settings' },
  { to: '/cost-basis', label: '원가 기준', menu: 'costBasis' },
];

/** 합쳐진 메뉴의 탭 (각 탭은 원래 화면·주소·권한을 그대로 사용) */
export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const { can } = useAuth();
  const visible = tabs.filter((t) => can(t.menu));
  if (visible.length < 2) return null;
  return (
    <nav className="tabs page-tabs no-print">
      {visible.map((t) => (
        <NavLink key={t.to} to={t.to}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
