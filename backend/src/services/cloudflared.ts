import * as k8s from '@kubernetes/client-node';
import { resolveClients } from '../controllers/clusterController.js';

// Runs cloudflared inside a cluster: one Deployment per named tunnel (namespace "cloudflared") and,
// for previews, a quick tunnel (trycloudflare.com) in an environment namespace.

export const CLOUDFLARED_IMAGE = process.env.CLOUDFLARED_IMAGE || 'cloudflare/cloudflared:2024.12.2';
export const PREVIEW_NAME = 'di-preview';
const TUNNEL_NAME = 'cloudflared';
const TOKEN_SECRET = 'cloudflared-token';
const MANAGED = { 'app.kubernetes.io/managed-by': 'devops-intelligence' };

const isNotFound = (e: any) => e?.code === 404 || e?.statusCode === 404 || e?.response?.statusCode === 404 || e?.response?.status === 404;
const ignore404 = <T>(p: Promise<T>) => p.catch((e) => (isNotFound(e) ? null : Promise.reject(e)));

const hardened = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ['ALL'] },
  runAsNonRoot: true,
  runAsUser: 65532,
};

const deploymentSpec = (name: string, labels: Record<string, string>, container: k8s.V1Container, replicas = 1): k8s.V1Deployment => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name, labels: { ...labels, ...MANAGED } },
  spec: {
    replicas,
    selector: { matchLabels: labels },
    template: {
      metadata: { labels: { ...labels, ...MANAGED } },
      spec: { securityContext: { seccompProfile: { type: 'RuntimeDefault' } }, containers: [container] },
    },
  },
});

// Create or replace, so re-running is safe.
const applyDeployment = async (apps: k8s.AppsV1Api, namespace: string, body: k8s.V1Deployment) => {
  const name = body.metadata!.name!;
  const existing = await ignore404(apps.readNamespacedDeployment({ name, namespace }));
  if (existing) await apps.replaceNamespacedDeployment({ name, namespace, body: { ...body, metadata: { ...body.metadata, resourceVersion: existing.metadata?.resourceVersion } } });
  else await apps.createNamespacedDeployment({ namespace, body });
};

const ensureNamespace = async (core: k8s.CoreV1Api, name: string) => {
  if (await ignore404(core.readNamespace({ name }))) return;
  await core.createNamespace({ body: { metadata: { name, labels: MANAGED } } });
};

const probes = {
  readinessProbe: { httpGet: { path: '/ready', port: 2000 as any }, initialDelaySeconds: 5, periodSeconds: 10 },
  livenessProbe: { httpGet: { path: '/ready', port: 2000 as any }, initialDelaySeconds: 20, periodSeconds: 20, failureThreshold: 3 },
};

const resources = { requests: { cpu: '10m', memory: '32Mi' }, limits: { memory: '128Mi' } };

// ---------------------------------------------------------------- named tunnel

export const deployTunnelConnector = async (clusterName: string, namespace: string, token: string, replicas = 1) => {
  const { core, apps } = await resolveClients(clusterName);
  await ensureNamespace(core, namespace);
  const secret = { metadata: { name: TOKEN_SECRET, labels: MANAGED }, type: 'Opaque', stringData: { token } };
  if (await ignore404(core.readNamespacedSecret({ name: TOKEN_SECRET, namespace }))) await core.replaceNamespacedSecret({ name: TOKEN_SECRET, namespace, body: secret });
  else await core.createNamespacedSecret({ namespace, body: secret });

  const labels = { 'app.kubernetes.io/name': TUNNEL_NAME };
  await applyDeployment(
    apps,
    namespace,
    deploymentSpec(
      TUNNEL_NAME,
      labels,
      {
        name: 'cloudflared',
        image: CLOUDFLARED_IMAGE,
        args: ['tunnel', '--no-autoupdate', '--metrics', '0.0.0.0:2000', 'run'],
        env: [{ name: 'TUNNEL_TOKEN', valueFrom: { secretKeyRef: { name: TOKEN_SECRET, key: 'token' } } }],
        securityContext: hardened,
        resources,
        ...probes,
      },
      Math.min(Math.max(replicas, 1), 3)
    )
  );
};

export const removeTunnelConnector = async (clusterName: string, namespace: string) => {
  const { core, apps } = await resolveClients(clusterName);
  await ignore404(apps.deleteNamespacedDeployment({ name: TUNNEL_NAME, namespace }));
  await ignore404(core.deleteNamespacedSecret({ name: TOKEN_SECRET, namespace }));
};

