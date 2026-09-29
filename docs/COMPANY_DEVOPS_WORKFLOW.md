# 📘 Enterprise DevOps & GitOps Architecture Reference

> **Complete Reference**: GitLab CI/CD Pipeline, Security Scanners (Snyk, SonarQube, Trivy), Dynamic K8s YAML Templating (`yq`), ArgoCD GitOps Deployment, and Local Learning Blueprint.

---

## 1. Executive Summary & Flow Diagram

Your enterprise DevOps workflow separates **Continuous Integration (CI)** in GitLab from **Continuous Delivery (CD / GitOps)** in ArgoCD. Rather than running `kubectl apply` directly from GitLab runners, the pipeline generates dynamic Kubernetes manifests, commits them to a dedicated GitOps repository, and lets ArgoCD synchronize the desired state into the Kubernetes cluster.

```
                           DEVELOPER
                               │
                               │ git push (e.g. dev, staging-qa, prod)
                               ▼
                     ┌──────────────────┐
                     │      GitLab      │
                     │ Source Repository│
                     └────────┬─────────┘
                              │
                              ▼
                       GitLab CI/CD
                              │
               ┌──────────────┼──────────────┐
               │              │              │
               ▼              ▼              ▼
          Code Scan       SonarQube      VA / Scans
           (Snyk)       (Code Quality)    (VAPT)
               │              │              │
               └──────────────┼──────────────┘
                              ▼
                        Build Artifacts
                       (npm run build)
                              │
                              ▼
                        Docker Build
                       (docker:dind)
                              │
                              ▼
                      Trivy Image Scan
                   (Container Security)
                              │
                              ▼
                  GitLab Container Registry
                    (Tagged Docker Image)
                              │
                              ▼
                     Dynamic YAML Generator
                       (yq-alpine engine)
                              │
                              ▼
                      kube-config.yaml
                              │
                              ▼
                      ARGOCD_GIT_COMMIT
                    (Publish to GitOps Repo)
                              │
                              ▼
                    ArgoCD Git Repository
                              │
                              ▼
                     ArgoCD Controller
                   (Reconciliation Loop)
                              │
                              ▼
                     Kubernetes Cluster
                    (Minikube / Cloud)
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
           Deployment      Service       Secrets
           (Pods/Replica) (targetPort) (dms-env, cm)
```

---

## 2. Pipeline Stages Deep-Dive

The pipeline definition uses 8 core stages:
```yaml
stages:
  - code_scan
  - sonar
  - va_scan
  - build
  - package
  - email-stage
  - kubeconfig
  - publish_argocd
```

### Stage 1: `code_scan` (Source & Dependency Scanning)
- **Runner Image**: `ukjaiswal/snyk-alpine`
- **Execution**: The scanning script is injected via GitLab CI/CD variable `$VAPT_SNYK_SCAN` and executed as `VAPT_SNYK_SCAN.sh`.
- **Output Artifacts**: `snyk-report.txt`, `snyk-report.json`.
- **Branch Rules**: Triggered on active branches (`dev`, `staging-qa`). Blocks critical vulnerable dependencies before compilation.

### Stage 2: `sonar` (Static Code Quality & SAST)
- **Runner Image**: `node:18-slim` with OpenJDK 17, Python, curl, jq, and `sonar-scanner`.
- **Target**: Evaluates code smells, cyclomatic complexity, test coverage, and vulnerabilities.
- **Execution**: Run via `$sonar_scan` script variable.

### Stage 3: `build` (Compilation & Artifact Packaging)
- **Runner Image**: `node:20-alpine`
- **Commands**:
  ```bash
  npm i --legacy-peer-deps
  npm run build
  cp -rf node_modules dist/
  ```
- **Environment Resolution**: Selects environment files based on Git branch slug `$CI_COMMIT_REF_SLUG`:
  - `resources/dbconfig/mongo.$CI_COMMIT_REF_SLUG.json`
  - `resources/envs/$CI_COMMIT_REF_SLUG.env`
- **Deterministic Docker Image Tagging**:
  ```bash
  export DATE1=`date +'%Y%m%d%H%M'`
  export DOCKER_IMAGE_NAME=$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG-$DATE1-$CI_COMMIT_SHA-$CI_PIPELINE_ID
  echo $DOCKER_IMAGE_NAME > dockerimagename.txt
  ```
- **Artifacts Saved**: `dist/` and `dockerimagename.txt` passed to the next job.

### Stage 4: `package` (Docker Build & Trivy Image Security)
- **Runner & Service**: `docker:latest` with `docker:dind` (Docker-in-Docker).
- **Registry Login**:
  ```bash
  docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  ```
- **Docker Build**:
  ```bash
  export DOCKER_IMAGE_NAME=`cat dockerimagename.txt`
  docker build -t $DOCKER_IMAGE_NAME \
    --build-arg BUILDCOMMAND=build:$CI_COMMIT_BRANCH \
    --build-arg API_VERSION=$CI_COMMIT_REF_SLUG \
    --build-arg DB_PORT=$SPRING_DB_PORT \
    -f Dockerfile .
  ```
