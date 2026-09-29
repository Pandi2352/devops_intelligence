import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, Eye, EyeOff, Info, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/common/Button';

export const LoginPage: React.FC = () => {
  const { login, user, token, signOutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (token && user) return <Navigate to={user.mustChangePassword ? '/account/password' : from} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-md p-6">
        <div className="text-center mb-6">
          <div className="w-11 h-11 mx-auto rounded-md bg-sky-600 flex items-center justify-center text-white mb-2">
            <Boxes size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            DevOps <span className="text-sky-600">Intelligence</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Sign in to continue</p>
        </div>

        {signOutReason && !error && (
          <div className="mb-4 p-2.5 rounded-md bg-sky-50 border border-sky-200 text-sky-900 text-xs flex items-start gap-2" role="status">
            <Info size={14} className="shrink-0 mt-0.5" /> {signOutReason}
          </div>
        )}
        {error && (
          <div className="mb-4 p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 pl-3 pr-10 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full justify-center h-10" isLoading={isLoading} disabled={!email || !password} leftIcon={<LogIn size={15} />}>
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-[11px] text-slate-500 text-center">No account? Ask a DevOps admin to add you in Authorization → User Permissions.</p>
      </div>
    </div>
  );
};
