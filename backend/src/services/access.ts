import { IUser } from '../models/User.js';
import { IProject, Project } from '../models/Project.js';

// Who may see and do what.
//   Super Admin / DevOps ("managers"): everything.
//   Developer / Viewer: only what their direct permissions grant, per project and environment.
// Levels: 0 none · 1 view · 2 deploy (Build and Deploy) · 3 admin (manage the project and its environments).

export type Level = 0 | 1 | 2 | 3;
export const VIEW: Level = 1;
export const DEPLOY: Level = 2;
export const ADMIN: Level = 3;

const PERMISSION_LEVEL: Record<string, Level> = {
  'View only': 1,
  'Manager Approver': 1,
  'Build and Deploy': 2,
  Admin: 3,
};

export const LEVEL_NAME: Record<Level, string> = { 0: 'no access', 1: 'view', 2: 'build and deploy', 3: 'admin' };

export const isManager = (u?: IUser | null): boolean => Boolean(u && (u.isSuperAdmin || u.role === 'superadmin' || u.role === 'devops'));
export const isSuperAdmin = (u?: IUser | null): boolean => Boolean(u && (u.isSuperAdmin || u.role === 'superadmin'));

const grants = (u: IUser, project: string) => (u.directPermissions || []).filter((p) => p.project === '*' || p.project === project);
const cap = (u: IUser, level: Level): Level => (u.role === 'viewer' ? (Math.min(level, 1) as Level) : level);

// Level on one environment of a project.
export const envLevel = (u: IUser | undefined | null, project: string, env: string): Level => {
  if (!u) return 0;
  if (isManager(u)) return 3;
  const lv = grants(u, project)
    .filter((p) => !p.environment || p.environment === 'all' || p.environment === env)
    .reduce<Level>((m, p) => Math.max(m, PERMISSION_LEVEL[p.permission] || 0) as Level, 0);
  return cap(u, lv);
};

// Level on the project as a whole (settings, adding environments): only grants for all environments count.
// Any environment grant still lets the user see the project itself (level 1).
export const projectLevel = (u: IUser | undefined | null, project: string): Level => {
  if (!u) return 0;
  if (isManager(u)) return 3;
  const g = grants(u, project);
  if (!g.length) return 0;
  const whole = g.filter((p) => !p.environment || p.environment === 'all').reduce<Level>((m, p) => Math.max(m, PERMISSION_LEVEL[p.permission] || 0) as Level, 0);
  return cap(u, Math.max(whole, 1) as Level);
};

export const canApprove = (u: IUser | undefined | null, project: string, env?: string): boolean => {
  if (!u) return false;
  if (isManager(u)) return true;
  if (u.role === 'viewer') return false;
  return grants(u, project).some(
    (p) => (p.permission === 'Manager Approver' || p.permission === 'Admin') && (!env || !p.environment || p.environment === 'all' || p.environment === env)
  );
};

export const envNameOf = (a: IProject['argoApps'][number]) => a.environment || a.branch || a.appName;

// Everything a user can see, resolved against the current projects. null = unrestricted (managers).
export interface Scope {
  projects: Set<string>;
  namespaces: Set<string>;
  apps: Set<string>;
  repoPaths: Set<string>; // group/repo, lower-case
  envsByProject: Map<string, Set<string>>;
}

export const repoPathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

export const buildScope = async (u: IUser | undefined | null, projects?: IProject[]): Promise<Scope | null> => {
  if (isManager(u)) return null;
  const all = projects || (await Project.find());
  const scope: Scope = { projects: new Set(), namespaces: new Set(), apps: new Set(), repoPaths: new Set(), envsByProject: new Map() };
  for (const p of all) {
    if (projectLevel(u, p.name) < 1) continue;
    scope.projects.add(p.name);
    const envs = new Set<string>();
    for (const a of p.argoApps || []) {
      const env = envNameOf(a);
      if (envLevel(u, p.name, env) < 1) continue;
      envs.add(env);
      if (a.targetNamespace) scope.namespaces.add(a.targetNamespace);
      scope.apps.add(a.appName);
    }
    // A grant on every environment also covers the project's extra mapped namespaces.
    if (grants(u!, p.name).some((g) => !g.environment || g.environment === 'all')) {
      for (const m of p.kubernetesMappings || []) for (const ns of m.namespaces || []) scope.namespaces.add(ns);
    }
    scope.envsByProject.set(p.name, envs);
    for (const r of p.gitLabRepos || []) scope.repoPaths.add(repoPathOf(r.repoUrl));
  }
  return scope;
};

// Highest level a user has on any environment whose namespace is `ns` (0 when none).
export const namespaceLevel = async (u: IUser | undefined | null, ns: string): Promise<Level> => {
  if (isManager(u)) return 3;
  const projects = await Project.find({ $or: [{ 'argoApps.targetNamespace': ns }, { 'kubernetesMappings.namespaces': ns }] });
  let best: Level = 0;
  for (const p of projects) {
    for (const a of p.argoApps || []) if (a.targetNamespace === ns) best = Math.max(best, envLevel(u, p.name, envNameOf(a))) as Level;
    if ((p.kubernetesMappings || []).some((m) => (m.namespaces || []).includes(ns))) {
      const whole = grants(u!, p.name).filter((g) => !g.environment || g.environment === 'all');
      if (whole.length) best = Math.max(best, projectLevel(u, p.name)) as Level;
    }
  }
  return best;
};

// Summary sent to the browser so it can hide what the user cannot use (the API still enforces everything).
export const accessSummary = async (u: IUser) => {
  if (isManager(u)) return { manager: true, superAdmin: isSuperAdmin(u), projects: [] as unknown[] };
  const projects = await Project.find({}, { name: 1, argoApps: 1 });
  return {
    manager: false,
    superAdmin: false,
    projects: projects
      .filter((p) => projectLevel(u, p.name) > 0)
      .map((p) => ({
        id: String(p._id),
        name: p.name,
        level: projectLevel(u, p.name),
        canApprove: canApprove(u, p.name),
        environments: (p.argoApps || []).map((a) => ({ name: envNameOf(a), level: envLevel(u, p.name, envNameOf(a)) })).filter((e) => e.level > 0),
      })),
  };
};
