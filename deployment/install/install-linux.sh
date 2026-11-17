#!/usr/bin/env bash
set -euo pipefail

echo "=== Rawad Tech Captive Portal - Linux Installer ==="
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[1/4] Running database migrations..."
node "$ROOT_DIR/database/migrations/migrate.mjs"

echo "[2/4] Building backend..."
(cd "$ROOT_DIR/backend" && npm ci && npm run build)

echo "[3/4] Building guest-portal..."
(cd "$ROOT_DIR/frontend/guest-portal" && npm ci && npm run build)

echo "[4/4] Building admin-dashboard..."
(cd "$ROOT_DIR/frontend/admin-dashboard" && npm ci && npm run build)

echo "=== Installation Complete ==="
