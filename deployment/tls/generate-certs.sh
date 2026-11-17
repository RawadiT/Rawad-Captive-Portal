#!/usr/bin/env bash
set -euo pipefail

# Generates Internal CA + MikroTik www-ssl certificate ONLY (for Backend <-> MikroTik 192.168.10.1:443).
# Guest-facing HTTPS MUST use a publicly-trusted certificate (e.g. Let's Encrypt DNS-01 via renew-cert.sh).

OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "$OUT_DIR"

echo "=== Generating Rawad Tech Internal Root CA (Backend <-> MikroTik www-ssl only) ==="
openssl genrsa -out "$OUT_DIR/rawad-ca.key" 4096
openssl req -x509 -new -nodes -key "$OUT_DIR/rawad-ca.key" -sha256 -days 1825 \
  -subj "/C=IQ/O=Rawad Tech/CN=Rawad Tech Internal MikroTik CA" \
  -out "$OUT_DIR/rawad-ca.crt"

cat > "$OUT_DIR/mikrotik.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
subjectAltName = @alt_names
[alt_names]
IP.1 = 192.168.10.1
IP.2 = 192.168.20.1
EOF

echo "=== Generating MikroTik www-ssl Certificate ==="
openssl genrsa -out "$OUT_DIR/mikrotik.key" 2048
openssl req -new -key "$OUT_DIR/mikrotik.key" -subj "/C=IQ/O=Rawad Tech/CN=192.168.10.1" -out "$OUT_DIR/mikrotik.csr"
openssl x509 -req -in "$OUT_DIR/mikrotik.csr" -CA "$OUT_DIR/rawad-ca.crt" -CAkey "$OUT_DIR/rawad-ca.key" -CAcreateserial \
  -out "$OUT_DIR/mikrotik.crt" -days 825 -sha256 -extfile "$OUT_DIR/mikrotik.ext"

echo "=== Internal MikroTik certificates generated in $OUT_DIR ==="
