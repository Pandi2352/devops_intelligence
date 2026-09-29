import { randomBytes } from 'node:crypto';
import * as k8s from '@kubernetes/client-node';
import { IProject } from '../models/Project.js';
import { ISonarIntegration } from '../models/SonarIntegration.js';
import { resolveClients } from '../controllers/clusterController.js';
import { pickConnector, repoPathFromUrl } from '../controllers/environmentController.js';
import { envNameOf } from './access.js';
import { requiresApproval } from './approvals.js';
import { defaultSonar, describeSonarError, projectQuality, sonarHostForJobs, SonarQuality } from './sonarClient.js';
import { ImageReport, namespaceReports, sumReports } from './trivyService.js';

export const SCANNER_IMAGE = process.env.SONAR_SCANNER_IMAGE || 'sonarsource/sonar-scanner-cli:latest';
export const GIT_IMAGE = process.env.GIT_IMAGE || 'alpine/git:latest';

const clusterOf = (p: IProject) => p.kubernetesMappings?.[0]?.clusterName || 'minikube';

// SonarQube keys: letters, digits, '-', '_', '.', ':'; must not be only digits.
export const sonarKeyOf = (p: IProject) =>
  p.security?.sonarProjectKey || p.name.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || `project-${String(p._id).slice(-6)}`;

export const sonarFor = async (p: IProject) => defaultSonar(p.security?.sonarConnectorId || undefined);

export const appRepoOf = (p: IProject) => {
  const repos = p.gitLabRepos || [];
  return repos.find((r) => r.role === 'app') || repos.find((r) => r.role !== 'gitops') || null;
};

// ---------------------------------------------------------------- summaries

export const qualityOf = async (p: IProject): Promise<{ connector: ISonarIntegration | null; quality: SonarQuality | null; error: string }> => {
  const connector = await sonarFor(p);
  if (!connector) return { connector: null, quality: null, error: '' };
  try {
    return { connector, quality: await projectQuality(connector, sonarKeyOf(p)), error: '' };
  } catch (err) {
    return { connector, quality: null, error: describeSonarError(err) };
  }
};

export const envReports = async (p: IProject, env: string): Promise<{ reports: ImageReport[]; error: string }> => {
  const app = (p.argoApps || []).find((a) => envNameOf(a) === env);
  if (!app) return { reports: [], error: `No environment ${env}` };
  try {
    return { reports: await namespaceReports(clusterOf(p), app.targetNamespace), error: '' };
  } catch (err: any) {
    return { reports: [], error: err?.message || 'Could not read vulnerability reports' };
  }
};

// ---------------------------------------------------------------- release checks

export interface ReleaseCheck {
  key: 'quality-gate' | 'vulnerabilities';
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'unknown';
  detail: string;
  blocking: boolean; // fails and the project's policy blocks on it
}

