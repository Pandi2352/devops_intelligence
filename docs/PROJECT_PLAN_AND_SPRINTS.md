# 🛰️ KubeOrbit — Enterprise DevOps & GitOps Platform Master Blueprint

> **System Mission**: A centralized DevOps platform inspired by Devtron, unifying **GitLab CI/CD**, **Container Registries**, **ArgoCD GitOps**, **Multi-Cluster Kubernetes (Minikube & Fleet)**, and **Full-Stack Observability (Prometheus/Loki/Grafana)** with strict **Project-Scoped RBAC** and **Manager Governance**.

---

## 🏗️ 1. Complete End-to-End DevOps Architecture

The platform models and automates your company's exact 10-tier continuous delivery lifecycle:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               1. DEVELOPER WORKSPACE                                   │
│  git add .  ──►  git commit -m "feat: document api"  ──►  git push origin [dev|prod]   │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               2. GITLAB REPOSITORY                                     │
│  Source Code  •  .gitlab-ci.yml  •  resources/dbconfig/mongo.$CI_COMMIT_REF_SLUG.json  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ triggers pipeline
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              3. GITLAB CI/CD PIPELINE                                  │
│                                                                                        │
│  [Stage 1: code_scan]   ──►  Snyk Alpine Vulnerability Scan (snyk-report.json)         │
│  [Stage 2: sonar]       ──►  SonarQube Quality Gate (Java 17 + sonar-scanner)          │
│  [Stage 3: build]       ──►  Node 20 build: dist/ + env configs + dockerimagename.txt  │
│  [Stage 4: package]     ──►  Docker-in-Docker (DinD) Build + Trivy Image Scan + Push   │
│  [Stage 5: email-stage] ──►  VAPT Security Reports & Audit Dispatch                    │
│  [Stage 6: kubeconfig]  ──►  yq dynamic manifest engine (kube-config.yaml generated)  │
│  [Stage 7: publish]     ──►  ARGOCD_GIT_COMMIT.sh commits to GitOps Deployment Repo    │
└──────────────────┬───────────────────────────────────────┬─────────────────────────────┘
                   │                                       │
                   │ Docker Image                          │ Git Desired State
                   ▼                                       ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│     4. GITLAB CONTAINER REGISTRY     │  │          5. ARGOCD GITOPS REPO               │
│ registry.gitlab.com/org/app:dev-tag  │  │ deployment.yaml (image, replica, secrets)   │
└──────────────────┬───────────────────┘  └───────────────────────┬──────────────────────┘
                   │                                              │
                   │ image pull (credentials secret)              │ watches desired state
                   ▼                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        6. ARGOCD GITOPS RECONCILER                                     │
│  Continuously compares Git Desired State vs Kubernetes Actual State ──► Triggers Sync  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                     7. KUBERNETES RUNTIME (Minikube / Cluster Fleet)                   │
│                                                                                        │
│  Namespace: dms-$CI_COMMIT_REF_SLUG-apps (e.g., dms-dev-apps, dms-prod-apps)          │
│  ├── Deployments & ReplicaSets (Pods: NestJS, Microservices, MongoDB, Redis)          │
│  ├── Services (ClusterIP on port 3000)                                                │
│  ├── ConfigMaps & Secrets (dms-dev-v2-env, dms-dev-cm) mounted at /smtc-app/.env      │
│  └── Ingress (ingress-nginx on port 80/443 with path routing)                         │
└──────────────────┬───────────────────────────────────────┬─────────────────────────────┘
                   │                                       │
                   │ Metrics Scraping                      │ Container Logs Streaming
                   ▼                                       ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│        8. PROMETHEUS METRICS         │  │              9. LOKI LOG STACK               │
│ CPU, Memory, Pod Restarts, Latency   │  │ Promtail / Alloy streaming stdout & stderr   │
└──────────────────┬───────────────────┘  └───────────────────────┬──────────────────────┘
                   │                                              │
                   └───────────────────────┬──────────────────────┘
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             10. GRAFANA OBSERVABILITY                                  │
│           Unified Dashboards: Infrastructure, Pipelines, Application SLAs              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 👥 2. Three Dedicated Persona Portals

