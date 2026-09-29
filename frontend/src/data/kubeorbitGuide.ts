// Static content for the Getting Started page. Live status for each step is computed in DocsPage.

export type GuideStepId =
  | 'cluster'
  | 'gitlab'
  | 'argocd'
  | 'project'
  | 'team'
  | 'pipeline'
  | 'gitops'
  | 'approvals'
  | 'observability';

export interface GuideCommand {
  label: string;
  code: string;
  shell?: 'bash' | 'powershell' | 'yaml';
}

export interface GuideStep {
  id: GuideStepId;
  title: string;
  goal: string;
  why: string;
  actions: string[];
  commands?: GuideCommand[];
  link?: { to: string; label: string };
  dependsOn?: GuideStepId[];
  /** Where this step sits in docs/COMPANY_DEVOPS_WORKFLOW.md */
  workflowRef: string;
  /** Present when part of the step still has to be done outside KubeOrbit. */
  platformGap?: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'cluster',
    title: 'Connect a Kubernetes cluster',
    goal: 'KubeOrbit can reach at least one cluster (e.g. your local Minikube).',
    why: 'Every deployment, namespace mapping and resource-browser view needs a reachable cluster.',
    actions: [
      'Start Minikube on your machine.',
      'Open Connectors → Kubernetes Clusters and click "Sync kubeconfig" to import your contexts.',
      'Make sure the cluster shows Healthy. Use the plug icon to re-test it.',
    ],
    commands: [
      { label: 'Start Minikube', code: 'minikube start\nkubectl config use-context minikube\nkubectl get nodes', shell: 'bash' },
    ],
    link: { to: '/connectors?tab=clusters', label: 'Open cluster connectors' },
    workflowRef: 'Kubernetes Cluster (Minikube / Cloud)',
  },
  {
    id: 'gitlab',
    title: 'Connect GitLab',
    goal: 'A GitLab connector is verified with a personal access token.',
    why: 'KubeOrbit reads repositories, branches, commits and CI pipelines through this connector.',
    actions: [
      'In GitLab, create a personal access token with the read_api and read_user scopes (add api to trigger pipelines).',
      'Open Connectors → GitLab → "Add GitLab", paste the URL and token, click "Test connection", then save.',
      'Mark the connector you use day to day as the default (star icon).',
    ],
    link: { to: '/connectors?tab=gitlab', label: 'Open GitLab connectors' },
    workflowRef: 'GitLab Source Repository',
  },
  {
    id: 'argocd',
    title: 'Install and connect ArgoCD',
    goal: 'An ArgoCD connector reports Connected.',
    why: 'ArgoCD is the CD half of the workflow: it watches the GitOps manifest repo and syncs it into the cluster.',
    actions: [
      'Install ArgoCD into Minikube (commands below).',
      'Port-forward the ArgoCD API. Port 8080 is often taken, so this uses 8085.',
      'Read the initial admin password.',
      'Open Connectors → ArgoCD → "Add ArgoCD": URL https://localhost:8085, "Username & password" (admin), "Skip TLS verification" on. Test, then save.',
    ],
    commands: [
      {
        label: 'Install ArgoCD',
        code:
          'kubectl create namespace argocd\nkubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml\nkubectl -n argocd rollout status deploy/argocd-server',
        shell: 'bash',
      },
      { label: 'Expose the API (keep this terminal open)', code: 'kubectl port-forward svc/argocd-server -n argocd 8085:443', shell: 'bash' },
      {
        label: 'Initial admin password (PowerShell)',
        code:
          '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}")))',
        shell: 'powershell',
      },
    ],
    link: { to: '/connectors?tab=argocd', label: 'Open ArgoCD connectors' },
    dependsOn: ['cluster'],
    workflowRef: 'ArgoCD Controller (Reconciliation Loop)',
  },
  {
    id: 'project',
    title: 'Create a project and add its environments',
    goal: 'A project ties an application repo, a GitOps repo and a cluster together, with one environment per branch.',
    why: 'A project is the tenancy boundary: permissions, repos, namespaces and ArgoCD apps are all grouped by project.',
    actions: [
      'Open Projects → "New project". Pick the application repo and the GitOps repo from your GitLab connector, and the cluster.',
      'On the project page press "Add environment" (e.g. dev, then qa, staging, prod). KubeOrbit creates the namespace, registry pull secret, GitOps overlay, ArgoCD app, protected branch and the DEPLOY_BRANCHES CI variable.',
      'Every environment shows a checklist. A red item says what is wrong; "Fix" re-runs only the missing steps.',
      'The .gitlab-ci.yml in the app repo must deploy branches matching $DEPLOY_BRANCHES (see the demo) so new environments deploy without editing CI.',
    ],
    commands: [
      {
        label: '.gitlab-ci.yml rule for environment branches',
        code:
          '.environment_branch:\n  rules:\n    - if: $DEPLOY_BRANCHES && $CI_COMMIT_BRANCH =~ $DEPLOY_BRANCHES\n      variables:\n        DEPLOY_ENV: $CI_COMMIT_BRANCH',
        shell: 'yaml',
      },
    ],
    link: { to: '/projects', label: 'Open projects' },
    dependsOn: ['cluster', 'gitlab'],
    workflowRef: 'Application Source Repo (GitLab)',
  },
  {
    id: 'team',
    title: 'Invite the team and grant project permissions',
    goal: 'At least one non-admin user has a permission on a project.',
    why: 'Developers should only see and act on their own project; managers approve production changes.',
    actions: [
      'Open Authorization → User Permissions → "+ Add Users".',
      'Choose a permission group (Developer, DevOps Lead or Viewer).',
      'Under Direct Permissions add a row for the project with "View only", "Build and Deploy" or "Manager Approver".',
    ],
    link: { to: '/authorization/users', label: 'Open user permissions' },
    dependsOn: ['project'],
    workflowRef: 'Role boundaries: Developer / DevOps / Manager',
    platformGap: 'Permissions are saved but not yet enforced by the API, so every signed-in user can still reach every project.',
  },
  {
    id: 'pipeline',
    title: 'Run the CI pipeline for the project repo',
    goal: 'The mapped repository has at least one GitLab pipeline run.',
    why: 'CI scans, builds and pushes the image, then publishes the rendered manifest to the GitOps repo.',
    actions: [
      'Add a .gitlab-ci.yml with the company stages to the application repo (skeleton below).',
      'Define CI/CD variables in GitLab (VAPT_SNYK_SCAN, sonar_scan, KUBE_DEPLOYMENT, KUBE_SERVICE, ARGOCD_GIT_COMMIT…).',
      'Open GitLab Repositories → select the repo → "Run Pipeline", and follow each stage live.',
    ],
    commands: [
      {
        label: '.gitlab-ci.yml stages',
        code:
          'stages:\n  - code_scan       # Snyk\n  - sonar           # SonarQube quality gate\n  - va_scan\n  - build           # npm run build + dockerimagename.txt\n  - package         # docker:dind build + Trivy scan + push\n  - email-stage     # VAPT report\n  - kubeconfig      # yq renders kube-config.yaml\n  - publish_argocd  # commit manifest to the GitOps repo',
        shell: 'yaml',
      },
    ],
    link: { to: '/git', label: 'Open GitLab repositories' },
    dependsOn: ['project'],
    workflowRef: 'GitLab CI/CD stages 1–7',
  },
  {
    id: 'gitops',
    title: 'Create the ArgoCD application for the project',
    goal: 'ArgoCD has at least one application syncing the GitOps manifest repo.',
    why: 'This links the manifest repo (e.g. demo-api-devops) to a namespace, so every CI publish is deployed automatically.',
    actions: [
      'If the manifest repo is private, register it in ArgoCD with a GitLab token (argocd repo add … or ArgoCD UI → Settings → Repositories).',
      'Apply an Application manifest like the one below (adjust repo, path and namespace).',
      'Open ArgoCD GitOps in KubeOrbit: the app appears and can be synced with "Sync Now".',
    ],
    commands: [
      {
        label: 'argocd-app.yaml (kubectl apply -f argocd-app.yaml)',
        code:
          'apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: demo-api-dev\n  namespace: argocd\nspec:\n  project: default\n  source:\n    repoURL: https://gitlab.com/<group>/demo-api-devops.git\n    targetRevision: main\n    path: k8s/overlays/dev\n  destination:\n    server: https://kubernetes.default.svc\n    namespace: dms-dev-apps\n  syncPolicy:\n    automated: { prune: true, selfHeal: true }\n    syncOptions: [CreateNamespace=true]',
        shell: 'yaml',
      },
    ],
    link: { to: '/argocd', label: 'Open ArgoCD GitOps' },
    dependsOn: ['argocd', 'pipeline'],
    workflowRef: 'ARGOCD_GIT_COMMIT → ArgoCD Git Repository → Controller',
    platformGap: 'Projects → Add environment creates this application for you; the manifest is for understanding what it does.',
  },
  {
    id: 'approvals',
    title: 'Route production changes through approvals',
    goal: 'Sensitive operations (prod deploy, restart, scale) go through the Manager Approval queue.',
    why: 'Keeps production changes auditable: who asked, who approved, when.',
    actions: [
      'Developers request prod deploys or pod restarts (DevOps Copilot → "Submit Manager Approval Request").',
      'Managers review them in Manager Approvals and approve or reject with a comment.',
    ],
    link: { to: '/approvals', label: 'Open approvals' },
    dependsOn: ['team'],
    workflowRef: 'Manager Portal: privileged approval queue',
    platformGap: 'Approving a request records the decision but does not run the action yet.',
  },
  {
    id: 'observability',
    title: 'Connect metrics and logs',
    goal: 'Prometheus (and optionally Loki and Grafana) are added in Connectors → Observability.',
    why: 'Closes the loop: CPU, memory, restarts and logs for every environment, one click from the project.',
    actions: [
      'Connectors → Observability → "Discover in cluster" finds Prometheus, Grafana and Loki services. Add them: KubeOrbit reaches them through the Kubernetes API proxy, no port-forward needed.',
      'Logs: pick project → environment (or any namespace), then one pod, a whole deployment or every pod. Follow streams new lines; "Previous run" shows why a container crashed.',
      'Metrics: CPU, memory, restarts and throttling per pod from Prometheus, current usage from metrics-server, and links into Grafana dashboards.',
      'Live pod logs work without Loki. Loki adds history: logs of pods that were deleted or restarted long ago, searchable across pods.',
      'App metrics (requests/s, p95 latency, error rate) appear once the app exposes http_request_duration_seconds on /metrics and the GitOps base has a ServiceMonitor with the label release: kube-prometheus-stack.',
      'For Grafana links, set the browser URL on the Grafana connector and keep a port-forward running (command below).',
    ],
    commands: [
      {
        label: 'Install Loki + Promtail (log history) next to kube-prometheus-stack',
        code:
          'helm repo add grafana https://grafana.github.io/helm-charts\nhelm install loki grafana/loki-stack --version 2.10.3 -n monitoring -f devops-demo/platform/loki-values.yaml --wait',
        shell: 'bash',
      },
      {
        label: 'Open Grafana in the browser',
        code: 'kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80',
        shell: 'bash',
      },
    ],
    link: { to: '/logs', label: 'Open logs' },
    dependsOn: ['cluster'],
    workflowRef: 'Observability: Prometheus, Loki, Grafana',
  },
];

