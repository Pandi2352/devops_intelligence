import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { k8sManager, ClusterConnectionSpec } from '../config/k8s.js';
import { Cluster, ICluster, ClusterAuthType, ClusterType } from '../models/Cluster.js';
import { Project } from '../models/Project.js';
import { maskSecret } from '../utils/secrets.js';
import { describeRequestError } from '../utils/httpError.js';
import { cleanString, isHttpUrl, isValidId, normalizeUrl } from '../utils/validation.js';

const CLUSTER_TYPES: ClusterType[] = ['minikube', 'local', 'eks', 'gke', 'aks', 'baremetal'];
const AUTH_TYPES: ClusterAuthType[] = ['context', 'kubeconfig', 'token'];
const CLUSTER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

// Never send kubeconfig or token contents back to the browser.
export const serializeCluster = (c: ICluster) => ({
  _id: c._id,
  name: c.name,
  description: c.description || '',
  contextName: c.contextName,
  type: c.type,
  authType: c.authType || 'context',
  source: c.source || 'manual',
  serverUrl: c.serverUrl,
  version: c.version,
  nodeCount: c.nodeCount,
  status: c.status,
  isDefault: c.isDefault,
  namespaces: c.namespaces,
  lastSyncedAt: c.lastSyncedAt,
  lastTestedAt: c.lastTestedAt,
  lastError: c.lastError || '',
  insecureSkipTLSVerify: c.insecureSkipTLSVerify,
  hasKubeconfig: Boolean(c.kubeconfig),
  tokenHint: maskSecret(c.token),
  hasCaData: Boolean(c.caData),
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const specFromCluster = (c: ICluster): ClusterConnectionSpec => ({
  name: c.name,
  authType: c.authType || (c.kubeconfig ? 'kubeconfig' : c.token && c.serverUrl ? 'token' : 'context'),
  contextName: c.contextName,
  kubeconfig: c.kubeconfig,
  serverUrl: c.serverUrl,
  token: c.token,
  caData: c.caData,
  insecureSkipTLSVerify: c.insecureSkipTLSVerify,
});

// Resolves API clients for a cluster by name. Unknown names fall back to a local kubeconfig context.
export const resolveClients = async (clusterName: string) => {
  const cluster = await Cluster.findOne({ name: clusterName });
  const spec: ClusterConnectionSpec = cluster
    ? specFromCluster(cluster)
    : { name: clusterName, authType: 'context', contextName: clusterName };
  return { cluster, ...k8sManager.getClients(spec) };
};

// Runs a probe and records the outcome on the document (does not save).
const applyProbe = async (cluster: ICluster) => {
  cluster.lastTestedAt = new Date();
  try {
    const result = await k8sManager.probe(specFromCluster(cluster));
    cluster.status = 'Healthy';
    cluster.lastError = '';
    cluster.version = result.version;
    if (result.nodeCount !== null) cluster.nodeCount = result.nodeCount;
    cluster.namespaces = result.namespaces;
    if (result.serverUrl) cluster.serverUrl = result.serverUrl;
    if (!cluster.contextName && result.contextName) cluster.contextName = result.contextName;
    cluster.lastSyncedAt = new Date();
    return { ok: true, message: `Connected to ${result.serverUrl || cluster.name} (${result.version})`, details: probeDetails(result) };
  } catch (err) {
    const message = describeRequestError(err, 'Kubernetes API server');
    cluster.status = 'Offline';
    cluster.lastError = message;
    return { ok: false, message };
  }
};

const probeDetails = (result: Awaited<ReturnType<typeof k8sManager.probe>>) => ({
  serverUrl: result.serverUrl,
  context: result.contextName,
  version: result.version,
  nodes: result.nodeCount ?? 'no permission',
  namespaces: result.namespaces.length,
});

interface ClusterInput {
  name: string;
  description: string;
  type: ClusterType;
  authType: ClusterAuthType;
  contextName: string;
  kubeconfig: string;
  serverUrl: string;
  token: string;
  caData: string;
  insecureSkipTLSVerify: boolean;
  isDefault?: boolean;
}

const readInput = (body: any): ClusterInput => ({
  name: cleanString(body.name, 63),
  description: cleanString(body.description, 300),
  type: CLUSTER_TYPES.includes(body.type) ? body.type : 'local',
  authType: AUTH_TYPES.includes(body.authType) ? body.authType : 'context',
  contextName: cleanString(body.contextName, 200),
  kubeconfig: typeof body.kubeconfig === 'string' ? body.kubeconfig.trim() : '',
  serverUrl: typeof body.serverUrl === 'string' && body.serverUrl.trim() ? normalizeUrl(body.serverUrl) : '',
  token: typeof body.token === 'string' ? body.token.trim() : '',
  caData: typeof body.caData === 'string' ? body.caData.trim() : '',
  insecureSkipTLSVerify: Boolean(body.insecureSkipTLSVerify),
  isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
});

// Validates credentials for the selected auth method. `existing` supplies saved secrets on edit.
const validateCredentials = (input: ClusterInput, existing?: ICluster | null): string | null => {
  if (input.authType === 'context') {
    if (!input.contextName) return 'Select a kubeconfig context';
    const exists = k8sManager.getContexts().some((c) => c.name === input.contextName);
    if (!exists) return `Context '${input.contextName}' was not found in the server's local kubeconfig`;
  }
  if (input.authType === 'kubeconfig' && !input.kubeconfig && !existing?.kubeconfig) {
    return 'Paste or upload a kubeconfig file';
  }
  if (input.authType === 'token') {
    if (!isHttpUrl(input.serverUrl)) return 'A valid API server URL (https://…) is required';
    if (!input.token && !existing?.token) return 'A bearer token is required';
  }
  return null;
};

const buildSpec = (input: ClusterInput, existing?: ICluster | null): ClusterConnectionSpec => ({
  name: input.name || existing?.name || 'cluster',
  authType: input.authType,
  contextName: input.contextName,
  kubeconfig: input.kubeconfig || existing?.kubeconfig,
  serverUrl: input.serverUrl,
  token: input.token || existing?.token,
  caData: input.caData || existing?.caData,
  insecureSkipTLSVerify: input.insecureSkipTLSVerify,
});

// Copies connection settings onto the document; blank secrets keep their saved values.
const applyInput = (cluster: ICluster, input: ClusterInput) => {
  cluster.description = input.description;
  cluster.type = input.type;
  cluster.authType = input.authType;
  cluster.insecureSkipTLSVerify = input.insecureSkipTLSVerify;

  if (input.authType === 'context') {
    cluster.contextName = input.contextName;
    cluster.kubeconfig = '';
    cluster.token = '';
    cluster.caData = '';
    const ctx = k8sManager.getContexts().find((c) => c.name === input.contextName);
    if (ctx?.server) cluster.serverUrl = ctx.server;
  } else if (input.authType === 'kubeconfig') {
    if (input.kubeconfig) cluster.kubeconfig = input.kubeconfig;
    cluster.contextName = input.contextName;
    cluster.token = '';
    cluster.caData = '';
  } else {
    cluster.serverUrl = input.serverUrl;
    if (input.token) cluster.token = input.token;
    if (input.caData) cluster.caData = input.caData;
    cluster.kubeconfig = '';
    cluster.contextName = cluster.name;
  }
};

const clearOtherDefaults = (id: unknown) => Cluster.updateMany({ _id: { $ne: id } }, { isDefault: false });

export const getDiscoveredContexts = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({ contexts: k8sManager.getContexts() });
  } catch (err: any) {
    res.status(500).json({ message: 'Error reading kubeconfig contexts', error: err.message });
  }
};