export const connectorPods = async (clusterName: string, namespace: string, name = TUNNEL_NAME) => {
  const { core } = await resolveClients(clusterName);
  const list = await core.listNamespacedPod({ namespace, labelSelector: `app.kubernetes.io/name=${name}` });
  return list.items.map((p) => ({
    name: p.metadata?.name || '',
    phase: p.status?.phase || '',
    ready: Boolean(p.status?.containerStatuses?.every((c) => c.ready)),
    restarts: p.status?.containerStatuses?.reduce((n, c) => n + (c.restartCount || 0), 0) || 0,
    reason: p.status?.containerStatuses?.find((c) => c.state?.waiting)?.state?.waiting?.reason || '',
  }));
};

// ---------------------------------------------------------------- environment service / ingress

// The Service an environment is reached through: the named one, else the first with a port (prefers a port named http).
export const environmentService = async (clusterName: string, namespace: string, wanted = '', wantedPort = 0) => {
  const { core } = await resolveClients(clusterName);
  const list = await core.listNamespacedService({ namespace });
  const candidates = list.items.filter((s) => s.spec?.clusterIP !== 'None' && (s.spec?.ports || []).length && s.metadata?.name !== PREVIEW_NAME);
  const svc = wanted ? candidates.find((s) => s.metadata?.name === wanted) : candidates[0];
  if (!svc) return null;
  const ports = svc.spec?.ports || [];
  const port = wantedPort || (ports.find((p) => p.name === 'http') || ports[0]).port;
  return { name: svc.metadata!.name!, port, url: `http://${svc.metadata!.name}.${namespace}.svc.cluster.local:${port}` };
};

// Address an Ingress for this hostname publishes (LoadBalancer IP or hostname), if any.
export const ingressAddress = async (clusterName: string, namespace: string, hostname: string) => {
  const { kc } = await resolveClients(clusterName);
  const net = kc.makeApiClient(k8s.NetworkingV1Api);
  const list = await net.listNamespacedIngress({ namespace });
  const ing = list.items.find((i) => (i.spec?.rules || []).some((r) => r.host === hostname)) || null;
  const lb = ing?.status?.loadBalancer?.ingress?.[0];
  return { ingress: ing?.metadata?.name || '', address: lb?.ip || lb?.hostname || '' };
};

// ---------------------------------------------------------------- quick tunnel preview

export const startPreview = async (clusterName: string, namespace: string, serviceUrl: string) => {
  const { apps } = await resolveClients(clusterName);
  const labels = { 'app.kubernetes.io/name': PREVIEW_NAME };
  await applyDeployment(
    apps,
    namespace,
    deploymentSpec(PREVIEW_NAME, labels, {
      name: 'cloudflared',
      image: CLOUDFLARED_IMAGE,
      args: ['tunnel', '--no-autoupdate', '--metrics', '0.0.0.0:2000', '--url', serviceUrl],
      securityContext: hardened,
      resources,
      readinessProbe: probes.readinessProbe,
    })
  );
};

export const stopPreview = async (clusterName: string, namespace: string) => {
  const { apps } = await resolveClients(clusterName);
  return Boolean(await ignore404(apps.deleteNamespacedDeployment({ name: PREVIEW_NAME, namespace })));
};

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

// Whether the preview Deployment exists, and the URL cloudflared printed (it is random per start).
export const previewState = async (clusterName: string, namespace: string) => {
  const { core, apps } = await resolveClients(clusterName);
  const dep = await ignore404(apps.readNamespacedDeployment({ name: PREVIEW_NAME, namespace }));
  if (!dep) return { running: false, url: '', ready: false, reason: '' };
  const pods = await core.listNamespacedPod({ namespace, labelSelector: `app.kubernetes.io/name=${PREVIEW_NAME}` });
  const pod = pods.items.find((p) => !p.metadata?.deletionTimestamp) || pods.items[0];
  let url = '';
  if (pod?.status?.phase === 'Running') {
    const log = await core.readNamespacedPodLog({ name: pod.metadata!.name!, namespace, container: 'cloudflared', tailLines: 400 }).catch(() => '');
    url = String(log).match(QUICK_URL)?.[0] || '';
  }
  return {
    running: true,
    url,
    ready: Boolean(pod?.status?.containerStatuses?.every((c) => c.ready)),
    reason: pod?.status?.containerStatuses?.find((c) => c.state?.waiting)?.state?.waiting?.reason || pod?.status?.phase || 'Pending',
  };
};

// Namespaces of a cluster where a preview Deployment exists (one call, instead of one per environment).
export const previewNamespaces = async (clusterName: string) => {
  const { apps } = await resolveClients(clusterName);
  const list = await apps.listDeploymentForAllNamespaces({ labelSelector: `app.kubernetes.io/name=${PREVIEW_NAME}` });
  return new Set(list.items.map((d) => d.metadata?.namespace || ''));
};
