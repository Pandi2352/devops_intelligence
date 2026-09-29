import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const config = loadConfig();
const { app, state } = createApp(config);

const server = app.listen(config.port, () => {
  logger.info('demo-api started', {
    port: config.port,
    version: config.version,
    commit: config.commit,
    environment: config.environment,
    pod: config.pod,
  });
});

// Kubernetes sends SIGTERM before killing a pod (rollouts, scale-down, node drain).
// Fail readiness first so the Service stops routing here, then finish in-flight requests.
const shutdown = (signal) => {
  logger.info('shutdown started', { signal });
  state.shuttingDown = true;
  setTimeout(() => {
    server.close(() => {
      logger.info('shutdown complete');
      process.exit(0);
    });
  }, Number(process.env.SHUTDOWN_DELAY_MS ?? 5000)).unref();
  setTimeout(() => process.exit(1), 25000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
