#!/usr/bin/env bash
set -euo pipefail

echo "=== Rawad Tech Captive Portal - Linux Installer ==="
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[1/2] Building backend (Supabase + MikroTik)..."
(cd "$ROOT_DIR/backend" && npm ci && npm run build && npm prune --omit=dev)

echo "[2/2] Building frontend..."
(cd "$ROOT_DIR/frontend" && npm ci && npm run build && rm -rf .next/cache)

echo "=== Installation Complete. Apply supabase/schema.sql in Supabase SQL Editor, then configure deployment/.env ==="
