# devops-demo: learn DevOps one stage at a time

`demo-api` is a small Express service you push to GitLab and grow **one stage at a time**.
After every stage you push, then check what **KubeOrbit** shows. Anything KubeOrbit
cannot show yet goes on the KubeOrbit build list for that stage.

```
devops-demo/
  demo-api/      ← the repo you push to GitLab (starts with code + 1 CI job)
  _reference/    ← finished versions of later-stage files. Don't copy ahead; we add them stage by stage.
```

## The stages

| # | Stage | You add | After you push, KubeOrbit should show |
|---|---|---|---|
| **1** | **Code + tests in CI** | app, tests, 1-job `.gitlab-ci.yml` | repo, commit, branch, pipeline with a `build` job and test results |
| 2 | Security scan | `code_scan` job (npm audit) | 2-stage pipeline, scan pass/fail, audit report |
| 3 | Container image | `Dockerfile`, `package` job (build, push, Trivy) | image tag produced by the pipeline, Trivy result |
| 4 | Run on Kubernetes (by hand) | manifests, `kubectl apply` to Minikube | pods, logs, manifest, restarts in Resource Browser |
| 5 | GitOps repo | `kubeorbit-demo-api-gitops` repo, `kubeconfig` + `publish_argocd` jobs | the commit CI made to the GitOps repo, the image tag it set |
| 6 | ArgoCD auto-deploy (dev) | ArgoCD Application | app Synced/Healthy, new pods rolling out, `/` showing the new commit |
| 7 | Promote to prod | manual prod job, manual ArgoCD sync | approval request, OutOfSync → Synced after approval |
| **8** | **Observe** (done) | ServiceMonitor for `/metrics`, Loki | request rate, latency, error rate per route; log history |

---

## Stage 1: code + tests in CI

**Goal:** every `git push` runs the tests automatically, and you can see it happen in KubeOrbit.

### 1. Run it on your laptop

```bash
cd devops-demo/demo-api
npm install
npm test            # 9 tests should pass
npm run dev         # http://localhost:3000
```

Try these in another terminal:

```bash
curl http://localhost:3000/                 # service, version, commit, pod name
curl http://localhost:3000/health/ready     # readiness probe (used from stage 4)
curl -X POST http://localhost:3000/api/items -H "Content-Type: application/json" -d "{\"name\":\"first\"}"
curl http://localhost:3000/api/items
curl http://localhost:3000/metrics          # Prometheus metrics (used in stage 8)
```

Watch the terminal running `npm run dev`: each request is one JSON log line. That is
exactly what you will see later in KubeOrbit's pod **Logs** tab.

### 2 + 3. Create the GitLab project and push: from KubeOrbit

**GitLab Repositories → New repository**: pick the GitLab account, name `kubeorbit-demo-api`,
starter code `demo-api`. KubeOrbit creates the project and pushes this folder as the first commit
(`node_modules` and `.gitignore`d files are skipped). The pipeline starts immediately.

For later stages, edit files here and use **Push code** on the repo: it commits only the files
that changed, and asks before overwriting anything that was changed in GitLab.

> Already done for you: `mvp.bose23/kubeorbit-demo-api` (private), first pipeline passed with 9/9 tests.

### 2 + 3 (alternative). Push with git, the everyday way

```bash
cd devops-demo/demo-api
git init -b main
git add .
git commit -m "feat: demo-api with tests and CI"
git remote add origin https://gitlab.com/<your-group>/demo-api.git
git push -u origin main
```

The push starts a pipeline with one job, `build`, which runs `npm ci` and `npm run test:ci`.

> No pipeline? On gitlab.com, shared runners need a verified account
> (Settings → CI/CD → Runners). On a self-managed GitLab, ask for a runner with the Docker executor.

### 4. Check in KubeOrbit

| Where | What you should see |
|---|---|
| **GitLab Repositories** → Refresh | `demo-api` in the list, private/public badge, `main` branch |
| → **Live Commits** tab | your commit `feat: demo-api with tests and CI` with author and time |
| → **Branches** tab | `main`, marked default |
| → **CI/CD Pipelines** tab | pipeline for `main`, status running → passed, one stage `build` |
| → **Tech Stack** tab | JavaScript |
| → **Run Pipeline** | a new pipeline starts on `main` without pushing anything |
| **Projects** → Add Project | map `demo-api`'s clone URL, cluster `minikube`, namespaces `demo-dev, demo-prod` |
| **Getting Started** → Re-check | step 4 (project) and step 6 (pipeline) now **Done** |