To eliminate chaos between management, developers, and platform engineers, KubeOrbit provides role-tailored workspaces:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ROLE BOUNDARIES                                      │
├─────────────────────────┬───────────────────────────────┬──────────────────────────────┤
│      👩‍💻 DEVELOPER       │       🛠️ DEVOPS ENGINEER       │         👔 MANAGER           │
├─────────────────────────┼───────────────────────────────┼──────────────────────────────┤
│ • My Assigned Project   │ • Multi-Cluster Minikube/Fleet│ • Production Approval Queue  │
│ • Commit & Pipeline Run │ • GitLab Runner & CI Engine   │ • Release Timeline & Velocity│
│ • Container Image Tags  │ • ArgoCD Sync & Diff Inspector│ • Security Gate Compliance   │
│ • Pod Logs & Terminal   │ • Trivy & Snyk CVE Dashboard  │ • Cluster Uptime & SLA Stats │
│ • Non-Prod Restarts     │ • Ingress, Secrets, ConfigMaps│ • Audit Log: Who Did What    │
└─────────────────────────┴───────────────────────────────┴──────────────────────────────┘
```

### 1. Developer Portal
- **Zero Cluster Admin Needed**: Developers never touch raw kubeconfig files or need AWS/Azure IAM keys.
- **Project Isolation**: A developer assigned to project `argo-apps` only sees resources in `argo-apps` (no leakage into `devtron-demo` or production).
- **Resource Browser Self-Service**:
  - Live container stdout/stderr log viewer (like `kubectl logs -f`).
  - Terminal shell access (`exec` into pod for debugging).
  - Restart pod in `dev` environment with one click.
- **Pipeline Status**: Direct view of GitLab CI build status, unit test pass/fail, and generated image tag.

### 2. DevOps Engineer Portal
- **Multi-Cluster Infrastructure Deck**: Live health of `minikube`, `cluster1`, `cluster2`, nodes, and capacity.
- **GitLab CI & Image Management**: Inspect DinD build status, Trivy image scan results, and GitLab Container Registry images.
- **ArgoCD GitOps Sync Engine**: Visual Diff between Git repository and cluster state; manual sync, automated sync, and automated rollback.
- **Template Manifest Generator**: Inspect the dynamic `yq` transformation of `$KUBE_DEPLOYMENT` into `kube-config.yaml`.
- **Network & Ingress Routing**: Ingress controller rules, TLS certificates, service targetPorts.

### 3. Manager Portal
- **Privileged Approval Queue**:
  - Developers requesting deployment to `production` require 1-click Manager sign-off.
  - Pod restarts or replica scaling in `prod` generates an audit ticket.
- **Delivery Velocity Dashboard**: Lead time for changes, deployment frequency, failure rate, and Mean Time to Recovery (MTTR).
- **Security Compliance**: Snyk and Trivy pass/fail gate before promotion to staging or prod.
- **Server Health & Budgeting**: Node CPU/Memory utilization to prevent cluster starvation.

---

## 🗺️ 3. Sprint-Wise Execution Roadmap

| Sprint | Timeline | Primary Milestone | Key Deliverables |
| :---: | :---: | :--- | :--- |
| **Sprint 1** | Week 1–2 | **Foundations & Connectors** *(Completed)* | • Single unified sidebar with collapsible submenus<br>• Light theme, `rounded-md`, zero shadows<br>• Project model & UI (`argo-apps`, `devtron-demo`)<br>• User permissions mapping (Devtron-style)<br>• Minikube & multi-cluster context discovery |
| **Sprint 2** | Week 3–4 | **GitLab & ArgoCD Live Connectors** *(Current)* | • Authenticated GitLab integration (`mvp.bose23`)<br>• Auto-discovery of 10 GitLab repositories<br>• Resource Browser with live K8s tree (Pods, Deployments, Services)<br>• Live Manifest viewer (YAML without managedFields)<br>• Pod Logs streaming & container shell |
| **Sprint 3** | Week 5–6 | **GitLab CI/CD Pipeline Tracking** | • GitLab CI Pipeline visualizer (8 stages: Snyk, Sonar, Build, DinD, Trivy, yq, ArgoCD)<br>• Artifact viewer (`snyk-report.json`, `trivy_scan_report.json`, `dockerimagename.txt`)<br>• Real-time build progress and image tag tracking |
| **Sprint 4** | Week 7–8 | **ArgoCD GitOps Sync & Canary Rollout** | • Real ArgoCD connection via Minikube port-forward or API<br>• GitOps Sync trigger (`argocd app sync`)<br>• Canary traffic split slider (10% → 25% → 50% → 100%)<br>• Instant rollback to previous Git commit |
| **Sprint 5** | Week 9–10 | **Manager Approval Workflows & RBAC Guardrails** | • Approval Queue UI for privileged operations (`prod` deploys, pod restart, replica scaling)<br>• Audit trail logging with timestamps and actor email<br>• Notification dispatch (Slack / Webhook / Email simulator) |
| **Sprint 6** | Week 11–12 | **Prometheus, Loki & Grafana Observability** | • Embedded Grafana dashboards in KubeOrbit<br>• Prometheus metrics: Pod CPU/Memory, HTTP error rates<br>• Loki log stream aggregation across microservices |

---

## 🚀 4. How Each Stakeholder Uses the Platform (User Journey)

### A. The Developer Journey (e.g., Alice working on `demo-api`)
1. Alice writes code locally in NestJS/Node and pushes to branch `dev`.
2. She opens KubeOrbit at `http://localhost:5173`:
   - Her assigned project `demo-api` shows the active GitLab CI pipeline in progress.
   - She sees Snyk scan passed and SonarQube quality gate passed.
