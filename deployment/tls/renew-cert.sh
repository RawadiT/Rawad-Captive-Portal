#!/usr/bin/env bash
set -euo pipefail

# Automated or Manual Let's Encrypt DNS-01 Renewal + Graceful Nginx Reload
# Prerequisites:
#   - Set PORTAL_DOMAIN in deployment/.env (e.g., wifi.example.com)
#   - For automated renewal: configure DNS provider API credentials in
#     deployment/tls/.dns-credentials.env (chmod 600, never committed to git)
#     and install acme.sh or certbot + dns plugin.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
CRED_FILE="$SCRIPT_DIR/.dns-credentials.env"

mkdir -p "$CERTS_DIR"

if [[ -z "${PORTAL_DOMAIN:-}" ]]; then
  echo "ERROR: Export PORTAL_DOMAIN (e.g., export PORTAL_DOMAIN=wifi.yourcompany.com)"
  exit 1
fi

if [[ -f "$CRED_FILE" ]]; then
  # Ensure strict permissions on DNS API secrets
  chmod 600 "$CRED_FILE"
  # shellcheck disable=SC1090
  source "$CRED_FILE"
fi

if command -v acme.sh >/dev/null 2>&1 && [[ -n "${DNS_API_PLUGIN:-}" ]]; then
  echo "=== Running automated ACME DNS-01 via acme.sh ($DNS_API_PLUGIN) ==="
  acme.sh --issue --dns "$DNS_API_PLUGIN" -d "$PORTAL_DOMAIN" --server letsencrypt
  acme.sh --install-cert -d "$PORTAL_DOMAIN" \
    --fullchain-file "$CERTS_DIR/fullchain.pem" \
    --key-file "$CERTS_DIR/privkey.pem"
else
  echo "=== Automated DNS API not configured; checking existing fullchain.pem ==="
  if [[ ! -f "$CERTS_DIR/fullchain.pem" || ! -f "$CERTS_DIR/privkey.pem" ]]; then
    echo "Place your Let's Encrypt fullchain.pem and privkey.pem in $CERTS_DIR"
    echo "Manual DNS-01 example: certbot certonly --manual --preferred-challenges dns -d $PORTAL_DOMAIN"
    exit 1
  fi
fi

echo "=== Inspecting Certificate Extensions & CRL Distribution Points ==="
openssl x509 -in "$CERTS_DIR/fullchain.pem" -noout -dates -subject -issuer
openssl x509 -in "$CERTS_DIR/fullchain.pem" -noout -text | grep -A 5 "CRL Distribution Points" || echo "No CRL Distribution Points found"

echo "=== Testing & Gracefully Reloading Nginx Proxy (zero-downtime) ==="
docker exec rawad-tls-proxy nginx -t
docker exec rawad-tls-proxy nginx -s reload
echo "=== Certificate reload complete ==="