- **Trivy Container Scan**: Scans the compiled container image OS packages and libraries:
  ```bash
  sh VAPT_TRIVY_SCAN1.sh $DOCKER_IMAGE_NAME
  ```
- **Registry Push**: `docker push $DOCKER_IMAGE_NAME` pushes image to GitLab Container Registry.

### Stage 5: `email-stage` (Security & Audit Reporting)
- Sends automated email reports containing Snyk findings, Trivy CVE reports, and Git commit metadata using `$VAPT_EMAIL_REP` and `$VAPT_REPORT_GIT`.

### Stage 6: `kubeconfig` (Dynamic Kubernetes Manifest Generation)
- **Runner Image**: `ukjaiswal/yq-alpine`
- Instead of static YAML, dynamic templates (`$KUBE_DEPLOYMENT`, `$KUBE_SERVICE`) are populated on the fly:
  1. **Deployment Name**: `yq -y ".metadata.name = \"$CI_PROJECT_NAME-$CI_COMMIT_BRANCH\""`
  2. **Namespace**: `yq -y ".metadata.namespace = \"dms-$CI_COMMIT_REF_SLUG-apps\""`
  3. **Selectors & Labels**: `app: $CI_PROJECT_NAME-$CI_COMMIT_BRANCH`
  4. **Image Injection**: `yq -y ".spec.template.spec.containers[0].image = \"$DOCKER_IMAGE_NAME\""`
  5. **Secrets & ConfigMaps**: Mounts Kubernetes secrets (`dms-dev-v2-env`, `dms-dev-cm`) into container paths.
  6. **Service Target Port**: Configured to port `3000`.
- **Output**: Generates finalized `kube-config.yaml`.

### Stage 7: `publish_argocd` (GitOps Handoff)
- Executes `$ARGOCD_GIT_COMMIT` script:
  - Clones the dedicated ArgoCD Git repository (e.g. `dms-gitops-manifests`).
  - Commits and pushes the generated `kube-config.yaml`.
  - ArgoCD detects the new Git commit, performs a diff, and synchronizes the cluster pods without human intervention.

---

## 3. The 3 Security Pillars Comparison

| Scanner | Layer Scanned | Responsibility |
| :--- | :--- | :--- |
| **Snyk** | Source Code & npm dependencies | Catches vulnerable package versions (e.g. CVEs in `package.json` packages) |
| **SonarQube** | Code Quality & SAST | Identifies code smells, anti-patterns, duplicated logic, test coverage gaps |
| **Trivy** | Final Docker Container Image | Scans base OS libraries (Alpine/Debian), image binaries, and embedded vulnerabilities |

---

## 4. The 3 Repositories in Modern GitOps

1. **Application Source Repo (GitLab)**: Contains TypeScript/Node source code, tests, and `.gitlab-ci.yml`.
2. **Container Registry (GitLab Registry)**: Stores immutably tagged Docker images (`$DOCKER_IMAGE_NAME`).
3. **GitOps Manifest Repo (ArgoCD Git)**: Stores desired Kubernetes YAML state (Deployments, Services, ConfigMaps). ArgoCD only watches this repository.

---

## 5. Observability Ecosystem (Prometheus, Loki, Grafana)

```
                 KUBERNETES RUNTIME
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
   Prometheus                            Loki
 (Scrapes Pod & Node               (Aggregates Container
   Metrics / cAdvisor)               Logs via Promtail)
        │                                 │
        └────────────────┬────────────────┘
                         ▼
                      Grafana
             (Unified Visual Dashboards)
```

---

## 6. Complete Local Learning Blueprint (Windows + Minikube + Docker)

You can reproduce this entire stack on your local machine step by step:

### Phase 1: Local Docker & Packaging
- Practice writing multi-stage `Dockerfile` (build stage, runtime stage).
- Build and tag images locally: `docker build -t dms-backend:dev-local .`
- Run containers and connect to local MongoDB.

### Phase 2: Kubernetes Fundamentals on Minikube
- Minikube provides a real single-node Kubernetes cluster on your Windows PC.
- Practice deploying Pods, Deployments, Services (ClusterIP & NodePort), ConfigMaps, and Secrets.
- Test namespace isolation (`dms-dev-apps`, `dms-prod-apps`).

### Phase 3: Local GitLab Runner or CI Simulator
- Run GitLab Runner locally or use lightweight pipeline emulators to run Snyk CLI and Trivy CLI.

### Phase 4: Local ArgoCD GitOps
- Install ArgoCD inside Minikube:
  ```powershell
  kubectl create namespace argocd
  kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
  kubectl port-forward svc/argocd-server -n argocd 8080:443
  ```
- Connect ArgoCD to your Git repository and observe automated state sync.

### Phase 5: Local Observability
- Deploy kube-prometheus-stack and Grafana via Helm on Minikube to view real-time pod CPU/memory usage and logs.