// What approvers (and the promote button) see before code moves into `to`. The image checked is the one
// running in `from` (the one being promoted).
export const releaseChecks = async (p: IProject, to: string, from?: string): Promise<{ checks: ReleaseCheck[]; blocked: boolean; gated: boolean }> => {
  const policy = p.security || ({} as NonNullable<IProject['security']>);
  const gated = requiresApproval(p, to);
  const checks: ReleaseCheck[] = [];

  const { connector, quality, error } = await qualityOf(p);
  if (!connector) checks.push({ key: 'quality-gate', label: 'SonarQube quality gate', status: 'unknown', detail: 'No SonarQube connector', blocking: false });
  else if (error) checks.push({ key: 'quality-gate', label: 'SonarQube quality gate', status: 'unknown', detail: error, blocking: false });
  else if (!quality?.found) checks.push({ key: 'quality-gate', label: 'SonarQube quality gate', status: 'warn', detail: `${sonarKeyOf(p)} was never analysed`, blocking: false });
  else {
    const failed = quality.gate.status === 'ERROR';
    const failing = quality.gate.conditions.filter((c) => c.status === 'ERROR').map((c) => `${c.metric} ${c.actual} (limit ${c.threshold})`);
    checks.push({
      key: 'quality-gate',
      label: 'SonarQube quality gate',
      status: failed ? 'fail' : quality.gate.status === 'OK' ? 'pass' : 'warn',
      detail: failed ? `Failed: ${failing.join(', ') || 'see SonarQube'}` : `${quality.gate.status === 'OK' ? 'Passed' : quality.gate.status}${quality.lastAnalysis ? ` · analysed ${quality.lastAnalysis.date.slice(0, 10)}` : ''}`,
      blocking: failed && Boolean(policy.blockOnQualityGate),
    });
  }

  const source = from || to;
  const { reports, error: repErr } = await envReports(p, source);
  if (repErr) checks.push({ key: 'vulnerabilities', label: 'Image vulnerabilities (Trivy)', status: 'unknown', detail: repErr, blocking: false });
  else if (!reports.length) checks.push({ key: 'vulnerabilities', label: 'Image vulnerabilities (Trivy)', status: 'unknown', detail: `No scan of ${source} yet (Trivy Operator not installed or still scanning)`, blocking: false });
  else {
    const t = sumReports(reports);
    const images = [...new Set(reports.map((r) => r.image))].join(', ');
    checks.push({
      key: 'vulnerabilities',
      label: 'Image vulnerabilities (Trivy)',
      status: t.critical ? 'fail' : t.high ? 'warn' : 'pass',
      detail: `${t.critical} critical, ${t.high} high, ${t.medium} medium in ${images}`,
      blocking: t.critical > 0 && Boolean(policy.blockOnCritical),
    });
  }
  return { checks, blocked: gated && checks.some((c) => c.blocking), gated };
};

// ---------------------------------------------------------------- analysis job

const label = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

