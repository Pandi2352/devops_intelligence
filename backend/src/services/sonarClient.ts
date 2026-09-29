import axios from 'axios';
import { ISonarIntegration, SonarIntegration } from '../models/SonarIntegration.js';
import { closeForward, forwardedBaseUrl } from '../utils/kubePortForward.js';

export type SonarFields = Pick<ISonarIntegration, 'access' | 'clusterName' | 'namespace' | 'service' | 'port' | 'url' | 'token' | 'organization'>;
type Query = Record<string, string | number | boolean | undefined>;

// SonarQube accepts a token as the Basic-auth user name (works on every version and on SonarCloud).
const auth = (c: SonarFields): Record<string, string> => (c.token ? { Authorization: `Basic ${Buffer.from(`${c.token}:`).toString("base64")}` } : {});

export const sonarRequest = async <T = any>(c: SonarFields, path: string, query: Query = {}, method: 'GET' | 'POST' = 'GET', timeoutMs = 20000): Promise<T> => {
  let base: string;
  if (c.access === 'service') {
    if (!c.clusterName || !c.namespace || !c.service || !c.port) throw new Error('Cluster, namespace, service and port are required');
    // A port-forward, not the API server's service proxy: the proxy drops the Authorization header.
    base = await forwardedBaseUrl(c.clusterName, c.namespace, c.service, c.port);
  } else {
    if (!c.url) throw new Error('URL is required');
    base = c.url.replace(/\/+$/, '');
  }
  try {
    const res = await axios.request<T>({ method, url: `${base}${path}`, params: query, headers: auth(c), timeout: timeoutMs });
    return res.data;
  } catch (err: any) {
    // A dead forward (pod restarted): drop it so the next call opens a fresh one.
    if (c.access === 'service' && !err?.response) await closeForward(c.clusterName, c.namespace, c.service, c.port);
    throw err;
  }
};

// Where an analysis Job inside the cluster sends its report.
export const sonarHostForJobs = (c: SonarFields) =>
  c.access === 'service' ? `http://${c.service}.${c.namespace}.svc.cluster.local:${c.port}` : c.url.replace(/\/+$/, '');

export const describeSonarError = (err: any): string => {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const detail = Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg).join('; ') : typeof data === 'string' ? data.slice(0, 200) : '';
  if (status === 401) return 'SonarQube rejected the token (401). Create a user token under My Account → Security.';
  if (status === 403) return `SonarQube denied access (403)${detail ? `: ${detail}` : ''}. The token needs Browse (and Execute Analysis to run analyses).`;
  if (status === 404) return detail || 'Not found in SonarQube (404)';
  if (status === 503) return 'SonarQube is starting up (503). Try again in a minute.';
  if (status) return `SonarQube responded with HTTP ${status}${detail ? `: ${detail}` : ''}`;
  return err?.message || 'SonarQube is not reachable';
};

// Server up → token valid → version. Nothing is changed.
export const probeSonar = async (c: SonarFields): Promise<{ version: string; message: string }> => {
  const status: any = await sonarRequest(c, '/api/system/status');
  if (status?.status && status.status !== 'UP') throw new Error(`SonarQube is ${status.status} (starting or migrating). Try again in a minute.`);
  const valid: any = await sonarRequest(c, '/api/authentication/validate');
  if (!valid?.valid) throw new Error('SonarQube does not accept this token. Create a user token under My Account → Security.');
  const version = String(status?.version || (await sonarRequest(c, '/api/server/version').catch(() => '')) || 'unknown').trim();
  const projects: any = await sonarRequest(c, '/api/projects/search', { ps: 1, ...(c.organization ? { organization: c.organization } : {}) }).catch(() => null);
  const count = projects?.paging?.total;
  return { version, message: `SonarQube ${version} · token valid${typeof count === 'number' ? ` · ${count} project${count === 1 ? '' : 's'}` : ''}` };
};

export const defaultSonar = async (id?: string) => {
  if (id) {
    const c = await SonarIntegration.findOne({ _id: id, isActive: true }).catch(() => null);
    if (c) return c;
  }
  return (await SonarIntegration.findOne({ isActive: true, isDefault: true })) || SonarIntegration.findOne({ isActive: true }).sort({ createdAt: 1 });
};

// ---------------------------------------------------------------- project quality

const METRICS = [
  'alert_status',
  'bugs',
  'vulnerabilities',
  'security_hotspots',
  'code_smells',
  'coverage',
  'duplicated_lines_density',
  'ncloc',
  'reliability_rating',
  'security_rating',
  'sqale_rating',
  'security_review_rating',
];

const RATING = ['', 'A', 'B', 'C', 'D', 'E'];

export interface SonarQuality {
  projectKey: string;
  projectName: string;
  found: boolean;
  gate: { status: 'OK' | 'ERROR' | 'WARN' | 'NONE'; conditions: { metric: string; status: string; actual: string; threshold: string; comparator: string }[] };
  measures: Record<string, string>;
  ratings: Record<string, string>;
  lastAnalysis: { date: string; revision: string } | null;
  dashboardUrl: string;
}

export const projectQuality = async (c: ISonarIntegration, projectKey: string): Promise<SonarQuality> => {
  const base = c.publicUrl || (c.access === 'url' ? c.url : '');
  const empty: SonarQuality = {
    projectKey,
    projectName: projectKey,
    found: false,
    gate: { status: 'NONE', conditions: [] },
    measures: {},
    ratings: {},
    lastAnalysis: null,
    dashboardUrl: base ? `${base.replace(/\/+$/, '')}/dashboard?id=${encodeURIComponent(projectKey)}` : '',
  };
  const comp: any = await sonarRequest(c, '/api/measures/component', { component: projectKey, metricKeys: METRICS.join(',') }).catch((err) => {
    if (err?.response?.status === 404) return null;
    throw err;
  });
  if (!comp) return empty;
  const measures: Record<string, string> = {};
  for (const m of comp.component?.measures || []) measures[m.metric] = String(m.value ?? m.period?.value ?? '');
  const ratings: Record<string, string> = {};
  for (const k of ['reliability_rating', 'security_rating', 'sqale_rating', 'security_review_rating']) if (measures[k]) ratings[k] = RATING[Math.round(Number(measures[k]))] || measures[k];

  const [gate, analyses]: any[] = await Promise.all([
    sonarRequest(c, '/api/qualitygates/project_status', { projectKey }).catch(() => null),
    sonarRequest(c, '/api/project_analyses/search', { project: projectKey, ps: 1 }).catch(() => null),
  ]);
  const a = analyses?.analyses?.[0];
  return {
    ...empty,
    projectName: comp.component?.name || projectKey,
    found: true,
    gate: {
      status: gate?.projectStatus?.status || 'NONE',
      conditions: (gate?.projectStatus?.conditions || []).map((x: any) => ({ metric: x.metricKey, status: x.status, actual: String(x.actualValue ?? ''), threshold: String(x.errorThreshold ?? ''), comparator: x.comparator || '' })),
    },
    measures,
    ratings,
    lastAnalysis: a ? { date: a.date, revision: String(a.revision || '').slice(0, 8) } : null,
  };
};

// Pending/in-progress background tasks for a project (analysis reports being processed).
export const pendingTasks = async (c: ISonarIntegration, projectKey: string): Promise<number> => {
  const r: any = await sonarRequest(c, '/api/ce/component', { component: projectKey }).catch(() => null);
  return (r?.queue || []).length;
};
