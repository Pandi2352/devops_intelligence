import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { Project } from '../models/Project.js';
import { isValidId } from '../utils/validation.js';
import { envLevel } from '../services/access.js';
import { ENV_ORDER } from './environmentController.js';
import {
  EnvironmentSpec,
  checkEnvironment,
  deprovisionEnvironment,
  loadProjectContext,
  provisionEnvironment,
  readGitopsFiles,
  specFromMapping,
} from '../services/environmentProvisioner.js';
import { dumpYaml } from '@kubernetes/client-node';
import { argoRequest } from './argoController.js';
import { describeRequestError } from '../utils/httpError.js';

const ENV_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

const actor = (req: AuthRequest) => req.user?.email || req.user?.name || 'DevOps Intelligence';

const loadProject = async (req: AuthRequest, res: Response) => {
  const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
  if (!project) res.status(404).json({ message: 'Project not found' });
  return project;
};

const sendError = (res: Response, err: any) => {
  res.status(err.status || 500).json({ message: err.message || 'Request failed' });
};

const envOrder = (name: string) => ENV_ORDER.indexOf(name) + 1 || 50;

// Repos, cluster and every environment of a project, each with its setup checklist.
export const getProjectSetup = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  try {
    const ctx = await loadProjectContext(project);
    const names = (project.argoApps.map((a) => a.environment || a.branch).filter(Boolean) as string[]).filter((n) => envLevel(req.user, project.name, n) >= 1);
    const environments = await Promise.all(
      names.map(async (name) => {
        const spec = await specFromMapping(ctx, name);
        return spec ? { ...spec, checks: await checkEnvironment(ctx, spec) } : null;
      })
    );
    res.json({
      ready: true,
      appRepo: { url: ctx.appRepoUrl, path: ctx.appRepo, defaultBranch: ctx.defaultBranch },
      gitopsRepo: { url: ctx.gitopsRepoUrl, path: ctx.gitopsRepo },
      cluster: ctx.clusterName,
      overlayBase: ctx.overlayBase,
      environments: environments.filter(Boolean).sort((a, b) => envOrder(a!.name) - envOrder(b!.name)),
    });
  } catch (err: any) {
    if (err.status === 400) {
      res.json({ ready: false, message: err.message, environments: [] });
      return;
    }
    sendError(res, err);
  }
};

export const getEnvironmentChecks = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  try {
    const ctx = await loadProjectContext(project);
    const spec = await specFromMapping(ctx, String(req.params.env));
    if (!spec) {
      res.status(404).json({ message: `Environment ${req.params.env} is not mapped on ${project.name}` });
      return;
    }
    res.json({ spec, checks: await checkEnvironment(ctx, spec) });
  } catch (err) {
    sendError(res, err);
  }
};

// Add a new environment to the project and provision everything it needs.
export const addEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  try {
    const name = String(req.body?.name || '').trim().toLowerCase();
    if (!ENV_NAME.test(name)) {
      res.status(400).json({ message: 'Environment name: 1-20 lowercase letters, numbers or dashes, starting with a letter' });
      return;
    }
    if (project.argoApps.some((a) => (a.environment || a.branch) === name)) {
      res.status(409).json({ message: `${project.name} already has a ${name} environment` });
      return;
    }

    const ctx = await loadProjectContext(project);
    const appRepoName = ctx.appRepo.split('/').pop() || project.name;
    const spec: EnvironmentSpec = {
      name,
      namespace: String(req.body?.namespace || `${project.name}-${name}`).trim().toLowerCase(),
      appName: String(req.body?.appName || `${appRepoName}-${name}`).trim().toLowerCase(),
      overlayPath: `${ctx.overlayBase}/${name}`,
      autoSync: typeof req.body?.autoSync === 'boolean' ? req.body.autoSync : !['prod', 'production'].includes(name),
      sourceBranch: String(req.body?.sourceBranch || '').trim() || undefined,
    };
    if (!DNS_LABEL.test(spec.namespace) || !DNS_LABEL.test(spec.appName)) {
      res.status(400).json({ message: 'Namespace and ArgoCD app name must be valid DNS labels (lowercase, dashes, max 63)' });
      return;
    }
    if (project.argoApps.some((a) => a.targetNamespace === spec.namespace || a.appName === spec.appName)) {
      res.status(409).json({ message: `Another environment already uses namespace ${spec.namespace} or app ${spec.appName}` });
      return;
    }
    // Never take over another project's ArgoCD app or namespace: provisioning would re-point it.
    const other = await Project.findOne({
      _id: { $ne: project._id },
      $or: [{ 'argoApps.appName': spec.appName }, { 'argoApps.targetNamespace': spec.namespace }],
    });
    if (other) {
      const clash = other.argoApps.find((a) => a.appName === spec.appName) ? `ArgoCD app ${spec.appName}` : `namespace ${spec.namespace}`;
      res.status(409).json({ message: `${clash} belongs to project ${other.name}. Pick a different name.` });
      return;
    }

    // Map first, so the environment (and its checklist) shows up even if a step fails.
    project.argoApps.push({ appName: spec.appName, targetNamespace: spec.namespace, environment: name, branch: name, serverUrl: '' });
    const mapping = project.kubernetesMappings[0];
    if (mapping && !mapping.namespaces.includes(spec.namespace)) mapping.namespaces.push(spec.namespace);
    await project.save();

    const steps = await provisionEnvironment(ctx, spec, actor(req));
    const failed = steps.filter((s) => s.status === 'failed');
    res.status(201).json({
      message: failed.length
        ? `${name} added, but ${failed.length} step(s) failed. Fix them and press Provision again.`
        : `${name} is set up. The ${name} branch pipeline builds and deploys it.`,
      spec,
      steps,
      checks: await checkEnvironment(ctx, spec),
    });
  } catch (err) {
    sendError(res, err);
  }
};

