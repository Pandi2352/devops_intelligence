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

// How each environment state looks and reads everywhere (projects list, project page).
export const ENV_STATE_META: Record<string, { label: string; dot: string; chip: string; ring: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', ring: 'border-emerald-200' },
  deploying: { label: 'Deploying', dot: 'bg-sky-500 animate-pulse', chip: 'bg-sky-50 text-sky-800 border-sky-200', ring: 'border-sky-200' },
  waiting: { label: 'Waiting', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-900 border-amber-200', ring: 'border-amber-300' },
  failing: { label: 'Failing', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-800 border-rose-200', ring: 'border-rose-300' },
  missing: { label: 'Not set up', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 border-slate-200', ring: 'border-slate-200' },
  unknown: { label: 'Unknown', dot: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600 border-slate-200', ring: 'border-slate-200' },
};
