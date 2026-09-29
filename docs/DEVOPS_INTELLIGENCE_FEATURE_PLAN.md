# DevOps Intelligence: Feature Plan

Connectors to add next, feature enhancements, security hardening and optimizations, ordered so each phase
is useful on its own. Sizes: **S** ≈ 1–3 days, **M** ≈ 1 week, **L** ≈ 2+ weeks (one developer).

Status on 29 Sep 2026: approvals, the Cloudflare DNS work (connector, domains, tunnels, previews,
random URLs) and Public URLs are built and tested but **not yet committed**.

---

## 1. Where we are

### Connectors today

| Connector | Used for | Status |
|---|---|---|
| **Kubernetes clusters** | Workloads, pods, logs, events, manifests, provisioning namespaces | ✅ |
| **GitLab** | Repos, branches, merge requests, merge, pipelines, deploy tokens, registry pull secrets | ✅ |
| **ArgoCD** | GitOps apps: sync, rollback, history, health | ✅ |
| **Prometheus / Grafana / Loki** | Metrics, dashboards, log history | ✅ |
| **Cloudflare DNS** | Zones, records, tunnels, public hostnames, random URLs, domain checks | ✅ (token still needs DNS Edit + Tunnel Edit) |

### Features today

- **Delivery:**
  - projects with the create wizard and per-environment pipeline (dev → qa → staging → uat → prod)
  - promote, rollback, redeploy; merge and run pipelines from the UI
- **Governance:**
  - project-scoped permissions (View, Build and Deploy, Admin, Manager Approver)
  - approvals that replay the action as the requester; audit log
- **Run:**
  - Logs (live and Loki history), Metrics, the Resource Browser, pod details, manifests
- **Public:**
  - the Domains tab, Preview URLs (trycloudflare), random URLs on your domain
  - the Public URLs page and the domain health overview
- **Docs:** user guide (in the app at `/guide`), the draw.io project plan, test suites (permissions 360,
  approvals 22, DNS 52)

### Known gaps (from building the above)

- **Login tokens:** they live in `localStorage`, not an httpOnly cookie.
- **Login throttle:** it is in memory, so it resets on restart.
- **Unenforced permission rows:** "application" and "k8s-resource" rows exist in the model but are not enforced.
- **Nothing tells anyone when something happens:** no notifications (approval waiting, deploy failed, preview left open).
- **No CI, image or Helm chart for DevOps Intelligence itself.**
- **Credentials that were exposed must be rotated:**
  - the GitLab token in the git-ignored `backend/src/scripts/addSkillMineGitLab.ts`
  - the Cloudflare API token and R2 keys that were pasted into chat

---

## 2. Connector catalog

Every connector follows the existing pattern: **Connectors → tab**, encrypted secrets, **Test** with a
permission checklist, a default connector, and audit on change. Priority **P1** = next, **P2** = soon,
**P3** = later.

### 2.1 Notifications and ChatOps: P1 (biggest gap)

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **Slack** | Bot token (chat:write) or incoming webhook | Approval requests with **Approve / Reject buttons**, deploy started/finished/failed, sync drift, preview open > 24 h, cert expiring | M |
| **Microsoft Teams** | Incoming webhook / Workflows URL | Same messages as Slack (buttons link back to DevOps Intelligence) | S |
| **Email (SMTP)** | Host, port, user, password / API key (SES, SendGrid, Resend) | Approval requests, weekly digest, password reset | S |
| **Generic webhook** | URL + HMAC secret | Push every audit event to any system (n8n, Zapier, SIEM) | S |
| **PagerDuty / Opsgenie** | Routing key / API key | Page on-call for prod failures and firing alerts | S |

Feature built on top: **Notification rules** per project, e.g. "prod + failed deploy → Slack #release
and PagerDuty".

### 2.2 Code quality and security scanning: P1/P2

Your company pipeline already runs Snyk, SonarQube and Trivy (see `COMPANY_DEVOPS_WORKFLOW.md`); today
their results stay inside GitLab.

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **SonarQube / SonarCloud** | Server URL + user token | Quality gate status per branch/MR; block **promote to prod** when the gate fails | M |
| **Trivy** (Trivy Operator in cluster, or CI report) | none (cluster) / GitLab artifact | CVEs of the image **running** in each environment; critical-CVE badge on environment cards | M |
| **Snyk** | API token + org ID | Dependency vulnerabilities per project; trend | M |
| **GitLab security reports** | uses the GitLab connector | SAST / dependency / container scanning results per MR | S |

