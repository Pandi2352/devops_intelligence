import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Workflow,
  ShieldCheck,
  Cable,
  Bot,
  CheckSquare,
  Folder,
  Settings,
  ChevronDown,
  ChevronRight,
  Users,
  Shield,
  Lock,
  Boxes,
  BookOpen,
  Rocket,
  ScrollText,
  LifeBuoy,
  LineChart,
} from 'lucide-react';
import { GitLabLogo } from '../connectors/ConnectorLogos';
import { useAuth } from '../../context/AuthContext';

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { isManager } = useAuth();

  // Collapsible state for single sidebar menus and submenus
  const [isGlobalConfigOpen, setIsGlobalConfigOpen] = useState<boolean>(true);
  const [isAuthorizationOpen, setIsAuthorizationOpen] = useState<boolean>(true);

  // Helper to check if a route is active
  const isPathActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 select-none">
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center gap-3 border-b border-slate-200">
        <div className="w-8 h-8 rounded-md bg-sky-600 flex items-center justify-center text-white shrink-0">
          <Workflow size={18} />
        </div>
        <div>
          <span className="font-bold text-base tracking-tight text-slate-900">
            DevOps <span className="text-sky-600">Intelligence</span>
          </span>
          <span className="block text-[10px] text-slate-500 font-mono tracking-wide uppercase">
            Kubernetes · GitOps · CI/CD
          </span>
        </div>
      </div>

      {/* Navigation Menus & Submenus in a SINGLE Unified Sidebar */}
      <div className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
        {/* Section 1: Core Operations */}
        <div>
          <div className="px-2 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Platform &amp; Workflows
          </div>
          <div className="space-y-0.5">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <LayoutDashboard size={15} />
                <span>Dashboard</span>
              </div>
            </NavLink>

            <NavLink
              to="/docs"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <BookOpen size={15} />
                <span>Getting Started</span>
              </div>
            </NavLink>

            <NavLink
              to="/guide"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <LifeBuoy size={15} />
                <span>User Guide</span>
              </div>
            </NavLink>

            <NavLink
              to="/approvals"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <CheckSquare size={15} />
                <span>Manager Approvals</span>
              </div>
              <span className="px-1.5 py-0.2 text-[10px] font-mono font-semibold rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                Queue
              </span>
            </NavLink>

            <NavLink
              to="/copilot"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <Bot size={15} />
                <span>DevOps Copilot</span>
              </div>
              <span className="px-1.5 py-0.2 text-[10px] font-mono font-semibold rounded-md bg-sky-100 text-sky-700 border border-sky-200">
                AI Learn
              </span>
            </NavLink>
          </div>
        </div>

        {/* Section 2: Workloads & Delivery */}
        <div>
          <div className="px-2 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Workloads &amp; GitOps
          </div>
          <div className="space-y-0.5">
            <NavLink
              to="/resource-browser"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <Boxes size={15} className="text-sky-600" />
                <span className="font-semibold text-slate-800">Resource Browser</span>
              </div>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Live K8s
              </span>
            </NavLink>

            <NavLink
              to="/environments"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <Rocket size={15} />
                <span>Environments</span>
              </div>
            </NavLink>

            <NavLink
              to="/argocd"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <Workflow size={15} />
                <span>ArgoCD GitOps</span>
              </div>
            </NavLink>

            <NavLink
              to="/git"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <GitLabLogo size={15} />
                <span>GitLab Repositories</span>
              </div>
              <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold rounded bg-orange-50 text-orange-700 border border-orange-200">
                10 Repos
              </span>
            </NavLink>
          </div>
        </div>

        {/* Section: Observability */}
        <div>
          <div className="px-2 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Observability
          </div>
          <div className="space-y-0.5">
            <NavLink
              to="/logs"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <ScrollText size={15} />
                <span>Logs</span>
              </div>
            </NavLink>
            <NavLink
              to="/metrics"
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <div className="flex items-center gap-2">
                <LineChart size={15} />
                <span>Metrics</span>
              </div>
            </NavLink>
          </div>
        </div>

        {/* Section 3: GLOBAL CONFIGURATIONS - Accordion Menu with Submenus (Single Sidebar) */}
        <div>
          {/* Main Collapsible Menu Trigger */}
          <button
            type="button"
            onClick={() => setIsGlobalConfigOpen(!isGlobalConfigOpen)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors uppercase tracking-wider"
          >
            <div className="flex items-center gap-2">
              <Settings size={15} className="text-sky-600" />
              <span>Global Configurations</span>
            </div>
            {isGlobalConfigOpen ? (
              <ChevronDown size={14} className="text-slate-400" />
            ) : (
              <ChevronRight size={14} className="text-slate-400" />
            )}
          </button>

          {/* Submenu Items under Global Configurations */}
          {isGlobalConfigOpen && (
            <div className="mt-1 pl-2 space-y-0.5 border-l-2 border-slate-100 ml-3">
              {/* 1. Projects (Image 1 & 2) */}
              <NavLink
                to="/projects"
                className={({ isActive }) =>
                  `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`
                }
              >
                <div className="flex items-center gap-2">
                  <Folder size={14} className="text-amber-500" />
                  <span>Projects</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Workspace</span>
              </NavLink>

              {/* Connectors and Authorization are for DevOps admins only (the routes and API enforce it too). */}
              {isManager && (
              <>
              {/* 3. Connectors */}
              <NavLink
                to="/connectors"
                className={({ isActive }) =>
                  `flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`
                }
              >
                <div className="flex items-center gap-2">
                  <Cable size={14} className="text-slate-500" />
                  <span>Connectors</span>
                </div>
              </NavLink>

              {/* 4. Submenu: Authorization (Image 3, 4, 5) */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setIsAuthorizationOpen(!isAuthorizationOpen)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-sky-600" />
                    <span>Authorization</span>
                  </div>
                  {isAuthorizationOpen ? (
                    <ChevronDown size={13} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={13} className="text-slate-400" />
                  )}
                </button>

                {/* Sub-items under Authorization */}
                {isAuthorizationOpen && (
                  <div className="mt-0.5 pl-3 space-y-0.5 border-l-2 border-slate-100 ml-3">
                    <NavLink
                      to="/authorization/users"
                      className={({ isActive }) =>
                        `flex items-center justify-between px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                        }`
                      }
                    >
                      <div className="flex items-center gap-1.5">
                        <Users size={13} />
                        <span>User Permissions</span>
                      </div>
                    </NavLink>

                    <NavLink
                      to="/rbac"
                      className={({ isActive }) =>
                        `flex items-center justify-between px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-600'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                        }`
                      }
                    >
                      <div className="flex items-center gap-1.5">
                        <Shield size={13} />
                        <span>Permission Groups</span>
                      </div>
                    </NavLink>
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
