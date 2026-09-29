import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let state;

before(async () => {
  const config = loadConfig({ APP_ENV: 'test', APP_MESSAGE: 'hi from tests', CHAOS_ENABLED: 'true', API_KEY: 'x' });
  const created = createApp(config);
  state = created.state;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = (path, options = {}) =>
  fetch(`${baseUrl}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });

test('GET / reports service and build info', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, 'demo-api');
  assert.equal(body.environment, 'test');
  assert.equal(body.buildEnv, 'local');
  assert.equal(body.message, 'hi from tests');
  assert.ok(body.version);
});

test('liveness and readiness probes return 200', async () => {
  assert.equal((await call('/health/live')).status, 200);
  assert.equal((await call('/health/ready')).status, 200);
});

test('readiness returns 503 while shutting down', async () => {
  state.shuttingDown = true;
  assert.equal((await call('/health/ready')).status, 503);
  state.shuttingDown = false;
});

test('config endpoint never exposes the secret value', async () => {
  const body = await (await call('/api/config')).json();
  assert.equal(body.apiKeyConfigured, true);
  assert.equal(JSON.stringify(body).includes('"x"'), false);
});

test('items CRUD', async () => {
  const created = await call('/api/items', { method: 'POST', body: JSON.stringify({ name: 'first' }) });
  assert.equal(created.status, 201);
  const item = await created.json();

  const list = await (await call('/api/items')).json();
  assert.ok(list.items.some((i) => i.id === item.id));

  assert.equal((await call(`/api/items/${item.id}`)).status, 200);
  assert.equal((await call(`/api/items/${item.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/items/${item.id}`)).status, 404);
});

test('rejects invalid items', async () => {
  assert.equal((await call('/api/items', { method: 'POST', body: JSON.stringify({}) })).status, 400);
  assert.equal((await call('/api/items', { method: 'POST', body: '{bad json' })).status, 400);
});

test('metrics endpoint exposes Prometheus metrics', async () => {
  const text = await (await call('/metrics')).text();
  assert.match(text, /http_request_duration_seconds/);
  assert.match(text, /demo_items_total/);
});

test('chaos endpoints are blocked unless enabled', async () => {
  const { app } = createApp(loadConfig({ CHAOS_ENABLED: 'false' }));
  const blocked = app.listen(0);
  await new Promise((r) => blocked.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${blocked.address().port}/chaos/unready`, { method: 'POST' });
  assert.equal(res.status, 403);
  blocked.close();
});

test('unknown routes return 404 JSON', async () => {
  const res = await call('/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
});
