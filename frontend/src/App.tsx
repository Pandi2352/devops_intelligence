import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ArgoPage } from './pages/ArgoPage';
import { GitPage } from './pages/GitPage';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { RbacPage } from './pages/RbacPage';
import { CopilotPage } from './pages/CopilotPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { UserPermissionsPage } from './pages/UserPermissionsPage';
import { ResourceBrowserPage } from './pages/ResourceBrowserPage';
import { LoginPage } from './pages/LoginPage';
import { DocsPage } from './pages/DocsPage';
import { UserGuidePage } from './pages/UserGuidePage';
import { EnvironmentsPage } from './pages/EnvironmentsPage';
import { LogsPage } from './pages/LogsPage';
import { MetricsPage } from './pages/MetricsPage';
import { LoadingSpinner } from './components/common/LoadingSpinner';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <LoadingSpinner message="Authenticating session..." />
      </div>
    );
  }

  if (!token && !user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
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
            <Route path="applications" element={<Navigate to="/environments" replace />} />
            <Route path="argocd" element={<ArgoPage />} />
            <Route path="git" element={<GitPage />} />
            <Route path="connectors" element={<ConnectorsPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="authorization/users" element={<UserPermissionsPage />} />
            <Route path="rbac" element={<RbacPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
