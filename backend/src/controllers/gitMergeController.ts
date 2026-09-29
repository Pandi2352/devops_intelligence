import axios, { AxiosInstance } from 'axios';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { Project } from '../models/Project.js';
import { findIntegration, resolveProjectId } from './gitController.js';
import { describeRequestError } from '../utils/httpError.js';
import { cleanString } from '../utils/validation.js';
import { repoLevel } from '../services/gitAccess.js';

// Merge one branch into another through a GitLab merge request, then follow the target's pipeline.

const BRANCH = /^[A-Za-z0-9._\/-]{1,200}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

const fail = (res: Response, err: any) => {
  // Our own validation errors carry a status; axios errors do too, but also have a response.
  if (err?.status && !err?.response) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  const data = err?.response?.data;
  const gitlabMessage = Array.isArray(data?.message) ? data.message.join(', ') : typeof data?.message === 'string' ? data.message : data?.error;
  const status = err?.response?.status;
  res.status(status && status < 500 ? status : 502).json({
    message: gitlabMessage && !/^404/.test(gitlabMessage)
      ? `GitLab: ${gitlabMessage}`
      : status === 404
        ? 'Not found in GitLab: the branch or merge request does not exist (or the token cannot see it).'
        : describeRequestError(err, 'GitLab'),
  });
};

const client = async (req: AuthRequest): Promise<{ gl: AxiosInstance; repoPath: string; webUrl: string }> => {
  const integration = await findIntegration(req.params.id);
  if (!integration || integration.provider !== 'gitlab' || !integration.isActive) {
    throw Object.assign(new Error('An active GitLab connector is required'), { status: 400 });
  }
  const base = integration.baseUrl || 'https://gitlab.com';
  const pid = await resolveProjectId(base, integration.token, String(req.params.repoId));
  const gl = axios.create({ baseURL: `${base}/api/v4/projects/${pid}`, headers: { 'PRIVATE-TOKEN': integration.token }, timeout: 20000 });
  const { data } = await gl.get('');
  return { gl, repoPath: data.path_with_namespace, webUrl: data.web_url };
};

const branchParam = (value: unknown, label: string) => {
  const v = cleanString(value, 200);
  if (!BRANCH.test(v)) throw Object.assign(new Error(`Pick a valid ${label} branch`), { status: 400 });
  return v;
};

const pipelineSummary = (p: any) =>
  p ? { id: p.id, status: p.status, ref: p.ref, sha: String(p.sha || '').slice(0, 8), webUrl: p.web_url, createdAt: p.created_at, source: p.source } : null;

// Latest pipeline of the branch itself (GitLab's ref filter also returns merge-request pipelines of MRs from that branch).
const latestPipeline = async (gl: AxiosInstance, ref: string) => {
  const { data } = await gl.get('/pipelines', { params: { ref, per_page: 20, order_by: 'id', sort: 'desc' } });
  return pipelineSummary((data || []).find((p: any) => p.ref === ref && p.source !== 'merge_request_event'));
};

const mrSummary = (m: any) => ({
  iid: m.iid,
  title: m.title,
  source: m.source_branch,
  target: m.target_branch,
  author: m.author?.name || m.author?.username || '',
  createdAt: m.created_at,
  webUrl: m.web_url,
  state: m.state,
  status: m.detailed_merge_status || m.merge_status || '',
  hasConflicts: Boolean(m.has_conflicts),
  draft: Boolean(m.draft || m.work_in_progress),
  pipeline: pipelineSummary(m.head_pipeline || m.pipeline),
  mergeCommitSha: String(m.merge_commit_sha || m.squash_commit_sha || '').slice(0, 8),
});

// Plain-language reason a merge request cannot be merged right now.
const BLOCKED: Record<string, string> = {
  conflict: 'The branches have conflicting changes. Resolve them in GitLab, or merge the target into the source branch first.',
  broken_status: 'The source branch cannot be merged cleanly (conflicts). Resolve them in GitLab first.',
  need_rebase: 'This project only allows fast-forward merges and the target has moved on. Rebase the source branch first (Rebase button).',
  ci_must_pass: 'The pipeline of the source branch must succeed first. Use "Merge when pipeline succeeds".',
  ci_still_running: 'The source pipeline is still running. Use "Merge when pipeline succeeds" or wait.',
  not_approved: 'The merge request needs approval in GitLab first.',
  discussions_not_resolved: 'Open review threads must be resolved first.',
  draft_status: 'The merge request is a draft. Mark it ready in GitLab first.',
  not_open: 'The merge request is already merged or closed.',
  blocked_status: 'Another merge request blocks this one.',
  requested_changes: 'A reviewer requested changes.',
  jira_association_missing: 'A linked issue is required.',
};

