# KubeOrbit User Guide

> **One place to build, ship, run and debug your applications on Kubernetes.**
> This guide takes you from an empty laptop to a running, multi-environment application
> with CI/CD, GitOps, promotion, rollback, logs and metrics, all driven from KubeOrbit.
>
> Read it in the app: **User Guide** in the sidebar (`/guide`), with a searchable table of contents.
> Track your own progress: **Getting Started** (`/docs`) checks every step against your real setup.

---

## 1. What KubeOrbit is

KubeOrbit is a DevOps control center that sits on top of the tools teams already use:
**GitLab** (code, CI/CD, container registry), **ArgoCD** (GitOps deployments),
**Kubernetes** (where apps run) and **Prometheus / Grafana / Loki** (observability).

Without KubeOrbit you jump between a GitLab tab, the ArgoCD UI, `kubectl`, and Grafana,
and you have to remember which namespace, branch, image tag and ArgoCD app belongs to which
environment. KubeOrbit ties all of that to a **project** and its **environments**, so
one question ("what runs in qa, and why is it broken?") has one screen with the answer.

### What you can do with it

| You want to… | Where in KubeOrbit |
|---|---|
| Connect clusters, GitLab, ArgoCD, Prometheus, Grafana, Loki | **Connectors** |
| Create a repo from a template and push code | **GitLab Repositories** |
| Watch pipelines, read job logs, test results and scan reports | **GitLab Repositories** → pipeline → job |
| Create a project and give it environments (dev, qa, uat, staging, prod) | **Projects** |
| See what version runs in every environment and promote it | **Environments** |
| Roll back an environment to an earlier deploy | **Environments** → card → **History** |
| Sync, diff and inspect ArgoCD applications | **ArgoCD GitOps** |
| Read live logs of any pod, deployment or namespace | **Logs** |
| See CPU, memory, restarts and throttling | **Metrics** |
| Browse every Kubernetes resource and inspect a pod | **Resource Browser** |
| See GitOps manifests and Git-vs-cluster YAML | **Projects** → environment → **Manifests** |
| Learn the flow step by step, with live progress | **Getting Started** |

---

## 2. How KubeOrbit works

### 2.1 The big picture

```
                         ┌──────────────────────── KubeOrbit ─────────────────────────┐
  Browser  ─────────────▶│  Frontend (React, :5173)  ──/api──▶  Backend (Express, :5000)│
                         │                                         │   MongoDB (:27017)  │
                         └─────────────────────────────────────────┼─────────────────────┘
                                                                   │ uses saved connectors
          ┌─────────────────────┬──────────────────────┬───────────┴────────┬──────────────────────┐
          ▼                     ▼                      ▼                    ▼                      ▼
   GitLab API            ArgoCD API            Kubernetes API        Prometheus / Grafana     Loki
 (repos, CI, MRs,     (apps, sync, diff,     (pods, logs, events,   (metrics, dashboards)  (log history)
  registry, tokens)    history, rollback)     namespaces, secrets)   via the K8s service proxy
```

- The **frontend** is what you click. It only talks to the KubeOrbit backend.
- The **backend** holds the connectors (credentials are **encrypted at rest** with
  `CREDENTIALS_SECRET`) and calls GitLab, ArgoCD, Kubernetes and the observability tools for you.
- **Prometheus, Grafana and Loki** that run inside the cluster are reached through the Kubernetes
  API server's service proxy, so you don't need a port-forward for KubeOrbit to read them.

### 2.2 The delivery flow (one branch = one environment)

```
 feature ─MR─▶ dev ──MR──▶ qa ──MR──▶ staging ──MR──▶ uat ──MR──▶ prod
                │           │            │              │           │
          each push/merge starts the pipeline of THAT branch (DEPLOY_ENV = branch name)
                ▼
  code_scan ─▶ build (tests) ─▶ package (image + Trivy) ─▶ kubeconfig ─▶ publish_argocd
                                      │                                      │
      registry.gitlab.com/<group>/<app>/<env>:<env>-<date>-<sha>-<pipeline>   │
                                                                             ▼
                       commit "deploy(<env>): <app> <tag>" to k8s/overlays/<env> in the GitOps repo
                                                                             ▼
                  ArgoCD app <app>-<env> sees the commit ─▶ syncs ─▶ namespace <project>-<env>
```

Three rules make this safe:

1. **Promotion is a fast-forward merge request.** Merging `dev → qa` moves `qa` to the exact commit
   `dev` tested. No merge commits, no surprise code.