export interface PipelineStageInfo {
  stage: string;
  tool: string;
  purpose: string;
  inKubeOrbit: string;
}

export const PIPELINE_STAGES: PipelineStageInfo[] = [
  { stage: 'code_scan', tool: 'Snyk (snyk-alpine)', purpose: 'Finds vulnerable npm dependencies before the build.', inKubeOrbit: 'Job status in GitLab Repositories → CI/CD Pipelines' },
  { stage: 'sonar', tool: 'SonarQube', purpose: 'Code quality gate: smells, duplication, coverage, SAST.', inKubeOrbit: 'Job status' },
  { stage: 'va_scan', tool: 'VAPT scripts', purpose: 'Additional vulnerability assessment.', inKubeOrbit: 'Job status' },
  { stage: 'build', tool: 'node:20-alpine', purpose: 'npm run build, picks env files by branch, writes dockerimagename.txt.', inKubeOrbit: 'Job status' },
  { stage: 'package', tool: 'docker:dind + Trivy', purpose: 'Builds and scans the image, pushes it to the GitLab registry.', inKubeOrbit: 'Job status (image tag tracking planned)' },
  { stage: 'email-stage', tool: 'VAPT reporter', purpose: 'Emails Snyk / Trivy reports.', inKubeOrbit: 'Job status' },
  { stage: 'kubeconfig', tool: 'yq-alpine', purpose: 'Renders kube-config.yaml: name, namespace, image, secrets, port 3000.', inKubeOrbit: 'Job status' },
  { stage: 'publish_argocd', tool: 'ARGOCD_GIT_COMMIT', purpose: 'Commits the manifest to the GitOps repo; ArgoCD then syncs it.', inKubeOrbit: 'ArgoCD GitOps page (sync status, Sync Now)' },
];

