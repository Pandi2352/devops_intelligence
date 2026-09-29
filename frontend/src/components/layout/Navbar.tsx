import { Link } from 'react-router-dom';
import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogOut, HelpCircle, ChevronDown, Bell, KeyRound } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  const userInitial = (user?.name?.[0] || user?.email?.[0] || 'A').toUpperCase();
  const isSuper = user?.role === 'superadmin';

  return (
    <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-40 shrink-0">
      {/* Left: Clean Brand / Breadcrumb Area */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-800 tracking-tight">
          DevOps Intelligence Control Plane
        </span>
        <span className="text-slate-300">/</span>
        <span className="text-xs text-slate-500 font-medium">Enterprise GitOps &amp; RBAC</span>
      </div>

      {/* Right Controls: Devtron-style Help & User Profile */}
      <div className="flex items-center gap-4">
        {/* Help Link matching Devtron top navbar */}
        <button
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 transition-colors font-medium px-2 py-1 rounded-md hover:bg-slate-100"
          title="Documentation and help"
        >
          <HelpCircle size={15} className="text-slate-500" />
          <span>Help</span>
          <ChevronDown size={13} className="text-slate-400" />
        </button>

        {/* User RBAC Profile matching Devtron Avatar Circle */}
        {user ? (
          <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                  isSuper ? 'bg-orange-600' : 'bg-sky-600'
                }`}
                title={user.email}
              >
                {userInitial}
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-bold text-slate-900 leading-tight">
                  {user.name}
                </div>
                <div className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider font-mono">
                  {isSuper ? 'Super Admin' : user.role}
                </div>
              </div>
            </div>

            <Link
              to="/account/password"
              className="p-1.5 rounded-md text-slate-400 hover:text-sky-700 hover:bg-sky-50 border border-slate-200 transition-colors"
              title="Change password"
              aria-label="Change password"
            >
              <KeyRound size={14} />
            </Link>
            <button
              onClick={() => logout()}
              className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};