2. **Every environment builds its own image**, tagged with the environment, commit and pipeline.
3. **Git is the source of truth.** CI never runs `kubectl apply`; it commits the new image tag to the
   GitOps repo and ArgoCD applies it. Rollback is a Git commit too, so it's all auditable.

Production is set to **manual sync** in ArgoCD: the pipeline updates Git, and a person presses
**Sync prod**. That click is the production approval.

### 2.3 Projects and environments

A **project** is one application:

| Part | Example |
|---|---|
| Application repo (code + `.gitlab-ci.yml`) | `mvp.bose23/kubeorbit-demo-api` |
| GitOps repo (Kustomize base + one overlay per environment) | `mvp.bose23/kubeorbit-demo-api-gitops` |
| Cluster | `minikube` |

An **environment** of a project is always these eight things, and KubeOrbit checks every one:

| # | Item | Example for `uat` |
|---|---|---|
| 1 | Namespace | `kubeorbit-demo-uat` |
| 2 | Registry pull secret | `gitlab-registry` in that namespace |
| 3 | GitOps overlay | `k8s/overlays/uat` |
| 4 | ArgoCD can read the GitOps repo | repository registered, connection *Successful* |
| 5 | ArgoCD application | `kubeorbit-demo-api-uat` → `k8s/overlays/uat` → `kubeorbit-demo-uat` |
| 6 | CI deploys the branch | `DEPLOY_BRANCHES` CI variable contains `uat` |
| 7 | Branch protected | merge requests only, so CI receives the protected deploy key |
| 8 | Branch | `uat` |

**Add environment** creates all eight. **Fix** re-creates only what's missing.

### 2.4 Naming conventions

| Thing | Pattern | Example |
|---|---|---|
| Namespace | `<project>-<env>` | `kubeorbit-demo-qa` |
| ArgoCD app | `<app-repo>-<env>` | `kubeorbit-demo-api-qa` |
| Branch / overlay folder | `<env>` | `qa`, `k8s/overlays/qa` |
| Image | `registry.gitlab.com/<group>/<app>/<env>:<env>-<yyyymmddhhmm>-<sha8>-<pipeline>` | `…/kubeorbit-demo-api/qa:qa-202609281129-ea41a441-2889290430` |
| Deploy commit | `deploy(<env>): <app> <tag>` | `deploy(qa): demo-api qa-2026…` |
| Rollback commit | `rollback(<env>): <app> <tag> (was <tag>) by <user>` | |

---

## 3. What you need

| Tool | Version used | Why |
|---|---|---|
| Docker Desktop | 4.x | runs the minikube node |
| minikube | 1.3x+ | a local Kubernetes cluster |
| kubectl | matches the cluster (1.3x) | talk to Kubernetes |
| Helm | 3.x | install Prometheus, Grafana, Loki |
| Node.js | 20+ | run KubeOrbit and the demo app |
| MongoDB | 7/8 | KubeOrbit's database |
| Git | any | push code the everyday way |
| A GitLab.com account | verified (for shared CI runners) | repos, CI/CD, registry |

Machine: **4 CPUs and 8 GB RAM free** for minikube is comfortable (ArgoCD + monitoring + 5 environments).

> **Windows:** run the commands in Git Bash or PowerShell. Where they differ, both are shown.

---

## 4. Part A: set up the local platform

### A1. Start minikube

```bash
minikube start --driver=docker --cpus=4 --memory=8192
minikube addons enable metrics-server     # live CPU/memory for KubeOrbit
minikube addons enable ingress            # optional: ingress controller
kubectl get nodes                         # minikube   Ready
```

`kubectl` now points at the `minikube` context in `~/.kube/config`. KubeOrbit reads the same file.

Useful later:

```bash
minikube status
minikube stop            # frees the RAM; everything comes back with `minikube start`
kubectl config get-contexts
```

### A2. Install ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server
```

Open it (keep this terminal running):

```bash
kubectl port-forward svc/argocd-server -n argocd 8081:443
```

ArgoCD is now at **https://localhost:8081** (self-signed certificate). Get the `admin` password:

```bash
# Git Bash / Linux / macOS
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d; echo
```

```powershell
# PowerShell
$p = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}"
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))
```

> You don't need to create ArgoCD applications by hand. KubeOrbit creates them when you add an environment.

### A3. Install Prometheus + Grafana (metrics)

Install the Helm CLI first if `helm version` fails:

```powershell
winget install Helm.Helm        # Windows; or download helm-<version>-windows-amd64.zip from https://get.helm.sh
```

```bash
brew install helm               # macOS
```

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace
kubectl -n monitoring get pods          # prometheus-…, grafana-…, kube-state-metrics-…, node-exporter-…
```