### 5. Break it on purpose

Change an assertion in `test/app.test.js` (e.g. expect `'demo-apix'`), commit, push.
The pipeline fails. In KubeOrbit the pipeline turns red and the `build` stage shows failed.
Revert the change and push again: green.

**What you learned:** CI = every change is tested automatically on a clean machine
(`npm ci` in a fresh `node:20-alpine` container), not "works on my laptop".

### KubeOrbit for stage 1: done

After a push, KubeOrbit now shows everything without opening GitLab:

1. **Real job logs.** Click the `build` stage: the actual runner log, with commands highlighted,
   line filter and copy. It follows the log live while the job runs.
2. **Test results.** `Tests 9/9 passed` on each pipeline (red with the failed count when a test breaks).
3. **Real commit title and author**, plus how it started (pushed / run from KubeOrbit / scheduled).
4. **Auto-refresh.** Running pipelines update every 5 seconds on their own.

---

## Stages 2–7: branch per environment + GitOps (set up and working)

One branch = one environment, like the company workflow (`dev`, `staging-qa`, `prod`):

| Branch | Environment | Namespace | Replicas | ArgoCD sync | Who can change the branch |
|---|---|---|---|---|---|
| `dev` (default) | dev | `kubeorbit-demo-dev` | 1 | auto | maintainers push / merge |
| `qa` | qa | `kubeorbit-demo-qa` | 1 | auto | merge request only |
| `staging` | staging | `kubeorbit-demo-staging` | 2 | auto | merge request only |
| `prod` | prod | `kubeorbit-demo-prod` | 2 + PDB | **manual** (approval) | merge request only |

```
feature branch ──MR──▶ dev ──MR──▶ qa ──MR──▶ staging ──MR──▶ prod
                        │           │            │               │
                  push triggers the pipeline on that branch (DEPLOY_ENV = branch name)
                        ▼
  code_scan ─ build (tests) ─ package (image) ─ trivy ─ kubeconfig (yq) ─ publish_argocd
                                                                             │
     commits "deploy(<env>): demo-api <tag>" to k8s/overlays/<env> ◀─────────┘
                        ▼
  kubeorbit-demo-api-gitops ◀── ArgoCD watches ──▶ app kubeorbit-demo-api-<env> ─▶ namespace kubeorbit-demo-<env>
```

### Two rules

1. **Promotion merges are fast-forward only** (project setting *Merge method: fast-forward*).
   Merging `dev → qa` moves `qa` to the exact commit `dev` tested: no merge commit, no new code.
   If `qa` ever has a commit `dev` does not (a hotfix), KubeOrbit reports *diverged*: merge it back
   into `dev` first, then promote again.
2. **Each environment builds its own image**, in its own registry path, with the environment baked in:

   | Environment | Image |
   |---|---|
   | dev | `registry.gitlab.com/mvp.bose23/kubeorbit-demo-api/dev:dev-<date>-<sha>-<pipeline>` |
   | qa | `…/kubeorbit-demo-api/qa:qa-…` |
   | staging | `…/kubeorbit-demo-api/staging:staging-…` |
   | prod | `…/kubeorbit-demo-api/prod:prod-…` |

   `GET /` returns `buildEnv`, so you can see which image answers. Same commit, different images:
   verified with commit `38d6099b` (dev `sha256:5865a95c…`, qa `6202c1b1…`, staging `d48ccbf1…`, prod `4af0cffb…`).
   The trade-off to know: prod runs an image *rebuilt* from the commit QA tested, not QA's exact image.
   Rule 1 guarantees the code is identical; pinned base images and `npm ci` keep the rebuild reproducible.

### Add an environment (e.g. `uat`)

KubeOrbit → **Projects** → `kubeorbit-demo` → **Add environment**. One form, and KubeOrbit sets up:

| Item | What is created |
|---|---|
| Namespace | `kubeorbit-demo-uat`, labelled with the project and environment |
| Pull secret | `gitlab-registry`, copied from another environment namespace |
| GitOps overlay | `k8s/overlays/uat`, copied from an existing overlay (namespace, `APP_ENV`, image path changed) |
| ArgoCD app | `kubeorbit-demo-api-uat` → `k8s/overlays/uat`, auto-sync unless the name is `prod` |
| CI rule | the `DEPLOY_BRANCHES` CI/CD variable, e.g. `/^(dev\|qa\|staging\|uat\|prod)$/` |
| Branch | `uat`, protected (merge requests only), created from the branch you pick |

`.gitlab-ci.yml` deploys any branch matching `$DEPLOY_BRANCHES`, so no CI edit is needed per environment.
A branch only picks this up once its `.gitlab-ci.yml` has that rule: an older branch keeps its fixed
list until the change is promoted into it, and the project page shows exactly that as a red *CI* item.
Each environment has a checklist; **Fix** re-runs only the missing items, **Remove** deletes the ArgoCD app
(and optionally the namespace) but keeps the branch and overlay for history.

### Promote with KubeOrbit

KubeOrbit → **Environments** → project `kubeorbit-demo` shows the four environments (branch, branch head,
latest pipeline, running commit, image, GitOps revision, pods) and the promotion path below them.
For each step the panel offers the next action:

| State | Meaning | Button |
|---|---|---|
| *ready* | `dev` has commits `qa` does not | **Open merge request** (or **Create branch** if it does not exist yet) |
| *review* | the MR is mergeable | **Merge !N into qa**: fast-forwards `qa`, starting its pipeline |
| *publishing* | the target branch pipeline is building / publishing | – |
| *syncing* | Git points the environment at the new commit; ArgoCD is deploying | – |
| *needs-sync* | prod only: Git is updated, waiting for approval | **Sync prod** |
| *up-to-date* | the environment runs the head of its branch | – |
| *blocked* / *diverged* | MR cannot merge / branch has extra commits | fix in GitLab |

Every action asks for confirmation and needs a Super Admin or DevOps user.

### Do the loop yourself

1. Change something visible in `demo-api/` (e.g. a new endpoint, or `APP_MESSAGE` default).
2. KubeOrbit → GitLab Repositories → `kubeorbit-demo-api` → **Push code** → branch **dev**.
3. Watch the `dev` pipeline (auto-refreshing; click jobs for live logs). `package:docker` says it *built* the image.
4. Environments: dev picks it up automatically. **dev → qa: Open merge request**, then **Merge**.
5. The `qa` pipeline builds the qa image (`…/kubeorbit-demo-api/qa:…`) and qa updates.
6. Repeat qa → staging, then staging → prod. Prod stops at *needs-sync*: **Sync prod** is the approval.
7. Check each environment: `kubectl -n kubeorbit-demo-<env> port-forward svc/demo-api 3998:80` then
   `curl localhost:3998/` shows `commit`, `buildEnv` and `Hello from <ENV>`.

On each environment card: **Details** (ArgoCD resources, sync history, last operation), **History**
(every deploy of that environment, with *Roll back here*), and **Redeploy head** after a rollback.
Click any pipeline job, then **Reports**, for `npm-audit.txt`, `trivy-report.txt` and the rendered `kube-config.yaml`.

### Pieces

| Piece | Where |
|---|---|
| App repo | `mvp.bose23/kubeorbit-demo-api` (this folder: `demo-api/`) |
| GitOps repo | `mvp.bose23/kubeorbit-demo-api-gitops` (this folder: `demo-api-gitops/`) |
| Images | `registry.gitlab.com/mvp.bose23/kubeorbit-demo-api/<env>:<env>-<date>-<sha>-<pipeline>` |
| ArgoCD | `https://localhost:8081` (`kubectl port-forward svc/argocd-server -n argocd 8081:443`) |
| KubeOrbit project | `kubeorbit-demo` (each ArgoCD app mapped with its `environment` and `branch`) |

Credentials, each limited to one job:

| Credential | Access | Used by |
|---|---|---|
| SSH deploy key "kubeorbit-demo-api CI" | push to the GitOps repo only (allowed on its protected `main`) | CI variable `GITOPS_DEPLOY_KEY` (file, **protected**: only environment branches get it) |
| Deploy token `argocd-read` | read the GitOps repo | ArgoCD secret `argocd/kubeorbit-demo-api-gitops-repo` |
| Deploy token `minikube-pull` | pull images from the app repo's registry | Secret `gitlab-registry` in each environment namespace |

