import { Request, Response } from 'express';
import { Project, IProject, IGitRepoMapping } from '../models/Project.js';
import { cleanString, isHttpUrl, isValidId } from '../utils/validation.js';
import { AuthRequest } from '../middleware/auth.js';
import { projectLevel } from '../services/access.js';

export const getProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projects = (await Project.find().sort({ createdAt: -1 })).filter((p) => projectLevel(req.user, p.name) >= 1);
    res.json({ projects, total: projects.length });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch projects', error: err.message });
  }
};

export const getProjectById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const project = isValidId(id) ? await Project.findById(id) : null;
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    res.json({ project });
  } catch (err: any) {
    res.status(500).json({ message: 'Error retrieving project', error: err.message });
  }
};

const PROJECT_NAME = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

const repoFromUrl = (url: string, role: 'app' | 'gitops', branch = 'main'): IGitRepoMapping | null => {
  if (!isHttpUrl(url)) return null;
  const name = new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/').pop() || url;
  return { name, repoUrl: url.trim(), branch, provider: url.includes('github.com') ? 'github' : 'gitlab', role };
};

// Structured input from the DevOps Intelligence Projects page: one app repo, one GitOps repo, one cluster.
const applyStructuredInput = (project: IProject, body: any): string | null => {
  const repos = [...(project.gitLabRepos || [])];
  for (const role of ['app', 'gitops'] as const) {
    const key = role === 'app' ? 'appRepoUrl' : 'gitopsRepoUrl';
    if (body[key] === undefined) continue;
    const others = repos.filter((r) => r.role !== role);
    if (!body[key]) {
      repos.splice(0, repos.length, ...others);
      continue;
    }
    const repo = repoFromUrl(String(body[key]), role, role === 'app' ? cleanString(body.appDefaultBranch, 100) || 'main' : 'main');
    if (!repo) return `${role === 'app' ? 'Application' : 'GitOps'} repository must be a valid http(s) URL`;
    repos.splice(0, repos.length, ...others, repo);
  }
  project.gitLabRepos = repos;

  if (body.clusterName !== undefined) {
    const clusterName = cleanString(body.clusterName, 63);
    const current = project.kubernetesMappings?.[0];
    project.kubernetesMappings = [{ clusterName, namespaces: current?.namespaces || [] }];
  }

  if (body.gitopsPath !== undefined) {
    // A relative folder inside the GitOps repo; no absolute paths or ../ escapes.
    const path = cleanString(body.gitopsPath, 200).replace(/^\/+|\/+$/g, '');
    if (path && (!/^[A-Za-z0-9._\/-]+$/.test(path) || path.split('/').includes('..'))) return 'GitOps folder must be a relative path like k8s/overlays';
    project.gitopsPath = path;
  }
  return null;
};

export const createProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, gitLabRepos, kubernetesMappings, argoApps } = req.body;
    const cleanName = cleanString(name, 50).toLowerCase().replace(/\s+/g, '-');
    if (!PROJECT_NAME.test(cleanName)) {
      res.status(400).json({ message: 'Project name must be 1-50 lowercase letters, numbers or dashes' });
      return;
    }
    if (await Project.exists({ name: cleanName })) {
      res.status(409).json({ message: `Project '${cleanName}' already exists` });
      return;
    }

    const project = new Project({
      name: cleanName,
      description: cleanString(description, 500),
      gitLabRepos: gitLabRepos || [],
      kubernetesMappings: kubernetesMappings || [],
      argoApps: argoApps || [],
      active: true,
    });
    const inputError = applyStructuredInput(project, req.body);
    if (inputError) {
      res.status(400).json({ message: inputError });
      return;
    }

    await project.save();
    res.status(201).json({ message: `Project '${cleanName}' created`, project });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to create project', error: err.message });
  }
};

export const updateProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { description, gitLabRepos, kubernetesMappings, argoApps, active } = req.body;

    const project = isValidId(id) ? await Project.findById(id) : null;
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    if (req.body.name && cleanString(req.body.name, 50) !== project.name) {
      res.status(400).json({ message: 'Project names cannot be changed' });
      return;
    }

    if (description !== undefined) project.description = cleanString(description, 500);
    if (gitLabRepos) project.gitLabRepos = gitLabRepos;
    if (kubernetesMappings) project.kubernetesMappings = kubernetesMappings;
    if (argoApps) project.argoApps = argoApps;
    if (typeof active === 'boolean') project.active = active;
    const inputError = applyStructuredInput(project, req.body);
    if (inputError) {
      res.status(400).json({ message: inputError });
      return;
    }

    await project.save();
    res.json({ message: `Project '${project.name}' updated`, project });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update project', error: err.message });
  }
};

export const deleteProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = isValidId(id) ? await Project.findByIdAndDelete(id) : null;
    if (!deleted) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    res.json({ message: `Project ${deleted.name} deleted successfully` });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to delete project', error: err.message });
  }
};