Grafana in the browser (only needed for the "Open in Grafana" links):

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
# user admin, password:
kubectl -n monitoring get secret kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d; echo
```

### A4. Install Loki (log history, optional)

Live pod logs work **without** Loki. Loki keeps logs after a pod is deleted or restarted many times,
and lets you search across pods and days.

- **Loki** stores the logs (5 GiB volume, so history survives a Loki restart).
- **Promtail** runs on every node and ships every container's log file to Loki.

The values file is in the repo: `devops-demo/platform/loki-values.yaml`.

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm install loki grafana/loki-stack --version 2.10.3 -n monitoring \
  -f devops-demo/platform/loki-values.yaml --wait
kubectl -n monitoring get pods | grep -E "loki|promtail"     # loki-0 1/1, loki-promtail-xxxxx 1/1
```

```yaml
# devops-demo/platform/loki-values.yaml (the important part)
promtail:
  config:
    snippets:
      pipelineStages:
        - docker: {}     # minikube's docker driver; use `- cri: {}` for containerd / CRI-O nodes
```

> **Pick the pipeline stage that matches the node's runtime** (`kubectl get nodes -o wide`, column CONTAINER-RUNTIME).
> With the wrong one every line is stored wrapped in `{"log": …}` and stamped with the time it was shipped
> instead of the time it was written.

Then add it in KubeOrbit: **Connectors → Observability → Discover in cluster → Add** on `monitoring/loki:3100`.

> On the first start Promtail reads the existing log files. Loki refuses lines that are more than about an hour
> older than the newest line of the same stream (`entry too far behind` in the Promtail log), so part of the
> oldest history of busy pods may be skipped once. Everything from then on is kept.

### A5. MongoDB

Install MongoDB Community and make sure it runs on `127.0.0.1:27017`:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"     # { ok: 1 }
```

Or with Docker: `docker run -d --name mongo -p 27017:27017 mongo:8`.

### A6. Run KubeOrbit

**Backend**

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

| Variable | Value | Notes |
|---|---|---|
| `PORT` | `5000` | |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/kubeorbit` | |
| `JWT_SECRET` | a long random string | signs login tokens |
| `CREDENTIALS_SECRET` | a long random string | **encrypts saved credentials. Never change it later**, or saved tokens become unreadable |
| `KUBECONFIG_PATH` | empty | empty = `~/.kube/config` |
| `FRONTEND_URL` | `http://localhost:5173` | |

Generate a random secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

```bash
npm run build && npm start        # or: npm run dev   (auto-reload while developing)
curl http://localhost:5000/api/health
```

On first start KubeOrbit creates the admin user **`admin@kubeorbit.local`** / **`AdminPassword123!`**.
Change the password after the first login.

**Frontend**

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (Vite picks 5174/5175 if 5173 is busy)
```

Open the URL, sign in, and go to **Getting Started**: every step shows *Done*, *To do* or
*Needs attention*, computed from your real setup. Press **Re-check** after each step.

### A7. Terminals to keep open

| Terminal | Command |
|---|---|
| ArgoCD | `kubectl port-forward svc/argocd-server -n argocd 8081:443` |
| Grafana (optional) | `kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80` |
| KubeOrbit backend | `cd backend && npm start` |
| KubeOrbit frontend | `cd frontend && npm run dev` |

---

## 5. Part B: connect your tools (Connectors)

Every credential lives in **Connectors**, and nowhere else. Tokens are encrypted, never shown again
(only the last 4 characters), and each connector has **Test** to prove it works.

### B1. Clusters

**Connectors → Clusters → Sync kubeconfig** imports every context in `~/.kube/config`
(`minikube` becomes the default). Or **Add cluster** with:

- **kubeconfig**: paste a kubeconfig,
- **token**: API server URL + service-account token (+ CA),
- **context**: a context name from the server's kubeconfig.

Status turns **Healthy** after a successful test (version, nodes and namespaces are shown).

### B2. GitLab

**Connectors → GitLab → Add GitLab**

| Field | Value |
|---|---|
| Base URL | `https://gitlab.com` (or your self-managed URL) |
| Personal access token | scopes **`api`**, **`read_registry`**, **`write_repository`** |

GitLab → *Preferences → Access tokens → Add new token*. Set an expiry date and store it only in KubeOrbit.
The **folder icon** on the connector row lists the repositories that token can see.

### B3. ArgoCD

**Connectors → ArgoCD → Add ArgoCD**

| Field | Value |
|---|---|
| Server URL | `https://localhost:8081` |
| Auth | *username + password* (`admin` + the password from A2), or an API token |
| Skip TLS verify | **on** for the local self-signed certificate |

