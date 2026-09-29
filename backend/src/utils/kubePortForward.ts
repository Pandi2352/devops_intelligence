import net from 'node:net';
import * as k8s from '@kubernetes/client-node';
import { resolveClients } from '../controllers/clusterController.js';

// A local TCP port that forwards to a Service's pod, like `kubectl port-forward svc/…`.
// Needed where the API server's service proxy does not fit: it drops the Authorization header,
// which token-authenticated services (SonarQube) need. One listener per cluster/namespace/service/port.

interface Forward {
  port: number;
  server: net.Server;
  pod: string;
  targetPort: number;
}

const forwards = new Map<string, Promise<Forward>>();

const readyPod = async (core: k8s.CoreV1Api, namespace: string, selector: Record<string, string>) => {
  const labelSelector = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',');
  const pods = await core.listNamespacedPod({ namespace, labelSelector });
  const pod = pods.items.find((p) => p.status?.phase === 'Running' && p.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'));
  if (!pod) throw Object.assign(new Error(`No ready pod behind service ${namespace}/${Object.values(selector).join(',')}`), { code: 'ECONNREFUSED' });
  return pod;
};

const open = async (clusterName: string, namespace: string, service: string, port: number): Promise<Forward> => {
  const { kc, core } = await resolveClients(clusterName);
  const svc = await core.readNamespacedService({ name: service, namespace });
  const selector = svc.spec?.selector || {};
  if (!Object.keys(selector).length) throw new Error(`Service ${namespace}/${service} has no selector`);
  const svcPort = (svc.spec?.ports || []).find((p) => p.port === port) || svc.spec?.ports?.[0];
  if (!svcPort) throw new Error(`Service ${namespace}/${service} has no port ${port}`);

  // The container port the Service targets (number, or a named port on the pod).
  const resolveTarget = (pod: k8s.V1Pod) => {
    const t = svcPort.targetPort ?? svcPort.port;
    if (typeof t === 'number') return t;
    if (/^\d+$/.test(String(t))) return Number(t);
    const named = (pod.spec?.containers || []).flatMap((c) => c.ports || []).find((p) => p.name === t);
    if (!named) throw new Error(`Pod ${pod.metadata?.name} has no port named ${t}`);
    return named.containerPort;
  };

  let pod = await readyPod(core, namespace, selector);
  const state: Forward = { port: 0, server: null as unknown as net.Server, pod: pod.metadata!.name!, targetPort: resolveTarget(pod) };
  const pf = new k8s.PortForward(kc);

  const server = net.createServer(async (socket) => {
    socket.on('error', () => socket.destroy());
    try {
      await pf.portForward(namespace, state.pod, [state.targetPort], socket, null, socket);
    } catch {
      // The pod may have been replaced: pick the current one for the next connection.
      try {
        pod = await readyPod(core, namespace, selector);
        state.pod = pod.metadata!.name!;
        state.targetPort = resolveTarget(pod);
      } catch {
        /* nothing ready */
      }
      socket.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  server.unref(); // never keeps the process alive on its own
  state.server = server;
  state.port = (server.address() as net.AddressInfo).port;
  return state;
};

// Local base URL (http://127.0.0.1:<port>) for a Service port in a cluster.
export const forwardedBaseUrl = async (clusterName: string, namespace: string, service: string, port: number): Promise<string> => {
  const key = `${clusterName}/${namespace}/${service}/${port}`;
  let f = forwards.get(key);
  if (!f) {
    f = open(clusterName, namespace, service, port);
    forwards.set(key, f);
    f.catch(() => forwards.delete(key));
  }
  return `http://127.0.0.1:${(await f).port}`;
};

// Drop a forward (e.g. after connection errors, or when a connector changes).
export const closeForward = async (clusterName: string, namespace: string, service: string, port: number) => {
  const key = `${clusterName}/${namespace}/${service}/${port}`;
  const f = forwards.get(key);
  forwards.delete(key);
  if (f) (await f.catch(() => null))?.server.close();
};