Feature on top: **Security tab** per project and a **"Can this go to prod?"** checklist in the
approval request (tests green, quality gate passed, no critical CVEs).

### 2.3 Source control and registries: P2

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **GitHub** | PAT or GitHub App | Same as GitLab (the model already has `provider: 'github'`): repos, PRs, Actions runs | L |
| **Docker Hub / GHCR / Harbor / AWS ECR** | Registry credentials | Browse tags, image size/age, pull secrets for non-GitLab registries, cleanup of old tags | M |
| **Helm repositories** (OCI / HTTP) | URL (+ auth) | Deploy charts (Prometheus, Loki, cloudflared) from the UI | M |

### 2.4 Secrets: P2

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **HashiCorp Vault** | URL + AppRole / Kubernetes auth | Show which secrets an environment uses (names only), rotate, sync to K8s | L |
| **External Secrets Operator / Sealed Secrets** | cluster | Secret status per environment; "secret out of sync" alerts; stop plain Secrets in Git | M |
| **AWS Secrets Manager / Azure Key Vault / GCP Secret Manager** | cloud credentials | Same, for cloud-hosted secrets | M |

### 2.5 Identity (SSO): P2

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **OIDC** (Keycloak, Google, Microsoft Entra ID, Okta) | Client ID/secret, issuer | Single sign-on, MFA from the identity provider, group → role mapping | M |
| **GitLab OAuth** | OAuth app | Sign in with GitLab; map GitLab project membership to permissions | M |
| **LDAP / Active Directory** | Bind DN + password | Company directory login and groups | M |

### 2.6 Storage and backup: P2 (you already have Cloudflare R2 keys)

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **S3-compatible storage** (Cloudflare R2, AWS S3, MinIO) | Access key, secret, endpoint, bucket | Loki log storage, **Velero** backups, audit-log export archive, Terraform state | M |
| **Velero** | cluster + the S3 connector | Backup/restore a namespace from the UI, scheduled backups per environment | M |

### 2.7 Cloud providers: P3

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **AWS** (EKS, ECR, Route 53) | IAM role / access key | Import EKS clusters, ECR registries, Route 53 DNS like Cloudflare | L |
| **Google Cloud** (GKE, Artifact Registry, Cloud DNS) | Service account | Same for GCP | L |
| **Azure** (AKS, ACR, Azure DNS) | Service principal | Same for Azure | L |
| **DigitalOcean / Hetzner** | API token | Cheap managed clusters for staging | M |

### 2.8 Observability extras: P2/P3

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **Alertmanager** | via cluster (service proxy) | Firing alerts per environment, silence from the UI | M |
| **Tempo / Jaeger** (tracing) | via cluster | Trace a slow request across services; link from logs | M |
| **Sentry** | DSN + auth token | App errors per release and environment ("errors since this deploy") | M |
| **Uptime checks** (Blackbox exporter or built-in) | none | History of the Public URLs checks, SLA per hostname | S |

### 2.9 Planning, policy, cost and AI: P3

| Connector | Credentials | What it enables | Size |
|---|---|---|---|
| **Jira / Linear / GitLab Issues** | API token | Issues included in each release; release notes; "deployed to prod" comments on tickets | M |
| **Kyverno / OPA Gatekeeper** | cluster | Policy violations per environment (no `latest` tag, resource limits, non-root) | M |
| **OpenCost / Kubecost** | via cluster | Cost per project and environment per month | M |
| **Argo Rollouts** | cluster | Canary and blue-green deploys with automatic analysis | L |
| **Terraform / OpenTofu** (with the S3 connector) | Git + state bucket | Plan/apply infrastructure with approvals | L |
| **LLM provider for Copilot** (Anthropic Claude) | API key | Copilot explains failed pods, deploys and alerts from real logs, events and metrics | M |

### Recommended connector order

1. **Slack or Teams + Email + generic webhook**: notifications (P1)
2. **SonarQube + Trivy**: release safety (P1)
3. **S3/R2 storage + Velero**: backups, Loki storage (P2)
4. **OIDC SSO**: company login (P2)
5. **GitHub**: second Git provider (P2)
6. **Alertmanager + Sentry**: find problems before users do (P2)

---

## 3. Feature enhancements

### 3.1 Delivery and releases

