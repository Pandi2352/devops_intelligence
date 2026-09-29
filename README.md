# 🚀 DevOps Intelligence (Centralized DevOps & GitOps Platform)

> **DevOps Intelligence** is a centralized, next-generation DevOps platform inspired by Devtron, designed to manage multi-cluster Kubernetes environments, automate progressive delivery (Canary, Blue-Green, Rolling Updates), integrate declaratively with **ArgoCD**, and connect seamlessly with **GitHub** and **GitLab**.

---

## 🌟 Unique Project Name Options

1. **DevOps Intelligence** *(Selected Default)* — The unified flight deck for multi-cluster Kubernetes, GitOps, and microservice lifecycles.
2. **NexaOps** — Next-generation automated GitOps orchestrator.
3. **CloudWeaver** — Weaving together multi-cluster K8s, ArgoCD, and modern CI/CD pipelines.
4. **AegisOps** — Secure, enterprise-grade RBAC Kubernetes control center.

---

## 🏗️ Architecture & Technology Stack

### **Backend (`/backend`)**
- **Runtime & Language**: Node.js v20+ with TypeScript (`NodeNext` ES Modules)
- **Framework**: Express.js (v4.21+) with Helmet, CORS, and Morgan
- **Database**: MongoDB (Mongoose v8.10+) with auto-indexed schemas and pre-save password hashing
- **Kubernetes Client**: `@kubernetes/client-node` — auto-discovers local KubeConfig (`~/.kube/config`), switches contexts, detects `minikube`, inspects nodes, namespaces, and pods
- **GitOps Engine**: Direct REST integration with **ArgoCD** (`https://localhost:8080`)
- **Git Providers**: `@octokit/rest` for GitHub & Axios for GitLab REST APIs
- **Realtime**: Socket.io for live cluster events and deployment streaming
- **Security & RBAC**: JWT tokens with role-based guardrails (`superadmin`, `devops`, `developer`, `viewer`)

### **Frontend (`/frontend`)**
- **Core**: React 19 + TypeScript + Vite 6+
- **Styling**: Tailwind CSS v4 + Custom Glassmorphism design tokens (Dark mode, neon cyan/violet accents, glowing status indicators)
- **Routing**: React Router DOM (v7) with modular Protected Routes
- **Components Architecture**:
  - `src/components/common/`: Reusable `Badge`, `Button`, `Card`, `StatCard`, `Modal`, `PageHeader`, `LoadingSpinner`, `EmptyState`
  - `src/components/layout/`: `Sidebar`, `Navbar`, `Layout`
  - `src/components/clusters/`: `ClusterCard`, `NodesTable`, `PodsTable`
  - `src/components/applications/`: `ApplicationCard`, `CreateAppModal`, `DeployTriggerModal`
  - `src/components/git/`: `GitProviderCard`, `AddGitModal`
  - `src/components/argocd/`: `ArgoStatusCard`, `ArgoConfigModal`
  - `src/components/rbac/`: `UserTable`, `EditRoleModal`
  - `src/pages/`: `DashboardPage`, `ProjectsPage`, `ProjectDetailPage`, `EnvironmentsPage`, `ArgoPage`, `GitPage`, `LogsPage`, `MetricsPage`, `ResourceBrowserPage`, `ConnectorsPage`, `DocsPage`, `UserGuidePage`, `RbacPage`, `LoginPage` (full guide: `docs/DEVOPS_INTELLIGENCE_USER_GUIDE.md`)

---

## 🚦 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+
- **MongoDB**: Running locally on `127.0.0.1:27017` (Verified & Active)
- **Kubernetes**: `minikube` / `kubectl` (Configured in `~/.kube/config`)
- **ArgoCD**: Local ArgoCD running (optional: `kubectl port-forward svc/argocd-server -n argocd 8080:443`)

### 2. Start the Backend
```bash
cd backend
npm run dev
```
- Server URL: `http://localhost:5000`
- Health check: `http://localhost:5000/api/health`
- Default superadmin auto-seeded on first run:
  - **Email**: `admin@kubeorbit.local`
  - **Password**: `AdminPassword123!`

### 3. Start the Frontend
```bash
cd frontend
npm run dev
```
- Web Application URL: `http://localhost:5173`
- Use the **"Fill Default Superadmin Credentials"** button on the login screen for instant one-click login.

---

## 🔒 Role-Based Access Control (RBAC) Matrix

| Feature / Resource | Superadmin | DevOps | Developer | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| Cluster Discovery & Nodes | ✅ | ✅ | 👁️ Read-Only | 👁️ Read-Only |
| ArgoCD Sync & Config | ✅ | ✅ | ❌ | ❌ |
| Deploy to Dev/Staging | ✅ | ✅ | ✅ | ❌ |
| Deploy to Production | ✅ | ✅ | ❌ | ❌ |
| Canary Traffic Adjustment | ✅ | ✅ | ❌ | ❌ |
| Manage User Roles (RBAC) | ✅ | ❌ | ❌ | ❌ |
