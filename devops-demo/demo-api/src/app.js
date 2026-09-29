import express from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { createMetrics } from './metrics.js';

export const createApp = (config) => {
  const app = express();
  const metrics = createMetrics(config);
  const startedAt = Date.now();
  const items = new Map();
  const state = { ready: true, shuttingDown: false };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  // Access log + latency metric for every request.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      metrics.httpDuration.observe({ method: req.method, route, status: res.statusCode }, seconds);
      if (!req.path.startsWith('/health') && req.path !== '/metrics') {
        logger.info('request', { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(seconds * 1000) });
      }
    });
    next();
  });

  // Which build is answering? Refresh during a rollout and watch version/commit/pod change.
  app.get('/', (_req, res) => {
    res.json({
      service: config.service,
      message: config.message,
      version: config.version,
      commit: config.commit,
      buildTime: config.buildTime,
      buildEnv: config.buildEnv,
      environment: config.environment,
      pod: config.pod,
      namespace: config.namespace,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // Liveness: is the process alive? Failing this makes Kubernetes restart the container.
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  // Readiness: should this pod receive traffic? Failing this removes it from the Service, no restart.
  app.get('/health/ready', (_req, res) => {
    if (state.ready && !state.shuttingDown) return res.json({ status: 'ready' });
    return res.status(503).json({ status: state.shuttingDown ? 'shutting-down' : 'not-ready' });
  });

  app.get('/metrics', async (_req, res) => {
    metrics.itemsGauge.set(items.size);
    res.set('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  // Shows config coming from the ConfigMap and whether the Secret is mounted, never its value.
  app.get('/api/config', (_req, res) => {
    res.json({ environment: config.environment, message: config.message, apiKeyConfigured: config.hasApiKey, chaosEnabled: config.chaosEnabled });
  });

  app.get('/api/items', (_req, res) => res.json({ items: [...items.values()] }));

  app.post('/api/items', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) return res.status(400).json({ error: 'name is required (1-100 characters)' });
    const item = { id: randomUUID(), name, createdAt: new Date().toISOString(), createdBy: config.pod };
    items.set(item.id, item);
    return res.status(201).json(item);
  });

  app.get('/api/items/:id', (req, res) => {
    const item = items.get(req.params.id);
    return item ? res.json(item) : res.status(404).json({ error: 'item not found' });
  });

  app.delete('/api/items/:id', (req, res) => {
    if (!items.delete(req.params.id)) return res.status(404).json({ error: 'item not found' });
    return res.status(204).end();
  });

  // Failure drills for learning. Disabled unless CHAOS_ENABLED=true (never in prod).
  const chaos = express.Router();
  chaos.use((_req, res, next) => (config.chaosEnabled ? next() : res.status(403).json({ error: 'chaos endpoints are disabled' })));
  chaos.post('/unready', (req, res) => {
    const seconds = Math.min(Number(req.query.seconds) || 30, 300);
    state.ready = false;
    logger.warn('readiness disabled by chaos endpoint', { seconds });
    setTimeout(() => {
      state.ready = true;
      logger.info('readiness restored');
    }, seconds * 1000).unref();
    res.json({ status: 'not-ready', seconds });
  });
  chaos.post('/crash', (_req, res) => {
    logger.error('crash requested by chaos endpoint');
    res.json({ status: 'crashing' });
    setTimeout(() => process.exit(1), 100);
  });
  app.use('/chaos', chaos);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    logger.error('unhandled error', { error: err.message });
    return res.status(500).json({ error: 'internal error' });
  });

  return { app, state };
};
