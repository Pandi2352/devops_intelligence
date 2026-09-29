import axios from 'axios';
import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { GitIntegration } from '../models/GitIntegration.js';
import { Project } from '../models/Project.js';
import { isValidId } from '../utils/validation.js';
import { LEVEL_NAME, Level, envLevel, envNameOf, isManager, projectLevel, repoPathOf } from './access.js';

// Access to a GitLab repository follows the projects that use it:
//  - view: the user can see a project that maps the repo
//  - on a branch that is an environment branch: the level on that environment
//  - on any other branch (feature branches): the best level the user has on any environment of that project

const pathCache = new Map<string, { path: string; at: number }>();

export const repoPath = async (connectorId: string, repoId: string): Promise<string | null> => {
  const key = `${connectorId}/${repoId}`;
  const hit = pathCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.path;
  if (!/^\d+$/.test(repoId)) return repoId.toLowerCase(); // already group/repo
  const integration = isValidId(connectorId) ? await GitIntegration.findById(connectorId) : null;
  if (!integration) return null;
  try {
    const { data } = await axios.get(`${integration.baseUrl || 'https://gitlab.com'}/api/v4/projects/${repoId}`, {
      headers: { 'PRIVATE-TOKEN': integration.token },
      timeout: 15000,
    });
    const path = String(data.path_with_namespace).toLowerCase();
    pathCache.set(key, { path, at: Date.now() });
    return path;
  } catch {
    return null;
  }
};

// Level of a user on a repo, optionally for one branch.
export const repoLevel = async (req: AuthRequest, connectorId: string, repoId: string, ref?: string): Promise<Level> => {
  if (isManager(req.user)) return 3;
  const path = await repoPath(connectorId, repoId);
  if (!path) return 0;
  const projects = (await Project.find()).filter((p) => (p.gitLabRepos || []).some((r) => repoPathOf(r.repoUrl) === path));
  let best: Level = 0;
  for (const p of projects) {
    if (projectLevel(req.user, p.name) < 1) continue;
    const app = ref ? (p.argoApps || []).find((a) => (a.branch || a.environment) === ref) : undefined;
    const isAppRepo = (p.gitLabRepos || []).some((r) => repoPathOf(r.repoUrl) === path && r.role !== 'gitops');
    let lv: Level;
    if (app && isAppRepo) lv = envLevel(req.user, p.name, envNameOf(app));
    else if (ref) lv = (p.argoApps || []).reduce<Level>((m, a) => Math.max(m, envLevel(req.user, p.name, envNameOf(a))) as Level, 1);
    else lv = Math.max(1, ...(p.argoApps || []).map((a) => envLevel(req.user, p.name, envNameOf(a)))) as Level;
    best = Math.max(best, lv) as Level;
  }
  return best;
};

// Route guard: /git/:id/repos/:repoId/... with an optional branch taken from the request.
export const requireRepo = (needed: Level, refOf?: (req: AuthRequest) => string | undefined) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (isManager(req.user)) return next();
    const ref = refOf?.(req);
    const level = await repoLevel(req, String(req.params.id), String(req.params.repoId), ref || undefined);
    if (level < needed) {
      res.status(403).json({
        message: `You need ${LEVEL_NAME[needed]} access${ref ? ` on branch ${ref}` : ''} of a project that uses this repository. Ask a DevOps admin in Authorization → User Permissions.`,
      });
      return;
    }
    next();
  };
};
