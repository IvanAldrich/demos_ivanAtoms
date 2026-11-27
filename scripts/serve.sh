#!/usr/bin/env bash
# Production-ish host run: web (Next) + worker, with local Docker sandbox.
# For ECS: install Node 22 + Docker, copy repo, create .env, run this script, open http://<ECS_IP>:3000/.
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

IMG="${SANDBOX_IMAGE:-ivanatoms/base:node22}"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "[serve] building base runtime image $IMG"
  docker build -t "$IMG" -f docker/base-node22.Dockerfile docker/
fi

echo "[serve] npm install"
npm install --no-audit --no-fund

echo "[serve] npm run build"
npm run build

echo "[serve] starting web (:${PORT:-3000}) + worker"
npm start &
WEB=$!
npm run worker &
WORKER=$!

trap 'kill $WEB $WORKER 2>/dev/null || true' INT TERM
wait