export const seedClustersIfNone = async (): Promise<void> => {
  try {
    const contexts = k8sManager.getContexts();
    for (const ctx of contexts) {
      const isMinikube = ctx.name.toLowerCase().includes('minikube');
      let clusterDoc = await Cluster.findOne({ $or: [{ contextName: ctx.name, authType: 'context' }, { name: ctx.name }] });

      if (!clusterDoc) {
        clusterDoc = new Cluster({
          name: ctx.name,
          contextName: ctx.name,
          type: isMinikube ? 'minikube' : 'local',
          authType: 'context',
          source: 'kubeconfig',
          serverUrl: ctx.server || '',
          status: 'Connecting',
          isDefault: ctx.isCurrent && !(await Cluster.exists({ isDefault: true })),
        });
      }

      // Records saved before `source` existed were all created by this sync.
      if (!clusterDoc.isNew && clusterDoc.$isDefault('source') && clusterDoc.contextName === ctx.name) {
        clusterDoc.source = 'kubeconfig';
      }

      // Only kubeconfig-context clusters are refreshed from the local kubeconfig.
      if ((clusterDoc.authType || 'context') === 'context') {
        await applyProbe(clusterDoc);
      }
      await clusterDoc.save();
    }
    console.log(`[Clusters] Synced ${contexts.length} contexts from Kubeconfig: ${contexts.map((c) => c.name).join(', ')}`);
  } catch (err) {
    console.warn('[Clusters] Could not auto-sync clusters on boot:', err);
  }
};