// Re-run provisioning for an existing environment: creates whatever is missing.
export const provisionExistingEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  try {
    const ctx = await loadProjectContext(project);
    const spec = await specFromMapping(ctx, String(req.params.env));
    if (!spec) {
      res.status(404).json({ message: `Environment ${req.params.env} is not mapped on ${project.name}` });
      return;
    }
    if (req.body?.sourceBranch) spec.sourceBranch = String(req.body.sourceBranch);
    const steps = await provisionEnvironment(ctx, spec, actor(req));
    const failed = steps.filter((s) => s.status === 'failed').length;
    const changed = steps.filter((s) => s.status === 'created' || s.status === 'updated').length;
    res.json({
      message: failed ? `${failed} step(s) still failing` : changed ? `Fixed ${changed} item(s) for ${spec.name}` : `${spec.name} was already complete`,
      steps,
      checks: await checkEnvironment(ctx, spec),
    });
  } catch (err) {
    sendError(res, err);
  }
};

export const removeEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  try {
    const envName = String(req.params.env);
    const ctx = await loadProjectContext(project);
    const spec = await specFromMapping(ctx, envName);
    if (!spec) {
      res.status(404).json({ message: `Environment ${envName} is not mapped on ${project.name}` });
      return;
    }
    const steps = await deprovisionEnvironment(ctx, spec, { deleteNamespace: req.query.deleteNamespace === 'true' });

    project.argoApps = project.argoApps.filter((a) => (a.environment || a.branch) !== envName);
    const mapping = project.kubernetesMappings[0];
    if (mapping) mapping.namespaces = mapping.namespaces.filter((n) => n !== spec.namespace);
    await project.save();

    res.json({ message: `${envName} removed from ${project.name}`, steps });
  } catch (err) {
    sendError(res, err);
  }
};

const tidy = (raw?: string) => {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj?.metadata) {
      delete obj.metadata.managedFields;
      if (obj.metadata.annotations) delete obj.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
    }
    return obj;
  } catch {
    return null;
  }
};

// GitOps source files (overlay + base) and, per resource, what Git wants vs. what runs in the cluster.
export const getEnvironmentManifests = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  try {
    const ctx = await loadProjectContext(project);
    const spec = await specFromMapping(ctx, String(req.params.env));
    if (!spec) {
      res.status(404).json({ message: `Environment ${req.params.env} is not mapped on ${project.name}` });
      return;
    }
    const [files, managed] = await Promise.all([
      readGitopsFiles(ctx, spec).catch((err) => ({ error: describeRequestError(err, 'GitLab') })),
      argoRequest('get', `/api/v1/applications/${encodeURIComponent(spec.appName)}/managed-resources`).catch((err) => ({ error: describeRequestError(err, 'ArgoCD') })),
    ]);
    const resources = 'error' in managed
      ? []
      : ((managed as any).data.items || []).map((item: any) => {
          const desired = tidy(item.targetState);
          const live = tidy(item.liveState);
          return {
            kind: item.kind,
            group: item.group || '',
            name: item.name,
            namespace: item.namespace || '',
            state: !live && desired ? 'missing' : live && !desired ? 'extra' : item.modified ? 'modified' : 'in-sync',
            desiredYaml: desired ? dumpYaml(desired) : '',
            liveYaml: live ? dumpYaml(live) : '',
          };
        });
    res.json({
      environment: spec.name,
      appName: spec.appName,
      namespace: spec.namespace,
      gitopsRepo: ctx.gitopsRepo,
      overlayPath: spec.overlayPath,
      files: Array.isArray(files) ? files : [],
      filesError: Array.isArray(files) ? undefined : files.error,
      resources,
      resourcesError: 'error' in managed ? managed.error : undefined,
    });
  } catch (err) {
    sendError(res, err);
  }
};
