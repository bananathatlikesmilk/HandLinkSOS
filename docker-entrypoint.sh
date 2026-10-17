#!/bin/sh
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL must point to a writable SQLite database}"
: "${ORIGIN:?ORIGIN must be the public URL of this server}"
: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET must be set}"
if [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then
    echo 'BETTER_AUTH_SECRET must contain at least 32 characters.' >&2
    exit 1
fi

node scripts/migrate.mjs
exec "$@"
