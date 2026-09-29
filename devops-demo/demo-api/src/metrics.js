import client from 'prom-client';

// A registry per app instance keeps tests isolated from each other.
export const createMetrics = (config) => {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: config.service, version: config.version, environment: config.environment });
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 1, 3],
    registers: [registry],
  });

  const itemsGauge = new client.Gauge({
    name: 'demo_items_total',
    help: 'Number of items currently stored in memory',
    registers: [registry],
  });

  return { registry, httpDuration, itemsGauge };
};