export const syncClustersFromKubeConfig = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    await seedClustersIfNone();
    const clusters = await Cluster.find().sort({ createdAt: -1 });
    res.json({ message: 'Clusters synchronized with kubeconfig', clusters: clusters.map(serializeCluster) });
  } catch (err: any) {
    res.status(500).json({ message: 'Cluster sync failed', error: err.message });
  }
};

export const getAllClusters = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clusters = await Cluster.find().sort({ createdAt: -1 });
    res.json({ clusters: clusters.map(serializeCluster) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to retrieve clusters', error: err.message });
  }
};

export const createClusterCredential = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = readInput(req.body);
    if (!CLUSTER_NAME_PATTERN.test(input.name)) {
      res.status(400).json({ message: 'Cluster name must be 1-63 characters: letters, numbers, dot, dash or underscore' });
      return;
    }
    if (await Cluster.exists({ name: input.name })) {
      res.status(409).json({ message: `A cluster named '${input.name}' already exists` });
      return;
    }
    const credentialError = validateCredentials(input);
    if (credentialError) {
      res.status(400).json({ message: credentialError });
      return;
    }
    try {
      k8sManager.buildKubeConfig(buildSpec(input));
    } catch (err: any) {
      res.status(400).json({ message: err.message });
      return;
    }

    const cluster = new Cluster({ name: input.name, source: 'manual', status: 'Connecting' });
    applyInput(cluster, input);
    const test = await applyProbe(cluster);

    const isFirst = !(await Cluster.exists({}));
    cluster.isDefault = input.isDefault ?? isFirst;
    await cluster.save();
    if (cluster.isDefault) await clearOtherDefaults(cluster._id);

    res.status(201).json({
      message: test.ok ? `Cluster '${cluster.name}' connected` : `Cluster '${cluster.name}' saved, but the connection test failed`,
      connector: serializeCluster(cluster),
      test,
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to save cluster credential', error: err.message });
  }
};

export const updateCluster = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      res.status(404).json({ message: 'Cluster not found' });
      return;
    }
    const cluster = await Cluster.findById(id);
    if (!cluster) {
      res.status(404).json({ message: 'Cluster not found' });
      return;
    }

    const input = readInput({ ...req.body, name: cluster.name });
    if (req.body.name && cleanString(req.body.name, 63) !== cluster.name) {
      res.status(400).json({ message: 'Cluster name cannot be changed because projects and applications reference it' });
      return;
    }
    const credentialError = validateCredentials(input, cluster);
    if (credentialError) {
      res.status(400).json({ message: credentialError });
      return;
    }
    try {
      k8sManager.buildKubeConfig(buildSpec(input, cluster));
    } catch (err: any) {
      res.status(400).json({ message: err.message });
      return;
    }

    applyInput(cluster, input);
    const test = await applyProbe(cluster);
    if (input.isDefault !== undefined) cluster.isDefault = input.isDefault;
    await cluster.save();
    if (cluster.isDefault) await clearOtherDefaults(cluster._id);

    res.json({ message: `Cluster '${cluster.name}' updated`, connector: serializeCluster(cluster), test });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update cluster', error: err.message });
  }
};

