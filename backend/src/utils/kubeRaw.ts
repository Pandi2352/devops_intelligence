import http from 'http';
import https from 'https';
import * as k8s from '@kubernetes/client-node';

// Raw requests against the Kubernetes API server with the cluster's own credentials.
// Used where the generated client falls short: metrics.k8s.io, service proxies with query
// strings, and streaming pod logs.

export interface KubeRawOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | boolean | undefined>;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class KubeRawError extends Error {
  constructor(message: string, public response: { status: number; data: unknown }) {
    super(message);
  }
}

const buildUrl = (kc: k8s.KubeConfig, path: string, query?: KubeRawOptions['query']) => {
  const server = kc.getCurrentCluster()?.server;
  if (!server) throw new Error('The cluster has no API server URL');
  const url = new URL(server.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return url;
};

const open = async (kc: k8s.KubeConfig, path: string, opts: KubeRawOptions) => {
  const url = buildUrl(kc, path, opts.query);
  const reqOpts: https.RequestOptions = {
    method: opts.method || 'GET',
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    headers: { Accept: 'application/json, */*', ...(opts.headers || {}) },
  };
  await kc.applyToHTTPSOptions(reqOpts);
  return { url, reqOpts, lib: url.protocol === 'http:' ? http : https };
};

// Buffered request. JSON is parsed when the response says it is JSON.
export const kubeRequest = async <T = any>(kc: k8s.KubeConfig, path: string, opts: KubeRawOptions = {}): Promise<T> => {
  const { reqOpts, lib } = await open(kc, path, opts);
  return new Promise<T>((resolve, reject) => {
    const req = lib.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const isJson = String(res.headers['content-type'] || '').includes('json');
        let data: unknown = text;
        if (isJson) {
          try {
            data = JSON.parse(text);
          } catch {
            /* keep text */
          }
        }
        const status = res.statusCode || 0;
        if (status >= 400) {
          const message = (data as any)?.message || (typeof data === 'string' ? data.slice(0, 200) : '') || `HTTP ${status}`;
          reject(new KubeRawError(message, { status, data }));
        } else resolve(data as T);
      });
    });
    req.setTimeout(opts.timeoutMs ?? 20000, () => req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
};

// Streaming GET (e.g. logs with follow=true). Returns a function that aborts the stream.
export const kubeStream = async (
  kc: k8s.KubeConfig,
  path: string,
  opts: KubeRawOptions,
  handlers: { onData: (chunk: string) => void; onEnd: (err?: Error) => void }
): Promise<() => void> => {
  const { reqOpts, lib } = await open(kc, path, opts);
  let done = false;
  const finish = (err?: Error) => {
    if (done) return;
    done = true;
    handlers.onEnd(err);
  };
  const req = lib.request(reqOpts, (res) => {
    if ((res.statusCode || 0) >= 400) {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let message = Buffer.concat(chunks).toString('utf8');
        try {
          message = JSON.parse(message).message || message;
        } catch {
          /* plain text */
        }
        finish(new KubeRawError(message.slice(0, 300), { status: res.statusCode || 0, data: message }));
      });
      return;
    }
    res.setEncoding('utf8');
    res.on('data', (c: string) => handlers.onData(c));
    res.on('end', () => finish());
    res.on('error', (e) => finish(e));
  });
  req.on('error', (e) => finish(e));
  req.end();
  return () => {
    done = true;
    req.destroy();
  };
};

// "250m" -> 0.25 cores, "12345n" -> cores
export const parseCpu = (v?: string): number => {
  if (!v) return 0;
  const n = parseFloat(v);
  if (v.endsWith('n')) return n / 1e9;
  if (v.endsWith('u')) return n / 1e6;
  if (v.endsWith('m')) return n / 1e3;
  return n;
};

// "128Mi" -> bytes
export const parseMemory = (v?: string): number => {
  if (!v) return 0;
  const m = /^([0-9.]+)([a-zA-Z]*)$/.exec(v.trim());
  if (!m) return 0;
  const units: Record<string, number> = {
    '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4,
  };
  return parseFloat(m[1]) * (units[m[2]] ?? 1);
};
