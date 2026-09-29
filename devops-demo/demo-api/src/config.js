import os from 'node:os';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Everything that differs between laptop, dev and prod comes from environment variables.
// In Kubernetes these are set by the Deployment (build info), a ConfigMap and a Secret.
export const loadConfig = (env = process.env) => ({
  port: Number(env.PORT) || 3000,
  service: 'demo-api',
  version: env.APP_VERSION || pkg.version,
  commit: env.GIT_SHA || 'local',
  buildTime: env.BUILD_TIME || 'unknown',
  buildEnv: env.BUILD_ENV || 'local',
  environment: env.APP_ENV || 'local',
  message: env.APP_MESSAGE || 'Hello from demo-api',
  hasApiKey: Boolean(env.API_KEY),
  chaosEnabled: env.CHAOS_ENABLED === 'true',
  pod: env.POD_NAME || os.hostname(),
  namespace: env.POD_NAMESPACE || 'none',
});