KubeOrbit logs in with a session and refreshes it automatically.

### B4. Observability (Prometheus, Grafana, Loki)

**Connectors → Observability → Discover in cluster** scans the cluster for Prometheus, Grafana and Loki
services. Press **Add** on each:

| Connector | Found service (kube-prometheus-stack) | Access |
|---|---|---|
| Prometheus | `monitoring/kube-prometheus-stack-prometheus:9090` | through cluster (service proxy) |
| Grafana | `monitoring/kube-prometheus-stack-grafana:80` | through cluster, **browser URL** `http://localhost:3000` |
| Loki | `monitoring/loki:3100` | through cluster |

- **Through cluster** needs no port-forward and no credentials. KubeOrbit uses the cluster connector.
- **URL** mode is for a hosted or ingress-exposed service (with optional basic auth or bearer token).
- Grafana's **browser URL** is what *your browser* opens for "Open in Grafana" links.

### Credentials used by the pipeline (per project)

These are created by you once, or by KubeOrbit for you, and each is limited to one job:

| Credential | Access | Stored in | Who creates it |
|---|---|---|---|
| SSH deploy key (write) on the GitOps repo | push to the GitOps repo only | app repo CI variable `GITOPS_DEPLOY_KEY` (File, **Protected**) | you (B5) |
| `GITOPS_REPO` | SSH URL of the GitOps repo | app repo CI variable | you (B5) |
| Deploy token `kubeorbit-argocd-read` | read the GitOps repo | ArgoCD repository | KubeOrbit (Add environment) |
| Registry pull secret `gitlab-registry` | pull images | each environment namespace | KubeOrbit (Add environment) |
| `DEPLOY_BRANCHES` | which branches deploy | app repo CI variable | KubeOrbit (Add environment) |

### B5. One-time CI setup for a new application repo

```bash
ssh-keygen -t ed25519 -f gitops_deploy_key -N "" -C "<app> CI"
```

1. **GitOps repo → Settings → Repository → Deploy keys → Add**: paste `gitops_deploy_key.pub`,
   tick **Grant write permissions**.
2. **GitOps repo → Settings → Repository → Protected branches** → `main` → *Allowed to push*: add that deploy key.
3. **App repo → Settings → CI/CD → Variables**:
   - `GITOPS_REPO` = `git@gitlab.com:<group>/<app>-gitops.git`
   - `GITOPS_DEPLOY_KEY` = contents of `gitops_deploy_key`, type **File**, **Protected** on.
4. **App repo → Settings → Merge requests → Merge method: Fast-forward merge.**
5. Delete the local key files.

> Why *Protected*: only protected branches (your environment branches) receive the key, so a feature
> branch can never publish to an environment.

---

## 6. Part C: your first project, end to end

The repository ships a demo app in `devops-demo/` (`demo-api` + `demo-api-gitops`).
The steps below use it. Your own app works the same way.

### C1. Try the app locally (optional)

```bash
cd devops-demo/demo-api
npm install && npm test        # 9 tests pass
npm run dev                    # http://localhost:3000
curl localhost:3000/           # service, version, commit, buildEnv, pod
```

### C2. Create both repositories from KubeOrbit

**GitLab Repositories → New repository**

1. Name `kubeorbit-demo-api`, starter code **demo-api**. KubeOrbit creates the project and pushes the
   folder as the first commit. The pipeline starts immediately.
2. Name `kubeorbit-demo-api-gitops`, starter code **demo-api-gitops**.

Later changes: edit files locally, then **Push code** on the repo. It commits only changed files and asks
before overwriting anything changed in GitLab (*abort*, *overwrite* or *skip*).

Then do the one-time CI setup (**B5**) on these two repos.

### C3. Create the project

**Projects → New project**

| Field | Value |
|---|---|
| Project name | `kubeorbit-demo` (lowercase; becomes the namespace prefix; cannot be renamed) |
| GitLab connector | your connector |
| Application repository | `kubeorbit-demo-api` |
| GitOps repository | `kubeorbit-demo-api-gitops` |
| First environment branch | `dev` |
| Cluster | `minikube` |

You land on the project page.

### C4. Add environments

On the project page press **Add environment** for each of `dev`, `qa`, `staging`, `uat`, `prod`:

| Field | Default | Notes |
|---|---|---|
| Environment name | | also the branch name and overlay folder |
| Create branch from | the default branch | only used if the branch does not exist |
| Namespace | `<project>-<env>` | editable |
| ArgoCD application | `<app-repo>-<env>` | editable |
| Auto-sync | on (off for `prod`) | off = every deploy needs **Sync** |

