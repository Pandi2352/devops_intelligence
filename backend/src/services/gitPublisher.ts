import axios, { AxiosInstance } from 'axios';
import { IGitIntegration } from '../models/GitIntegration.js';
import { octokitFor } from './githubClient.js';

// Creates a repository on GitHub or GitLab and pushes a set of files as one commit.
// Never writes into a repository that already has content.

export interface RepoOwner {
  id: string; // GitHub: login; GitLab: namespace id
  name: string; // what people read
  kind: 'user' | 'org' | 'group';
}

export interface PublishFile {
  path: string;
  content: string;
}

export interface PublishInput {
  owner: string; // GitHub login/org; GitLab namespace id ('' = your own)
  name: string;
  description: string;
  visibility: 'private' | 'public' | 'internal';
  branch: string;
  message: string;
  files: PublishFile[];
}

export interface PublishResult {
  url: string;
  fullName: string;
  branch: string;
  commit: string;
  cloneUrl: string;
}

export type Progress = (step: 'create' | 'upload' | 'commit', message: string) => Promise<void> | void;

const gitlab = (g: IGitIntegration): AxiosInstance =>
  axios.create({ baseURL: `${(g.baseUrl || 'https://gitlab.com').replace(/\/+$/, '')}/api/v4`, headers: { 'PRIVATE-TOKEN': g.token }, timeout: 60000 });

// ---------------------------------------------------------------- owners

export const listOwners = async (g: IGitIntegration): Promise<RepoOwner[]> => {
  if (g.provider === 'github') {
    const o = octokitFor(g.token, g.baseUrl);
    const me = await o.rest.users.getAuthenticated();
    const orgs = await o.paginate(o.rest.orgs.listForAuthenticatedUser, { per_page: 100 }).catch(() => []);
    return [{ id: me.data.login, name: `@${me.data.login}`, kind: 'user' }, ...orgs.map((x) => ({ id: x.login, name: x.login, kind: 'org' as const }))];
  }
  const api = gitlab(g);
  const me = (await api.get('/user')).data;
  // Namespaces the user can create projects in: their own + groups with at least Developer access.
  const groups = (await api.get('/groups', { params: { min_access_level: 30, per_page: 100, all_available: false } }).catch(() => ({ data: [] }))).data as any[];
  return [
    { id: String(me.namespace_id || ''), name: `@${me.username}`, kind: 'user' },
    ...groups.map((x) => ({ id: String(x.id), name: x.full_path, kind: 'group' as const })),
  ];
};

// ---------------------------------------------------------------- exists?

