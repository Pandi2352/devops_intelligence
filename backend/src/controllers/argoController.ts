import { Response } from 'express';
import { isManager } from '../services/access.js';
import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { AuthRequest } from '../middleware/auth.js';
import { ArgoIntegration, IArgoIntegration, ArgoAuthType } from '../models/ArgoIntegration.js';
import { maskSecret } from '../utils/secrets.js';
import { describeRequestError } from '../utils/httpError.js';
import { cleanString, isHttpUrl, isValidId, nameMatch, normalizeUrl } from '../utils/validation.js';

const AUTH_TYPES: ArgoAuthType[] = ['token', 'password', 'none'];

interface ArgoConnection {
  id?: string;
  serverUrl: string;
  authType: ArgoAuthType;
  authToken?: string;
  username?: string;
  password?: string;
  insecure: boolean;
}

// Credentials are never returned; `id` is kept for older clients of /argocd/status.
export const serializeArgo = (a: IArgoIntegration) => ({
  _id: a._id,
  id: a._id,
  name: a.name,
  serverUrl: a.serverUrl,
  authType: a.authType || (a.authToken ? 'token' : a.password ? 'password' : 'none'),
  username: a.username,
  hasToken: Boolean(a.authToken),
  tokenHint: maskSecret(a.authToken),
  hasPassword: Boolean(a.password),
  insecure: a.insecure,
  isDefault: a.isDefault,
  status: a.status,
  version: a.version,
  lastPingAt: a.lastPingAt,
  lastError: a.lastError || '',
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const connectionFromDoc = (a: IArgoIntegration): ArgoConnection => ({
  id: String(a._id),
  serverUrl: a.serverUrl,
  authType: a.authType || (a.authToken ? 'token' : a.password ? 'password' : 'none'),
  authToken: a.authToken,
  username: a.username,
  password: a.password,
  insecure: a.insecure,
});

const httpClient = (insecure: boolean): AxiosInstance =>
  axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: !insecure }),
    timeout: 8000,
  });

// Session tokens obtained with username/password are cached briefly to avoid logging in on every call.
const sessionCache = new Map<string, { token: string; expiresAt: number }>();
const SESSION_TTL_MS = 10 * 60 * 1000;