// Runs sonar-scanner as a Job in the SonarQube connector's cluster: clone the app repo, scan, send to SonarQube.
// The Git and SonarQube tokens go into a Secret owned by the Job, so both are deleted together.
export const startAnalysis = async (p: IProject, startedBy: string) => {
  const connector = await sonarFor(p);
  if (!connector) throw Object.assign(new Error('No SonarQube connector. A DevOps admin adds one in Connectors → Security.'), { status: 400 });
  if (connector.access !== 'service') throw Object.assign(new Error('Analyses run inside the cluster: use a SonarQube connector reached "through cluster".'), { status: 400 });
  const repo = appRepoOf(p);
  if (!repo) throw Object.assign(new Error(`${p.name} has no application repository`), { status: 400 });
  const git = await pickConnector(repo.repoUrl);
  if (!git) throw Object.assign(new Error('No GitLab connector for the application repository'), { status: 400 });

  const url = new URL(repo.repoUrl.replace(/\.git$/, '') + '.git');
  const cloneUrl = `${url.protocol}//oauth2:${encodeURIComponent(git.token)}@${url.host}${url.pathname}`;
  const branch = repo.branch || 'main';
  const key = sonarKeyOf(p);
  const name = `di-sonar-${label(p.name)}-${randomBytes(3).toString('hex')}`;
  const namespace = connector.namespace;
  const { core, kc } = await resolveClients(connector.clusterName);
  const batch = kc.makeApiClient(k8s.BatchV1Api);
  const labels = { 'app.kubernetes.io/managed-by': 'devops-intelligence', 'devops-intelligence/analysis': label(p.name) };

  const job = await batch.createNamespacedJob({
    namespace,
    body: {
      metadata: { name, labels },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: 1200,
        ttlSecondsAfterFinished: 3600,
        template: {
          metadata: { labels },
          spec: {
            restartPolicy: 'Never',
            securityContext: { runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
            volumes: [{ name: 'work', emptyDir: {} }],
            initContainers: [
              {
                name: 'clone',
                image: GIT_IMAGE,
                command: ['sh', '-c', 'git clone --depth 50 --branch "$BRANCH" "$GIT_URL" /work/src && cd /work/src && git log -1 --format="Cloned %h %s"'],
                env: [
                  { name: 'BRANCH', value: branch },
                  { name: 'HOME', value: '/work' },
                  { name: 'GIT_URL', valueFrom: { secretKeyRef: { name, key: 'git-url' } } },
                ],
                volumeMounts: [{ name: 'work', mountPath: '/work' }],
                securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
              },
            ],
            containers: [
              {
                name: 'scanner',
                image: SCANNER_IMAGE,
                workingDir: '/work/src',
                env: [
                  { name: 'SONAR_HOST_URL', value: sonarHostForJobs(connector) },
                  { name: 'SONAR_TOKEN', valueFrom: { secretKeyRef: { name, key: 'sonar-token' } } },
                  { name: 'SONAR_USER_HOME', value: '/work/.sonar' },
                  {
                    name: 'SONAR_SCANNER_OPTS',
                    value: [
                      `-Dsonar.projectKey=${key}`,
                      `-Dsonar.projectName=${p.name}`,
                      '-Dsonar.sources=.',
                      '-Dsonar.exclusions=**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/*.min.js',
                      '-Dsonar.qualitygate.wait=false',
                      ...(connector.organization ? [`-Dsonar.organization=${connector.organization}`] : []),
                    ].join(' '),
                  },
                ],
                volumeMounts: [{ name: 'work', mountPath: '/work' }],
                resources: { requests: { cpu: '200m', memory: '512Mi' }, limits: { memory: '2Gi' } },
                securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
              },
            ],
          },
        },
      },
    },
  });
  try {
    await core.createNamespacedSecret({
      namespace,
      body: {
        metadata: {
          name,
          labels,
          ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name, uid: job.metadata!.uid!, blockOwnerDeletion: false }],
        },
        type: 'Opaque',
        stringData: { 'git-url': cloneUrl, 'sonar-token': connector.token },
      },
    });
  } catch (err) {
    await batch.deleteNamespacedJob({ name, namespace, propagationPolicy: 'Background' }).catch(() => undefined);
    throw err;
  }
  return { job: name, namespace, clusterName: connector.clusterName, projectKey: key, branch, repo: repoPathFromUrl(repo.repoUrl), startedAt: new Date(), startedBy };
};

// Job state and the tail of its logs (clone + scanner).
export const analysisStatus = async (clusterName: string, namespace: string, job: string) => {
  const { core, kc } = await resolveClients(clusterName);
  const batch = kc.makeApiClient(k8s.BatchV1Api);
  const j = await batch.readNamespacedJob({ name: job, namespace }).catch((e: any) => (e?.code === 404 ? null : Promise.reject(e)));
  if (!j) return { state: 'gone' as const, log: '', reason: 'The job was cleaned up (jobs are kept for an hour)' };
  const pods = await core.listNamespacedPod({ namespace, labelSelector: `job-name=${job}` });
  const pod = pods.items[0];
  const waiting = [...(pod?.status?.initContainerStatuses || []), ...(pod?.status?.containerStatuses || [])].find((c) => c.state?.waiting && c.state.waiting.reason !== 'PodInitializing')?.state?.waiting;
  const state = j.status?.succeeded ? 'succeeded' : j.status?.failed ? 'failed' : 'running';
  const tail = async (container: string) =>
    pod ? String(await core.readNamespacedPodLog({ name: pod.metadata!.name!, namespace, container, tailLines: 40 }).catch(() => '')) : '';
  const log = [await tail('clone'), await tail('scanner')].filter(Boolean).join('\n');
  return { state, log: log.replace(/oauth2:[^@\s]+@/g, 'oauth2:***@'), reason: waiting ? `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ''}` : '' };
};
