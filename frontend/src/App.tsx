import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ArgoPage } from './pages/ArgoPage';
import { GitPage } from './pages/GitPage';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { PublicUrlsPage } from './pages/PublicUrlsPage';
import { RbacPage } from './pages/RbacPage';
import { CopilotPage } from './pages/CopilotPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { UserPermissionsPage } from './pages/UserPermissionsPage';
import { ResourceBrowserPage } from './pages/ResourceBrowserPage';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DocsPage } from './pages/DocsPage';
import { UserGuidePage } from './pages/UserGuidePage';
import { EnvironmentsPage } from './pages/EnvironmentsPage';
import { LogsPage } from './pages/LogsPage';
import { MetricsPage } from './pages/MetricsPage';
import { StarterPage } from './pages/StarterPage';
import { LoadingSpinner } from './components/common/LoadingSpinner';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <LoadingSpinner message="Checking your session..." />
      </div>
    );
  }
  if (!token || !user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // Accounts on a published or admin-set password must pick their own before anything else.
  if (user.mustChangePassword && location.pathname !== '/account/password') return <Navigate to="/account/password" replace />;
  return <>{children}</>;
};

// Pages only DevOps admins use (connectors, users). The API enforces the same.
const ManagerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isManager } = useAuth();
  return isManager ? <>{children}</> : <Navigate to="/" replace />;
};

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="guide" element={<UserGuidePage />} />
            <Route path="copilot" element={<CopilotPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            {/* Cluster credentials live in Connectors; old links land there. */}
            <Route path="clusters" element={<Navigate to="/connectors?tab=clusters" replace />} />
            <Route path="resource-browser" element={<ResourceBrowserPage />} />
            <Route path="environments" element={<EnvironmentsPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="public-urls" element={<PublicUrlsPage />} />
            <Route path="applications" element={<Navigate to="/environments" replace />} />
            <Route path="argocd" element={<ArgoPage />} />
            <Route path="git" element={<GitPage />} />
            <Route path="connectors" element={<ManagerRoute><ConnectorsPage /></ManagerRoute>} />
            <Route path="starter" element={<ManagerRoute><StarterPage /></ManagerRoute>} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="authorization/users" element={<ManagerRoute><UserPermissionsPage /></ManagerRoute>} />
            <Route path="rbac" element={<ManagerRoute><RbacPage /></ManagerRoute>} />
            <Route path="account/password" element={<ChangePasswordPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
