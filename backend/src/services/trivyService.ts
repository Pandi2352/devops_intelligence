import { resolveClients } from '../controllers/clusterController.js';
import { kubeRequest } from '../utils/kubeRaw.js';

// Trivy Operator writes one VulnerabilityReport per workload container (aquasecurity.github.io/v1alpha1).
const GROUP = '/apis/aquasecurity.github.io/v1alpha1';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface ImageReport {
  name: string; // report name
  namespace: string;
  workloadKind: string;
  workload: string;
  container: string;
  image: string; // registry/repository:tag
  tag: string;
  digest: string;
  os: string;
  scannedAt: string;
  scanner: string;
  counts: SeverityCounts;
  fixable: number; // vulnerabilities with a fixed version
}

export interface Vulnerability {
  id: string;
  severity: Severity;
  score: number | null;
  package: string;
  installed: string;
  fixed: string;
  title: string;
  link: string;
  target: string;
}

export const emptyCounts = (): SeverityCounts => ({ critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });
export const addCounts = (a: SeverityCounts, b: SeverityCounts): SeverityCounts => ({
  critical: a.critical + b.critical,
  high: a.high + b.high,
  medium: a.medium + b.medium,
  low: a.low + b.low,
  unknown: a.unknown + b.unknown,
});

const toReport = (r: any): ImageReport => {
  const labels = r.metadata?.labels || {};
  const art = r.report?.artifact || {};
  const server = r.report?.registry?.server || '';
  const s = r.report?.summary || {};
  const repo = art.repository || '';
  const image = `${server && server !== 'index.docker.io' ? `${server}/` : ''}${repo}${art.tag ? `:${art.tag}` : ''}`;
  return {
    name: r.metadata?.name || '',
    namespace: r.metadata?.namespace || '',
    workloadKind: labels['trivy-operator.resource.kind'] || '',
    workload: labels['trivy-operator.resource.name'] || '',
    container: labels['trivy-operator.container.name'] || '',
    image,
    tag: art.tag || '',
    digest: art.digest || '',
    os: [r.report?.os?.family, r.report?.os?.name].filter(Boolean).join(' '),
    scannedAt: r.report?.updateTimestamp || r.metadata?.creationTimestamp || '',
    scanner: [r.report?.scanner?.name, r.report?.scanner?.version].filter(Boolean).join(' '),
    counts: { critical: s.criticalCount || 0, high: s.highCount || 0, medium: s.mediumCount || 0, low: s.lowCount || 0, unknown: s.unknownCount || 0 },
    fixable: (r.report?.vulnerabilities || []).filter((v: any) => v.fixedVersion).length,
  };
};

const isNotFound = (e: any) => e?.response?.status === 404;

// Is the operator installed on this cluster (CRD present), and is its Deployment ready?
export const trivyStatus = async (clusterName: string) => {
  const { kc, apps } = await resolveClients(clusterName);
  try {
    await kubeRequest(kc, '/apis/apiextensions.k8s.io/v1/customresourcedefinitions/vulnerabilityreports.aquasecurity.github.io');
  } catch (err) {
    if (isNotFound(err)) return { installed: false, ready: false, version: '', reports: 0, namespace: '' };
    throw err;
  }
  const deps = await apps.listDeploymentForAllNamespaces({ labelSelector: 'app.kubernetes.io/name=trivy-operator' }).catch(() => null);
  const dep = deps?.items?.[0];
  const list: any = await kubeRequest(kc, `${GROUP}/vulnerabilityreports`, { query: { limit: 500 } }).catch(() => ({ items: [] }));
  return {
    installed: true,
    ready: Boolean(dep && (dep.status?.readyReplicas || 0) > 0),
    version: dep?.metadata?.labels?.['app.kubernetes.io/version'] || '',
    namespace: dep?.metadata?.namespace || '',
    reports: (list.items || []).length,
  };
};

// Reports of one namespace (the workloads of an environment). Empty when the operator is missing.
export const namespaceReports = async (clusterName: string, namespace: string): Promise<ImageReport[]> => {
  const { kc } = await resolveClients(clusterName);
  try {
    const list: any = await kubeRequest(kc, `${GROUP}/namespaces/${encodeURIComponent(namespace)}/vulnerabilityreports`);
    return (list.items || []).map(toReport);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
};

export const reportVulnerabilities = async (clusterName: string, namespace: string, name: string): Promise<{ report: ImageReport; vulnerabilities: Vulnerability[] }> => {
  const { kc } = await resolveClients(clusterName);
  const r: any = await kubeRequest(kc, `${GROUP}/namespaces/${encodeURIComponent(namespace)}/vulnerabilityreports/${encodeURIComponent(name)}`);
  const order = (s: string) => SEVERITIES.indexOf(s as Severity);
  const vulnerabilities: Vulnerability[] = (r.report?.vulnerabilities || [])
    .map((v: any) => ({
      id: v.vulnerabilityID,
      severity: (v.severity || 'UNKNOWN') as Severity,
      score: typeof v.score === 'number' ? v.score : null,
      package: v.resource || '',
      installed: v.installedVersion || '',
      fixed: v.fixedVersion || '',
      title: v.title || '',
      link: v.primaryLink || (v.links || [])[0] || '',
      target: v.target || '',
    }))
    .sort((a: Vulnerability, b: Vulnerability) => order(a.severity) - order(b.severity) || (b.score ?? 0) - (a.score ?? 0));
  return { report: toReport(r), vulnerabilities };
};

export const sumReports = (reports: ImageReport[]) => reports.reduce((acc, r) => addCounts(acc, r.counts), emptyCounts());
