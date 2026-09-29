import type { NamespaceInfo } from '../api/observabilityApi';
import { DNS_LABEL, ENV_NAME, ENV_ORDER, sortEnvironments } from './project';

// One environment in the New project wizard. The branch is always the environment name
// (branch qa deploys to environment qa); sourceBranch is only used when that branch does not exist yet.
export interface EnvRow {
  key: string;
  name: string;
  custom: boolean;
  sourceBranch: string;
  namespace: string;
  autoSync: boolean;
}

export const STANDARD_ENVS = ['dev', 'qa', 'staging', 'uat', 'prod'];

let seq = 0;
// Namespace defaults to <project>-<env>: reused if it already exists, created otherwise.
export const newEnvRow = (name: string, project: string, sourceBranch: string): EnvRow => ({
  key: `row-${(seq += 1)}`,
  name,
  custom: false,
  sourceBranch,
  namespace: project && name ? `${project}-${name}` : name,
  autoSync: !['prod', 'production'].includes(name),
});

// Environment names to offer: the usual ones, overlays already in the GitOps repo, and branches that look like environments.
export const envNameOptions = (overlayEnvs: string[], branches: string[]): string[] => {
  const skip = new Set(['main', 'master', 'HEAD', 'local']);
  const all = new Set([...STANDARD_ENVS, ...overlayEnvs.filter((e) => !skip.has(e)), ...branches.filter((b) => !skip.has(b) && /^[a-z][a-z0-9-]{0,19}$/.test(b))]);
  return sortEnvironments([...all], (n) => n);
};

export const nextEnvName = (used: string[], options: string[]): string =>
  [...ENV_ORDER, ...options].find((n) => STANDARD_ENVS.includes(n) && !used.includes(n)) || options.find((n) => !used.includes(n)) || '';

// Row-level validation used by the wizard before moving on.
export const validateEnvRows = (rows: EnvRow[], namespaces: NamespaceInfo[], projectName: string): Record<string, string> => {
  const errors: Record<string, string> = {};
  const names = new Map<string, number>();
  const nss = new Map<string, number>();
  rows.forEach((r) => {
    names.set(r.name, (names.get(r.name) || 0) + 1);
    nss.set(r.namespace, (nss.get(r.namespace) || 0) + 1);
  });
  for (const r of rows) {
    if (!ENV_NAME.test(r.name)) errors[`${r.key}.name`] = 'Environment: lowercase letters, numbers or dashes, starting with a letter';
    else if ((names.get(r.name) || 0) > 1) errors[`${r.key}.name`] = `${r.name} is listed twice`;
    const owner = namespaces.find((n) => n.name === r.namespace)?.project;
    if (!DNS_LABEL.test(r.namespace)) errors[`${r.key}.namespace`] = 'Pick a namespace';
    else if ((nss.get(r.namespace) || 0) > 1) errors[`${r.key}.namespace`] = `Namespace ${r.namespace} is used by two environments`;
    else if (owner && owner !== projectName) errors[`${r.key}.namespace`] = `Namespace ${r.namespace} belongs to project ${owner}`;
  }
  return errors;
};