The result lists every step: *created*, *already there*, *updated* or *failed*. The environment row
then shows **all 8 ready**, or **N of 8 missing** with the reason in red. Press **Fix** to re-run only
the missing items. **Remove** deletes the ArgoCD app (and optionally the namespace) but keeps the branch
and overlay for history.

Order matters for promotion: `local → dev → qa → test → staging → uat → preprod → prod`.

### C5. First deploy

1. Push a change to `dev` (**GitLab Repositories → Push code → branch dev**, or `git push`).
2. **GitLab Repositories → CI/CD Pipelines**: the pipeline auto-refreshes every 5 s.
   Click a job for its **live log**; **Reports** shows `npm-audit.txt`, `trivy-report.txt` and the rendered
   `kube-config.yaml`. The pipeline row shows `Tests 9/9 passed`.
3. `publish_argocd` commits `deploy(dev): …` to the GitOps repo.
4. ArgoCD syncs `kubeorbit-demo-api-dev` (auto-sync) and the pod rolls.
5. **Environments** shows dev running the new commit and image.

### C6. Promote

**Environments → project `kubeorbit-demo`**: one card per environment and the promotion path between them.

| State | Meaning | What you press |
|---|---|---|
| *ready* | the source has commits the target doesn't | **Open merge request** (or **Create branch**) |
| *review* | the merge request can be merged | **Merge !N** (fast-forwards the target) |
| *publishing* | the target's pipeline is building and publishing | wait |
| *syncing* | Git points at the new commit, ArgoCD is deploying | wait, or **Sync now** |
| *needs-sync* | manual-sync environment (prod) is updated in Git | **Sync prod** = the approval |
| *up-to-date* | the environment runs the head of its branch | nothing |
| *rolled-back* | running an older deploy than the branch head | fix forward, or **Redeploy head** |
| *blocked* / *diverged* | MR can't merge / the target has extra commits | fix in GitLab (merge the hotfix back into dev) |
| *failed* | the target pipeline failed | open the pipeline, read the job log |

Every action asks for confirmation and needs a **Super Admin** or **DevOps** user.

### C7. Roll back and redeploy

**Environments → card → History** lists every deploy of that environment (image, commit, who, when).
**Roll back here** commits that deploy's image back into the overlay
(`rollback(qa): demo-api <old> (was <new>) by you`) and syncs ArgoCD immediately.
The card then says *Rolled back*. Either fix forward on `dev` and promote again, or press **Redeploy head**
to rebuild and deploy the branch head.

**Details** on a card shows the ArgoCD resources, sync history and last operation.

### C8. Check what answers

```bash
kubectl -n kubeorbit-demo-qa port-forward svc/demo-api 3998:80
curl localhost:3998/        # "message":"Hello from QA", "buildEnv":"qa", "commit":"…"
```

---

## 7. Part D: run and debug (day-2 operations)

### D1. Logs

**Observability → Logs**, or **Logs** on a project environment, or **Logs** on any pod.

1. **Scope bar**: *Cluster → Project → Environment* (the namespace is filled in), or pick any
   **Namespace** directly. Namespaces that belong to a project show `project · env`.
2. **Pods**: *All pods*, a whole **Deployment/StatefulSet/DaemonSet** (every replica merged), or one pod.
   The left list flags pods that need attention, with the reason in plain words.
3. **Container**: all containers, or one.

In the viewer:

| Control | What it does |
|---|---|
| Last N lines / time range | tail 100–5000 lines, or the last 5 min … 24 h |
| **Follow** | streams new lines live (green dot = connected) |
| **Previous run** | logs of the container **before its last restart**: the crash reason is usually here |
| Level | all / warnings + errors / errors only (JSON `level` and plain `ERROR`/`WARN` are detected) |
| Search | highlights matches; *Only matches* hides the rest; `.*` = regular expression |
| History (Loki) | appears when a Loki connector exists: search across pods and days, including deleted pods |
| Timestamps / wrap / copy / download / clear | as named |

With several pods, each line has a coloured `[pod-suffix]` tag. Error lines are tinted red,
and the red *N errors* counter filters to them.

**Shareable links**: the selection is in the URL, e.g.
`/logs?project=<id>&env=qa&target=wl:Deployment/demo-api`.

### D2. Metrics

**Observability → Metrics** uses the same scope bar.

