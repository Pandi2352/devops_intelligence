// End-to-end check of Cloudflare DNS: connector, zone records, environment hostnames, apply/fix/remove
// (with an approval), tunnels and permissions. Cloudflare is replaced by a local fake API, and a second
// backend is started on TEST_PORT pointing at it, so no real DNS changes. Uses the seeded test accounts
// and the kubeorbit-demo project (dev and qa); everything it creates is removed at the end.
//   node dist/scripts/testDns.js
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TEST_PORT = Number(process.env.TEST_PORT || 5055);
const API = `http://localhost:${TEST_PORT}/api`;
const PROJECT = process.env.TEST_PROJECT_ID || '6aba360d948a2fd77c77dde1';
const TOKEN = 'test_token_0123456789abcdefghijklmnop';
const ACCOUNT = 'abcdefabcdefabcdefabcdefabcdef12';
const ZONE = { id: 'zone-ditest', name: 'ditest.example' };
const CONNECTOR_NAME = '__di-test-dns';
const TUNNEL_NAME = 'di-test-tunnel';

// ---------------------------------------------------------------- fake Cloudflare API

const records = new Map<string, any>();
const tunnels = new Map<string, any>();
const ok = (result: unknown, info?: unknown) => ({ success: true, errors: [], messages: [], result, ...(info ? { result_info: info } : {}) });
const fail = (code: number, message: string) => ({ success: false, errors: [{ code, message }], messages: [], result: null });

const fakeCloudflare = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(400, fail(6003, 'Invalid request headers'));
    const body = raw ? JSON.parse(raw) : {};
    const p = url.pathname.replace(/^\/client\/v4/, '');
    const m = (re: RegExp) => p.match(re);
    let x: RegExpMatchArray | null;

    if (p === '/user/tokens/verify' || m(/^\/accounts\/[^/]+\/tokens\/verify$/)) return send(200, ok({ id: 'tok', status: 'active' }));
    if (p === '/zones' && req.method === 'GET') {
      return send(200, ok([{ ...ZONE, status: 'active', paused: false, plan: { name: 'Free Website' }, name_servers: ['ada.ns.cloudflare.com'], account: { id: ACCOUNT, name: 'Test' } }], { page: 1, per_page: 50, total_count: 1, total_pages: 1 }));
    }
    if ((x = m(/^\/zones\/([^/]+)\/dns_records$/))) {
      if (x[1] !== ZONE.id) return send(404, fail(7003, 'Could not route'));
      if (req.method === 'GET') {
        const list = [...records.values()].filter((r) => (!url.searchParams.get('name') || r.name === url.searchParams.get('name')) && (!url.searchParams.get('type') || r.type === url.searchParams.get('type')));
        return send(200, ok(list, { page: 1, per_page: 100, total_count: list.length, total_pages: 1 }));
      }
      if (req.method === 'POST') {
        const clash = [...records.values()].some((r) => r.name === body.name && (r.type === 'CNAME' || body.type === 'CNAME'));
        if (clash) return send(400, fail(81053, 'An A, AAAA, or CNAME record with that host already exists.'));
        const r = { id: randomUUID().replace(/-/g, ''), proxiable: true, ttl: 1, ...body, modified_on: new Date().toISOString() };
        records.set(r.id, r);
        return send(200, ok(r));
      }
    }
    if ((x = m(/^\/zones\/([^/]+)\/dns_records\/([^/]+)$/))) {
      const existing = records.get(x[2]);
      if (!existing) return send(404, fail(81044, 'Record does not exist.'));
      if (req.method === 'PUT') {
        const r = { ...existing, ...body, id: existing.id, modified_on: new Date().toISOString() };
        records.set(r.id, r);
        return send(200, ok(r));
      }
      if (req.method === 'DELETE') {
        records.delete(x[2]);
        return send(200, ok({ id: x[2] }));
      }
    }
    if ((x = m(/^\/accounts\/([^/]+)\/cfd_tunnel$/)) && req.method === 'POST') {
      const t = { id: randomUUID(), name: body.name, status: 'inactive', created_at: new Date().toISOString(), connections: [], config: { ingress: [] } };
      tunnels.set(t.id, t);
      return send(200, ok(t));
    }
    if ((x = m(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)(\/[a-z]+)?$/))) {
      const t = tunnels.get(x[1]);
      if (!t) return send(404, fail(1003, 'Tunnel not found'));
      const sub = x[2] || '';
      if (sub === '' && req.method === 'GET') return send(200, ok(t));
      if (sub === '' && req.method === 'DELETE') {
        tunnels.delete(x[1]);
        return send(200, ok(t));
      }
      if (sub === '/token') return send(200, ok('eyJmYWtlIjoidHVubmVsLXRva2VuIn0'));
      if (sub === '/connections') return send(200, ok(null));
      if (sub === '/configurations' && req.method === 'GET') return send(200, ok({ config: t.config }));
      if (sub === '/configurations' && req.method === 'PUT') {
        t.config = body.config;
        return send(200, ok({ config: t.config }));
      }
    }
    send(404, fail(7000, `No route for ${req.method} ${p}`));
  });
});

