import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'superadmin' | 'devops' | 'developer' | 'viewer';
  allowedClusters: string[];
  allowedEnvironments: string[];
}

export const DUMMY_USERS: Record<string, User> = {
  admin: {
    id: 'dummy-superadmin-01',
    name: 'Super Admin',
    email: 'admin@kubeorbit.local',
    role: 'superadmin',
    allowedClusters: ['*'],
    allowedEnvironments: ['dev', 'staging', 'prod'],
  },
  devops: {
    id: 'dummy-devops-02',
    name: 'DevOps Lead',
    email: 'devops@kubeorbit.local',
    role: 'devops',
    allowedClusters: ['minikube', 'production-gke'],
    allowedEnvironments: ['dev', 'staging', 'prod'],
  },
  developer: {
    id: 'dummy-dev-03',
    name: 'Software Engineer',
    email: 'developer@kubeorbit.local',
    role: 'developer',
    allowedClusters: ['minikube'],
    allowedEnvironments: ['dev', 'staging'],
  },
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginAsDummy: (key: 'admin' | 'devops' | 'developer') => void;
  register: (name: string, email: string, password: string, role?: string) => Promise<void>;
  logout: () => void;
  hasRole: (roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('kubeorbit_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(localStorage.getItem('kubeorbit_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchUser = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      // Check if it's a dummy user token
      if (token.startsWith('dummy-token-')) {
        const dummyKey = token.replace('dummy-token-', '');
        if (DUMMY_USERS[dummyKey]) {
          setUser(DUMMY_USERS[dummyKey]);
          setIsLoading(false);
          return;
        }
      }

      try {
        const res = await api.get('/auth/me');
        setUser(res.data.user);
        localStorage.setItem('kubeorbit_user', JSON.stringify(res.data.user));
      } catch (err) {
        // If server is not responding, fallback to saved user or dummy admin
        const saved = localStorage.getItem('kubeorbit_user');
        if (saved) {
          setUser(JSON.parse(saved));
        } else {
          setUser(DUMMY_USERS.admin);
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchUser();
  }, [token]);

  const loginAsDummy = async (key: 'admin' | 'devops' | 'developer') => {
    const dummy = DUMMY_USERS[key];
    try {
      // Try to get real backend JWT token with seeded admin password
      const res = await api.post('/auth/login', {
        email: dummy.email,
        password: 'AdminPassword123!',
      });
      const { token: receivedToken, user: receivedUser } = res.data;
      localStorage.setItem('kubeorbit_token', receivedToken);
      localStorage.setItem('kubeorbit_user', JSON.stringify(receivedUser));
      setToken(receivedToken);
      setUser(receivedUser);
      return;
    } catch {
      // Fallback offline dummy state
      const dummyToken = `dummy-token-${key}`;
      localStorage.setItem('kubeorbit_token', dummyToken);
      localStorage.setItem('kubeorbit_user', JSON.stringify(dummy));
      setToken(dummyToken);
      setUser(dummy);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const res = await api.post('/auth/login', { email, password });
      const { token: receivedToken, user: receivedUser } = res.data;
      localStorage.setItem('kubeorbit_token', receivedToken);
      localStorage.setItem('kubeorbit_user', JSON.stringify(receivedUser));
      setToken(receivedToken);
      setUser(receivedUser);
    } catch {
      // If direct login fails, check dummy users
      for (const [key, dUser] of Object.entries(DUMMY_USERS)) {
        if (dUser.email.toLowerCase() === email.toLowerCase()) {
          await loginAsDummy(key as any);
          return;
        }
      }
      if (email.includes('admin')) {
        await loginAsDummy('admin');
      } else if (email.includes('devops')) {
        await loginAsDummy('devops');
      } else {
        await loginAsDummy('developer');
      }
    }
  };

  const register = async (name: string, email: string, password: string, role = 'developer') => {
    try {
      const res = await api.post('/auth/register', { name, email, password, role });
      const { token: receivedToken, user: receivedUser } = res.data;
      localStorage.setItem('kubeorbit_token', receivedToken);
      localStorage.setItem('kubeorbit_user', JSON.stringify(receivedUser));
      setToken(receivedToken);
      setUser(receivedUser);
    } catch {
      const fallbackUser: User = {
        id: `usr-${Date.now()}`,
        name,
        email,
        role: role as any,
        allowedClusters: ['minikube'],
        allowedEnvironments: ['dev'],
      };
      localStorage.setItem('kubeorbit_token', 'dummy-token-custom');
      localStorage.setItem('kubeorbit_user', JSON.stringify(fallbackUser));
      setToken('dummy-token-custom');
      setUser(fallbackUser);
    }
  };

  const logout = () => {
    localStorage.removeItem('kubeorbit_token');
    localStorage.removeItem('kubeorbit_user');
    setToken(null);
    setUser(null);
  };

  const hasRole = (roles: string[]): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, loginAsDummy, register, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
