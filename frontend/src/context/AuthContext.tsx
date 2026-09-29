import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '../api/client';

export type UserRole = 'superadmin' | 'devops' | 'developer' | 'viewer';

export interface DirectPermission {
  project: string;
  environment: string;
  application: string;
  permission: 'View only' | 'Build and Deploy' | 'Admin' | 'Manager Approver';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  directPermissions: DirectPermission[];
  allowedClusters: string[];
  allowedEnvironments: string[];
}

// What the signed-in user may do; the API enforces the same rules. Levels: 1 view · 2 build and deploy · 3 admin.
export interface AccessSummary {
  manager: boolean;
  superAdmin: boolean;
  projects: { id: string; name: string; level: number; canApprove: boolean; environments: { name: string; level: number }[] }[];
}

export const TOKEN_KEY = 'kubeorbit_token';
const USER_KEY = 'kubeorbit_user';

interface AuthContextType {
  user: User | null;
  access: AccessSummary | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>;
  refresh: () => Promise<void>;
  logout: (reason?: string) => void;
  signOutReason: string | null;
  hasRole: (roles: string[]) => boolean;
  isManager: boolean;
  /** Level (0-3) on a project, or on one of its environments. */
  levelOn: (project: string, env?: string) => number;
  /** True when the user may deploy to at least one environment anywhere. */
  canDeployAnywhere: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const readJson = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(() => readJson<User>(USER_KEY));
  const [access, setAccess] = useState<AccessSummary | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const [signOutReason, setSignOutReason] = useState<string | null>(null);

  const clear = useCallback((reason?: string) => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setAccess(null);
    setSignOutReason(reason || null);
  }, []);

  const store = (t: string, u: User, a?: AccessSummary | null) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    if (a !== undefined) setAccess(a);
  };

  const refresh = useCallback(async () => {
    const res = await api.get('/auth/me');
    setUser(res.data.user);
    setAccess(res.data.access);
    localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
  }, []);

  // Validate the stored session on load; an expired or revoked token signs the user out.
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    refresh()
      .catch(() => clear('Your session has expired. Sign in again.'))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any 401 from the API (expired token, account disabled, password changed elsewhere) ends the session.
  useEffect(() => {
    const onExpired = (e: Event) => clear((e as CustomEvent<string>).detail || 'Your session has expired. Sign in again.');
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [clear]);

  const login = async (email: string, password: string) => {
    try {
      const res = await api.post('/auth/login', { email, password });
      setSignOutReason(null);
      store(res.data.token, res.data.user, res.data.access);
    } catch (err) {
      throw new Error(getApiErrorMessage(err, 'Sign in failed'));
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      const res = await api.post('/auth/me/password', { currentPassword, newPassword });
      store(res.data.token, res.data.user);
      await refresh();
      return res.data.message as string;
    } catch (err) {
      throw new Error(getApiErrorMessage(err, 'Could not change the password'));
    }
  };

  const isManager = Boolean(access?.manager ?? (user && ['superadmin', 'devops'].includes(user.role)));

  const hasRole = (roles: string[]): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return roles.includes(user.role);
  };

  const levelOn = (project: string, env?: string): number => {
    if (isManager) return 3;
    const p = access?.projects.find((x) => x.name === project);
    if (!p) return 0;
    if (!env) return p.level;
    return p.environments.find((e) => e.name === env)?.level || 0;
  };

  const canDeployAnywhere = isManager || Boolean(access?.projects.some((p) => p.environments.some((e) => e.level >= 2)));

  return (
    <AuthContext.Provider
      value={{ user, access, token, isLoading, login, changePassword, refresh, logout: clear, signOutReason, hasRole, isManager, levelOn, canDeployAnywhere }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