export const repoExists = async (g: IGitIntegration, ownerName: string, name: string): Promise<string | null> => {
  if (g.provider === 'github') {
    try {
      const r = await octokitFor(g.token, g.baseUrl).rest.repos.get({ owner: ownerName, repo: name });
      return r.data.html_url;
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }
  try {
    const r = await gitlab(g).get(`/projects/${encodeURIComponent(`${ownerName}/${name}`)}`);
    return r.data.web_url;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
};

// ---------------------------------------------------------------- publish

const publishGithub = async (g: IGitIntegration, me: string, i: PublishInput, progress: Progress): Promise<PublishResult> => {
  const o = octokitFor(g.token, g.baseUrl);
  await progress('create', `Creating ${i.owner}/${i.name} on GitHub`);
  // auto_init gives the repo a first commit: the Git Data API cannot write into an empty repository.
  const params = { name: i.name, description: i.description.slice(0, 350), private: i.visibility !== 'public', auto_init: true };
  const repo = i.owner && i.owner !== me ? (await o.rest.repos.createInOrg({ org: i.owner, ...params, visibility: (i.visibility === 'internal' ? 'internal' : undefined) as any })).data : (await o.rest.repos.createForAuthenticatedUser(params)).data;
  const owner = repo.owner.login;
  const branch = repo.default_branch || 'main';
  let parent = '';
  for (let tries = 0; tries < 10 && !parent; tries++) {
    parent = await o.rest.git
      .getRef({ owner, repo: repo.name, ref: `heads/${branch}` })
      .then((r) => r.data.object.sha)
      .catch(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return '';
      });
  }
  if (!parent) throw new Error('GitHub did not create the initial commit in time; try again');

  await progress('upload', `Uploading ${i.files.length} files`);
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  for (let k = 0; k < i.files.length; k += 8) {
    const batch = i.files.slice(k, k + 8);
    const blobs = await Promise.all(batch.map((f) => o.rest.git.createBlob({ owner, repo: repo.name, content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' })));
    blobs.forEach((b, idx) => tree.push({ path: batch[idx].path, mode: '100644', type: 'blob', sha: b.data.sha }));
    if (k + 8 < i.files.length) await progress('upload', `Uploaded ${Math.min(k + 8, i.files.length)}/${i.files.length} files`);
  }
  await progress('commit', 'Committing');
  // No base_tree: the commit contains exactly the generated files (it replaces GitHub's auto README).
  const t = await o.rest.git.createTree({ owner, repo: repo.name, tree });
  const commit = await o.rest.git.createCommit({ owner, repo: repo.name, message: i.message, tree: t.data.sha, parents: [parent] });
  await o.rest.git.updateRef({ owner, repo: repo.name, ref: `heads/${branch}`, sha: commit.data.sha });
  return { url: repo.html_url, fullName: repo.full_name, branch, commit: commit.data.sha.slice(0, 8), cloneUrl: repo.clone_url };
};

const publishGitlab = async (g: IGitIntegration, i: PublishInput, progress: Progress): Promise<PublishResult> => {
  const api = gitlab(g);
  await progress('create', `Creating ${i.name} on GitLab`);
  const project = (
    await api.post('/projects', {
      name: i.name,
      path: i.name,
      description: i.description.slice(0, 2000),
      visibility: i.visibility,
      initialize_with_readme: false,
      ...(i.owner ? { namespace_id: Number(i.owner) } : {}),
    })
  ).data;
  await progress('upload', `Uploading ${i.files.length} files`);
  await progress('commit', 'Committing');
  // One commit creates the branch in the empty project.
  const commit = (
    await api.post(`/projects/${project.id}/repository/commits`, {
      branch: i.branch || 'main',
      commit_message: i.message,
      actions: i.files.map((f) => ({ action: 'create', file_path: f.path, content: f.content, encoding: 'text' })),
    })
  ).data;
  if ((i.branch || 'main') !== project.default_branch) await api.put(`/projects/${project.id}`, { default_branch: i.branch || 'main' }).catch(() => undefined);
  return { url: project.web_url, fullName: project.path_with_namespace, branch: i.branch || 'main', commit: String(commit.short_id || commit.id || '').slice(0, 8), cloneUrl: project.http_url_to_repo };
};

export const publish = async (g: IGitIntegration, i: PublishInput, progress: Progress = () => undefined): Promise<PublishResult> => {
  if (g.provider === 'github') {
    const me = (await octokitFor(g.token, g.baseUrl).rest.users.getAuthenticated()).data.login;
    return publishGithub(g, me, i, progress);
  }
  return publishGitlab(g, i, progress);
};

export const describeGitError = (err: any, provider: string): string => {
  const status = err?.status || err?.response?.status;
  const data = err?.response?.data;
  const msg = data?.message || (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.message || e).join('; ') : '') || err?.message || '';
  const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
  if (status === 401) return `${provider} rejected the token (401).`;
  if (status === 403) return `${provider} refused (403): ${text}. The token needs permission to create repositories (GitHub: repo scope / Administration write; GitLab: api).`;
  if (status === 404) return `${provider}: not found (404). Check the owner/group and that the token can create repositories there.`;
  if (status === 422 || status === 400) return `${provider} refused the request: ${text.slice(0, 300)}`;
  return `${provider}: ${text.slice(0, 300) || 'request failed'}`;
};