export const THREE_REPOS = [
  { name: 'Application source repo', example: 'demo-api', holds: 'Source code, tests, .gitlab-ci.yml' },
  { name: 'Container registry', example: 'registry.gitlab.com/<group>/demo-api', holds: 'Immutable image tags: <branch>-<date>-<sha>-<pipeline>' },
  { name: 'GitOps manifest repo', example: 'demo-api-devops', holds: 'Rendered Kubernetes YAML. ArgoCD watches only this repo.' },
];

export type RoadmapStatus = 'done' | 'partial' | 'not-started';

export interface RoadmapItem {
  sprint: string;
  title: string;
  status: RoadmapStatus;
  done: string[];
  remaining: string[];
}

export const ROADMAP: RoadmapItem[] = [
  {
    sprint: 'Sprint 1',
    title: 'Foundations',
    status: 'done',
    done: ['Unified sidebar and light theme', 'Project model and UI', 'Devtron-style user permissions screens', 'Kubeconfig context discovery'],
    remaining: [],
  },
  {
    sprint: 'Sprint 2',
    title: 'Connectors & resource browser',
    status: 'partial',
    done: [
      'Cluster, GitLab and ArgoCD connectors with test, edit, default and delete',
      'Credentials encrypted at rest',
      'Live pods, deployments, services, config maps, secrets, nodes, namespaces',
      'Live manifests and pod logs',
    ],
    remaining: ['StatefulSets, DaemonSets, Jobs, Ingress, PVCs in the resource browser', 'Real pod events and terminal (currently sample output)'],
  },
  {
    sprint: 'Sprint 3',
    title: 'GitLab CI tracking',
    status: 'partial',
    done: [
      'Live pipelines, jobs, branches, commits',
      'Trigger a pipeline on any branch',
      'Real job logs, followed live while a job runs',
      'Test results per pipeline and real commit titles',
      'Pipelines auto-refresh while running',
      'Create repositories and push starter code from KubeOrbit',
      'Job reports (npm audit, Trivy, rendered manifests) inside KubeOrbit',
    ],
    remaining: ['Image tag tracking per pipeline', 'Parsed security findings (severity counts) per pipeline'],
  },
  {
    sprint: 'Sprint 4',
    title: 'ArgoCD sync & progressive delivery',
    status: 'partial',
    done: [
      'List ArgoCD applications with sync and health',
      'Manual sync (restricted to Super Admin / DevOps)',
      'Environments page: live image, commit, pipeline and GitOps revision per environment',
      'Two-step dev → prod promotion: run the publish job, then sync',
      'Branch-per-environment promotion through fast-forward merge requests',
      'Rollback to any earlier deploy, redeploy branch head, ArgoCD details',
      'Projects: add, fix and remove environments (namespace, pull secret, overlay, ArgoCD app, branch, CI)',
    ],
    remaining: ['Git vs cluster diff', 'Canary via Argo Rollouts'],
  },
  {
    sprint: 'Sprint 5',
    title: 'Approvals & RBAC guardrails',
    status: 'partial',
    done: ['Approval queue UI and API', 'Connector changes limited to Super Admin / DevOps'],
    remaining: [
      'Remove the admin fallback in API authentication',
      'Enforce project permissions on every API route',
      'Execute approved actions and keep an audit log',
      'Notifications (Slack / webhook / email)',
    ],
  },
  {
    sprint: 'Sprint 6',
    title: 'Observability',
    status: 'partial',
    done: [
      'Logs page: live, follow and previous-run logs for a pod, a workload or a namespace',
      'Metrics page: Prometheus CPU / memory / restarts / throttling, metrics-server usage, PromQL explorer',
      'Prometheus, Grafana and Loki connectors with in-cluster discovery',
      'Resource Browser with pod details (containers, usage vs limits, events, YAML)',
      'Loki + Promtail installed; log history searchable across pods and namespaces',
      'Application metrics per route: requests/s, p95 latency, status codes, 5xx error rate (ServiceMonitor in the GitOps base)',
    ],
    remaining: ['Alert rules and notifications'],
  },
];

// Recommended order for the platform work that unblocks the steps above.
export const BUILD_ORDER = [
  { title: 'Fix authentication', detail: 'Stop treating missing or invalid tokens as the admin; drop dummy logins. Every RBAC feature depends on this.' },
  { title: 'Enforce project permissions', detail: 'Filter projects, environments, clusters and namespaces by the signed-in user’s direct permissions.' },
  { title: 'Approvals that execute + audit log', detail: 'Run the approved action and record who requested, approved and executed it.' },
  { title: 'Canary and blue-green releases', detail: 'Argo Rollouts per environment, with the traffic split and promotion driven from the Environments page.' },
  { title: 'Alerts and notifications', detail: 'Prometheus alert rules and Slack / email / webhook notifications for failed deploys and crashing pods.' },
];
