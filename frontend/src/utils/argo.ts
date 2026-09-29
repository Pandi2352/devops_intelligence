// "https://gitlab.com/group/repo.git" → "group/repo"
export const repoShortName = (url: string) => {
  try {
    return new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  } catch {
    return url;
  }
};

// Web link to a commit in the source repo (GitLab and GitHub URL styles).
export const commitUrl = (repoURL: string, sha: string) => {
  if (!repoURL || !sha) return '';
  const base = repoURL.replace(/\.git$/, '');
  return base.includes('github.com') ? `${base}/commit/${sha}` : `${base}/-/commit/${sha}`;
};

export const clusterLabel = (server: string, name: string) =>
  name || (server === 'https://kubernetes.default.svc' ? 'in-cluster' : server.replace(/^https?:\/\//, ''));
