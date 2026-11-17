#!/usr/bin/env bash
set -euo pipefail

# Automated or Manual Let's Encrypt DNS-01 Renewal + Atomic Validation + Graceful Nginx Reload
# Usage:
#   ./renew-cert.sh                 # Run renewal/validation & reload Nginx if valid
#   ./renew-cert.sh --install-cron  # Install daily cron job for automated DNS-01 renewal

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
STAGE_DIR="$CERTS_DIR/.staging"
BACKUP_DIR="$CERTS_DIR/.backup"
CRED_FILE="$SCRIPT_DIR/.dns-credentials.env"

mkdir -p "$CERTS_DIR" "$STAGE_DIR" "$BACKUP_DIR"

if [[ "${1:-}" == "--install-cron" ]]; then
  CRON_CMD="0 3 * * * PORTAL_DOMAIN=${PORTAL_DOMAIN:-} $SCRIPT_DIR/renew-cert.sh >> /var/log/rawad-cert-renew.log 2>&1"
  (crontab -l 2>/dev/null | grep -v "renew-cert.sh"; echo "$CRON_CMD") | crontab -
  echo "Installed daily automated renewal cron job at 03:00."
  exit 0
fi

if [[ -z "${PORTAL_DOMAIN:-}" ]]; then
  echo "ERROR: Export PORTAL_DOMAIN (e.g., export PORTAL_DOMAIN=wifi.yourcompany.com)"
  exit 1
fi

if [[ -f "$CRED_FILE" ]]; then
  chmod 600 "$CRED_FILE"
  # shellcheck disable=SC1090
  source "$CRED_FILE"
fi

# Step 1: Issue/renew into staging directory so existing live certs are NEVER overwritten on failure
if command -v acme.sh >/dev/null 2>&1 && [[ -n "${DNS_API_PLUGIN:-}" ]]; then
  echo "=== [Automated DNS-01] Renewing via acme.sh ($DNS_API_PLUGIN) ==="
  acme.sh --issue --dns "$DNS_API_PLUGIN" -d "$PORTAL_DOMAIN" --server letsencrypt || exit 1
  acme.sh --install-cert -d "$PORTAL_DOMAIN" \
    --fullchain-file "$STAGE_DIR/fullchain.pem" \
    --key-file "$STAGE_DIR/privkey.pem"
else
  echo "=== [Manual DNS-01 Mode] Validating staged/existing certificates ==="
  if [[ ! -f "$CERTS_DIR/fullchain.pem" || ! -f "$CERTS_DIR/privkey.pem" ]]; then
    echo "ERROR: No fullchain.pem / privkey.pem found. Run manual certbot DNS-01 and place files in $CERTS_DIR"
    exit 1
  fi
  cp "$CERTS_DIR/fullchain.pem" "$STAGE_DIR/fullchain.pem"
  cp "$CERTS_DIR/privkey.pem" "$STAGE_DIR/privkey.pem"
fi

# Step 2: Validate certificate expiry (> 24h) and key-pair match before touching live certs
openssl x509 -in "$STAGE_DIR/fullchain.pem" -noout -checkend 86400
CERT_PUB=$(openssl x509 -in "$STAGE_DIR/fullchain.pem" -pubkey -noout)
KEY_PUB=$(openssl pkey -in "$STAGE_DIR/privkey.pem" -pubout)
if [[ "$CERT_PUB" != "$KEY_PUB" ]]; then
  echo "ERROR: Certificate and private key mismatch! Aborting without reloading Nginx."
  exit 1
fi

echo "=== Inspecting CRL Distribution Points ==="
openssl x509 -in "$STAGE_DIR/fullchain.pem" -noout -dates -subject -issuer
openssl x509 -in "$STAGE_DIR/fullchain.pem" -noout -text | grep -A 5 "CRL Distribution Points" || echo "No CRL Distribution Points found"

# Step 3: Backup live certs, promote staged certs, test Nginx, and reload (or rollback on nginx -t failure)
if [[ -f "$CERTS_DIR/fullchain.pem" && -f "$CERTS_DIR/privkey.pem" ]]; then
  cp "$CERTS_DIR/fullchain.pem" "$BACKUP_DIR/fullchain.pem"
  cp "$CERTS_DIR/privkey.pem" "$BACKUP_DIR/privkey.pem"
fi

mv "$STAGE_DIR/fullchain.pem" "$CERTS_DIR/fullchain.pem"
mv "$STAGE_DIR/privkey.pem" "$CERTS_DIR/privkey.pem"

if ! docker exec rawad-tls-proxy nginx -t; then
  echo "ERROR: nginx -t failed! Restoring previous certificates and aborting reload."
  if [[ -f "$BACKUP_DIR/fullchain.pem" && -f "$BACKUP_DIR/privkey.pem" ]]; then
    cp "$BACKUP_DIR/fullchain.pem" "$CERTS_DIR/fullchain.pem"
    cp "$BACKUP_DIR/privkey.pem" "$CERTS_DIR/privkey.pem"
  fi
  exit 1
fi

docker exec rawad-tls-proxy nginx -s reload
echo "=== Graceful zero-downtime Nginx reload complete ==="