// Which project environment a branch deploys (branch-per-environment), for the warning in the UI.
const deploysTo = async (repoPath: string, branch: string) => {
  const projects = await Project.find({ 'argoApps.branch': branch }, { name: 1, gitLabRepos: 1, argoApps: 1 });
  for (const p of projects) {
    const repoMatch = p.gitLabRepos.some((r) => r.role !== 'gitops' && r.repoUrl.replace(/\.git$/, '').toLowerCase().endsWith(`/${repoPath.toLowerCase()}`));
    const app = p.argoApps.find((a) => a.branch === branch);
    if (repoMatch && app) return { project: p.name, projectId: String(p._id), environment: app.environment || branch, namespace: app.targetNamespace };
  }
  return null;
};

// Merge request details for the approval gate (target branch decides the environment).
export const mergeRequestInfo = async (req: AuthRequest, iid: number) => {
  const { gl, repoPath } = await client(req);
  const { data } = await gl.get(`/merge_requests/${iid}`);
  return { repoPath, title: data.title as string, source: data.source_branch as string, target: data.target_branch as string, webUrl: data.web_url as string, sha: String(data.sha || '').slice(0, 8) };
};

// ---------------------------------------------------------------- read

export const compareBranches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const source = branchParam(req.query.source, 'source');
    const target = branchParam(req.query.target, 'target');
    if (source === target) throw Object.assign(new Error('Source and target must be different branches'), { status: 400 });
    const { gl, repoPath, webUrl } = await client(req);
    const [ahead, behind, open, targetBranch, pipeline, deploy] = await Promise.all([
      gl.get('/repository/compare', { params: { from: target, to: source, straight: false } }),
      gl.get('/repository/compare', { params: { from: source, to: target, straight: false } }),
      gl.get('/merge_requests', { params: { state: 'opened', source_branch: source, target_branch: target } }),
      gl.get(`/repository/branches/${enc(target)}`),
      latestPipeline(gl, target),
      deploysTo(repoPath, target),
    ]);
    const commits = (ahead.data.commits || []) as any[];
    res.json({
      source,
      target,
      ahead: commits.length,
      behind: (behind.data.commits || []).length,
      fastForward: (behind.data.commits || []).length === 0,
      filesChanged: (ahead.data.diffs || []).length,
      commits: commits
        .slice(-50)
        .reverse()
        .map((c) => ({ sha: c.id, shortId: c.short_id, title: c.title, author: c.author_name, date: c.created_at, webUrl: `${webUrl}/-/commit/${c.id}` })),
      files: (ahead.data.diffs || []).slice(0, 100).map((d: any) => ({ path: d.new_path, status: d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified' })),
      compareUrl: `${webUrl}/-/compare/${enc(target)}...${enc(source)}`,
      openMergeRequest: open.data?.[0] ? mrSummary(open.data[0]) : null,
      targetProtected: Boolean(targetBranch.data.protected),
      targetPipeline: pipeline,
      deploysTo: deploy,
    });
  } catch (err) {
    fail(res, err);
  }
};

export const listMergeRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gl } = await client(req);
    const state = ['opened', 'merged', 'closed', 'all'].includes(String(req.query.state)) ? String(req.query.state) : 'opened';
    const { data } = await gl.get('/merge_requests', { params: { state, per_page: 30, order_by: 'updated_at' } });
    res.json({ mergeRequests: (data || []).map(mrSummary) });
  } catch (err) {
    fail(res, err);
  }
};

export const branchPipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ref = branchParam(req.query.ref, 'target');
    const { gl } = await client(req);
    res.json({ pipeline: await latestPipeline(gl, ref) });
  } catch (err) {
    fail(res, err);
  }
};

// ---------------------------------------------------------------- write

