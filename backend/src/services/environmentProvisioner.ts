import { AxiosInstance } from 'axios';
import { IProject } from '../models/Project.js';
import { argoRequest } from '../controllers/argoController.js';
import { resolveClients } from '../controllers/clusterController.js';
import { ENV_ORDER, gitlabClient, pickConnector, repoPathFromUrl } from '../controllers/environmentController.js';
import { describeRequestError } from '../utils/httpError.js';

// Sets up and checks everything one deployment environment needs (branch-per-environment flow):
//
//   namespace → image pull secret → GitOps overlay → ArgoCD repo access → ArgoCD app
//   → CI deploys the branch → protected branch → branch
//
// Every step is idempotent: it checks first and only creates what is missing.

export const PULL_SECRET = 'gitlab-registry';
const IN_CLUSTER = 'https://kubernetes.default.svc';
const CI_VARIABLE = 'DEPLOY_BRANCHES';

export interface EnvironmentSpec {
  name: string; // environment == branch name == overlay folder
  namespace: string;
  appName: string; // ArgoCD application
  overlayPath: string; // folder in the GitOps repo
  autoSync: boolean;
  sourceBranch?: string; // where a missing branch is created from
}

export interface CheckResult {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface StepResult {
  key: string;
  label: string;
  status: 'exists' | 'created' | 'updated' | 'failed' | 'skipped';
  detail: string;
}

export interface ProjectContext {
  project: IProject;
  gl: AxiosInstance;
  appRepoUrl: string;
  appRepo: string;
  gitopsRepoUrl: string;
  gitopsRepo: string;
  clusterName: string;
  overlayBase: string;
  defaultBranch: string;
}

const enc = encodeURIComponent;
const proj = (path: string) => `/projects/${enc(path)}`;
const normalizeRepo = (url: string) => url.trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
const exists = async (p: Promise<unknown>) => p.then(() => true).catch((e) => (e.response?.status === 404 || e.code === 404 || e.statusCode === 404 ? false : Promise.reject(e)));

// ---------------------------------------------------------------- context

export const loadProjectContext = async (project: IProject): Promise<ProjectContext> => {
  const repos = project.gitLabRepos || [];
  let gitopsRepoUrl = repos.find((r) => r.role === 'gitops')?.repoUrl || '';
  let overlayBase = 'k8s/overlays';

  // Fall back to what ArgoCD already deploys from.
  const firstApp = project.argoApps?.[0]?.appName;
  if (firstApp) {
    try {
      const { data } = await argoRequest('get', `/api/v1/applications/${enc(firstApp)}`);
      gitopsRepoUrl = gitopsRepoUrl || data.spec?.source?.repoURL || '';
      const path: string = data.spec?.source?.path || '';
      if (path.includes('/')) overlayBase = path.slice(0, path.lastIndexOf('/'));
    } catch {
      // ArgoCD unreachable or app missing: keep defaults.
    }
  }
  const appRepoUrl =
    repos.find((r) => r.role === 'app')?.repoUrl ||
    repos.find((r) => normalizeRepo(r.repoUrl) !== normalizeRepo(gitopsRepoUrl))?.repoUrl ||
    '';

  if (!appRepoUrl || !gitopsRepoUrl) {
    throw Object.assign(new Error('Map the application repository and the GitOps repository on the project first'), { status: 400 });
  }
  const connector = await pickConnector(appRepoUrl);
  if (!connector) throw Object.assign(new Error('No active GitLab connector can reach these repositories'), { status: 400 });
  const gl = gitlabClient(connector);
  const appRepo = repoPathFromUrl(appRepoUrl);
  const defaultBranch = await gl
    .get(proj(appRepo))
    .then((r) => r.data.default_branch || 'main')
    .catch(() => 'main');

  return {
    project,
    gl,
    appRepoUrl,
    appRepo,
    gitopsRepoUrl,
    gitopsRepo: repoPathFromUrl(gitopsRepoUrl),
    clusterName: project.kubernetesMappings?.[0]?.clusterName || '',
    overlayBase,
    defaultBranch,
  };
};

// Spec of an environment that is already mapped on the project.
export const specFromMapping = async (ctx: ProjectContext, envName: string): Promise<EnvironmentSpec | null> => {
  const mapping = ctx.project.argoApps.find((a) => (a.environment || a.branch) === envName);
  if (!mapping) return null;
  let overlayPath = `${ctx.overlayBase}/${envName}`;
  let autoSync = envName !== 'prod' && envName !== 'production';
  try {
    const { data } = await argoRequest('get', `/api/v1/applications/${enc(mapping.appName)}`);
    overlayPath = data.spec?.source?.path || overlayPath;
    autoSync = Boolean(data.spec?.syncPolicy?.automated);
  } catch {
    // App missing: the checks report it.
  }
  return { name: envName, namespace: mapping.targetNamespace, appName: mapping.appName, overlayPath, autoSync };
};

const branchesOf = (project: IProject) => project.argoApps.map((a) => a.branch || a.environment || '').filter(Boolean);

const orderEnvs = (names: string[]) =>
  [...names].sort((a, b) => (ENV_ORDER.indexOf(a) + 1 || 50) - (ENV_ORDER.indexOf(b) + 1 || 50) || a.localeCompare(b));

const deployBranchesRegex = (branches: string[]) => `/^(${orderEnvs(Array.from(new Set(branches))).join('|')})$/`;

// Does the branch's .gitlab-ci.yml deploy it? Either through $DEPLOY_BRANCHES or a hard-coded regex.
// `ref` is the branch whose .gitlab-ci.yml is read (a new environment copies its source branch's file).
const ciDeploysBranch = async (ctx: ProjectContext, branch: string, ref = branch): Promise<{ ok: boolean; detail: string }> => {
  const file = await ctx.gl
    .get(`${proj(ctx.appRepo)}/repository/files/${enc('.gitlab-ci.yml')}/raw`, { params: { ref }, responseType: 'text', transformResponse: (d) => d })
    .catch(() =>
      ctx.gl.get(`${proj(ctx.appRepo)}/repository/files/${enc('.gitlab-ci.yml')}/raw`, {
        params: { ref: ctx.defaultBranch },
        responseType: 'text',
        transformResponse: (d) => d,
      })
    )
    .catch(() => null);
  if (!file) return { ok: false, detail: 'No .gitlab-ci.yml found' };
  const text = String(file.data);

  if (text.includes(CI_VARIABLE)) {
    const variable = await ctx.gl.get(`${proj(ctx.appRepo)}/variables/${CI_VARIABLE}`).catch(() => null);
    const value: string = variable?.data?.value || '';
    // Unset: the CI file's fixed fallback regex (checked below) decides.
    if (value) {
      const m = /^\/(.*)\/([a-z]*)$/.exec(value);
      const ok = Boolean(m && new RegExp(m[1], m[2]).test(branch));
      return { ok, detail: ok ? `${CI_VARIABLE} = ${value}` : `${CI_VARIABLE} (${value}) does not include ${branch}` };
    }
  }
  for (const match of text.matchAll(/\$CI_COMMIT_BRANCH\s*=~\s*\/(.+?)\/([a-z]*)/g)) {
    if (new RegExp(match[1], match[2]).test(branch)) return { ok: true, detail: `CI rule /${match[1]}/ matches ${branch}` };
  }
  return { ok: false, detail: `The CI rules do not deploy branch ${branch}. Use $${CI_VARIABLE} in .gitlab-ci.yml so KubeOrbit can manage it.` };
};

// ArgoCD answers 403 (not 404) for an application that does not exist, so it cannot leak app names.
// A genuine permission problem still surfaces when the app is created.
const findArgoApp = (name: string) =>
  argoRequest('get', `/api/v1/applications/${enc(name)}`).catch((e) => ([403, 404].includes(e.response?.status) ? null : Promise.reject(e)));

// ---------------------------------------------------------------- checks

export const checkEnvironment = async (ctx: ProjectContext, spec: EnvironmentSpec): Promise<CheckResult[]> => {
  const results: CheckResult[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string) => results.push({ key, label, ok, detail });
  const safe = async (key: string, label: string, fn: () => Promise<[boolean, string]>) => {
    try {
      const [ok, detail] = await fn();
      add(key, label, ok, detail);
    } catch (err) {
      add(key, label, false, describeRequestError(err, key.startsWith('argo') ? 'ArgoCD' : key === 'namespace' || key === 'pullSecret' ? 'Kubernetes' : 'GitLab'));
    }
  };

  const clients = ctx.clusterName ? await resolveClients(ctx.clusterName).catch(() => null) : null;

  await Promise.all([
    safe('namespace', 'Namespace', async () => {
      if (!clients) return [false, 'No cluster mapped on the project'];
      const ok = await exists(clients.core.readNamespace({ name: spec.namespace }));
      return [ok, ok ? `${spec.namespace} exists on ${ctx.clusterName}` : `${spec.namespace} does not exist on ${ctx.clusterName}`];
    }),
    safe('pullSecret', 'Image pull secret', async () => {
      if (!clients) return [false, 'No cluster mapped on the project'];
      const ok = await exists(clients.core.readNamespacedSecret({ name: PULL_SECRET, namespace: spec.namespace }));
      return [ok, ok ? `${PULL_SECRET} lets the cluster pull from the private registry` : `${PULL_SECRET} is missing, so pods cannot pull private images`];
    }),
    safe('overlay', 'GitOps overlay', async () => {
      const ok = await exists(ctx.gl.get(`${proj(ctx.gitopsRepo)}/repository/files/${enc(`${spec.overlayPath}/kustomization.yaml`)}`, { params: { ref: 'main' } }));
      return [ok, ok ? `${spec.overlayPath} in ${ctx.gitopsRepo}` : `${spec.overlayPath}/kustomization.yaml is missing in ${ctx.gitopsRepo}`];
    }),
    safe('argoRepo', 'ArgoCD can read the GitOps repo', async () => {
      const { data } = await argoRequest('get', '/api/v1/repositories');
      const repo = (data.items || []).find((r: any) => normalizeRepo(r.repo) === normalizeRepo(ctx.gitopsRepoUrl));
      if (!repo) return [false, 'The GitOps repository is not registered in ArgoCD'];
      const state = repo.connectionState?.status;
      return [state !== 'Failed', state === 'Failed' ? `ArgoCD cannot connect: ${repo.connectionState?.message || 'unknown error'}` : 'Registered in ArgoCD'];
    }),
    safe('argoApp', 'ArgoCD application', async () => {
      const app = await findArgoApp(spec.appName);
      if (!app) return [false, `${spec.appName} does not exist in ArgoCD (or the connector cannot see it)`];
      const s = app.data.spec || {};
      const problems = [
        s.source?.path !== spec.overlayPath && `path is ${s.source?.path}`,
        s.destination?.namespace !== spec.namespace && `namespace is ${s.destination?.namespace}`,
        normalizeRepo(s.source?.repoURL || '') !== normalizeRepo(ctx.gitopsRepoUrl) && 'points at another repository',
      ].filter(Boolean);
      return [problems.length === 0, problems.length ? `${spec.appName} ${problems.join(', ')}` : `${spec.appName} (${s.syncPolicy?.automated ? 'auto-sync' : 'manual sync'})`];
    }),
    safe('ci', 'CI deploys the branch', async () => {
      const r = await ciDeploysBranch(ctx, spec.name);
      return [r.ok, r.detail];
    }),
    safe('branchProtected', 'Branch protected', async () => {
      const ok = await exists(ctx.gl.get(`${proj(ctx.appRepo)}/protected_branches/${enc(spec.name)}`));
      return [ok, ok ? 'Only maintainers can merge; CI receives the protected deploy key' : 'Unprotected branches do not receive the GitOps deploy key, so CI cannot publish'];
    }),
    safe('branch', 'Branch', async () => {
      const r = await ctx.gl.get(`${proj(ctx.appRepo)}/repository/branches/${enc(spec.name)}`).catch((e) => (e.response?.status === 404 ? null : Promise.reject(e)));
      return r ? [true, `${spec.name} at ${r.data.commit.short_id}`] : [false, `Branch ${spec.name} does not exist in ${ctx.appRepo}`];
    }),
  ]);

  const order = ['namespace', 'pullSecret', 'overlay', 'argoRepo', 'argoApp', 'ci', 'branchProtected', 'branch'];
  return results.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
};

// ---------------------------------------------------------------- provisioning

// New overlay = copy of an existing environment's overlay with namespace, labels and image adjusted.
const buildOverlay = async (ctx: ProjectContext, spec: EnvironmentSpec) => {
  const templates = orderEnvs(branchesOf(ctx.project).filter((b) => b !== spec.name));
  const preferred = spec.sourceBranch && templates.includes(spec.sourceBranch) ? [spec.sourceBranch, ...templates] : templates;
  for (const templateEnv of preferred) {
    const templateSpec = await specFromMapping(ctx, templateEnv);
    if (!templateSpec) continue;
    const res = await ctx.gl
      .get(`${proj(ctx.gitopsRepo)}/repository/files/${enc(`${templateSpec.overlayPath}/kustomization.yaml`)}/raw`, {
        params: { ref: 'main' },
        responseType: 'text',
        transformResponse: (d) => d,
      })
      .catch(() => null);
    if (!res) continue;

    const env = spec.name;
    let text = String(res.data)
      .replace(/^namespace:.*$/m, `namespace: ${spec.namespace}`)
      .replace(/APP_ENV=\S+/g, `APP_ENV=${env}`)
      .replace(/APP_MESSAGE=.*/g, `APP_MESSAGE=Hello from ${env.toUpperCase()}`)
      .replace(new RegExp(`(newName:\\s*\\S+)/${templateEnv}(\\s*)$`, 'm'), `$1/${env}$2`)
      .replace(/newTag:.*$/m, 'newTag: not-built-yet');
    text = text.replace(/^(#.*\r?\n)+/, '');
    text = `# ${env}: created by KubeOrbit from the ${templateEnv} overlay.\n# CI sets images[0] with yq on every ${env} branch build.\n${text}`;

    // Copy files the template overlay references locally (e.g. pdb.yaml).
    const extra: { file: string; content: string }[] = [];
    const block = /^resources:\s*\n((?:\s+-\s+.+\n?)+)/m.exec(String(res.data))?.[1] || '';
    for (const line of block.split('\n')) {
      const item = line.replace(/^\s*-\s*/, '').trim();
      if (!item || item.startsWith('..') || item.includes('://')) continue;
      const file = await ctx.gl
        .get(`${proj(ctx.gitopsRepo)}/repository/files/${enc(`${templateSpec.overlayPath}/${item}`)}/raw`, {
          params: { ref: 'main' },
          responseType: 'text',
          transformResponse: (d) => d,
        })
        .catch(() => null);
      if (file) extra.push({ file: item, content: String(file.data) });
    }
    return { templateEnv, kustomization: text, extra };
  }
  return null;
};

export const provisionEnvironment = async (ctx: ProjectContext, spec: EnvironmentSpec, actor: string): Promise<StepResult[]> => {
  const steps: StepResult[] = [];
  const run = async (key: string, label: string, fn: () => Promise<[StepResult['status'], string]>) => {
    try {
      const [status, detail] = await fn();
      steps.push({ key, label, status, detail });
      return status !== 'failed';
    } catch (err) {
      steps.push({ key, label, status: 'failed', detail: describeRequestError(err, key.startsWith('argo') ? 'ArgoCD' : key === 'namespace' || key === 'pullSecret' ? 'Kubernetes' : 'GitLab') });
      return false;
    }
  };

  const clients = ctx.clusterName ? await resolveClients(ctx.clusterName) : null;
  const projectLabel = { 'app.kubernetes.io/part-of': ctx.project.name, 'kubeorbit.io/environment': spec.name };

  await run('namespace', 'Namespace', async () => {
    if (!clients) return ['failed', 'Map a cluster on the project first'];
    if (await exists(clients.core.readNamespace({ name: spec.namespace }))) return ['exists', spec.namespace];
    await clients.core.createNamespace({ body: { metadata: { name: spec.namespace, labels: projectLabel } } });
    return ['created', `${spec.namespace} on ${ctx.clusterName}`];
  });

  await run('pullSecret', 'Image pull secret', async () => {
    if (!clients) return ['failed', 'Map a cluster on the project first'];
    if (await exists(clients.core.readNamespacedSecret({ name: PULL_SECRET, namespace: spec.namespace }))) return ['exists', PULL_SECRET];
    // Copy it from another environment of the project, so no new token is needed.
    for (const other of ctx.project.argoApps) {
      if (other.targetNamespace === spec.namespace) continue;
      const source: any = await clients.core.readNamespacedSecret({ name: PULL_SECRET, namespace: other.targetNamespace }).catch(() => null);
      if (!source) continue;
      await clients.core.createNamespacedSecret({
        namespace: spec.namespace,
        body: { metadata: { name: PULL_SECRET, labels: projectLabel }, type: source.type, data: source.data },
      });
      return ['created', `Copied from ${other.targetNamespace}`];
    }
    // None to copy: create a read-only registry deploy token on the app repo.
    const token = (await ctx.gl.post(`${proj(ctx.appRepo)}/deploy_tokens`, { name: `kubeorbit-pull-${spec.name}`, scopes: ['read_registry'] })).data;
    const registry = new URL(ctx.appRepoUrl).host === 'gitlab.com' ? 'registry.gitlab.com' : `registry.${new URL(ctx.appRepoUrl).host}`;
    const auth = Buffer.from(`${token.username}:${token.token}`).toString('base64');
    await clients.core.createNamespacedSecret({
      namespace: spec.namespace,
      body: {
        metadata: { name: PULL_SECRET, labels: projectLabel },
        type: 'kubernetes.io/dockerconfigjson',
        stringData: { '.dockerconfigjson': JSON.stringify({ auths: { [registry]: { username: token.username, password: token.token, auth } } }) },
      },
    });
    return ['created', `New read-only registry deploy token ${token.name}`];
  });

  await run('overlay', 'GitOps overlay', async () => {
    const path = `${spec.overlayPath}/kustomization.yaml`;
    if (await exists(ctx.gl.get(`${proj(ctx.gitopsRepo)}/repository/files/${enc(path)}`, { params: { ref: 'main' } }))) return ['exists', spec.overlayPath];
    const overlay = await buildOverlay(ctx, spec);
    if (!overlay) return ['failed', `No existing overlay to copy from. Add ${path} to ${ctx.gitopsRepo}.`];
    await ctx.gl.post(`${proj(ctx.gitopsRepo)}/repository/commits`, {
      branch: 'main',
      commit_message: `feat(${spec.name}): add ${spec.name} environment overlay (KubeOrbit, ${actor})`,
      actions: [
        { action: 'create', file_path: path, content: overlay.kustomization },
        ...overlay.extra.map((f) => ({ action: 'create', file_path: `${spec.overlayPath}/${f.file}`, content: f.content })),
      ],
    });
    return ['created', `${spec.overlayPath}, copied from ${overlay.templateEnv}`];
  });

  await run('argoRepo', 'ArgoCD can read the GitOps repo', async () => {
    const { data } = await argoRequest('get', '/api/v1/repositories');
    const repo = (data.items || []).find((r: any) => normalizeRepo(r.repo) === normalizeRepo(ctx.gitopsRepoUrl));
    if (repo && repo.connectionState?.status !== 'Failed') return ['exists', 'Already registered'];
    const token = (await ctx.gl.post(`${proj(ctx.gitopsRepo)}/deploy_tokens`, { name: 'kubeorbit-argocd-read', scopes: ['read_repository'] })).data;
    await argoRequest('post', `/api/v1/repositories?upsert=true`, {
      repo: ctx.gitopsRepoUrl,
      type: 'git',
      name: ctx.gitopsRepo.split('/').pop(),
      username: token.username,
      password: token.token,
    });
    return [repo ? 'updated' : 'created', 'Registered with a read-only deploy token'];
  });

  await run('argoApp', 'ArgoCD application', async () => {
    const existing = await findArgoApp(spec.appName);
    const cur = existing?.data?.spec;
    if (
      cur &&
      cur.source?.path === spec.overlayPath &&
      cur.destination?.namespace === spec.namespace &&
      normalizeRepo(cur.source?.repoURL || '') === normalizeRepo(ctx.gitopsRepoUrl)
    ) {
      return ['exists', `${spec.appName} (${cur.syncPolicy?.automated ? 'auto-sync' : 'manual sync'})`];
    }
    await argoRequest('post', '/api/v1/applications?upsert=true', {
      metadata: { name: spec.appName, namespace: 'argocd', labels: { 'app.kubernetes.io/part-of': ctx.project.name, 'kubeorbit.io/environment': spec.name } },
      spec: {
        project: 'default',
        source: { repoURL: ctx.gitopsRepoUrl, path: spec.overlayPath, targetRevision: 'main' },
        destination: { server: IN_CLUSTER, namespace: spec.namespace },
        syncPolicy: {
          ...(spec.autoSync ? { automated: { prune: true, selfHeal: true } } : {}),
          syncOptions: ['CreateNamespace=true'],
        },
      },
    });
    return [existing ? 'updated' : 'created', `${spec.appName} → ${spec.namespace} (${spec.autoSync ? 'auto-sync' : 'manual sync'})`];
  });

  // CI must know the branch before the branch exists: creating it starts a pipeline right away.
  const branches = Array.from(new Set([...branchesOf(ctx.project), spec.name]));
  await run('ci', 'CI deploys the branch', async () => {
    const value = deployBranchesRegex(branches);
    const current = await ctx.gl.get(`${proj(ctx.appRepo)}/variables/${CI_VARIABLE}`).catch(() => null);
    const status: StepResult['status'] = current?.data?.value === value ? 'exists' : current ? 'updated' : 'created';
    if (status === 'updated') await ctx.gl.put(`${proj(ctx.appRepo)}/variables/${CI_VARIABLE}`, { value, protected: false, masked: false });
    if (status === 'created') await ctx.gl.post(`${proj(ctx.appRepo)}/variables`, { key: CI_VARIABLE, value, protected: false, masked: false });

    // The variable only helps if the branch's .gitlab-ci.yml reads it.
    const branchExists = await exists(ctx.gl.get(`${proj(ctx.appRepo)}/repository/branches/${enc(spec.name)}`));
    const ref = branchExists ? spec.name : spec.sourceBranch || ctx.defaultBranch;
    const ci = await ciDeploysBranch(ctx, spec.name, ref);
    if (!ci.ok) {
      throw new Error(
        `${CI_VARIABLE} is set, but .gitlab-ci.yml on ${ref} has a fixed branch list without ${spec.name}. ` +
          `Promote a .gitlab-ci.yml that uses $${CI_VARIABLE} from ${ctx.defaultBranch} into ${spec.name}.`
      );
    }
    return [status, `${CI_VARIABLE} = ${value}`];
  });

  await run('branchProtected', 'Branch protected', async () => {
    if (await exists(ctx.gl.get(`${proj(ctx.appRepo)}/protected_branches/${enc(spec.name)}`))) return ['exists', 'Already protected'];
    // The first environment takes direct pushes; later ones only change through merge requests.
    const first = orderEnvs(branches)[0] === spec.name;
    await ctx.gl.post(`${proj(ctx.appRepo)}/protected_branches`, {
      name: spec.name,
      push_access_level: first ? 40 : 0,
      merge_access_level: 40,
      allow_force_push: false,
    });
    return ['created', first ? 'Maintainers push and merge' : 'Merge requests only (maintainers merge)'];
  });

  await run('branch', 'Branch', async () => {
    const existing = await ctx.gl.get(`${proj(ctx.appRepo)}/repository/branches/${enc(spec.name)}`).catch((e) => (e.response?.status === 404 ? null : Promise.reject(e)));
    if (existing) return ['exists', `${spec.name} at ${existing.data.commit.short_id}`];
    const ref = spec.sourceBranch || ctx.defaultBranch;
    const created = (await ctx.gl.post(`${proj(ctx.appRepo)}/repository/branches`, null, { params: { branch: spec.name, ref } })).data;
    return ['created', `${spec.name} from ${ref} at ${created.commit.short_id}. Its pipeline builds and deploys ${spec.name}.`];
  });

  return steps;
};

export const deprovisionEnvironment = async (
  ctx: ProjectContext,
  spec: EnvironmentSpec,
  options: { deleteNamespace: boolean }
): Promise<StepResult[]> => {
  const steps: StepResult[] = [];
  const run = async (key: string, label: string, fn: () => Promise<[StepResult['status'], string]>) => {
    try {
      const [status, detail] = await fn();
      steps.push({ key, label, status, detail });
    } catch (err) {
      steps.push({ key, label, status: 'failed', detail: describeRequestError(err, key.startsWith('argo') ? 'ArgoCD' : 'Kubernetes') });
    }
  };

  await run('argoApp', 'ArgoCD application', async () => {
    const found = await findArgoApp(spec.appName);
    if (!found) return ['skipped', 'Already gone'];
    await argoRequest('delete', `/api/v1/applications/${enc(spec.appName)}?cascade=true`);
    return ['updated', `Deleted ${spec.appName} and the resources it managed`];
  });

  await run('namespace', 'Namespace', async () => {
    if (!options.deleteNamespace) return ['skipped', `${spec.namespace} kept`];
    const clients = await resolveClients(ctx.clusterName);
    if (!(await exists(clients.core.readNamespace({ name: spec.namespace })))) return ['skipped', 'Already gone'];
    await clients.core.deleteNamespace({ name: spec.namespace });
    return ['updated', `Deleting ${spec.namespace}`];
  });

  await run('ci', 'CI deploys the branch', async () => {
    const remaining = branchesOf(ctx.project).filter((b) => b !== spec.name);
    if (remaining.length === 0) return ['skipped', 'No environments left'];
    const current = await ctx.gl.get(`${proj(ctx.appRepo)}/variables/${CI_VARIABLE}`).catch(() => null);
    if (!current) return ['skipped', `${CI_VARIABLE} not used`];
    await ctx.gl.put(`${proj(ctx.appRepo)}/variables/${CI_VARIABLE}`, { value: deployBranchesRegex(remaining) });
    return ['updated', `${CI_VARIABLE} = ${deployBranchesRegex(remaining)}`];
  });

  steps.push({ key: 'branch', label: 'Branch and overlay', status: 'skipped', detail: `Branch ${spec.name} and ${spec.overlayPath} are kept for history; delete them in GitLab if no longer needed.` });
  return steps;
};

// ---------------------------------------------------------------- manifests

export interface GitopsFile {
  path: string;
  layer: 'overlay' | 'base';
  content: string;
  webUrl: string;
}

// Every file of the environment's overlay plus the folders its kustomization pulls in (usually ../../base).
export const readGitopsFiles = async (ctx: ProjectContext, spec: EnvironmentSpec, ref = 'main'): Promise<GitopsFile[]> => {
  const repoWeb = ctx.gitopsRepoUrl.replace(/\.git$/, '');
  const listDir = async (dir: string): Promise<string[]> => {
    const { data } = await ctx.gl.get(`${proj(ctx.gitopsRepo)}/repository/tree`, { params: { path: dir, ref, recursive: true, per_page: 100 } });
    return (data || []).filter((e: any) => e.type === 'blob').map((e: any) => e.path as string);
  };
  const readFile = async (path: string) => {
    const { data } = await ctx.gl.get(`${proj(ctx.gitopsRepo)}/repository/files/${enc(path)}/raw`, {
      params: { ref },
      responseType: 'text',
      transformResponse: (d) => d,
    });
    return String(data);
  };

  const overlayPaths = await listDir(spec.overlayPath);
  const kustomization = overlayPaths.find((p) => /(^|\/)kustomization\.ya?ml$/.test(p) && p.split('/').length === spec.overlayPath.split('/').length + 1);
  const files: GitopsFile[] = [];
  const add = async (path: string, layer: GitopsFile['layer']) =>
    files.push({ path, layer, content: await readFile(path), webUrl: `${repoWeb}/-/blob/${ref}/${path}` });

  for (const p of overlayPaths) await add(p, 'overlay');

  // Directories listed under resources:/bases: in the overlay kustomization.
  const text = kustomization ? files.find((f) => f.path === kustomization)?.content || '' : '';
  const refs = [...text.matchAll(/^\s*-\s*["']?(\.\.?\/[^\s"'#]+)["']?\s*$/gm)].map((m) => m[1]);
  for (const r of refs) {
    const parts = `${spec.overlayPath}/${r}`.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') resolved.pop();
      else if (part && part !== '.') resolved.push(part);
    }
    const dir = resolved.join('/');
    if (/\.ya?ml$/.test(dir) || dir.startsWith(spec.overlayPath)) continue; // a single file inside the overlay was already read
    const basePaths = await listDir(dir).catch(() => []);
    for (const p of basePaths) if (!files.some((f) => f.path === p)) await add(p, 'base');
  }
  return files;
};
