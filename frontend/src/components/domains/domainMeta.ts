import { EnvDnsState, Reachability } from '../../api/dnsApi';

export const DNS_STATE_META: Record<EnvDnsState, { label: string; chip: string; dot: string }> = {
  ok: { label: 'Live', chip: 'bg-emerald-50 border-emerald-200 text-emerald-800', dot: 'bg-emerald-500' },
  missing: { label: 'No record', chip: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500' },
  mismatch: { label: 'Points elsewhere', chip: 'bg-rose-50 border-rose-200 text-rose-800', dot: 'bg-rose-500' },
  'needs-target': { label: 'Needs a target', chip: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500' },
  error: { label: 'Error', chip: 'bg-rose-50 border-rose-200 text-rose-800', dot: 'bg-rose-500' },
  'not-configured': { label: 'No hostname', chip: 'bg-slate-50 border-slate-200 text-slate-700', dot: 'bg-slate-400' },
};

export const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;

// One DNS label: lowercase letters, digits and dashes, no leading or trailing dash.
export const dnsLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');

// demo-api + dev → demo-api-dev; production uses the project name alone.
export const suggestSubdomain = (projectName: string, env: string) =>
  /^(prod|production)$/i.test(env) ? dnsLabel(projectName) : dnsLabel(`${projectName}-${env}`);

export const reachText = (r: Reachability | null) => {
  if (!r) return '';
  if (r.status) return `HTTP ${r.status} · ${r.ms} ms${r.error ? ` · ${r.error}` : ''}`;
  return r.error || 'Not reachable';
};