export const createMergeRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const source = branchParam(req.body?.source, 'source');
    const target = branchParam(req.body?.target, 'target');
    if (source === target) throw Object.assign(new Error('Source and target must be different branches'), { status: 400 });
    const { gl } = await client(req);
    const existing = await gl.get('/merge_requests', { params: { state: 'opened', source_branch: source, target_branch: target } });
    if (existing.data?.[0]) {
      res.json({ existed: true, message: `Merge request !${existing.data[0].iid} is already open`, mergeRequest: mrSummary(existing.data[0]) });
      return;
    }
    const actor = req.user?.email || req.user?.name || 'DevOps Intelligence';
    const { data } = await gl.post('/merge_requests', {
      source_branch: source,
      target_branch: target,
      title: cleanString(req.body?.title, 250) || `Merge ${source} into ${target}`,
      description: `${cleanString(req.body?.description, 2000)}\n\nOpened from DevOps Intelligence by ${actor}.`.trim(),
      remove_source_branch: Boolean(req.body?.removeSourceBranch),
      squash: Boolean(req.body?.squash),
    });
    res.status(201).json({ existed: false, message: `Opened merge request !${data.iid}`, mergeRequest: mrSummary(data) });
  } catch (err) {
    fail(res, err);
  }
};

export const mergeMergeRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const iid = Number(req.params.iid);
    if (!Number.isInteger(iid) || iid < 1) throw Object.assign(new Error('Invalid merge request'), { status: 400 });
    const { gl } = await client(req);
    const whenPipelineSucceeds = Boolean(req.body?.whenPipelineSucceeds);

    // GitLab computes mergeability asynchronously right after the MR is created or updated.
    let mr: any;
    for (let i = 0; i < 12; i += 1) {
      mr = (await gl.get(`/merge_requests/${iid}`, { params: { with_merge_status_recheck: i === 0 } })).data;
      const status = mr.detailed_merge_status || mr.merge_status;
      if (!['checking', 'unchecked', 'preparing', 'approvals_syncing', 'cannot_be_merged_recheck'].includes(status)) break;
      await sleep(1500);
    }
    if ((await repoLevel(req, String(req.params.id), String(req.params.repoId), mr.target_branch)) < 2) {
      res.status(403).json({ message: `You need build and deploy access on ${mr.target_branch} to merge into it.` });
      return;
    }
    const status = mr.detailed_merge_status || mr.merge_status;
    const pipelineRunning = ['running', 'pending', 'created', 'waiting_for_resource', 'preparing'].includes(mr.head_pipeline?.status);
    const autoMerge = whenPipelineSucceeds && (pipelineRunning || status === 'ci_still_running' || status === 'ci_must_pass');
    if (status !== 'mergeable' && !autoMerge) {
      res.status(409).json({ message: BLOCKED[status] || `GitLab says this merge request cannot be merged yet (${status}).`, status, mergeRequest: mrSummary(mr) });
      return;
    }

    const startedAt = Date.now();
    const { data } = await gl.put(`/merge_requests/${iid}/merge`, {
      squash: req.body?.squash === undefined ? undefined : Boolean(req.body.squash),
      should_remove_source_branch: req.body?.removeSourceBranch === undefined ? undefined : Boolean(req.body.removeSourceBranch),
      ...(autoMerge ? { merge_when_pipeline_succeeds: true, auto_merge: true } : {}),
    });
    if (autoMerge) {
      res.json({ merged: false, scheduled: true, message: `!${iid} merges automatically when its pipeline succeeds`, mergeRequest: mrSummary(data) });
      return;
    }

    // The merge pushes to the target branch, which usually starts its pipeline a moment later.
    let pipeline = null;
    for (let i = 0; i < 6; i += 1) {
      pipeline = await latestPipeline(gl, data.target_branch);
      if (pipeline && new Date(pipeline.createdAt).getTime() >= startedAt - 5000) break;
      pipeline = null;
      await sleep(1500);
    }
    res.json({
      merged: true,
      message: `Merged !${iid}: ${data.source_branch} → ${data.target_branch}`,
      mergeRequest: mrSummary(data),
      targetPipeline: pipeline,
      targetPipelineStarted: Boolean(pipeline),
    });
  } catch (err) {
    fail(res, err);
  }
};

export const rebaseMergeRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gl } = await client(req);
    await gl.put(`/merge_requests/${Number(req.params.iid)}/rebase`);
    res.json({ message: 'Rebase started. Try merging again in a few seconds.' });
  } catch (err) {
    fail(res, err);
  }
};

export const closeMergeRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gl } = await client(req);
    const { data } = await gl.put(`/merge_requests/${Number(req.params.iid)}`, { state_event: 'close' });
    res.json({ message: `Closed !${data.iid}`, mergeRequest: mrSummary(data) });
  } catch (err) {
    fail(res, err);
  }
};
