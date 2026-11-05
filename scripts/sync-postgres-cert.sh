#!/bin/bash
# Keeps Postgres serving the certificate the reverse proxy renews (#155). Run on
# a schedule on the database host, as root, from a local copy of this file --
# never fetch it from GitHub at run time, since that would run whatever is on
# the branch as root.
set -euo pipefail

: "${NPM_CERT_DIR:?directory holding the renewed fullchain.pem and privkey.pem}"
: "${PG_CERT_DIR:?directory Postgres reads fullchain.pem and privkey.pem from}"
: "${PG_CONTAINER:?name of the Postgres container}"
: "${PG_ADDRESS:?host:port of Postgres}"
: "${CERT_DOMAIN:?hostname the certificate must be valid for}"

fingerprint() {
    openssl x509 -noout -fingerprint -sha256 2>/dev/null
}

served_fingerprint() {
    openssl s_client -starttls postgres -connect "$PG_ADDRESS" </dev/null 2>/dev/null | fingerprint
}

renewed=$(fingerprint <"$NPM_CERT_DIR/fullchain.pem")

if [ "$(served_fingerprint)" = "$renewed" ]; then
    echo "Postgres already serves the current certificate"
    exit 0
fi

# A proxy directory holding another site's cert would break every client that verifies the hostname.
if ! openssl x509 -in "$NPM_CERT_DIR/fullchain.pem" -noout -checkhost "$CERT_DOMAIN" | grep -q ' does match '; then
    echo "Refusing to sync: $NPM_CERT_DIR is not a certificate for $CERT_DOMAIN" >&2
    exit 1
fi

# cp onto the existing files keeps their owner and mode, which Postgres checks on the key.
cp -L "$NPM_CERT_DIR/fullchain.pem" "$PG_CERT_DIR/fullchain.pem"
cp -L "$NPM_CERT_DIR/privkey.pem" "$PG_CERT_DIR/privkey.pem"

# SIGHUP makes Postgres re-read its TLS files without dropping connections or needing a DB login.
docker kill --signal=HUP "$PG_CONTAINER" >/dev/null
sleep 2

if [ "$(served_fingerprint)" != "$renewed" ]; then
    echo "Postgres is not serving the renewed certificate after reload" >&2
    exit 1
fi
echo "Postgres now serves the renewed certificate"