export const setDefaultCluster = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cluster = isValidId(id) ? await Cluster.findById(id) : null;
    if (!cluster) {
      res.status(404).json({ message: 'Cluster not found' });
      return;
    }
    cluster.isDefault = true;
    await cluster.save();
    await clearOtherDefaults(cluster._id);
    res.json({ message: `'${cluster.name}' is now the default cluster`, connector: serializeCluster(cluster) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to set default cluster', error: err.message });
  }
};

// Tests credentials from the form without saving. Pass `id` to reuse secrets already stored.
export const testClusterConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = isValidId(req.body.id) ? await Cluster.findById(req.body.id) : null;
    const input = readInput({ ...req.body, name: req.body.name || existing?.name || 'connection-test' });
    const credentialError = validateCredentials(input, existing);
    if (credentialError) {
      res.status(400).json({ message: credentialError });
      return;
    }
    try {
      const result = await k8sManager.probe(buildSpec(input, existing));
      res.json({ ok: true, message: `Connected to ${result.serverUrl} (${result.version})`, details: probeDetails(result) });
    } catch (err) {
      res.json({ ok: false, message: describeRequestError(err, 'Kubernetes API server') });
    }
  } catch (err: any) {
    res.status(500).json({ message: 'Connection test failed', error: err.message });
  }
};

export const testSavedCluster = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cluster = isValidId(id) ? await Cluster.findById(id) : null;
    if (!cluster) {
      res.status(404).json({ message: 'Cluster not found' });
      return;
    }
    const test = await applyProbe(cluster);
    await cluster.save();
    res.json({ ...test, connector: serializeCluster(cluster) });
  } catch (err: any) {
    res.status(500).json({ message: 'Connection test failed', error: err.message });
  }
};

