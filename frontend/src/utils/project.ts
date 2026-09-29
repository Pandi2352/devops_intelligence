// Same order as the backend's ENV_ORDER (controllers/environmentController.ts).
export const ENV_ORDER = ['local', 'dev', 'development', 'qa', 'test', 'staging', 'uat', 'preprod', 'prod', 'production'];

const rank = (name: string) => {
  const i = ENV_ORDER.indexOf(name);
  return i === -1 ? ENV_ORDER.length : i;
};

export const sortEnvironments = <T>(items: T[], name: (item: T) => string): T[] =>
  [...items].sort((a, b) => rank(name(a)) - rank(name(b)) || name(a).localeCompare(name(b)));

// https://gitlab.com/group/repo.git -> group/repo
export const repoLabel = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  } catch {
    return url;
  }
};

export const repoWebUrl = (url: string): string => url.replace(/\.git$/, '');

export const ENV_NAME = /^[a-z][a-z0-9-]{0,19}$/;
export const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
