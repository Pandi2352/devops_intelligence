"""Generates docs/DEVOPS_INTELLIGENCE_PROJECT_PLAN.drawio (8 pages).

Run:  python docs/diagrams/build_project_plan.py
Open the .drawio file in draw.io / diagrams.net or the VS Code "Draw.io Integration" extension.
Edit this script (not the XML) and re-run it to keep all pages consistent.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[1] / "DEVOPS_INTELLIGENCE_PROJECT_PLAN.drawio"

# ---------------------------------------------------------------- palette
C = {
    "platform": ("#dbeafe", "#1d4ed8"),   # DevOps Intelligence (blue)
    "gitlab": ("#ffedd5", "#c2410c"),     # GitLab (orange)
    "argo": ("#ccfbf1", "#0f766e"),       # ArgoCD / GitOps (teal)
    "k8s": ("#e0e7ff", "#3730a3"),        # Kubernetes (indigo)
    "obs": ("#f3e8ff", "#7e22ce"),        # Observability (purple)
    "data": ("#f1f5f9", "#334155"),       # data / neutral
    "done": ("#dcfce7", "#15803d"),
    "partial": ("#fef3c7", "#b45309"),
    "todo": ("#fee2e2", "#b91c1c"),
    "planned": ("#f1f5f9", "#64748b"),
    "person": ("#fce7f3", "#be185d"),
    "note": ("#fffbeb", "#a16207"),
}


class Page:
    def __init__(self, name, width=1900, height=1200):
        self.name, self.width, self.height = name, width, height
        self.cells, self.n = [], 0

    def _id(self):
        self.n += 1
        return f"p{self.name.split()[0]}_{self.n}"

    def box(self, x, y, w, h, text, kind="data", shape="rounded=1;arcSize=8;", size=12, bold=False, align="center", valign="middle", extra=""):
        fill, stroke = C[kind]
        cid = self._id()
        style = (
            f"{shape}whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontColor=#0f172a;"
            f"fontSize={size};align={align};verticalAlign={valign};spacing=8;{'fontStyle=1;' if bold else ''}{extra}"
        )
        self.cells.append(f'<mxCell id="{cid}" value="{escape(text, {chr(34): "&quot;"})}" style="{style}" vertex="1" parent="1">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid

    def lane(self, x, y, w, h, title, kind="data"):
        fill, stroke = C[kind]
        return self.box(x, y, w, h, f"<b>{title}</b>", kind,
                        shape="rounded=1;arcSize=2;dashed=1;", size=13, valign="top",
                        extra="fillOpacity=35;")

    def text(self, x, y, w, h, html, size=12, align="left"):
        cid = self._id()
        style = f"text;html=1;whiteSpace=wrap;fontSize={size};align={align};verticalAlign=top;fontColor=#0f172a;"
        self.cells.append(f'<mxCell id="{cid}" value="{escape(html, {chr(34): "&quot;"})}" style="{style}" vertex="1" parent="1">'
                          f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid

    def title(self, text, sub=""):
        self.text(40, 20, self.width - 80, 40, f"<b>{text}</b>", size=24)
        if sub:
            self.text(40, 62, self.width - 80, 30, f"<span style='color:#475569'>{sub}</span>", size=13)

    def arrow(self, a, b, label="", dashed=False, color="#475569", both=False):
        cid = self._id()
        style = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor={color};strokeWidth=1.6;fontSize=11;"
                 f"endArrow=block;endFill=1;{'dashed=1;' if dashed else ''}{'startArrow=block;startFill=1;' if both else ''}"
                 "labelBackgroundColor=#ffffff;")
        self.cells.append(f'<mxCell id="{cid}" value="{escape(label, {chr(34): "&quot;"})}" style="{style}" edge="1" parent="1" source="{a}" target="{b}">'
                          '<mxGeometry relative="1" as="geometry"/></mxCell>')
        return cid

    def legend(self, x, y, items):
        self.text(x, y, 200, 20, "<b>Legend</b>", size=12)
        for i, (kind, label) in enumerate(items):
            self.box(x, y + 26 + i * 30, 26, 20, "", kind)
            self.text(x + 34, y + 26 + i * 30, 220, 22, label, size=11)

    def xml(self):
        body = "".join(self.cells)
        return (f'<diagram name="{escape(self.name)}" id="page{self.name.split()[0]}">'
                f'<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
                f'fold="1" page="1" pageScale="1" pageWidth="{self.width}" pageHeight="{self.height}" background="#ffffff" math="0" shadow="0">'
                f'<root><mxCell id="0"/><mxCell id="1" parent="0"/>{body}</root></mxGraphModel></diagram>')


def bullets(title, items):
    lis = "".join(f"<li>{i}</li>" for i in items)
    return f"<b>{title}</b><ul style='margin:4px 0 0 0;padding-left:16px'>{lis}</ul>"


pages = []

# ================================================================= 1. Overview & architecture
p = Page("1 Overview & Architecture", 1900, 1250)
p.title("DevOps Intelligence: overview & architecture",
        "One control center for GitLab CI/CD, ArgoCD GitOps, Kubernetes and Prometheus / Loki / Grafana, organised by project and environment.")

p.box(40, 110, 560, 150, bullets("Mission", [
    "Every project: app repo + GitOps repo + cluster",
    "One branch = one environment (dev → qa → staging → uat → prod)",
    "Promote, roll back, debug (logs / metrics / manifests) from one UI",
    "Credentials only in Connectors, encrypted at rest (AES-256-GCM)",
]), "platform", align="left", valign="top")
p.box(620, 110, 560, 150, bullets("Problems it removes", [
    "Jumping between GitLab, ArgoCD UI, kubectl and Grafana",
    "Guessing which namespace / branch / image belongs to which env",
    "Hand-made ArgoCD apps, namespaces, pull secrets, branch rules",
    "No safe, audited path to production",
]), "note", align="left", valign="top")
p.box(1200, 110, 660, 150, bullets("Tech stack", [
    "Frontend: React 19, Vite 8, Tailwind 4, React Router 7 (no chart/markdown libs: own SVG charts + MD renderer)",
    "Backend: Node 20, Express 4, TypeScript (NodeNext ESM), Mongoose 8, @kubernetes/client-node 1.4",
    "Data: MongoDB (users, projects, connectors, approvals)",
    "Integrations: GitLab REST API, ArgoCD API, Kubernetes API (+ service proxy), Prometheus, Loki, Grafana",
]), "data", align="left", valign="top", size=11)

# personas
p.lane(40, 290, 300, 420, "Users (roles)", "person")
dev = p.box(60, 330, 260, 80, "<b>Developer</b><br>own project envs, logs, metrics, pipelines", "person", size=11)
ops = p.box(60, 425, 260, 80, "<b>DevOps</b><br>connectors, projects, environments, promote / sync / rollback", "person", size=11)
mgr = p.box(60, 520, 260, 80, "<b>Manager</b><br>approves production changes (approval queue)", "person", size=11)
sa = p.box(60, 615, 260, 80, "<b>Super Admin / Viewer</b><br>everything / read-only", "person", size=11)

# platform
p.lane(380, 290, 640, 420, "DevOps Intelligence platform", "platform")
fe = p.box(410, 330, 580, 90, "<b>Frontend</b> (React, :5173)<br>Dashboard · Getting Started · User Guide · Projects · Environments · GitLab · ArgoCD · Resource Browser · Logs · Metrics · Connectors · Approvals · Authorization", "platform", size=11)
be = p.box(410, 450, 580, 110, "<b>Backend API</b> (Express, :5000 /api)<br>auth · projects (+ environments, setup, promote, rollback, manifests) · clusters · git · argocd · observability (pods, logs stream, events, metrics, resources, connectors) · approvals", "platform", size=11)
db = p.box(410, 590, 280, 90, "<b>MongoDB</b> :27017/kubeorbit<br>User · Project · Cluster · GitIntegration · ArgoIntegration · ObservabilityIntegration · ApprovalRequest", "data", size=10)
sec = p.box(710, 590, 280, 90, "<b>Security</b><br>JWT sessions · roles · secrets encrypted (CREDENTIALS_SECRET) · Secret values redacted in UI", "data", size=10)
p.arrow(fe, be, "REST + NDJSON log stream")
p.arrow(be, db)

# externals
p.lane(1060, 290, 800, 420, "Connected systems (Connectors)", "data")
gl = p.box(1090, 330, 360, 110, "<b>GitLab</b><br>app repo · GitOps repo · CI/CD pipelines · Container Registry · MRs · protected branches · CI variables · deploy tokens/keys", "gitlab", size=11)
ar = p.box(1470, 330, 360, 110, "<b>ArgoCD</b> (https://localhost:8081)<br>Applications per env · sync · diff · history · rollback · repo credentials", "argo", size=11)
k8 = p.box(1090, 465, 360, 110, "<b>Kubernetes</b> (minikube / clusters)<br>namespaces · pods · logs · events · metrics-server · every resource kind", "k8s", size=11)
ob = p.box(1470, 465, 360, 110, "<b>Observability</b> (monitoring ns)<br>Prometheus (kube-prometheus-stack) · Grafana · Loki + Promtail", "obs", size=11)
p.box(1090, 600, 740, 90, "Reached with saved connectors. In-cluster Prometheus / Grafana / Loki go through the Kubernetes API service proxy, so no port-forward is needed for DevOps Intelligence to read them.", "note", size=11)
for t, lbl in [(gl, "GitLab API"), (ar, "ArgoCD API"), (k8, "K8s API"), (ob, "service proxy")]:
    p.arrow(be, t, lbl)
p.arrow(ar, k8, "reconciles", color="#0f766e")
p.arrow(gl, ar, "GitOps repo", dashed=True, color="#0f766e")
p.arrow(k8, ob, "scrape / ship logs", dashed=True, color="#7e22ce")
for u in (dev, ops, mgr, sa):
    p.arrow(u, fe)

# key numbers / demo
p.box(40, 740, 900, 200, bullets("Reference project (devops-demo)", [
    "demo-api: Express service with tests, /metrics (prom-client), chaos drills, JSON logs",
    "App repo mvp.bose23/kubeorbit-demo-api · GitOps repo mvp.bose23/kubeorbit-demo-api-gitops (Kustomize base + overlays)",
    "DevOps Intelligence project kubeorbit-demo with environments dev, qa, staging, uat, prod",
    "Images: registry.gitlab.com/&lt;group&gt;/&lt;app&gt;/&lt;env&gt;:&lt;env&gt;-&lt;date&gt;-&lt;sha8&gt;-&lt;pipeline&gt;",
    "Namespaces kubeorbit-demo-&lt;env&gt; · ArgoCD apps kubeorbit-demo-api-&lt;env&gt; (prod = manual sync)",
]), "data", align="left", valign="top", size=11)
p.box(960, 740, 900, 200, bullets("Documents", [
    "docs/DEVOPS_INTELLIGENCE_USER_GUIDE.md: full step-by-step guide (also in-app: /guide)",
    "docs/COMPANY_DEVOPS_WORKFLOW.md: the company CI → GitOps → Kubernetes reference",
    "docs/PROJECT_PLAN_AND_SPRINTS.md: blueprint, personas, sprint plan",
    "devops-demo/README.md: learn DevOps stage by stage (stages 1–8)",
    "This file: docs/DEVOPS_INTELLIGENCE_PROJECT_PLAN.drawio (regenerate with docs/diagrams/build_project_plan.py)",
]), "note", align="left", valign="top", size=11)
p.legend(40, 970, [("platform", "DevOps Intelligence"), ("gitlab", "GitLab"), ("argo", "ArgoCD / GitOps"), ("k8s", "Kubernetes"), ("obs", "Observability"), ("person", "People / roles")])
pages.append(p)

# ================================================================= 2. Delivery flow
p = Page("2 Delivery Flow (CI to CD)", 2000, 1300)
p.title("Delivery flow: one branch = one environment",
        "Push → GitLab CI builds a per-environment image → commits the tag to the GitOps repo → ArgoCD syncs the namespace. Promotion = fast-forward merge request.")

d = p.box(40, 130, 180, 80, "<b>Developer</b><br>git push / Push code", "person")
repo = p.box(260, 130, 220, 80, "<b>App repo</b> (GitLab)<br>branches: dev · qa · staging · uat · prod (protected)", "gitlab", size=11)
p.arrow(d, repo, "push / merge")

p.lane(520, 110, 1020, 250, "GitLab CI pipeline (runs for the branch; DEPLOY_ENV = branch; rule: $CI_COMMIT_BRANCH =~ $DEPLOY_BRANCHES)", "gitlab")
stages = [
    ("code_scan", "npm audit<br>(high/critical fail)"),
    ("build", "npm ci · tests (JUnit)<br>writes image name"),
    ("package:docker", "docker build<br>BUILD_ENV=env · push"),
    ("package:trivy", "image scan<br>fixable CRITICAL fails"),
    ("kubeconfig", "yq + kustomize<br>render overlay"),
    ("publish_argocd", "commit deploy(env)<br>via GITOPS_DEPLOY_KEY"),
]
prev = None
ids = {}
for i, (s, desc) in enumerate(stages):
    b = p.box(540 + i * 165, 170, 150, 100, f"<b>{s}</b><br>{desc}", "gitlab", size=11)
    ids[s] = b
    if prev:
        p.arrow(prev, b)
    prev = b
p.arrow(repo, ids["code_scan"], "triggers")
p.box(540, 290, 980, 55, "Company pipeline (reference) adds: sonar (SonarQube) · va_scan (VAPT) · email-stage (reports). Artifacts: npm-audit.txt · trivy-report.txt · kube-config.yaml · junit.xml, all visible in DevOps Intelligence → job → Reports.", "note", size=11)

reg = p.box(1590, 130, 370, 90, "<b>GitLab Container Registry</b><br>…/kubeorbit-demo-api/&lt;env&gt;:&lt;env&gt;-&lt;yyyymmddhhmm&gt;-&lt;sha8&gt;-&lt;pipeline&gt;", "gitlab", size=11)
p.arrow(ids["package:docker"], reg, "push image")
gops = p.box(1590, 250, 370, 110, "<b>GitOps repo</b> (main)<br>k8s/base: deployment · service · servicemonitor<br>k8s/overlays/&lt;env&gt;: namespace, replicas, env vars, image tag", "argo", size=11)
p.arrow(ids["publish_argocd"], gops, "commit tag (resource_group: one at a time)")

p.lane(40, 400, 1920, 330, "Environments (ArgoCD app per env → namespace kubeorbit-demo-<env>)", "argo")
envs = [("dev", "auto-sync<br>chaos drills on<br>1 replica"), ("qa", "auto-sync<br>1 replica"), ("staging", "auto-sync<br>2 replicas"), ("uat", "auto-sync<br>added from the UI"), ("prod", "<b>manual sync</b> = approval<br>2 replicas + PDB")]
env_ids = []
for i, (e, desc) in enumerate(envs):
    b = p.box(80 + i * 375, 450, 300, 120, f"<b>{e}</b><br>ArgoCD app kubeorbit-demo-api-{e}<br>{desc}", "done" if e != "prod" else "partial", size=11)
    env_ids.append(b)
for a, b in zip(env_ids, env_ids[1:]):
    p.arrow(a, b, "promote: MR → ff-merge")
p.arrow(gops, env_ids[-1], "ArgoCD watches", dashed=True, color="#0f766e")
p.box(80, 600, 1840, 110,
      "<b>Promotion states</b> (Environments page): ready → Open merge request · review → Merge !N · publishing → pipeline running · syncing → ArgoCD applying · "
      "needs-sync → Sync prod · up-to-date · rolled-back → Redeploy head · blocked / diverged → fix in GitLab · failed → open the pipeline<br>"
      "<b>Rules</b>: fast-forward merges only (every env runs the exact commit the previous one tested) · each env builds its own image · CI never runs kubectl; Git is the source of truth",
      "note", size=11, align="left")

p.lane(40, 760, 940, 300, "Rollback & redeploy", "data")
h = p.box(70, 800, 270, 90, "<b>Environments → card → History</b><br>every deploy: image, commit, who, when", "platform", size=11)
rb = p.box(370, 800, 270, 90, "<b>Roll back here</b><br>commits rollback(env): app &lt;old&gt; (was &lt;new&gt;) by &lt;user&gt;", "platform", size=11)
sy = p.box(670, 800, 280, 90, "<b>Hard refresh + sync</b><br>waits/retries if another ArgoCD operation runs", "argo", size=11)
p.arrow(h, rb)
p.arrow(rb, sy)
p.box(70, 920, 880, 110, "Card shows <b>Rolled back</b>: the branch still has newer code. Either fix forward on dev and promote again, or <b>Redeploy head</b> (re-runs the branch pipeline). "
      "Verified on qa: 38d6099b → c7712c27 → 38d6099b.", "note", size=11, align="left")

p.lane(1020, 760, 940, 300, "Credentials used by the pipeline (each limited to one job)", "data")
creds = [
    ("GITOPS_DEPLOY_KEY", "SSH deploy key, write on GitOps repo · CI variable File + Protected (only env branches get it)", "gitlab"),
    ("GITOPS_REPO", "SSH URL of the GitOps repo · CI variable", "gitlab"),
    ("DEPLOY_BRANCHES", "regex of env branches · CI variable managed by DevOps Intelligence", "platform"),
    ("kubeorbit-argocd-read", "read deploy token → ArgoCD repository", "argo"),
    ("gitlab-registry secret", "read_registry deploy token → pull secret in each namespace", "k8s"),
]
for i, (n, dsc, kind) in enumerate(creds):
    p.box(1050, 800 + i * 50, 880, 42, f"<b>{n}</b>: {dsc}", kind, size=11, align="left")
pages.append(p)

# ================================================================= 3. Projects & environments
p = Page("3 Projects & Environment Provisioning", 1900, 1150)
p.title("Projects & environment provisioning",
        "A project = app repo + GitOps repo + cluster. 'Add environment' creates and checks 8 items; 'Fix' re-runs only what is missing; 'Remove' tears it down.")
proj = p.box(40, 120, 360, 170, bullets("New project (Projects page)", [
    "name (lowercase, namespace prefix, fixed)",
    "application repo (picked from GitLab connector)",
    "GitOps repo",
    "first environment branch (default dev)",
    "cluster (from Connectors)",
]), "platform", align="left", valign="top", size=11)
add = p.box(40, 330, 360, 170, bullets("Add environment (e.g. uat)", [
    "name = branch = overlay folder",
    "create branch from (default branch)",
    "namespace &lt;project&gt;-&lt;env&gt;",
    "ArgoCD app &lt;app-repo&gt;-&lt;env&gt;",
    "auto-sync (off for prod)",
]), "platform", align="left", valign="top", size=11)
p.arrow(proj, add, "project page")

p.lane(450, 110, 1410, 560, "The 8 checklist items (checked live, created by Add / Fix)", "argo")
items = [
    ("1 Namespace", "kubeorbit-demo-uat, labelled app.kubernetes.io/part-of + kubeorbit.io/environment", "k8s"),
    ("2 Pull secret", "gitlab-registry copied from another env, else new read_registry deploy token", "k8s"),
    ("3 GitOps overlay", "k8s/overlays/uat copied from a template env: namespace, APP_ENV, image path, tag not-built-yet", "argo"),
    ("4 ArgoCD repo access", "repository registered with kubeorbit-argocd-read token; connection Successful", "argo"),
    ("5 ArgoCD application", "path k8s/overlays/uat → namespace, in-cluster, CreateNamespace, auto-sync if chosen", "argo"),
    ("6 CI deploys branch", "DEPLOY_BRANCHES updated; branch .gitlab-ci.yml must read $DEPLOY_BRANCHES", "gitlab"),
    ("7 Branch protected", "first env: maintainers push; later envs: merge requests only", "gitlab"),
    ("8 Branch", "created from the chosen source branch → its pipeline builds & deploys", "gitlab"),
]
for i, (n, dsc, k) in enumerate(items):
    col, row = i % 2, i // 2
    b = p.box(480 + col * 690, 150 + row * 125, 660, 105, f"<b>{n}</b><br>{dsc}", k, size=12)
    if i == 0:
        first = b
p.arrow(add, first, "provision")

p.box(40, 540, 360, 130, bullets("Result per step", ["created / updated / already there", "failed + reason (red)", "Fix = re-run missing only"]), "note", align="left", valign="top", size=11)
p.box(450, 700, 690, 160, bullets("Remove environment", [
    "deletes the ArgoCD app (cascade: its resources)",
    "optionally deletes the namespace",
    "removes the env from DEPLOY_BRANCHES",
    "keeps branch + overlay for history",
]), "todo", align="left", valign="top", size=11)
p.box(1170, 700, 690, 160, bullets("Per-environment shortcuts (project page)", [
    "Logs · Metrics · Pods (Resource Browser) · Manifests",
    "Manifests: GitOps files (overlay + base) and per resource Desired (Git) vs Live (cluster) YAML",
    "states: in-sync · modified · missing · extra",
]), "platform", align="left", valign="top", size=11)
p.box(40, 900, 1820, 90, "<b>Verified</b>: uat added end to end: 8/8 green after promoting the $DEPLOY_BRANCHES CI rule dev → qa → staging → uat; uat answers buildEnv=uat, 'Hello from UAT'. "
      "Gotcha handled: ArgoCD answers 403 (not 404) for an app that does not exist yet.", "done", size=12, align="left")
pages.append(p)

# ================================================================= 4. Observability
p = Page("4 Observability (Logs & Metrics)", 1900, 1150)
p.title("Observability: logs, metrics, resources",
        "Scope everywhere: cluster → project → environment → namespace → all pods / a workload / one pod → container. Every view is a shareable URL.")
k = p.lane(40, 110, 520, 560, "Kubernetes (minikube)", "k8s")
pods = p.box(70, 160, 460, 90, "<b>Pods</b> in kubeorbit-demo-&lt;env&gt; and all namespaces<br>stdout/stderr → /var/log/pods on the node", "k8s", size=11)
api = p.box(70, 280, 460, 80, "<b>Kubernetes API</b><br>pod list · logs (tail / since / previous / follow) · events · YAML", "k8s", size=11)
ms = p.box(70, 390, 460, 70, "<b>metrics-server</b><br>live CPU / memory per pod & container", "k8s", size=11)
prom = p.box(70, 490, 220, 150, "<b>Prometheus</b><br>cAdvisor · kube-state-metrics · ServiceMonitor demo-api /metrics (15s)", "obs", size=11)
loki = p.box(310, 490, 220, 150, "<b>Loki + Promtail</b><br>docker pipeline stage · 5 GiB volume · history across pods", "obs", size=11)
p.arrow(pods, loki, "Promtail", dashed=True, color="#7e22ce")
p.arrow(pods, prom, "/metrics", dashed=True, color="#7e22ce")

p.lane(600, 110, 560, 560, "DevOps Intelligence backend (/api/observability)", "platform")
b1 = p.box(630, 160, 500, 70, "<b>pods · pods/:ns/:pod</b><br>status explained (CrashLoopBackOff, ImagePullBackOff, OOMKilled…), owner, usage", "platform", size=11)
b2 = p.box(630, 250, 500, 70, "<b>logs · logs/stream (NDJSON) · logs/history (LogQL)</b><br>many pods merged, sorted by time", "platform", size=11)
b3 = p.box(630, 340, 500, 70, "<b>metrics/usage · metrics/range · metrics/query</b><br>panels per pod / per route, Grafana links", "platform", size=11)
b4 = p.box(630, 430, 500, 70, "<b>resources · resources/:kind/:ns/:name · events</b><br>17 kinds, Secret values redacted", "platform", size=11)
b5 = p.box(630, 520, 500, 110, "<b>connectors (+ discover, test)</b><br>Prometheus / Grafana / Loki: access through cluster service proxy or URL, auth none / basic / bearer", "platform", size=11)
p.arrow(api, b1)
p.arrow(api, b2)
p.arrow(ms, b3)
p.arrow(prom, b3, "PromQL")
p.arrow(loki, b2, "LogQL")
p.arrow(api, b4)

p.lane(1200, 110, 660, 560, "UI", "platform")
u1 = p.box(1230, 160, 600, 110, bullets("Logs page", ["pod list with problems flagged", "Follow (live), Previous run, tail / time range", "search + regex, level filter, pod colour tags", "History (Loki), copy, download"]), "platform", align="left", valign="top", size=11)
u2 = p.box(1230, 285, 600, 115, bullets("Metrics page", ["Application: req/s, p95 latency, 2xx/4xx/5xx, 5xx %", "Containers: CPU & memory vs limit, restarts, throttling", "usage vs node capacity · PromQL explorer · Open in Grafana"]), "platform", align="left", valign="top", size=11)
u3 = p.box(1230, 415, 600, 115, bullets("Resource Browser", ["every kind, sortable, only-unhealthy, auto-refresh", "project · env chips per namespace", "pod details: Overview / Logs / Events / Metrics / YAML"]), "platform", align="left", valign="top", size=11)
u4 = p.box(1230, 545, 600, 105, bullets("Also", ["Environments card Details / History", "Project → env → Logs · Metrics · Pods · Manifests", "ArgoCD page: resources tree, diff, history, events"]), "platform", align="left", valign="top", size=11)
p.arrow(b2, u1)
p.arrow(b3, u2)
p.arrow(b4, u3)
p.arrow(b1, u3)

p.box(40, 700, 1820, 150, bullets("Setup notes (verified on this machine)", [
    "kube-prometheus-stack in monitoring; Prometheus selects ServiceMonitors with label release: kube-prometheus-stack",
    "minikube cAdvisor exports pod-level series only (no container label) → queries fall back to the pod cgroup; network metrics are not exported",
    "Loki chart grafana/loki-stack 2.10.3 with devops-demo/platform/loki-values.yaml (docker stage, not cri); first backfill skips lines 'too far behind'",
    "Grafana links need: kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80",
]), "note", align="left", valign="top", size=11)
pages.append(p)

# ================================================================= 5. Roadmap
p = Page("5 Roadmap & Status", 2000, 1520)
p.title("Roadmap & status (as of 2026-09-29)", "Sprint plan from docs/PROJECT_PLAN_AND_SPRINTS.md, with what is actually built and what remains.")
sprints = [
    ("Sprint 1 · Week 1–2", "Foundations", "done",
     ["Unified sidebar, light theme", "Project model & UI", "Devtron-style user permission screens", "Kubeconfig context discovery"], []),
    ("Sprint 2 · Week 3–4", "Connectors & Resource Browser", "done",
     ["Cluster / GitLab / ArgoCD / Observability connectors (test, default, edit, delete)", "Credentials encrypted at rest", "Resource Browser: 17 kinds, pod details, events, YAML (secrets redacted)", "Live & streamed pod logs"],
     ["Pod terminal (exec)", "Create resources from the browser"]),
    ("Sprint 3 · Week 5–6", "GitLab CI tracking", "done",
     ["Pipelines, jobs, branches, commits, run pipeline", "Live job logs, test results, auto-refresh", "Create repo + push starter code", "Job reports: npm audit, Trivy, rendered manifest", "Image per environment on Environments page"],
     ["Parsed security findings (severity counts) per pipeline", "SonarQube / Snyk stages (company pipeline)"]),
    ("Sprint 4 · Week 7–8", "GitOps, environments & promotion", "partial",
     ["ArgoCD apps: sync, diff, history, rollback, terminate", "Environments: live image/commit/pipeline/GitOps revision", "Branch-per-env promotion via ff merge requests", "Rollback & redeploy head", "Projects: add / fix / remove environments", "Manifests: Git vs cluster YAML"],
     ["Canary / blue-green (Argo Rollouts)"]),
    ("Sprint 5 · Week 9–10", "Approvals & RBAC guardrails", "todo",
     ["Approval queue UI + API", "Role checks on write routes (superadmin / devops)"],
     ["Remove admin fallback + dummy logins (auth)", "Enforce project permissions on every route", "Approvals that execute (Sync prod, prod merge) + audit log", "Notifications (Slack / email / webhook)"]),
    ("Sprint 6 · Week 11–12", "Observability", "partial",
     ["Logs page (live, follow, previous, history)", "Metrics page (containers + application per route)", "Loki + Promtail, ServiceMonitor for demo-api", "PromQL explorer, Grafana links"],
     ["Alert rules + notifications", "Prod ServiceMonitor after next Sync prod"]),
]
for i, (sp, name, st, done, rem) in enumerate(sprints):
    x = 40 + (i % 3) * 650
    y = 110 + (i // 3) * 470
    p.box(x, y, 620, 50, f"<b>{sp}: {name}</b> <span style='font-weight:normal'>({ {'done': 'done', 'partial': 'mostly done', 'todo': 'open'}[st] })</span>", st, size=13)
    p.box(x, y + 60, 620, 230, bullets("Built", done), "done", align="left", valign="top", size=11)
    p.box(x, y + 300, 620, 140, bullets("Remaining", rem) if rem else "<b>Remaining</b><br>nothing", "todo" if rem else "planned", align="left", valign="top", size=11)

p.lane(40, 1060, 1920, 250, "Next, in order (recommended)", "platform")
nxt = [
    ("1 Authentication", "remove the no-token = admin fallback and dummy tokens; real sessions + expiry", "todo"),
    ("2 Project permissions", "developers see only their projects' envs, logs, metrics", "todo"),
    ("3 Approvals that execute", "Sync prod / prod merge → approval → execute → audit log", "todo"),
    ("4 Alerts", "Prometheus rules (crash loops, failed deploys, memory) → Slack / email + card badge", "partial"),
    ("5 Canary / blue-green", "Argo Rollouts per environment, driven from Environments", "planned"),
    ("Housekeeping", "rotate skill-mine GitLab token · promote uat → prod · fake '10 Repos' badge · stale in-app roadmap text", "note"),
]
prev = None
for i, (n, dsc, k) in enumerate(nxt):
    b = p.box(70 + i * 312, 1110, 292, 170, f"<b>{n}</b><br><br>{dsc}", k, size=12)
    if prev and i < 5:
        p.arrow(prev, b)
    prev = b
p.legend(40, 1330, [("done", "done"), ("partial", "partly done"), ("todo", "open / risk"), ("planned", "planned")])
pages.append(p)

# ================================================================= 6. Feature map
p = Page("6 Feature Map (UI & API)", 2000, 1250)
p.title("Feature map: sidebar pages → backend routes → data", "What each screen does and which API it uses.")
groups = [
    ("Core", [("Dashboard /", "clusters, projects & environments, ArgoCD, git providers"), ("Getting Started /docs", "live setup checklist + roadmap"), ("User Guide /guide", "renders docs/DEVOPS_INTELLIGENCE_USER_GUIDE.md"),
              ("Manager Approvals /approvals", "approval queue (does not execute yet)"), ("DevOps Copilot /copilot", "assistant (canned answers)")]),
    ("Workloads & GitOps", [("Resource Browser", "every kind, pod details"), ("Environments", "what runs where, promote, rollback, history, details"), ("ArgoCD GitOps", "apps, sync, diff, history, rollback"),
                            ("GitLab Repositories", "repos, commits, branches, pipelines, job logs & reports, new repo, push code")]),
    ("Observability", [("Logs", "live / follow / previous / Loki history"), ("Metrics", "application + container charts, PromQL")]),
    ("Global Configurations", [("Projects /projects/:id", "projects, environments checklist, add / fix / remove, manifests"), ("Connectors", "Clusters · GitLab · ArgoCD · Observability (discover)"),
                               ("Authorization", "users, permission groups (not enforced yet)")]),
]
y = 110
for gname, entries in groups:
    p.lane(40, y, 900, 30 + 62 * len(entries), gname, "platform")
    for j, (n, dsc) in enumerate(entries):
        p.box(60, y + 30 + j * 62, 860, 54, f"<b>{n}</b>: {dsc}", "platform", size=11, align="left")
    y += 50 + 62 * len(entries)

routes = [
    ("/api/auth", "login, me, users (CRUD, role-guarded)"),
    ("/api/projects", "CRUD · /:id/setup · environments add / checks / provision / remove · promote · history · rollback · redeploy · details · manifests"),
    ("/api/clusters", "connectors CRUD, sync kubeconfig, test, resources (legacy)"),
    ("/api/git", "connectors, repos, commits, branches, pipelines, jobs trace & artifacts, templates, create repo, push template"),
    ("/api/argocd", "connectors · apps list / details / tree / diff / events / refresh / sync / rollback / terminate"),
    ("/api/observability", "scopes, namespaces, pods, events, logs (+stream, history), metrics (usage, range, query), resources, connectors (+discover, test)"),
    ("/api/approvals", "list, create, review"),
    ("/api/health", "health check"),
]
p.lane(980, 110, 980, 40 + 70 * len(routes), "Backend routes (Express)", "data")
for j, (r, dsc) in enumerate(routes):
    p.box(1000, 145 + j * 70, 940, 60, f"<b>{r}</b>: {dsc}", "data", size=11, align="left")
p.box(980, 740, 980, 170, bullets("Data model (MongoDB)", [
    "User: role superadmin / devops / developer / viewer, direct permissions",
    "Project: gitLabRepos (role app / gitops), kubernetesMappings (cluster, namespaces), argoApps (appName, targetNamespace, environment, branch)",
    "Cluster · GitIntegration · ArgoIntegration · ObservabilityIntegration: encrypted secrets, status, last test",
    "ApprovalRequest: requested action, status, reviewer",
]), "data", align="left", valign="top", size=11)
p.box(980, 930, 980, 130, bullets("Shared UI building blocks", [
    "Modal, Dropdown (portal, searchable), Form fields, DataTable, ListToolbar, Pagination, ConfirmDialog, Toasts",
    "useListQuery (search / filter / sort / page in URL), useForm, useObservabilityScope",
    "LogViewer, LineChart (SVG), MetricsPanel, PodDetailsModal, MarkdownView",
]), "note", align="left", valign="top", size=11)
pages.append(p)

# ================================================================= 7. Roles & governance
p = Page("7 Roles & Governance", 1900, 1100)
p.title("Roles, permissions & production governance", "Who can do what today, and the target approval flow (Sprint 5).")
roles = [
    ("Super Admin", "everything, incl. deleting projects and users", "person"),
    ("DevOps", "connectors, projects, add / fix / remove environments, promote, sync, rollback, PromQL", "person"),
    ("Developer", "view everything, logs, metrics, pipelines (target: only own projects)", "person"),
    ("Viewer", "read-only", "person"),
]
for i, (r, dsc, k) in enumerate(roles):
    p.box(40, 110 + i * 95, 520, 80, f"<b>{r}</b><br>{dsc}", k, size=12)
p.box(40, 500, 520, 150, "<b>Today (risk)</b><br>requests without a token are treated as admin; dummy-token logins exist; project permissions are saved but not enforced. "
      "Write routes already require superadmin / devops.", "todo", size=12, align="left")

p.lane(600, 110, 1260, 540, "Target production flow (Sprint 5)", "platform")
steps = [
    ("Developer / DevOps", "Merge uat → prod or Sync prod", "person"),
    ("Approval request", "action, env, commit, image, scan results", "platform"),
    ("Manager review", "Manager Approvals: approve / reject", "person"),
    ("Execute", "DevOps Intelligence merges / syncs ArgoCD", "argo"),
    ("Audit log", "who requested, approved, executed, when", "data"),
    ("Notify", "Slack / email / webhook", "obs"),
]
prev = None
for i, (n, dsc, k) in enumerate(steps):
    col, row = i % 3, i // 3
    b = p.box(640 + col * 400, 170 + row * 220, 360, 150, f"<b>{n}</b><br><br>{dsc}", k, size=12)
    if prev:
        p.arrow(prev, b)
    prev = b
p.box(40, 700, 1820, 140, bullets("Guardrails already in place", [
    "prod ArgoCD app is manual-sync: CI updates Git, a person presses Sync prod",
    "environment branches are protected: merge requests only; only protected branches receive GITOPS_DEPLOY_KEY",
    "fast-forward promotion: prod runs the exact commit uat tested · every action asks for confirmation",
    "secrets never shown: tokens masked (last 4 chars), Kubernetes Secret values redacted",
]), "done", align="left", valign="top", size=12)
pages.append(p)

# ================================================================= 8. Local setup & runbook
p = Page("8 Local Setup & Runbook", 1900, 1150)
p.title("Local setup & daily runbook", "Everything runs on one Windows machine with Docker Desktop + minikube. Full steps: User Guide Part A.")
steps = [
    ("1 minikube", "minikube start --driver=docker --cpus=4 --memory=8192<br>minikube addons enable metrics-server", "k8s"),
    ("2 ArgoCD", "kubectl create ns argocd · kubectl apply -n argocd -f …/install.yaml<br>port-forward svc/argocd-server 8081:443", "argo"),
    ("3 Prometheus + Grafana", "helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack -n monitoring --create-namespace", "obs"),
    ("4 Loki", "helm install loki grafana/loki-stack --version 2.10.3 -n monitoring -f devops-demo/platform/loki-values.yaml", "obs"),
    ("5 MongoDB", "127.0.0.1:27017 (local install or docker run mongo:8)", "data"),
    ("6 Backend", "cd backend · .env (JWT_SECRET, CREDENTIALS_SECRET) · npm run build · npm start → :5000", "platform"),
    ("7 Frontend", "cd frontend · npm run dev → :5173", "platform"),
    ("8 Connectors", "Clusters: Sync kubeconfig · GitLab PAT (api, read_registry, write_repository) · ArgoCD admin · Observability: Discover", "platform"),
    ("9 First project", "New repository (demo-api, demo-api-gitops) · CI variables · New project · Add environments · push to dev", "gitlab"),
]
prev = None
for i, (n, cmd, k) in enumerate(steps):
    col, row = i % 3, i // 3
    b = p.box(40 + col * 610, 110 + row * 190, 580, 160, f"<b>{n}</b><br><br><span style='font-family:monospace;font-size:11px'>{cmd}</span>", k, size=13)
    if prev:
        p.arrow(prev, b)
    prev = b
p.box(40, 690, 900, 250, bullets("Daily", [
    "minikube start",
    "kubectl port-forward svc/argocd-server -n argocd 8081:443",
    "(optional) kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80",
    "backend: npm start · frontend: npm run dev",
    "minikube stop at the end of the day",
]), "note", align="left", valign="top", size=12)
p.box(960, 690, 900, 250, bullets("Ports & logins", [
    "UI http://localhost:5173 · API http://localhost:5000/api",
    "ArgoCD https://localhost:8081 (admin, argocd-initial-admin-secret)",
    "Grafana http://localhost:3000 · MongoDB 27017",
    "Seed login admin@kubeorbit.local (change the password)",
    "Code: github.com/Pandi2352/devops_intelligence (main)",
]), "data", align="left", valign="top", size=12)
pages.append(p)

# ---------------------------------------------------------------- write
xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net" agent="DevOps Intelligence plan generator" version="24.7.0" type="device">'
       + "".join(pg.xml() for pg in pages) + "</mxfile>\n")
OUT.write_text(xml, encoding="utf-8")
print(f"wrote {OUT} ({len(pages)} pages, {sum(len(pg.cells) for pg in pages)} shapes)")
