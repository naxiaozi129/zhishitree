import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/api';
import { canUseApp } from '../utils/roles';

export type AuthUser = { id: number; username: string; role: string; approved: boolean };

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<{ pendingApproval: boolean }>;
  register: (username: string, password: string) => Promise<{ pendingApproval: boolean }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: AuthUser | null }>('/api/auth/me');
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<{ user: AuthUser; pendingApproval?: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(data.user);
    return { pendingApproval: Boolean(data.pendingApproval) || !canUseApp(data.user) };
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await apiFetch<{ user: AuthUser; pendingApproval?: boolean }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(data.user);
    return { pendingApproval: Boolean(data.pendingApproval) || !canUseApp(data.user) };
  }, []);

  const logout = useCallback(async () => {
    await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, login, register, logout }),
    [user, loading, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
