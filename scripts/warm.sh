#!/usr/bin/env bash
# Warm-up: ensure the base runtime image exists and the platform is healthy.
set -euo pipefail

IMG="${SANDBOX_IMAGE:-ivanatoms/base:node22}"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "[warm] building base image $IMG"
  docker build -t "$IMG" -f docker/base-node22.Dockerfile docker/
fi

echo "[warm] base image ready"
curl -fsS "http://localhost:${PORT:-3000}/api/health" && echo || echo "(platform not running yet — start scripts/serve.sh first)"