import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import type { Role } from './codes';

export interface User {
  empId: string;
  name: string;
  role: Role;
  mustChangePw?: boolean; // 초기 비밀번호(이메일 주소) → 변경 전까지 다른 화면 이용 불가
  isPm?: boolean; // 투입 배정에서 PM으로 지정된 프로젝트가 있음
  pmPrjCds?: string[]; // PM으로 지정된 프로젝트
  tester?: boolean; // 테스트 계정 (역할 전환 가능)
  testPm?: string | null; // 테스트 계정이 PM으로 시험 중인 프로젝트
}

/** 메뉴 키 → 권한 단계 (서버 '메뉴 권한' 설정, DB) */
export type Level = 'NONE' | 'VIEW' | 'EDIT';
export type Perms = Record<string, Level>;
const RANK: Record<Level, number> = { NONE: 0, VIEW: 1, EDIT: 2 };

interface AuthCtx {
  user: User | null;
  ready: boolean;
  perms: Perms;
  /** 메뉴 권한 확인: can('employees') = 조회 이상, can('employees', 'EDIT') = 편집 */
  can: (menu: string, level?: Level) => boolean;
  reloadPerms: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** 비밀번호 변경 후 새 토큰 반영 */
  applySession: (token: string, user: User) => void;
}

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [perms, setPerms] = useState<Perms | null>(null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setPerms(null);
  }, []);

  const reloadPerms = useCallback(() => {
    api
      .get<Perms>('/auth/me/permissions')
      .then(setPerms)
      .catch(() => setPerms({}));
    // 프로젝트 PM 지정 여부 (로그인 후·배정 변경 후 갱신)
    api
      .get<User>('/auth/me')
      .then((u) => setUser((prev) => (prev ? { ...prev, isPm: u.isPm, pmPrjCds: u.pmPrjCds, tester: u.tester, testPm: u.testPm } : prev)))
      .catch(() => undefined);
  }, []);

  // 로그인·역할 변경 시 메뉴 권한 다시 불러오기 (초기 비밀번호 변경 전에는 불필요)
  useEffect(() => {
    if (user && !user.mustChangePw) reloadPerms();
  }, [user?.empId, user?.role, user?.mustChangePw, reloadPerms]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = useCallback((menu: string, level: Level = 'VIEW') => RANK[perms?.[menu] ?? 'NONE'] >= RANK[level], [perms]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api
      .get<User>('/auth/me')
      .then((u) => setUser({ empId: u.empId, name: u.name, role: u.role, mustChangePw: u.mustChangePw, isPm: u.isPm, pmPrjCds: u.pmPrjCds, tester: u.tester, testPm: u.testPm }))
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true));
  }, [logout]);

  const applySession = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setUser(u);
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    applySession(r.token, r.user);
  };

  // 권한을 불러오기 전에는 화면을 그리지 않음 (메뉴가 깜빡이거나 권한 없음이 잠깐 보이지 않도록)
  const allReady = ready && (!user || !!user.mustChangePw || perms != null);
  return <Ctx.Provider value={{ user, ready: allReady, perms: perms ?? {}, can, reloadPerms, login, logout, applySession }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const hasRole = (u: User | null, ...roles: Role[]) => !!u && roles.includes(u.role);

/** 프로젝트 PM(수행인력): 담당 프로젝트로 범위 제한 */
export const pmScoped = (u: User | null) => !!u && u.role === 'EMP' && !!u.isPm;

/** 기술등급·고용형태 표시 여부: 수행인력(프로젝트 PM 포함)에게는 표시하지 않음 */
export const useShowHr = () => {
  const { user } = useAuth();
  return !!user && user.role !== 'EMP';
};

/** 이 프로젝트의 PM인가 (투입 배정 지정, 테스트 계정은 시험 중인 프로젝트) */
export const isPmOf = (u: User | null, prjCd: string) => !!u?.pmPrjCds?.includes(prjCd);