3. Once the image is pushed and ArgoCD syncs:
   - Alice clicks **Resource Browser** → selects namespace `dms-dev-apps` → clicks her pod.
   - She inspects **Logs** in real-time to verify her API server started on port 3000.
   - If she needs to test an internal endpoint, she clicks **Terminal** to run `curl localhost:3000`.

### B. The DevOps Journey (e.g., Bob managing Minikube & Infrastructure)
1. Bob manages cluster credentials in **Connectors** (GitLab PAT, Minikube Kubeconfig, ArgoCD token).
2. In **Projects**, he maps new microservices to target namespaces (`argo-apps`, `default`, `monitoring`).
3. In **Resource Browser**, he inspects deployments, services, endpoints, and persistent volume claims across all 4 clusters (`minikube`, `cluster1`, `cluster2`, `docker-desktop`).
4. In **ArgoCD GitOps**, he audits the YAML diff between the deployment Git repo and the running cluster.

### C. The Manager Journey (e.g., Carol approving a Production Release)
1. Carol receives a notification: *Alice has requested promotion of `demo-api` (tag: `dev-20260928-a81f3c9`) to Production*.
2. Carol opens **Manager Approvals**:
   - Reviews the Snyk security report (0 Criticals) and Trivy image scan (Clean).
   - Verifies the target environment is `production` (Namespace: `dms-prod-apps`).
   - Clicks **Approve & Deploy**.
3. KubeOrbit signals ArgoCD to sync the production manifest, and the manager observes the zero-downtime rolling update.

---

## 🛠️ 5. Next Immediate Execution Steps

1. **Link GitLab Repos to Projects**:
   - In **Projects** (`/projects`), map your newly connected repository `demo-api-devops` or `demo-api` to project `argo-apps`.
2. **Expose ArgoCD Server on Minikube**:
   ```powershell
   kubectl port-forward svc/argocd-server -n argocd 8085:443
   ```
   Save `https://localhost:8085` in **Global Configurations** → **Connectors** → **ArgoCD Credentials**.
3. **Verify Pipeline Simulation**:
   - Run our built-in pipeline inspector to test the 8-stage flow (`code_scan` → `sonar` → `build` → `package` → `kubeconfig` → `publish_argocd`).