### Roll back

Environments → card → **History** → **Roll back here** on an earlier deploy. KubeOrbit commits that deploy's
image back into the overlay (`rollback(<env>): demo-api <tag> (was <tag>) by <you>`) and syncs ArgoCD at once.
The card and promotion path then show *Rolled back*: the branch still holds the newer code. Either fix forward
on `dev` and promote again, or press **Redeploy head** to rebuild and deploy the branch head.
Verified on qa: rolled back `38d6099b → c7712c27`, then redeployed `38d6099b`.

### What happened on the first runs (worth reading)

- **Trivy failed the first image**, not because of our code (0 findings in `app/node_modules`) but because
  of the `node:20-alpine` base: old OpenSSL and the **npm CLI bundled in the image**, with a CRITICAL `tar`
  CVE. Fix in the Dockerfile: `apk upgrade` + delete npm/npx from the runtime stage. Lesson: scan the
  *image*, not just `package.json`. The gate is still `allow_failure: true`; set it to `false` now.
- **A YAML colon broke the pipeline**: `git commit -m "deploy(dev): …"` unquoted is a YAML map. Quote
  whole script lines that contain `: `. GitLab's CI Lint catches this before you push.
- **Two syncs collided**: KubeOrbit asked ArgoCD to sync while auto-sync was already applying the change
  (`another operation is already in progress`). Sync now waits for the running operation and retries.
- **ArgoCD caches Git revisions** for a few minutes. KubeOrbit's Sync now hard-refreshes first, and the
  Environments page compares what is *running* with the branch head, not just the branches.

### KubeOrbit build list

1. ~~What is running where~~: done, **Environments**.
2. ~~Promotion from KubeOrbit~~: done, publish-job flow and branch/merge-request flow.
3. ~~Rollback~~: done, History → Roll back here, and Redeploy head.
4. ~~ArgoCD app details~~: done, Details (resources, sync history, last operation). A full Git-vs-cluster diff is still open.
5. ~~Job reports~~: done, job → Reports tab.
6. ~~Environment setup from a project~~: done, Projects → Add environment / Fix / Remove.
7. ~~Logs, metrics, manifests~~: done, **Logs**, **Metrics**, Resource Browser pod details, environment **Manifests**.

---

## Stage 8: observe (set up and working)

**Goal:** see how the app behaves from the inside (requests, latency, errors) and keep logs after pods are gone.

| Piece | Where |
|---|---|
| App metrics | `demo-api` exposes `/metrics` (prom-client): `http_request_duration_seconds{method,route,status}`, `demo_items_total`, Node.js runtime metrics |
| Scraping | `demo-api-gitops/k8s/base/servicemonitor.yaml`: label `release: kube-prometheus-stack`, port `http`, every 15 s |
| Log history | Loki + Promtail in `monitoring`, installed with `platform/loki-values.yaml` |
| Connectors | Prometheus, Grafana and Loki under Connectors → Observability (through the cluster, no port-forward) |

```bash
# once, if not installed yet
helm install loki grafana/loki-stack --version 2.10.3 -n monitoring -f devops-demo/platform/loki-values.yaml --wait
```

Try it:

1. Send traffic to dev (or any environment):
   `kubectl -n kubeorbit-demo-dev port-forward svc/demo-api 3998:80`, then
   `for i in $(seq 1 100); do curl -s localhost:3998/ >/dev/null; curl -s localhost:3998/api/items >/dev/null; curl -s localhost:3998/nope >/dev/null; done`
2. **Metrics** → project `kubeorbit-demo` → `dev` → **Application**: requests/s per route, p95 latency per route,
   2xx vs 4xx (the `unmatched` route is the 404s), error rate 5xx %.
3. **Logs** → same scope → **History (Loki)** → search `request`: every request line, also from pods that were replaced.
4. PromQL explorer: `up{job="demo-api"}` = 1 per pod means Prometheus scrapes it.

> Chaos endpoints (`/chaos/*`) are **enabled in dev** (`CHAOS_ENABLED=true` in the dev overlay).
> `POST /chaos/unready` makes the pod fail its readiness probe for 30 s, which is a good way to watch the 503s on
> `/health/ready`, the pod turn not-ready in the Resource Browser, and the Service drop it.

prod gets the ServiceMonitor after the next **Sync prod** (it's manual-sync by design).