- **Pods table**: status, ready, restarts, live CPU and memory (metrics-server), with **Logs** and **Metrics** per pod.
- **Current usage**: CPU and memory of the selection against the node's capacity.
- **Charts** (Prometheus), for 15 min … 7 days, auto-refreshing every 30 s, in two sections:
  - **Application** (from the app's own `/metrics`): requests per second by route, latency p95 by route,
    responses by status (2xx / 4xx / 5xx) and error rate (5xx %). Health-probe and `/metrics` traffic is left out.
  - **Containers**: CPU usage (with the limit line), memory working set (with the limit line), network in/out,
    container restarts, CPU throttling %.
- **Open in Grafana**: namespace dashboard, or the pod dashboard when one pod is selected.
- **PromQL explorer** (DevOps / Super Admin): run any query and chart it.

How to read them:

| You see | It usually means |
|---|---|
| Memory climbing to the limit line, then a restart | memory leak or limit too low (**OOMKilled** in pod details) |
| High CPU throttling % | CPU limit too low for the load |
| Restarts rising with low CPU/memory | the app exits or the liveness probe fails: read **Previous run** logs |
| Empty network charts on minikube | minikube's cAdvisor doesn't export network metrics (normal) |
| p95 latency jumps on one route only | that endpoint (or what it calls) got slow; compare with its logs at the same time |
| 5xx error rate above 0 right after a deploy | the new version is failing: check logs, then **Roll back** from Environments |
| 4xx growing, 5xx flat | clients call wrong URLs or send bad input (the `unmatched` route = 404s) |

#### Make your own app show up under "Application"

Container charts work for every pod automatically. Request metrics need two things from the app:

1. **Expose `/metrics`** with a histogram named `http_request_duration_seconds` and the labels
   `method`, `route` and `status`. In Node.js with `prom-client`:

   ```js
   const httpDuration = new client.Histogram({
     name: 'http_request_duration_seconds',
     help: 'HTTP request duration in seconds',
     labelNames: ['method', 'route', 'status'],
     buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 1, 3],
   });
   // in a middleware, on res 'finish':
   httpDuration.observe({ method: req.method, route: req.route?.path || 'unmatched', status: res.statusCode }, seconds);
   ```

   Use the **route pattern** (`/api/items/:id`), never the raw path, or every id becomes a new time series.

2. **A ServiceMonitor** next to the Service in the GitOps base, so Prometheus scrapes every environment:

   ```yaml
   # k8s/base/servicemonitor.yaml  (and add it to resources: in k8s/base/kustomization.yaml)
   apiVersion: monitoring.coreos.com/v1
   kind: ServiceMonitor
   metadata:
     name: demo-api
     labels:
       app.kubernetes.io/name: demo-api
       release: kube-prometheus-stack     # the label this Prometheus selects ServiceMonitors by
   spec:
     selector:
       matchLabels:
         app.kubernetes.io/name: demo-api # must match the Service's labels
     endpoints:
       - port: http                       # the Service's port *name*
         path: /metrics
         interval: 15s
   ```

Commit it to the GitOps repo: auto-sync environments pick it up within ~3 minutes; manual-sync ones (prod)
after **Sync prod**. Check it worked with the PromQL explorer: `up{job="demo-api"}` shows 1 per pod.

### D3. Resource Browser

**Workloads & GitOps → Resource Browser**: every Kubernetes kind, live.

- Left: kinds grouped as *Cluster*, *Workloads*, *Config & Storage*, *Networking*; type in *Jump to kind* and press Enter.
- Top: cluster, **project environment** shortcut, namespace, auto-refresh (15 s).
- Table: kind-specific columns, click headers to sort, **Only unhealthy** filter, search.
- Pods show ready, status, restarts (and when), CPU, memory, age and the project/environment chip.
  **Logs** opens the pod straight on its logs; **Details** opens the pod view.
- Other kinds open a details view with **Overview** (its pods, warnings), **YAML** and **Events**.
  Deployments, StatefulSets and DaemonSets offer **Logs of all pods**.
- **Secret values are never sent to the browser**. They show as `<redacted: N chars>`.

### D4. Pod details

Opened from Logs, Metrics, Resource Browser or a deployment's pod list.

| Tab | Shows |
|---|---|
| Overview | status with the explanation (e.g. *The image cannot be pulled…*), ready, restarts, owner, node, IP, QoS, per-container image, state, last exit code, CPU and memory **usage against request and limit**, conditions, labels |
| Logs | the full log viewer for this pod (opens on *Previous run* when it's in CrashLoopBackOff) |
| Events | Kubernetes events, warnings first (kept for about an hour) |
| Metrics | the pod's charts |
| YAML | the live manifest |

### D5. Manifests

**Projects → project → environment → Manifests**

- **GitOps files**: every file of the environment overlay and the base it pulls in, with line numbers,
  copy and **Open in GitLab**.
- **Resources (Git vs cluster)**: every resource ArgoCD manages, with its state:
  *in-sync*, *modified* (someone changed the cluster by hand), *missing* (in Git, not in the cluster),
  *extra* (in the cluster only). Toggle **Desired (Git)** / **Live (cluster)** YAML.

### D6. ArgoCD GitOps page

Every ArgoCD application with sync and health status. **Details** has tabs for *overview*,
*resources* (tree), *diff* (line diff of live vs desired), *history* and *events*. Actions:
**Refresh**, **Sync** (prune / force / apply-out-of-sync-only), **Rollback** (manual-sync apps only)
and **Terminate** a running operation. Sync and rollback need Super Admin or DevOps.

---

## 8. Troubleshooting playbook

| Symptom | Where to look | Fix |
|---|---|---|
| Pod **CrashLoopBackOff** | Pod details → Logs → **Previous run** | fix the error in the app/config; check *Last run ended: exit code* |
| Pod **ImagePullBackOff / ErrImagePull** | Pod details → Overview message, Events | image tag wrong, or pull secret missing: project page → **Fix** (re-creates `gitlab-registry`) |
| Pod **OOMKilled** | Pod details → container *Last run ended: OOMKilled*; Metrics memory | raise the memory limit in the overlay, or fix the leak |
| **Running but not ready** | Pod details → Conditions, Events (`Readiness probe failed`) | check `/health/ready`; logs |
| New environment **never deploys** | Project page → CI item red | the branch's `.gitlab-ci.yml` still has a fixed branch list: promote the file that uses `$DEPLOY_BRANCHES` into that branch |
| Pipeline builds but **doesn't publish** | job `publish_argocd` log | the branch isn't protected (no `GITOPS_DEPLOY_KEY`), or the deploy key lacks write access on GitOps `main` |
| ArgoCD app **Unknown** / *authentication required* | Project page → *ArgoCD repo access* | press **Fix** (creates a read deploy token and re-registers the repo) |
| Sync says *another operation is already in progress* | ArgoCD page → app → Details | KubeOrbit waits and retries; if stuck, **Terminate** the operation |
| Environments shows an old commit | card → Details | ArgoCD caches Git for ~3 min; **Sync now** hard-refreshes first |
| Promotion *diverged* | GitLab MR | the target has a hotfix commit: merge it back into `dev`, then promote |
| Metrics: *No Prometheus connector* | Connectors → Observability | **Discover in cluster** → Add Prometheus |
| "Open in Grafana" doesn't load | | start the Grafana port-forward (A3) and set the browser URL |
| No **History (Loki)** switch in Logs | | install Loki (A4) and add the Loki connector |
| History lines look like `{"log":"…","stream":"stdout"}` | Promtail pipeline stage | wrong runtime stage: use `docker: {}` on docker nodes, `cri: {}` on containerd (A4) |
| History is empty for a namespace | Promtail log (`kubectl -n monitoring logs ds/loki-promtail`) | wait a minute after installing; pods with no new output only appear once they log |
| **Application** metrics say "No request metrics" | PromQL explorer: `up{job="<service>"}` | no traffic in the range, or no ServiceMonitor / wrong `release` label / wrong port name (D2) |
| prod has no app metrics but other environments do | ArgoCD page: prod OutOfSync | the ServiceMonitor is committed but prod is manual-sync: press **Sync prod** |
| Live usage shows "metrics-server n/a" | | `minikube addons enable metrics-server`, wait a minute |
| Saved credentials suddenly fail | backend log `Failed to decrypt` | `CREDENTIALS_SECRET` changed: restore it, or re-enter the tokens |
| Pipeline never starts on gitlab.com | GitLab → Settings → CI/CD → Runners | verify your account for shared runners |
| CI YAML error on `deploy(dev): …` | GitLab CI Lint | quote script lines containing `: ` |

---

## 9. Roles

| Role | Can |
|---|---|
| **Super Admin** | everything, including deleting projects |
| **DevOps** | connectors, projects, environments (add / fix / remove), promote, sync, rollback, PromQL explorer |
| **Developer** | view everything, logs, metrics |
| **Viewer** | read-only |

> Project-level permissions (Authorization → User Permissions) are saved but **not enforced by the API yet**.
> Authentication hardening is planned next.

---

## 10. Reference

### Sidebar map

| Section | Page | Purpose |
|---|---|---|
| Core | Dashboard | cluster and platform overview |
| Core | Getting Started | this flow with live status per step |
| Core | Manager Approvals | approval queue |
| Core | DevOps Copilot | assistant |
| Workloads & GitOps | Resource Browser | every Kubernetes resource, pod details |
| Workloads & GitOps | Environments | what runs where, promotion, rollback |
| Workloads & GitOps | ArgoCD GitOps | ArgoCD applications, sync, diff |
| Workloads & GitOps | GitLab Repositories | repos, commits, branches, pipelines, job logs |
| Observability | Logs | live and historic logs |
| Observability | Metrics | Prometheus charts, usage, PromQL |
| Global Configurations | Projects | projects and environments |
| Global Configurations | Connectors | Clusters, GitLab, ArgoCD, Observability |
| Global Configurations | Authorization | users and permission groups |

### Ports and URLs

| What | URL |
|---|---|
| KubeOrbit UI | http://localhost:5173 (or 5174/5175) |
| KubeOrbit API | http://localhost:5000/api (health: `/api/health`) |
| ArgoCD | https://localhost:8081 (port-forward) |
| Grafana | http://localhost:3000 (port-forward) |
| MongoDB | mongodb://127.0.0.1:27017/kubeorbit |
| Demo app | http://localhost:3000 locally; in-cluster via `kubectl port-forward svc/demo-api` |

### CI pipeline stages (demo)

| Stage | Job | Does |
|---|---|---|
| code_scan | `code_scan:npm-audit` | fails on high/critical vulnerable production dependencies |
| build | `build` | `npm ci`, tests with a JUnit report, writes the image name |
| package | `package:docker` | builds and pushes `…/<env>:<tag>` with `BUILD_ENV=<env>` |
| package | `package:trivy` | scans the image; fixable CRITICAL fails the job |
| kubeconfig | `kubeconfig` | renders the overlay with the new image (`yq`, `kustomize`) |
| publish_argocd | `publish_argocd` | commits `deploy(<env>)` to the GitOps repo (one at a time: `resource_group`) |

Environment rule in `.gitlab-ci.yml`:

```yaml
.environment_branch:
  rules:
    - if: $DEPLOY_BRANCHES && $CI_COMMIT_BRANCH =~ $DEPLOY_BRANCHES
      variables:
        DEPLOY_ENV: $CI_COMMIT_BRANCH
    - if: $DEPLOY_BRANCHES == null && $CI_COMMIT_BRANCH =~ /^(dev|qa|staging|prod)$/
      variables:
        DEPLOY_ENV: $CI_COMMIT_BRANCH
```

### GitOps repo layout

```
k8s/
  base/                 deployment.yaml, service.yaml, servicemonitor.yaml, kustomization.yaml
  overlays/
    dev/                kustomization.yaml   (namespace, replicas, APP_ENV, images[0].newName/newTag)
    qa/  staging/  uat/
    prod/               kustomization.yaml + pdb.yaml
argocd/                 one Application per environment (for reference; KubeOrbit creates them)
```

### Glossary

| Term | Meaning |
|---|---|
| GitOps | the cluster state is described in Git; a controller (ArgoCD) makes the cluster match Git |
| Overlay | a Kustomize folder that changes the base for one environment |
| Sync | ArgoCD applying Git to the cluster |
| OutOfSync | cluster differs from Git |
| Healthy / Degraded / Progressing | ArgoCD's view of whether the resources work |
| Promotion | moving a tested commit to the next environment by fast-forward MR |
| Deploy key / deploy token | a credential limited to one repository |
| Protected branch / variable | only protected branches can push and receive protected CI variables |
| CrashLoopBackOff | container keeps crashing; Kubernetes waits longer between restarts |
| Working set memory | memory the container actually uses; what the OOM killer compares with the limit |
| Throttling | the container wanted more CPU than its limit allowed |

---

## 11. Daily cheat sheet

| Task | Clicks |
|---|---|
| Ship a change to dev | Push to `dev` → GitLab Repositories (watch) → Environments |
| Promote qa → staging | Environments → *qa → staging* → Open MR → Merge |
| Release to prod | Environments → *uat → prod* → Merge → **Sync prod** |
| Undo a bad release | Environments → card → History → Roll back here |
| Why is qa broken? | Projects → env → **Logs** (or Resource Browser → Only unhealthy → pod → Details) |
| Is it running out of memory? | Projects → env → **Metrics** |
| What exactly is deployed? | Projects → env → **Manifests** |
| New environment | Projects → project → Add environment |
| Something red on the checklist | Projects → project → **Fix** |

---

## 12. Not built yet

- Enforcing project permissions on every API route, and removing the development login fallback.
- Executing approved actions from the approval queue and an audit log.
- Canary / blue-green rollouts (Argo Rollouts).
- A terminal into pods, and creating resources from the Resource Browser.
- Alert rules and notifications (Slack / email / webhook).