export const deleteCluster = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cluster = isValidId(id) ? await Cluster.findById(id) : null;
    if (!cluster) {
      res.status(404).json({ message: 'Cluster not found' });
      return;
    }

    if (req.query.force !== 'true') {
      const projects = await Project.find({ 'kubernetesMappings.clusterName': cluster.name }).select('name');
      if (projects.length > 0) {
        res.status(409).json({
          message: `'${cluster.name}' is mapped in ${projects.length} project(s): ${projects.map((p) => p.name).join(', ')}`,
          projects: projects.map((p) => p.name),
        });
        return;
      }
    }

    await cluster.deleteOne();
    if (cluster.isDefault) {
      const next = await Cluster.findOne().sort({ createdAt: 1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
    res.json({ message: `Cluster '${cluster.name}' removed` });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to delete cluster', error: err.message });
  }
};

export const getClusterDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = String(req.params.name);
    const cluster = await Cluster.findOne({ name });
    if (!cluster) {
      res.status(404).json({ message: 'Cluster not found' });
      return;
    }

    let nodes: any[] = [];
    let pods: any[] = [];
    let deployments: any[] = [];

    let clients: ReturnType<typeof k8sManager.getClients> | null = null;
    try {
      clients = k8sManager.getClients(specFromCluster(cluster));
    } catch (err: any) {
      console.warn(`Could not build client for ${name}:`, err.message);
    }

    if (clients) {
      try {
        const nodesRes: any = await clients.core.listNode();
        const nodeList = nodesRes.items || nodesRes.body?.items || [];
        nodes = nodeList.map((node: any) => ({
          name: node.metadata?.name,
          status: node.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
          kubeletVersion: node.status?.nodeInfo?.kubeletVersion,
          osImage: node.status?.nodeInfo?.osImage,
          architecture: node.status?.nodeInfo?.architecture,
          cpu: node.status?.capacity?.cpu,
          memory: node.status?.capacity?.memory,
        }));

        const podsRes: any = await clients.core.listPodForAllNamespaces();
        const podList = podsRes.items || podsRes.body?.items || [];
        pods = podList.map((pod: any) => ({
          name: pod.metadata?.name,
          namespace: pod.metadata?.namespace,
          status: pod.status?.phase,
          podIP: pod.status?.podIP,
          startTime: pod.status?.startTime,
          restartCount: pod.status?.containerStatuses?.[0]?.restartCount || 0,
        }));
      } catch (err: any) {
        console.warn(`Could not query core k8s API for ${name}:`, err.message);
      }

      try {
        const depRes: any = await clients.apps.listDeploymentForAllNamespaces();
        const depList = depRes.items || depRes.body?.items || [];
        deployments = depList.map((dep: any) => ({
          name: dep.metadata?.name,
          namespace: dep.metadata?.namespace,
          replicas: dep.spec?.replicas,
          readyReplicas: dep.status?.readyReplicas || 0,
          strategy: dep.spec?.strategy?.type,
        }));
      } catch (err: any) {
        console.warn(`Could not query apps k8s API for ${name}:`, err.message);
      }
    }

    res.json({ cluster: serializeCluster(cluster), nodes, pods, deployments });
  } catch (err: any) {
    res.status(500).json({ message: 'Error getting cluster details', error: err.message });
  }
};

// Resource Browser: Query live K8s resources by Kind and Namespace
export const getLiveResources = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clusterName = String(req.params.name);
    const kind = String(req.query.kind || 'pod').toLowerCase();
    const namespace = String(req.query.namespace || 'all');

    const { core: coreApi, apps: appsApi } = await resolveClients(clusterName);

    let items: any[] = [];

    if (kind === 'pod') {
      const resp: any = namespace === 'all'
        ? await coreApi.listPodForAllNamespaces()
        : await coreApi.listNamespacedPod({ namespace });
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((p: any) => ({
        name: p.metadata?.name,
        namespace: p.metadata?.namespace,
        ready: `${p.status?.containerStatuses?.filter((c: any) => c.ready).length || 0}/${p.status?.containerStatuses?.length || 1}`,
        status: p.status?.phase?.toUpperCase() || 'UNKNOWN',
        restarts: p.status?.containerStatuses?.reduce((acc: number, c: any) => acc + (c.restartCount || 0), 0) || 0,
        age: p.metadata?.creationTimestamp,
        ip: p.status?.podIP,
        node: p.spec?.nodeName,
      }));
    } else if (kind === 'deployment') {
      const resp: any = namespace === 'all'
        ? await appsApi.listDeploymentForAllNamespaces()
        : await appsApi.listNamespacedDeployment({ namespace });
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((d: any) => ({
        name: d.metadata?.name,
        namespace: d.metadata?.namespace,
        ready: `${d.status?.readyReplicas || 0}/${d.spec?.replicas || 0}`,
        status: (d.status?.readyReplicas || 0) === (d.spec?.replicas || 0) ? 'HEALTHY' : 'PROGRESSING',
        restarts: 0,
        age: d.metadata?.creationTimestamp,
      }));
    } else if (kind === 'service') {
      const resp: any = namespace === 'all'
        ? await coreApi.listServiceForAllNamespaces()
        : await coreApi.listNamespacedService({ namespace });
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((s: any) => ({
        name: s.metadata?.name,
        namespace: s.metadata?.namespace,
        type: s.spec?.type,
        clusterIP: s.spec?.clusterIP,
        ports: s.spec?.ports?.map((pt: any) => `${pt.port}:${pt.targetPort || pt.port}/${pt.protocol}`).join(', '),
        status: 'ACTIVE',
        age: s.metadata?.creationTimestamp,
      }));
    } else if (kind === 'configmap') {
      const resp: any = namespace === 'all'
        ? await coreApi.listConfigMapForAllNamespaces()
        : await coreApi.listNamespacedConfigMap({ namespace });
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((cm: any) => ({
        name: cm.metadata?.name,
        namespace: cm.metadata?.namespace,
        keys: Object.keys(cm.data || {}).length,
        status: 'ACTIVE',
        age: cm.metadata?.creationTimestamp,
      }));
    } else if (kind === 'secret') {
      const resp: any = namespace === 'all'
        ? await coreApi.listSecretForAllNamespaces()
        : await coreApi.listNamespacedSecret({ namespace });
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((sc: any) => ({
        name: sc.metadata?.name,
        namespace: sc.metadata?.namespace,
        type: sc.type,
        keys: Object.keys(sc.data || {}).length,
        status: 'ACTIVE',
        age: sc.metadata?.creationTimestamp,
      }));
    } else if (kind === 'node') {
      const resp: any = await coreApi.listNode();
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((n: any) => ({
        name: n.metadata?.name,
        status: n.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'READY' : 'NOTREADY',
        version: n.status?.nodeInfo?.kubeletVersion,
        os: n.status?.nodeInfo?.osImage,
        age: n.metadata?.creationTimestamp,
      }));
    } else if (kind === 'namespace') {
      const resp: any = await coreApi.listNamespace();
      const rawList = resp.items || resp.body?.items || [];
      items = rawList.map((ns: any) => ({
        name: ns.metadata?.name,
        status: ns.status?.phase?.toUpperCase() || 'ACTIVE',
        age: ns.metadata?.creationTimestamp,
      }));
    }

    res.json({ cluster: clusterName, kind, namespace, total: items.length, items });
  } catch (err: any) {
    res.status(500).json({ message: 'Error querying live cluster resources', error: describeRequestError(err, 'Kubernetes API server') });
  }
};

