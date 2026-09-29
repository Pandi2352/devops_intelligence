import { Octokit } from '@octokit/rest';

// GitHub.com or GitHub Enterprise Server (API under <host>/api/v3).
export const githubApiBase = (baseUrl?: string) => {
  const url = (baseUrl || '').replace(/\/+$/, '');
  return url && url !== 'https://github.com' ? `${url}/api/v3` : 'https://api.github.com';
};

export const octokitFor = (token: string, baseUrl?: string) => new Octokit({ auth: token, baseUrl: githubApiBase(baseUrl), request: { timeout: 15000 } });

export interface GithubTokenInfo {
  login: string;
  name: string;
  /** Classic tokens list their scopes; fine-grained tokens and GitHub Apps do not (null). */
  scopes: string[] | null;
  tokenType: 'classic' | 'fine-grained' | 'unknown';
  orgs: string[];
  rateLimit: { remaining: number; limit: number } | null;
  /** What the future Project Starter needs: create repositories and push code (incl. CI workflow files). */
  canCreateRepos: boolean | null;
  canPushWorkflows: boolean | null;
}

// Who the token belongs to and what it may do. Read-only calls.
export const githubTokenInfo = async (token: string, baseUrl?: string): Promise<GithubTokenInfo> => {
  const octokit = octokitFor(token, baseUrl);
  const me = await octokit.request('GET /user');
  const header = me.headers['x-oauth-scopes'];
  const scopes = typeof header === 'string' ? header.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const tokenType = token.startsWith('github_pat_') ? 'fine-grained' : token.startsWith('ghp_') || scopes ? 'classic' : 'unknown';
  const orgs = await octokit
    .paginate(octokit.rest.orgs.listForAuthenticatedUser, { per_page: 100 })
    .then((list) => list.map((o) => o.login))
    .catch(() => [] as string[]);
  const remaining = Number(me.headers['x-ratelimit-remaining']);
  const limit = Number(me.headers['x-ratelimit-limit']);
  return {
    login: me.data.login,
    name: me.data.name || '',
    scopes,
    tokenType,
    orgs,
    rateLimit: Number.isFinite(remaining) && Number.isFinite(limit) ? { remaining, limit } : null,
    canCreateRepos: scopes ? scopes.includes('repo') || scopes.includes('public_repo') : null,
    canPushWorkflows: scopes ? scopes.includes('workflow') : null,
  };
};

// One line for the connector test result.
export const describeGithubToken = (i: GithubTokenInfo) => {
  const who = `Authenticated as @${i.login}${i.name ? ` (${i.name})` : ''}`;
  const orgs = i.orgs.length ? ` · orgs: ${i.orgs.slice(0, 5).join(', ')}${i.orgs.length > 5 ? '…' : ''}` : '';
  if (i.scopes) {
    const missing = [!i.canCreateRepos && 'repo', !i.canPushWorkflows && 'workflow'].filter(Boolean);
    return `${who} · classic token, scopes: ${i.scopes.join(', ') || 'none'}${orgs}${missing.length ? ` · add ${missing.join(' + ')} to create repos and push CI workflows` : ''}`;
  }
  return `${who} · fine-grained token${orgs} (needs Contents, Administration and Workflows: read & write to create and push repos)`;
};

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  ownerType: string; // User / Organization
  private: boolean;
  visibility: string; // public / private / internal
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  description: string;
  language: string;
  topics: string[];
  archived: boolean;
  fork: boolean;
  isTemplate: boolean;
  openIssues: number;
  starCount: number;
  forksCount: number;
  sizeKb: number;
  permission: 'admin' | 'maintain' | 'push' | 'triage' | 'pull' | '';
  lastActivityAt: string;
  updatedAt: string;
  createdAt: string;
}

const permissionOf = (p?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean }): GithubRepo['permission'] =>
  p?.admin ? 'admin' : p?.maintain ? 'maintain' : p?.push ? 'push' : p?.triage ? 'triage' : p?.pull ? 'pull' : '';

// Every repository the token can see (own, collaborator, organisation member), newest activity first.
export const listGithubRepos = async (token: string, baseUrl?: string, max = 1000): Promise<GithubRepo[]> => {
  const octokit = octokitFor(token, baseUrl);
  const repos: GithubRepo[] = [];
  for await (const page of octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'pushed',
    affiliation: 'owner,collaborator,organization_member',
  })) {
    for (const r of page.data) {
      repos.push({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login || '',
        ownerType: r.owner?.type || '',
        private: r.private,
        visibility: r.visibility || (r.private ? 'private' : 'public'),
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url || '',
        sshUrl: r.ssh_url || '',
        defaultBranch: r.default_branch || 'main',
        description: r.description || '',
        language: r.language || '',
        topics: r.topics || [],
        archived: Boolean(r.archived),
        fork: Boolean(r.fork),
        isTemplate: Boolean(r.is_template),
        openIssues: r.open_issues_count || 0,
        starCount: r.stargazers_count || 0,
        forksCount: r.forks_count || 0,
        sizeKb: r.size || 0,
        permission: permissionOf(r.permissions),
        lastActivityAt: r.pushed_at || r.updated_at || '',
        updatedAt: r.updated_at || '',
        createdAt: r.created_at || '',
      });
    }
    if (repos.length >= max) break;
  }
  return repos.slice(0, max);
};