| Feature | What it is | Size |
|---|---|---|
| **DORA metrics** | Deploy frequency, lead time (commit → prod), change failure rate, time to restore, per project; from ArgoCD history + audit log | M |
| **Release notes** | Auto-generated per promotion: commits, MRs, authors, linked issues; attached to the approval request | S |
| **Preview environment per merge request** | Open an MR → a temporary namespace + random URL (Cloudflare) → deleted when merged/closed | L |
| **Deploy freeze windows** | e.g. no prod deploys Friday 17:00 → Monday 09:00 unless break-glass | S |
| **Scheduled deploys** | "Promote to prod at 22:00" (runs as an approved request) | M |
| **Canary / blue-green** | Through Argo Rollouts; promote/abort buttons with metrics | L |
| **Environment diff** | Side-by-side of two environments: image, config, replicas, resources | M |
| **Config and secrets view** | ConfigMaps and Secret *names* per environment; change history from Git | M |

### 3.2 Approvals

| Feature | What it is | Size |
|---|---|---|
| **Multiple approvers for prod** | e.g. 2 approvals, or 1 from QA + 1 manager | M |
| **Approve from Slack/Teams/email** | Signed one-time links or interactive buttons | M |
| **Request expiry and reminders** | Pending > N hours → reminder, then auto-expire | S |
| **Pre-approval checklist** | Tests, quality gate, CVEs, change ticket shown on the request | M |

### 3.3 Observability and incidents

| Feature | What it is | Size |
|---|---|---|
| **Alerts page** | Rules (CPU, memory, restarts, error rate, URL down) per environment → notification connectors | M |
| **Deploy markers** | Deploys drawn on the metric charts; "what changed before this spike?" | S |
| **SLOs** | Availability/latency targets per public URL, error budget | M |
| **Incident timeline** | Alerts + deploys + approvals + pod events in one timeline per environment | M |
| **Saved log searches** | Named Loki queries per project, shareable | S |

### 3.4 Domains and public access (building on Cloudflare)

| Feature | What it is | Size |
|---|---|---|
| **Preview auto-stop** | Choose 1 h / 8 h / 24 h when starting a preview; stopped automatically | S |
| **Uptime history** | Store Public URLs checks every 5 min; uptime % and response-time chart | M |
| **Certificate / domain expiry alerts** | Warn 14 days before a certificate or token expires | S |
| **One-click fixes** | e.g. turn on Always Use HTTPS, raise minimum TLS to 1.2 (with approval) | S |
| **Cloudflare Access** | Protect preview/staging URLs with company login (Zero Trust) | M |

### 3.5 Platform and usability

| Feature | What it is | Size |
|---|---|---|
| **Teams / groups** | Grant permissions to a team instead of each user | M |
| **API tokens for automation** | Personal/service tokens with scopes, for CI or scripts | M |
| **CLI (`di`)** | `di promote demo-api staging prod`, `di logs`, `di url dev` | M |
| **Global search** | Search projects, environments, pods, hostnames, users | S |
| **Dashboard per role** | Developer: my envs and MRs · DevOps: cluster health · Manager: approvals, DORA | M |
| **Copilot with real context** | Answers from logs, events, metrics and deploy history of the selected environment | M |

---

## 4. Security hardening (do before any shared use)

| Item | Why | Size |
|---|---|---|
| **Rotate exposed credentials** | GitLab token in `addSkillMineGitLab.ts`, and the Cloudflare token + R2 keys pasted into chat | S (now) |
| **httpOnly cookie sessions** | Tokens in `localStorage` can be stolen by any XSS; cookies with SameSite + CSRF token | M |
| **Persistent login throttle** | In-memory counts reset on restart; store in MongoDB/Redis | S |
| **MFA** | TOTP for local accounts (or via SSO) | M |
| **Enforce all permission rows** | "application" and "k8s-resource" rows are stored but not checked | M |
| **Content Security Policy** | Strict CSP headers for the frontend | S |
| **Rate limits per user** | On expensive endpoints (log streams, domain checks, previews) | S |
| **Audit log integrity** | Hash-chain events, export to S3/R2, retention policy | M |
| **Secret scanning in CI** | gitleaks on this repository | S |
| **Test accounts off outside local** | Already blocked in production; add a startup warning when enabled | S |

---

## 5. Optimizations (performance, reliability, cost)

