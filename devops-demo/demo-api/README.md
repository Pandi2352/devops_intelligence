# demo-api

Small Express service for practising the DevOps Intelligence DevOps workflow one stage at a time
(see `devops-demo/README.md` in the DevOps Intelligence workspace).

## Run locally

```bash
npm install
npm test
npm run dev   # http://localhost:3000
```

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | service, version, commit, environment, pod name: shows which build is running |
| `GET /health/live` | liveness probe |
| `GET /health/ready` | readiness probe (503 while shutting down) |
| `GET /metrics` | Prometheus metrics |
| `GET /api/config` | config from environment; reports whether `API_KEY` is set, never its value |
| `GET/POST /api/items`, `GET/DELETE /api/items/:id` | in-memory CRUD to generate traffic |
| `POST /chaos/unready?seconds=30`, `POST /chaos/crash` | failure drills, only when `CHAOS_ENABLED=true` |

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `APP_ENV` | `local` | dev / prod in Kubernetes |
| `APP_MESSAGE` | `Hello from demo-api` | comes from a ConfigMap later |
| `API_KEY` | unset | comes from a Secret later |
| `CHAOS_ENABLED` | `false` | enables `/chaos/*` |
| `APP_VERSION`, `GIT_SHA`, `BUILD_TIME`, `BUILD_ENV` | from package.json / `local` | set by CI at image build time; `BUILD_ENV` = the environment the image was built for |

## CI

Stage 1 pipeline: one `build` job that runs `npm ci` and the tests, and publishes `junit.xml`
as a test report.
