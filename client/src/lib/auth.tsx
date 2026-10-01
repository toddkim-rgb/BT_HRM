import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import type { Role } from './codes';

export interface User {
  empId: string;
  name: string;
  role: Role;
}

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api
      .get<User>('/auth/me')
      .then((u) => setUser({ empId: u.empId, name: u.name, role: u.role }))
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true));
  }, [logout]);

  const login = async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    tokenStore.set(r.token);
    setUser(r.user);
  };

  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const hasRole = (u: User | null, ...roles: Role[]) => !!u && roles.includes(u.role);
