# ivanatoms base runtime image (no native deps; persistence via JSON in DATA_DIR)
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

RUN mkdir -p /opt/preinstalled \
 && cd /opt/preinstalled \
 && npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev express@4 \
 && chmod -R a+rX /opt/preinstalled/node_modules

ENV NODE_PATH=/opt/preinstalled/node_modules

RUN groupadd -g 1000 app 2>/dev/null || true \
 && useradd -u 1000 -g 1000 -m app 2>/dev/null || true

WORKDIR /app
USER 1000:1000
EXPOSE 3001

# Code is mounted at /app/code; data at /app/data. Run with -w /app/code.
CMD ["node", "server.js"]