import api from './client';
import { ConnectionTestResult } from '../types';

// ---------------------------------------------------------------- SonarQube connectors (DevOps admins)

export interface SonarConnector {
  _id: string;
  name: string;
  access: 'service' | 'url';
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  url: string;
  publicUrl: string;
  organization: string;
  hasToken: boolean;
  tokenHint: string;
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Error' | 'Unknown';
  version: string;
  lastError: string;
  lastTestedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SonarConnectorInput {
  name: string;
  access: 'service' | 'url';
  clusterName?: string;
  namespace?: string;
  service?: string;
  port?: number;
  url?: string;
  publicUrl?: string;
  token?: string; // blank on edit = keep
  organization?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface DiscoveredSonar {
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  suggestedName: string;
  alreadyAdded: boolean;
}

export interface TrivyClusterStatus {
  cluster: string;
  installed: boolean;
  ready: boolean;
  version: string;
  namespace: string;
  reports: number;
  error: string;
}

// ---------------------------------------------------------------- project security

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface ImageReport {
  name: string;
  namespace: string;
  workloadKind: string;
  workload: string;
  container: string;
  image: string;
  tag: string;
  digest: string;
  os: string;
  scannedAt: string;
  scanner: string;
  counts: SeverityCounts;
  fixable: number;
}

export interface Vulnerability {
  id: string; // CVE-2024-…
  severity: Severity;
  score: number | null;
  package: string;
  installed: string;
  fixed: string; // empty = no fix yet
  title: string;
  link: string;
  target: string;
}

export interface SonarQuality {
  projectKey: string;
  projectName: string;
  found: boolean; // false = never analysed
  gate: { status: 'OK' | 'ERROR' | 'WARN' | 'NONE'; conditions: { metric: string; status: string; actual: string; threshold: string; comparator: string }[] };
  /** bugs, vulnerabilities, security_hotspots, code_smells, coverage, duplicated_lines_density, ncloc … */
  measures: Record<string, string>;
  /** reliability_rating, security_rating, sqale_rating (maintainability), security_review_rating → A–E */
  ratings: Record<string, string>;
  lastAnalysis: { date: string; revision: string } | null;
  dashboardUrl: string;
}

export interface ReleaseCheck {
  key: 'quality-gate' | 'vulnerabilities';
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'unknown';
  detail: string;
  blocking: boolean;
}

export interface AnalysisInfo {
  job: string;
  namespace: string;
  clusterName: string;
  projectKey: string;
  branch: string;
  repo?: string;
  startedAt: string;
  startedBy: string;
  /** From GET /security/analysis only. */
  state?: 'running' | 'succeeded' | 'failed' | 'gone' | 'unknown';
  log?: string;
  reason?: string;
  /** SonarQube background tasks still processing the report. */
  pending?: number;
}

export interface ProjectSecurity {
  project: string;
  policy: { sonarConnectorId: string; sonarProjectKey: string; blockOnQualityGate: boolean; blockOnCritical: boolean };
  projectKey: string; // effective key
  sonar: {
    connector: { id: string; name: string; access: 'service' | 'url'; publicUrl: string } | null;
    quality: SonarQuality | null;
    error: string;
    pending: number;
  };
  lastAnalysis: AnalysisInfo | null;
  environments: { env: string; namespace: string; reports: ImageReport[]; totals: SeverityCounts; error: string; requiresApproval: boolean }[];
  /** For each gated environment: checks against the environment before it. */
  release: { env: string; from?: string; checks: ReleaseCheck[]; blocked: boolean; gated: boolean }[];
  canConfigure: boolean; // project admin
  canAnalyze: boolean; // build and deploy
  connectors: { id: string; name: string; isDefault: boolean }[];
}

export interface SecurityPolicyInput {
  sonarConnectorId?: string;
  sonarProjectKey?: string;
  blockOnQualityGate?: boolean;
  blockOnCritical?: boolean;
}

export const securityApi = {
  // connectors
  sonarConnectors: async (): Promise<SonarConnector[]> => (await api.get('/security/sonar/connectors')).data.connectors,
  createSonar: async (data: SonarConnectorInput): Promise<{ message: string; connector: SonarConnector; test: ConnectionTestResult }> => (await api.post('/security/sonar/connectors', data)).data,
  updateSonar: async (id: string, data: SonarConnectorInput): Promise<{ message: string; connector: SonarConnector; test: ConnectionTestResult }> => (await api.put(`/security/sonar/connectors/${id}`, data)).data,
  setDefaultSonar: async (id: string): Promise<SonarConnector> => (await api.put(`/security/sonar/connectors/${id}/default`)).data.connector,
  removeSonar: async (id: string, force = false): Promise<void> => {
    await api.delete(`/security/sonar/connectors/${id}`, { params: force ? { force: 'true' } : {} });
  },
  testSonar: async (data: Partial<SonarConnectorInput> & { id?: string }): Promise<ConnectionTestResult> => (await api.post('/security/sonar/connectors/test', data)).data,
  testSavedSonar: async (id: string): Promise<ConnectionTestResult & { connector: SonarConnector }> => (await api.post(`/security/sonar/connectors/${id}/test`)).data,
  discoverSonar: async (cluster?: string): Promise<{ cluster: string; services: DiscoveredSonar[] }> => (await api.get('/security/sonar/connectors/discover', { params: cluster ? { cluster } : {} })).data,
  trivy: async (): Promise<TrivyClusterStatus[]> => (await api.get('/security/trivy')).data.clusters,

  // project
  project: async (projectId: string): Promise<ProjectSecurity> => (await api.get(`/projects/${projectId}/security`)).data,
  setPolicy: async (projectId: string, data: SecurityPolicyInput): Promise<{ message: string }> => (await api.put(`/projects/${projectId}/security`, data)).data,
  runAnalysis: async (projectId: string): Promise<{ message: string; analysis: AnalysisInfo }> => (await api.post(`/projects/${projectId}/security/analysis`)).data,
  analysis: async (projectId: string): Promise<AnalysisInfo | null> => (await api.get(`/projects/${projectId}/security/analysis`)).data.analysis,
  vulnerabilities: async (projectId: string, env: string, report: string): Promise<{ report: ImageReport; vulnerabilities: Vulnerability[] }> =>
    (await api.get(`/projects/${projectId}/environments/${encodeURIComponent(env)}/vulnerabilities/${encodeURIComponent(report)}`)).data,
};

export const sonarStatus = (c: SonarConnector) => (c.isActive ? c.status : 'Disabled');