const resolveToken = async (conn: ArgoConnection, client: AxiosInstance, useCache = true): Promise<string> => {
  if (conn.authType === 'token') return conn.authToken || '';
  if (conn.authType !== 'password') return '';

  const cacheKey = conn.id ? `${conn.id}:${conn.serverUrl}:${conn.username}` : '';
  const cached = cacheKey ? sessionCache.get(cacheKey) : undefined;
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.token;

  const session = await client.post(`${conn.serverUrl}/api/v1/session`, {
    username: conn.username,
    password: conn.password,
  });
  const token: string = session.data?.token || '';
  if (cacheKey && token) sessionCache.set(cacheKey, { token, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
};

// Verifies the server responds and, when credentials are configured, that they are accepted.
const probeArgo = async (conn: ArgoConnection) => {
  const client = httpClient(conn.insecure);
  const versionRes = await client.get(`${conn.serverUrl}/api/version`);
  const version: string = versionRes.data?.Version || 'unknown';

  const token = await resolveToken(conn, client, false);
  let account = '';
  if (token) {
    const info = await client.get(`${conn.serverUrl}/api/v1/session/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!info.data?.loggedIn) throw new Error('ArgoCD did not accept the credentials');
    account = info.data?.username || '';
  }
  return { version, account };
};

const applyProbe = async (doc: IArgoIntegration) => {
  doc.lastPingAt = new Date();
  try {
    const { version, account } = await probeArgo(connectionFromDoc(doc));
    doc.status = 'Connected';
    doc.version = version;
    doc.lastError = '';
    return {
      ok: true,
      message: `Connected to ArgoCD ${version}${account ? ` as ${account}` : ''}`,
      details: { version, account: account || 'anonymous' },
    };
  } catch (err) {
    const message = describeRequestError(err, 'ArgoCD');
    doc.status = 'Error';
    doc.lastError = message;
    return { ok: false, message };
  }
};

const getDefaultIntegration = async () =>
  (await ArgoIntegration.findOne({ isDefault: true })) || (await ArgoIntegration.findOne().sort({ createdAt: 1 }));

const findConnector = async (id: unknown) => (isValidId(id) ? ArgoIntegration.findById(id) : null);

const clearOtherDefaults = (id: unknown) => ArgoIntegration.updateMany({ _id: { $ne: id } }, { isDefault: false });

const pickConnector = async (req: AuthRequest) =>
  req.query.connectorId ? findConnector(req.query.connectorId) : getDefaultIntegration();

export const getArgoStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    let integration = await getDefaultIntegration();
    if (!integration) {
      integration = new ArgoIntegration({
        name: 'Local ArgoCD',
        serverUrl: normalizeUrl(process.env.ARGOCD_SERVER_URL || 'https://localhost:8080'),
        authType: process.env.ARGOCD_AUTH_TOKEN ? 'token' : 'none',
        authToken: process.env.ARGOCD_AUTH_TOKEN || '',
        insecure: true,
        isDefault: true,
      });
    }

    await applyProbe(integration);
    await integration.save();
    const full = serializeArgo(integration);
    res.json({
      integration: isManager(_req.user)
        ? full
        : { _id: full._id, id: full.id, name: full.name, serverUrl: full.serverUrl, status: full.status, version: full.version, lastPingAt: full.lastPingAt, isDefault: full.isDefault },
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Error checking ArgoCD status', error: err.message });
  }
};

// Legacy endpoint used by the ArgoCD page modal: updates the default instance.
export const updateArgoConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { serverUrl, authToken, username, password } = req.body;
    let integration = await getDefaultIntegration();
    if (!integration) integration = new ArgoIntegration({ isDefault: true });

    if (serverUrl) {
      if (!isHttpUrl(serverUrl)) {
        res.status(400).json({ message: 'Server URL must be a valid http(s) URL' });
        return;
      }
      integration.serverUrl = normalizeUrl(serverUrl);
    }
    if (authToken) {
      integration.authToken = authToken;
      integration.authType = 'token';
    }
    if (username) integration.username = username;
    if (password) {
      integration.password = password;
      if (!authToken) integration.authType = 'password';
    }

    await applyProbe(integration);
    await integration.save();
    res.json({ message: 'ArgoCD settings updated', integration: serializeArgo(integration) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update ArgoCD configuration', error: err.message });
  }
};

export const listArgoApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await pickConnector(req);
    if (!integration || !integration.serverUrl) {
      res.json({ applications: [] });
      return;
    }

    const conn = connectionFromDoc(integration);
    const client = httpClient(conn.insecure);
    try {
      const token = await resolveToken(conn, client);
      const resp = await client.get(`${conn.serverUrl}/api/v1/applications`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      res.json({ applications: resp.data?.items || [] });
    } catch (apiErr) {
      // Return empty gracefully if ArgoCD server is not actively running at the moment
      res.json({ applications: [], warning: describeRequestError(apiErr, 'ArgoCD') });
    }
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch ArgoCD applications', error: err.message });
  }
};

// Authenticated request against the default ArgoCD instance, for other controllers.
export const argoRequest = async <T = any>(method: 'get' | 'post' | 'put' | 'delete', apiPath: string, data?: unknown): Promise<{ data: T; serverUrl: string }> => {
  const integration = await getDefaultIntegration();
  if (!integration) throw new Error('No ArgoCD connector is configured');
  const conn = connectionFromDoc(integration);
  const client = httpClient(conn.insecure);
  const token = await resolveToken(conn, client);
  const res = await client.request<T>({
    method,
    url: `${conn.serverUrl}${apiPath}`,
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { data: res.data, serverUrl: conn.serverUrl };
};

const OPERATION_IN_PROGRESS = /another operation is already in progress/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Hard-refresh (ArgoCD caches Git revisions for minutes), then sync. If ArgoCD is already running
// an operation (e.g. auto-sync picked the change up first), wait for it and sync once more.
export interface SyncOptions {
  prune?: boolean;
  force?: boolean;
  applyOutOfSyncOnly?: boolean;
}

export const syncArgoApp = async (name: string, options: SyncOptions = {}): Promise<{ revision: string; message: string }> => {
  const appPath = `/api/v1/applications/${encodeURIComponent(name)}`;
  await argoRequest('get', `${appPath}?refresh=hard`);
  const body = {
    prune: options.prune ?? true,
    dryRun: false,
    strategy: { apply: { force: Boolean(options.force) } },
    syncOptions: options.applyOutOfSyncOnly ? { items: ['ApplyOutOfSyncOnly=true'] } : undefined,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await argoRequest('post', `${appPath}/sync`, body);
      const revision = String(data?.operation?.sync?.revision || data?.status?.sync?.revision || '').slice(0, 8);
      return { revision, message: `ArgoCD application '${name}' sync triggered${revision ? ` at ${revision}` : ''}` };
    } catch (err: any) {
      const busy = err.response?.status === 400 && OPERATION_IN_PROGRESS.test(JSON.stringify(err.response?.data || ''));
      if (!busy) throw err;
      // Wait up to ~40s for the running operation to finish.
      for (let i = 0; i < 20; i++) {
        await sleep(2000);
        const { data } = await argoRequest('get', appPath);
        if (data?.status?.operationState?.phase !== 'Running') break;
      }
    }
  }
  return { revision: '', message: `ArgoCD is still busy with another sync of '${name}'; it applies the latest Git revision when that finishes.` };
};

export const syncArgoApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = String(req.params.name);
    if (req.query.connectorId) {
      res.status(400).json({ message: 'Syncing through a non-default ArgoCD connector is not supported' });
      return;
    }
    const { prune, force, applyOutOfSyncOnly } = req.body || {};
    const result = await syncArgoApp(name, {
      prune: typeof prune === 'boolean' ? prune : undefined,
      force: force === true,
      applyOutOfSyncOnly: applyOutOfSyncOnly === true,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: `Failed to sync application: ${describeRequestError(err, 'ArgoCD')}` });
  }
};

interface ArgoInput {
  name: string;
  serverUrl: string;
  authType: ArgoAuthType;
  authToken: string;
  username: string;
  password: string;
  insecure: boolean;
  isDefault?: boolean;
}

const readInput = (body: any): ArgoInput => ({
  name: cleanString(body.name, 80),
  serverUrl: typeof body.serverUrl === 'string' ? normalizeUrl(body.serverUrl) : '',
  authType: AUTH_TYPES.includes(body.authType) ? body.authType : 'token',
  authToken: typeof body.authToken === 'string' ? body.authToken.trim() : '',
  username: cleanString(body.username, 100),
  password: typeof body.password === 'string' ? body.password : '',
  insecure: Boolean(body.insecure),
  isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
});

const validateInput = (input: ArgoInput, existing?: IArgoIntegration | null): string | null => {
  if (!isHttpUrl(input.serverUrl)) return 'Server URL must be a valid http(s) URL';
  if (input.authType === 'token' && !input.authToken && !existing?.authToken) return 'An API token is required';
  if (input.authType === 'password') {
    if (!input.username) return 'Username is required';
    if (!input.password && !existing?.password) return 'Password is required';
  }
  return null;
};

const toConnection = (input: ArgoInput, existing?: IArgoIntegration | null): ArgoConnection => ({
  id: existing ? String(existing._id) : undefined,
  serverUrl: input.serverUrl,
  authType: input.authType,
  authToken: input.authToken || existing?.authToken,
  username: input.username,
  password: input.password || existing?.password,
  insecure: input.insecure,
});

// Blank secrets keep their saved values; switching auth method clears the unused ones.
const applyInput = (doc: IArgoIntegration, input: ArgoInput) => {
  doc.name = input.name;
  doc.serverUrl = input.serverUrl;
  doc.authType = input.authType;
  doc.insecure = input.insecure;
  if (input.authType === 'token') {
    if (input.authToken) doc.authToken = input.authToken;
    doc.password = '';
  } else if (input.authType === 'password') {
    doc.username = input.username;
    if (input.password) doc.password = input.password;
    doc.authToken = '';
  } else {
    doc.authToken = '';
    doc.password = '';
  }
};

export const listArgoConnectors = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const connectors = await ArgoIntegration.find().sort({ createdAt: -1 });
    // Records saved before defaults existed: promote the oldest so there is always exactly one.
    if (connectors.length > 0 && !connectors.some((c) => c.isDefault)) {
      const oldest = connectors[connectors.length - 1];
      oldest.isDefault = true;
      await oldest.save();
    }
    res.json({ connectors: connectors.map(serializeArgo) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch ArgoCD connectors', error: err.message });
  }
};

export const createArgoConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = readInput(req.body);
    if (!input.name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }
    const validationError = validateInput(input);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }
    if (await ArgoIntegration.exists({ name: nameMatch(input.name) })) {
      res.status(409).json({ message: `A connector named '${input.name}' already exists` });
      return;
    }

    const doc = new ArgoIntegration({});
    applyInput(doc, input);
    const test = await applyProbe(doc);
    doc.isDefault = input.isDefault ?? !(await ArgoIntegration.exists({}));
    await doc.save();
    if (doc.isDefault) await clearOtherDefaults(doc._id);

    res.status(201).json({
      message: test.ok ? `ArgoCD connector '${doc.name}' connected` : `ArgoCD connector '${doc.name}' saved, but the connection test failed`,
      connector: serializeArgo(doc),
      test,
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to create ArgoCD connector', error: err.message });
  }
};

export const updateArgoConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await findConnector(req.params.id);
    if (!doc) {
      res.status(404).json({ message: 'ArgoCD connector not found' });
      return;
    }
    const input = readInput(req.body);
    if (!input.name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }
    const validationError = validateInput(input, doc);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }
    if (await ArgoIntegration.exists({ _id: { $ne: doc._id }, name: nameMatch(input.name) })) {
      res.status(409).json({ message: `A connector named '${input.name}' already exists` });
      return;
    }

    applyInput(doc, input);
    for (const key of sessionCache.keys()) if (key.startsWith(`${doc._id}:`)) sessionCache.delete(key);
    const test = await applyProbe(doc);
    if (input.isDefault !== undefined) doc.isDefault = input.isDefault;
    await doc.save();
    if (doc.isDefault) await clearOtherDefaults(doc._id);

    res.json({ message: `ArgoCD connector '${doc.name}' updated`, connector: serializeArgo(doc), test });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update ArgoCD connector', error: err.message });
  }
};

export const setDefaultArgoConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await findConnector(req.params.id);
    if (!doc) {
      res.status(404).json({ message: 'ArgoCD connector not found' });
      return;
    }
    doc.isDefault = true;
    await doc.save();
    await clearOtherDefaults(doc._id);
    res.json({ message: `'${doc.name}' is now the default ArgoCD instance`, connector: serializeArgo(doc) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to set default connector', error: err.message });
  }
};

export const deleteArgoConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await findConnector(req.params.id);
    if (!doc) {
      res.status(404).json({ message: 'ArgoCD connector not found' });
      return;
    }
    await doc.deleteOne();
    if (doc.isDefault) {
      const next = await ArgoIntegration.findOne().sort({ createdAt: 1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
    res.json({ message: `ArgoCD connector '${doc.name}' deleted` });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to delete ArgoCD connector', error: err.message });
  }
};

// Tests form values without saving. Pass `id` to fall back to stored secrets.
export const testArgoConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await findConnector(req.body.id);
    const input = readInput(req.body);
    const validationError = validateInput(input, existing);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }
    try {
      const { version, account } = await probeArgo(toConnection(input, existing));
      res.json({
        ok: true,
        message: `Connected to ArgoCD ${version}${account ? ` as ${account}` : ''}`,
        details: { version, account: account || 'anonymous' },
      });
    } catch (err) {
      res.json({ ok: false, message: describeRequestError(err, 'ArgoCD') });
    }
  } catch (err: any) {
    res.status(500).json({ message: 'Connection test failed', error: err.message });
  }
};

export const testSavedArgoConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await findConnector(req.params.id);
    if (!doc) {
      res.status(404).json({ message: 'ArgoCD connector not found' });
      return;
    }
    const test = await applyProbe(doc);
    await doc.save();
    res.json({ ...test, connector: serializeArgo(doc) });
  } catch (err: any) {
    res.status(500).json({ message: 'Connection test failed', error: err.message });
  }
};
