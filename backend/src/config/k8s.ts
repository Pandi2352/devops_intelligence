import * as k8s from '@kubernetes/client-node';
import { withTimeout } from '../utils/httpError.js';

export interface ClusterContextInfo {
  name: string;
  cluster: string;
  user: string;
  isCurrent: boolean;
  server?: string;
}

export interface ClusterConnectionSpec {
  name: string;
  authType: 'context' | 'kubeconfig' | 'token';
  contextName?: string;
  kubeconfig?: string;
  serverUrl?: string;
  token?: string;
  caData?: string;
  insecureSkipTLSVerify?: boolean;
}

export interface ClusterProbeResult {
  serverUrl: string;
  contextName: string;
  version: string;
  nodeCount: number | null;
  namespaces: string[];
}

const PROBE_TIMEOUT_MS = 8000;

export class KubernetesManager {
  private static instance: KubernetesManager;

  public static getInstance(): KubernetesManager {
    if (!KubernetesManager.instance) {
      KubernetesManager.instance = new KubernetesManager();
    }
    return KubernetesManager.instance;
  }

  // Loaded fresh on every call so edits to ~/.kube/config are picked up without a restart.
  private loadLocalKubeConfig(): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();
    const customConfigPath = process.env.KUBECONFIG_PATH;
    if (customConfigPath) {
      kc.loadFromFile(customConfigPath);
    } else {
      kc.loadFromDefault();
    }
    return kc;
  }

  public getContexts(): ClusterContextInfo[] {
    try {
      const kc = this.loadLocalKubeConfig();
      const current = kc.getCurrentContext();
      return kc.getContexts().map((ctx) => ({
        name: ctx.name,
        cluster: ctx.cluster,
        user: ctx.user,
        isCurrent: ctx.name === current,
        server: kc.getCluster(ctx.cluster)?.server,
      }));
    } catch (err) {
      console.warn('[Kubernetes] Could not read local kubeconfig:', (err as Error).message);
      return [];
    }
  }

  // Builds an isolated KubeConfig per cluster so concurrent requests never share a mutable context.
  public buildKubeConfig(spec: ClusterConnectionSpec): k8s.KubeConfig {
    if (spec.authType === 'kubeconfig') {
      if (!spec.kubeconfig?.trim()) throw new Error('Kubeconfig content is empty');
      const kc = new k8s.KubeConfig();
      try {
        kc.loadFromString(spec.kubeconfig);
      } catch (err) {
        throw new Error(`Invalid kubeconfig: ${(err as Error).message}`);
      }
      if (spec.contextName) {
        if (!kc.getContextObject(spec.contextName)) {
          throw new Error(`Context '${spec.contextName}' was not found in the provided kubeconfig`);
        }
        kc.setCurrentContext(spec.contextName);
      }
      if (!kc.getCurrentCluster()) throw new Error('The kubeconfig has no current context or cluster');
      return kc;
    }

    if (spec.authType === 'token') {
      if (!spec.serverUrl) throw new Error('API server URL is required');
      if (!spec.token) throw new Error('Bearer token is required');
      const kc = new k8s.KubeConfig();
      const userName = `${spec.name}-user`;
      kc.loadFromOptions({
        clusters: [
          {
            name: spec.name,
            server: spec.serverUrl,
            caData: spec.caData || undefined,
            skipTLSVerify: Boolean(spec.insecureSkipTLSVerify),
          },
        ],
        users: [{ name: userName, token: spec.token }],
        contexts: [{ name: spec.name, cluster: spec.name, user: userName }],
        currentContext: spec.name,
      });
      return kc;
    }

    const kc = this.loadLocalKubeConfig();
    const contextName = spec.contextName || spec.name;
    if (!kc.getContextObject(contextName)) {
      throw new Error(`Context '${contextName}' was not found in the server's local kubeconfig`);
    }
    kc.setCurrentContext(contextName);
    return kc;
  }

  public getClients(spec: ClusterConnectionSpec) {
    const kc = this.buildKubeConfig(spec);
    return {
      kc,
      core: kc.makeApiClient(k8s.CoreV1Api),
      apps: kc.makeApiClient(k8s.AppsV1Api),
    };
  }

  // Verifies reachability + authentication. Listing namespaces proves the credentials work;
  // listing nodes needs cluster-scoped rights, so a failure there is tolerated.
  public async probe(spec: ClusterConnectionSpec): Promise<ClusterProbeResult> {
    const kc = this.buildKubeConfig(spec);
    const core = kc.makeApiClient(k8s.CoreV1Api);
    const versionApi = kc.makeApiClient(k8s.VersionApi);

    const nsList = await withTimeout(core.listNamespace(), PROBE_TIMEOUT_MS, 'Kubernetes API');
    const [versionInfo, nodeList] = await Promise.allSettled([
      withTimeout(versionApi.getCode(), PROBE_TIMEOUT_MS, 'Kubernetes API'),
      withTimeout(core.listNode(), PROBE_TIMEOUT_MS, 'Kubernetes API'),
    ]);

    return {
      serverUrl: kc.getCurrentCluster()?.server || spec.serverUrl || '',
      contextName: kc.getCurrentContext(),
      version: versionInfo.status === 'fulfilled' ? versionInfo.value.gitVersion : 'unknown',
      nodeCount: nodeList.status === 'fulfilled' ? nodeList.value.items.length : null,
      namespaces: nsList.items.map((n) => n.metadata?.name || '').filter(Boolean),
    };
  }
}

export const k8sManager = KubernetesManager.getInstance();
