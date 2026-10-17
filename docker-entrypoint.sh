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

# Bind mounts replace the ownership prepared in the image. Initialize only the
# dedicated data directory, then run migrations and the server without root.
if [ "$(id -u)" -eq 0 ]; then
    mkdir -p /app/data/.db-backups
    chown -R node:node /app/data
    exec su-exec node:node "$0" "$@"
fi

database_dir=$(dirname "$DATABASE_URL")
if [ ! -d "$database_dir" ] || [ ! -w "$database_dir" ]; then
    echo "SQLite directory is missing or not writable: $database_dir. Mount writable storage owned by UID $(id -u)." >&2
    exit 1
fi
if [ -e "$DATABASE_URL" ] && { [ ! -r "$DATABASE_URL" ] || [ ! -w "$DATABASE_URL" ]; }; then
    echo "SQLite database is not readable and writable: $DATABASE_URL. Check file ownership and mount permissions." >&2
    exit 1
fi

# SvelteKit 3 embeds paths.origin in the image. A runtime-only change would
# otherwise start successfully but reject same-origin writes and auth routes.
node --input-type=module <<'JS'
import { origin } from './build/adapter-node.js';
if (origin !== process.env.ORIGIN) {
    console.error(`Origin mismatch: image was built for ${origin ?? '(unset)'}, but ORIGIN is ${process.env.ORIGIN}.`);
    console.error('Rebuild with --build-arg ORIGIN matching the public URL. For GitHub Actions, set the DOCKER_ORIGIN repository variable before publishing.');
    process.exit(1);
}
JS

node scripts/migrate.mjs
exec "$@"