| Area | Change | Gain | Size |
|---|---|---|---|
| **Kubernetes reads** | Informers/watch caches instead of listing on every request | Faster pages, less API load | M |
| **Background jobs** | A queue (BullMQ + Redis, or Agenda on MongoDB) for approvals execution, previews, tunnel deploys, scheduled checks | No request timeouts; retries; survives restarts | M |
| **Live updates** | Push status over the existing Socket.io instead of polling (environments, previews, approvals) | Less traffic, instant UI | M |
| **Frontend data layer** | TanStack Query: caching, dedupe, background refresh | Fewer duplicate calls, simpler pages | M |
| **Bundle size** | Route-based code splitting (lazy pages), lighter chart library | Faster first load | S |
| **Server-side pagination** | Audit log, approvals, records, logs | Scales past thousands of rows | S |
| **MongoDB indexes** | On audit (`at`, `project`, `environment`), approvals (`status`, `projectName`), projects (`argoApps.dns.hostname`) | Fast filters | S |
| **External-call limits** | Concurrency limits + short timeouts for ArgoCD, GitLab, Cloudflare, domain checks; cache ArgoCD app lists (10–30 s) | No slow pages when one service is slow | S |
| **Observability of the platform itself** | Structured JSON logs, `/metrics` for DevOps Intelligence, OpenTelemetry traces | Debug the platform like any app | M |
| **Loki retention** | Store logs in R2/S3 with retention rules | Keep history cheaply | S |

---

## 6. Engineering for DevOps Intelligence itself

| Item | What | Size |
|---|---|---|
| **CI pipeline** | GitHub Actions or GitLab CI: lint, `tsc`, unit tests, build; permission/approval/DNS suites against a MongoDB service | M |
| **Container images** | Dockerfiles for backend and frontend (multi-stage, non-root) | S |
| **Helm chart** | Deploy DevOps Intelligence to any cluster; values for Mongo, secrets, ingress | M |
| **Dogfooding** | DevOps Intelligence deployed by ArgoCD on minikube, reachable through its own Cloudflare random URL | S |
| **End-to-end UI tests** | Playwright: login, promote, approve, preview | M |
| **Config reference** | Every environment variable documented (`JWT_SECRET`, `CREDENTIALS_SECRET`, `ENABLE_TEST_ACCOUNTS`, …) | S |
| **Backups** | Scheduled MongoDB dumps to R2 | S |

---

## 7. Roadmap

### Phase 1: Safe and notified (≈ 3 weeks)
1. Rotate exposed credentials; commit and push the current work
2. Security: httpOnly cookies, persistent throttle, CSP, rate limits
3. **Notification connectors**: Slack/Teams, Email, Webhook, plus notification rules
4. Alerts page (basic rules) + preview auto-stop + certificate/token expiry alerts
5. CI pipeline + Dockerfiles for this repo

**Done when:** approvers get a Slack/email message with a link, a failed prod deploy notifies the
channel, every push runs the test suites.

### Phase 2: Release safety and insight (≈ 4 weeks)
1. **SonarQube + Trivy** connectors, Security tab, pre-approval checklist
2. **DORA metrics** + release notes + deploy markers on charts
3. Multi-approver prod + approve from Slack/email + request expiry
4. Uptime history for Public URLs + SLOs
5. Server-side pagination, MongoDB indexes, TanStack Query

**Done when:** a prod promotion shows tests, quality gate, CVEs and release notes, and the dashboard shows the DORA numbers.

### Phase 3: Company-ready (≈ 4–5 weeks)
1. **OIDC SSO** + teams/groups + API tokens
2. **S3/R2 storage + Velero** backups; Loki on R2; MongoDB backups
3. **Preview environment per merge request** (namespace + random URL + auto-cleanup)
4. Background job queue + Socket.io live updates + Kubernetes informers
5. Helm chart; DevOps Intelligence deployed by ArgoCD (dogfooding)

**Done when:** people sign in with the company account, every MR gets its own URL, and a namespace can be restored from backup.

### Phase 4: Scale and automation (ongoing)
- GitHub connector, registries (ECR/GHCR/Harbor), Vault / External Secrets
- Cloud providers (EKS/GKE/AKS), Argo Rollouts canary, OpenCost, Kyverno
- Jira/Linear, Sentry, tracing, Copilot with real context (Claude), CLI

---

## 8. How to pick the next item

Start from the **pain you feel most**:

| If the pain is… | Start with |
|---|---|
| "Nobody noticed the approval / failed deploy" | Notification connectors (2.1) + alerts (3.3) |
| "Bad builds reach prod" | SonarQube + Trivy (2.2) + pre-approval checklist (3.2) |
| "We can't show managers progress" | DORA metrics + release notes (3.1) |
| "Login and secrets worry me" | Security hardening (4) + SSO (2.5) |
| "Testing a feature branch is slow" | Preview environment per MR (3.1) |
| "Pages feel slow" | Optimizations (5): informers, queue, TanStack Query |

**Recommendation:** Phase 1 first. It closes the security gaps, and notifications make the existing
approvals and deploys usable without everyone watching the UI.