// ---------------------------------------------------------------- HTTP helpers

const login = async (email: string, password: string) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return ((await r.json()) as any).token as string;
};
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, data };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addressRecords = (name: string) => [...records.values()].filter((r) => r.name === name && ['A', 'AAAA', 'CNAME'].includes(r.type));

const startBackend = async (cfPort: number): Promise<ChildProcess> => {
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: String(TEST_PORT), CLOUDFLARE_API_BASE: `http://127.0.0.1:${cfPort}/client/v4` },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr?.on('data', (d) => (errors += d));
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${API}/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  child.kill();
  throw new Error(`Test backend did not start on ${TEST_PORT}: ${errors.slice(0, 500)}`);
};

// ---------------------------------------------------------------- test

const main = async () => {
  await new Promise<void>((r) => fakeCloudflare.listen(0, '127.0.0.1', () => r()));
  const cfPort = (fakeCloudflare.address() as any).port;
  const backend = await startBackend(cfPort);

  let pass = 0;
  const fails: string[] = [];
  const check = (label: string, cond: boolean, detail = '') => (cond ? (pass += 1) : fails.push(`${label}${detail ? ` (${detail})` : ''}`));

  const admin = await login('test.admin@devops.local', 'Admin-Test-2026');
  const alice = await login('dev.alice@devops.local', 'Alice-Test-2026');
  const erin = await login('lead.erin@devops.local', 'Erin-Test-2026');
  const frank = await login('mgr.frank@devops.local', 'Frank-Test-2026');
  const grace = await login('viewer.grace@devops.local', 'Grace-Test-2026');
  const devHost = `kubeorbit-demo-dev.${ZONE.name}`;
  let connectorId = '';
  let tunnelDocId = '';

  try {
    // 1. connector
    const created = await call(admin, 'POST', '/dns/connectors', { name: CONNECTOR_NAME, apiToken: TOKEN, accountId: ACCOUNT, zones: [] });
    connectorId = created.data?.connector?._id;
    check('admin adds a Cloudflare connector', created.status === 201 && created.data?.test?.ok === true, created.data?.test?.message);
    check('connector sees the zone', created.data?.connector?.zoneCount === 1 && created.data?.connector?.dnsReadable === true);
    check('alice cannot list DNS connectors', (await call(alice, 'GET', '/dns/connectors')).status === 403);
    const zones = await call(admin, 'GET', `/dns/connectors/${connectorId}/zones`);
    check('zones list with record count', zones.data?.zones?.[0]?.name === ZONE.name && typeof zones.data?.zones?.[0]?.recordCount === 'number');

    // 2. zone records (admins)
    const bad = await call(admin, 'POST', `/dns/connectors/${connectorId}/zones/${ZONE.id}/records`, { type: 'A', name: 'www', content: 'not-an-ip' });
    check('invalid A record is refused', bad.status === 400, bad.data?.message);
    const www = await call(admin, 'POST', `/dns/connectors/${connectorId}/zones/${ZONE.id}/records`, { type: 'A', name: 'www', content: '198.51.100.7', proxied: true });
    check('admin creates www A record (relative name completed)', www.status === 201 && www.data?.record?.name === `www.${ZONE.name}`, www.data?.message);
    const upd = await call(admin, 'PUT', `/dns/connectors/${connectorId}/zones/${ZONE.id}/records/${www.data?.record?.id}`, { type: 'CNAME', name: 'www', content: 'origin.example.net' });
    check('admin changes it to a CNAME', upd.status === 200 && upd.data?.record?.type === 'CNAME');
    check('alice cannot read zone records', (await call(alice, 'GET', `/dns/connectors/${connectorId}/zones/${ZONE.id}/records`)).status === 403);
    const del = await call(admin, 'DELETE', `/dns/connectors/${connectorId}/zones/${ZONE.id}/records/${www.data?.record?.id}?name=www.${ZONE.name}`);
    check('admin deletes it', del.status === 200 && !records.has(www.data?.record?.id));

    // 3. environment hostname (project admin)
    const dnsConfig = { hostname: devHost, connectorId, mode: 'record', target: '203.0.113.10', proxied: true };
    check('alice (deploy on dev) cannot set the hostname', (await call(alice, 'PUT', `/projects/${PROJECT}/environments/dev/dns`, dnsConfig)).status === 403);
    const outside = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/dns`, { ...dnsConfig, hostname: 'demo.not-our-zone.org' });
    check('hostname outside the zone is refused', outside.status === 400, outside.data?.message);
    const set = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/dns`, dnsConfig);
    check('erin (project admin) sets the dev hostname', set.status === 200, set.data?.message);
    const dup = await call(erin, 'PUT', `/projects/${PROJECT}/environments/qa/dns`, dnsConfig);
    check('same hostname on qa is refused', dup.status === 409, dup.data?.message);

    const envOf = async (token: string) => (await call(token, 'GET', `/projects/${PROJECT}/dns?probe=0`)).data?.environments?.find((e: any) => e.env === 'dev');
    let dev = await envOf(alice);
    check('dev reports the record as missing', dev?.state === 'missing' && dev?.expected?.type === 'A', `${dev?.state}: ${dev?.message}`);
    check('alice may apply, may not configure', dev?.canApply === true && dev?.canConfigure === false);
    const graceView = await envOf(grace);
    check('viewer sees dev but cannot apply', graceView?.env === 'dev' && graceView?.canApply === false);
    check('viewer cannot apply', (await call(grace, 'POST', `/projects/${PROJECT}/environments/dev/dns/apply`, {})).status === 403);

    // 4. apply / fix
    const applied = await call(alice, 'POST', `/projects/${PROJECT}/environments/dev/dns/apply`, {});
    check('alice applies: record created', applied.status === 200 && applied.data?.changed === true, applied.data?.message);
    check('Cloudflare has A → target, proxied, with a comment', addressRecords(devHost).length === 1 && addressRecords(devHost)[0].content === '203.0.113.10' && addressRecords(devHost)[0].proxied === true && /DevOps Intelligence/.test(addressRecords(devHost)[0].comment));
    dev = await envOf(alice);
    check('dev is now ok', dev?.state === 'ok', `${dev?.state}: ${dev?.message}`);
    const again = await call(alice, 'POST', `/projects/${PROJECT}/environments/dev/dns/apply`, {});
    check('applying again changes nothing', again.status === 200 && again.data?.changed === false);

    const rec = addressRecords(devHost)[0];
    records.set(rec.id, { ...rec, content: '192.0.2.99' });
    dev = await envOf(alice);
    check('someone changed it: mismatch detected', dev?.state === 'mismatch', dev?.message);
    const fixed = await call(alice, 'POST', `/projects/${PROJECT}/environments/dev/dns/apply`, {});
    check('apply fixes it', fixed.status === 200 && addressRecords(devHost)[0]?.content === '203.0.113.10', fixed.data?.message);

    // 5. approval: removing the record on a gated environment
    const gate = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/approval`, { requiresApproval: true });
    check('dev gated for the test', gate.status === 200);
    try {
      const asked = await call(alice, 'DELETE', `/projects/${PROJECT}/environments/dev/dns/record`, { reason: 'dns test' });
      check('remove on a gated env returns 202', asked.status === 202 && asked.data?.approvalRequired === true, `HTTP ${asked.status}`);
      check('record still there while waiting', addressRecords(devHost).length === 1);
      const id = asked.data?.request?._id;
      const approved = await call(frank, 'PUT', `/approvals/${id}/review`, { status: 'APPROVED', reviewComment: 'ok for test' });
      check('frank approves', approved.status === 200, approved.data?.message);
      let final: any = null;
      for (let i = 0; i < 30; i += 1) {
        final = (await call(frank, 'GET', '/approvals?status=all')).data?.approvals?.find((a: any) => a._id === id);
        if (final && ['EXECUTED', 'FAILED'].includes(final.status)) break;
        await sleep(1000);
      }
      check('approved removal ran', final?.status === 'EXECUTED' && addressRecords(devHost).length === 0, `${final?.status}: ${final?.execution?.message}`);
    } finally {
      await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/approval`, { requiresApproval: null });
    }

    // 6. tunnel
    const tun = await call(admin, 'POST', '/dns/tunnels', { connectorId, clusterName: 'minikube', name: TUNNEL_NAME, deploy: false });
    tunnelDocId = tun.data?.tunnel?._id;
    const tunnelId = tun.data?.tunnel?.tunnelId;
    check('admin creates a tunnel (without deploying cloudflared)', tun.status === 201 && Boolean(tunnelId), tun.data?.message);
    check('alice cannot create tunnels', (await call(alice, 'POST', '/dns/tunnels', { connectorId, clusterName: 'minikube' })).status === 403);
    const viaTunnel = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/dns`, { hostname: devHost, connectorId, mode: 'tunnel', tunnelId });
    check('erin switches dev to the tunnel', viaTunnel.status === 200, viaTunnel.data?.message);
    const ingress = tunnels.get(tunnelId)?.config?.ingress || [];
    check('tunnel route added for dev', ingress.some((r: any) => r.hostname === devHost && /^http:\/\/.+\.svc\.cluster\.local:\d+$/.test(r.service)) && ingress.at(-1)?.service === 'http_status:404', JSON.stringify(ingress));
    const viaApply = await call(alice, 'POST', `/projects/${PROJECT}/environments/dev/dns/apply`, {});
    const cname = addressRecords(devHost)[0];
    check('apply creates a proxied CNAME to the tunnel', viaApply.status === 200 && cname?.type === 'CNAME' && cname?.content === `${tunnelId}.cfargotunnel.com` && cname?.proxied === true, viaApply.data?.message);
    const list = await call(admin, 'GET', '/dns/tunnels');
    check('tunnel list shows the route', list.data?.tunnels?.find((t: any) => t._id === tunnelDocId)?.routes?.[0]?.hostname === devHost);
    check('deleting a tunnel in use is refused', (await call(admin, 'DELETE', `/dns/tunnels/${tunnelDocId}`)).status === 409);
    const overview = await call(alice, 'GET', `/projects/${PROJECT}/overview`);
    const ovDev = (overview.data?.project?.environments || overview.data?.environments || []).find((e: any) => e.name === 'dev');
    check('overview carries the public URL', ovDev?.publicUrl === `https://${devHost}`, JSON.stringify(ovDev?.publicUrl));

    const heidi = await login('dev.heidi@devops.local', 'Heidi-Test-2026');
    const pubAlice = await call(alice, 'GET', '/dns/public-urls?probe=0');
    check('Public URLs lists the dev hostname for alice', pubAlice.status === 200 && pubAlice.data?.items?.some((i: any) => i.env === 'dev' && i.dns?.hostname === devHost), JSON.stringify(pubAlice.data?.summary));
    const pubHeidi = await call(heidi, 'GET', '/dns/public-urls?probe=0');
    check('Public URLs hides other projects (heidi)', pubHeidi.status === 200 && !pubHeidi.data?.items?.some((i: any) => i.projectName === 'kubeorbit-demo'));

    // 7. clean up through the API
    await call(alice, 'DELETE', `/projects/${PROJECT}/environments/dev/dns/record`, {});
    check('record removed', addressRecords(devHost).length === 0);
    const cleared = await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/dns`, { clear: true });
    check('hostname cleared, tunnel route dropped', cleared.status === 200 && !(tunnels.get(tunnelId)?.config?.ingress || []).some((r: any) => r.hostname), JSON.stringify(tunnels.get(tunnelId)?.config));
    const gone = await call(admin, 'DELETE', `/dns/tunnels/${tunnelDocId}`);
    check('unused tunnel deleted (Cloudflare too)', gone.status === 200 && !tunnels.has(tunnelId), gone.data?.message);
    tunnelDocId = '';

    const audit = await call(admin, 'GET', '/approvals/audit?limit=100');
    const events = audit.data?.events || audit.data?.items || [];
    check('audit has DNS changes', events.some((e: any) => e.action === 'DNS_CHANGE' && e.environment === 'dev'));
  } finally {
    // Leave nothing behind, even after a failure.
    await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/dns`, { clear: true }).catch(() => undefined);
    await call(erin, 'PUT', `/projects/${PROJECT}/environments/dev/approval`, { requiresApproval: null }).catch(() => undefined);
    if (tunnelDocId) await call(admin, 'DELETE', `/dns/tunnels/${tunnelDocId}?force=true`).catch(() => undefined);
    if (connectorId) {
      const removed = await call(admin, 'DELETE', `/dns/connectors/${connectorId}?force=true`);
      check('test connector removed', removed.status === 200, removed.data?.message);
    }
    const pending = (await call(admin, 'GET', '/approvals?status=PENDING')).data?.approvals || [];
    for (const p of pending.filter((a: any) => a.reason === 'dns test')) await call(admin, 'POST', `/approvals/${p._id}/cancel`, {});
    backend.kill();
    fakeCloudflare.close();
  }

  console.log(`\nRESULT: ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(fails.length ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
