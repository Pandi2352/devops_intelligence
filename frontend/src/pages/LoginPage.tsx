import React, { useState } from 'react';
import { useAuth, DUMMY_USERS } from '../context/AuthContext';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { Boxes, Shield, UserCheck, Code } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const LoginPage: React.FC = () => {
  const { login, loginAsDummy, register } = useAuth();
  const navigate = useNavigate();

  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('admin@kubeorbit.local');
  const [password, setPassword] = useState('AdminPassword123!');
  const [role, setRole] = useState('developer');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isRegister) {
        await register(name, email, password, role);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch (err: any) {
      setError('Login failed. Please check credentials or use dummy login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (key: 'admin' | 'devops' | 'developer') => {
    loginAsDummy(key);
    navigate('/');
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-md p-6">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-11 h-11 mx-auto rounded-md bg-sky-600 flex items-center justify-center text-white mb-2">
            <Boxes size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Kube<span className="text-sky-600">Orbit</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Centralized DevOps, Kubernetes & GitOps Platform
          </p>
        </div>

        {/* Dummy Credentials Banner & Quick One-Click Logins */}
        <div className="mb-6 p-4 rounded-md bg-slate-50 border border-slate-200">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Dummy Test Accounts</span>
            <span className="text-[10px] font-normal text-slate-500">Click to log in directly</span>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleQuickLogin('admin')}
              className="w-full text-left p-2 rounded-md bg-white border border-slate-200 hover:border-sky-500 hover:bg-sky-50/50 flex items-center justify-between transition-colors"
            >
              <div>
                <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Shield size={13} className="text-purple-600" />
                  <span>Super Admin</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono">admin@kubeorbit.local • AdminPassword123!</div>
              </div>
              <span className="text-[10px] font-semibold text-sky-600 uppercase">Login</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('devops')}
              className="w-full text-left p-2 rounded-md bg-white border border-slate-200 hover:border-sky-500 hover:bg-sky-50/50 flex items-center justify-between transition-colors"
            >
              <div>
                <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <UserCheck size={13} className="text-sky-600" />
                  <span>DevOps Engineer</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono">devops@kubeorbit.local • DevopsPassword123!</div>
              </div>
              <span className="text-[10px] font-semibold text-sky-600 uppercase">Login</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('developer')}
              className="w-full text-left p-2 rounded-md bg-white border border-slate-200 hover:border-sky-500 hover:bg-sky-50/50 flex items-center justify-between transition-colors"
            >
              <div>
                <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Code size={13} className="text-emerald-600" />
                  <span>Developer</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono">developer@kubeorbit.local • DevPassword123!</div>
              </div>
              <span className="text-[10px] font-semibold text-sky-600 uppercase">Login</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        {/* Regular Login Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {isRegister && (
            <div>
              <label className="block text-xs font-medium text-slate-700 uppercase tracking-wider mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:border-sky-600 font-mono"
            />
          </div>

          {isRegister && (
            <div>
              <label htmlFor="register-role" className="block text-xs font-medium text-slate-700 uppercase tracking-wider mb-1">
                Platform Role
              </label>
              <Dropdown<string>
                id="register-role"
                size="md"
                fullWidth
                value={role}
                onChange={setRole}
                options={[
                  { value: 'developer', label: 'Developer' },
                  { value: 'devops', label: 'DevOps Engineer' },
                  { value: 'viewer', label: 'Viewer' },
                ]}
              />
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-2"
            isLoading={isLoading}
          >
            {isRegister ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-200 text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-xs text-slate-600 hover:text-sky-600 transition-colors"
          >
            {isRegister ? 'Already have an account? Sign In' : 'Need an account? Register here'}
          </button>
        </div>
      </div>
    </div>
  );
};
