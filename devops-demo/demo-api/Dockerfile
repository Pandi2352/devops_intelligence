# ---- Stage 1: install production dependencies only ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# ---- Stage 2: small runtime image ----
FROM node:20-alpine AS runtime
WORKDIR /app

# Patch OS packages (e.g. OpenSSL) and remove npm/npx: the app never runs them at runtime,
# and their bundled dependencies (tar, glob, minimatch…) are what Trivy flags.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm

# Build metadata, passed by CI (docker build --build-arg ...). Shown by GET /.
ARG APP_VERSION=dev
ARG GIT_SHA=local
ARG BUILD_TIME=unknown
# Environment this image was built for (dev, qa, staging, prod). Each environment has its own image.
ARG BUILD_ENV=local
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME \
    BUILD_ENV=$BUILD_ENV

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# The node image ships an unprivileged "node" user; never run as root.
USER node
EXPOSE 3000

# Kubernetes uses its own probes; this helps with plain `docker run`.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1

CMD ["node", "src/server.js"]