// Resource Browser: Get Live Manifest (YAML / JSON)
export const getResourceManifest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clusterName = String(req.params.name);
    const kind = String(req.params.kind).toLowerCase();
    const namespace = String(req.params.namespace);
    const resourceName = String(req.params.resourceName);

    const { core: coreApi, apps: appsApi } = await resolveClients(clusterName);

    let manifest: any = null;

    if (kind === 'pod') {
      manifest = await coreApi.readNamespacedPod({ name: resourceName, namespace });
    } else if (kind === 'deployment') {
      manifest = await appsApi.readNamespacedDeployment({ name: resourceName, namespace });
    } else if (kind === 'service') {
      manifest = await coreApi.readNamespacedService({ name: resourceName, namespace });
    } else if (kind === 'configmap') {
      manifest = await coreApi.readNamespacedConfigMap({ name: resourceName, namespace });
    }

    if (!manifest) {
      res.status(404).json({ message: 'Resource not found' });
      return;
    }

    // Clean up managedFields for readable live manifest like Devtron
    if (manifest.metadata?.managedFields) {
      delete manifest.metadata.managedFields;
    }

    res.json({ manifest });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to read resource manifest', error: describeRequestError(err, 'Kubernetes API server') });
  }
};

// Resource Browser: Get Pod Logs
export const getPodLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clusterName = String(req.params.name);
    const namespace = String(req.params.namespace);
    const podName = String(req.params.podName);
    const container = req.query.container ? String(req.query.container) : undefined;
    const tailLines = parseInt(req.query.tailLines as string) || 100;

    const { core: coreApi } = await resolveClients(clusterName);
    const logs = await coreApi.readNamespacedPodLog({ name: podName, namespace, container, tailLines });

    res.json({ logs: logs || 'No logs generated yet' });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch pod logs', error: describeRequestError(err, 'Kubernetes API server') });
  }
};
