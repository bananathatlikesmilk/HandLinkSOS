FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++
RUN corepack enable
RUN corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN npm_config_nodedir=/usr/local pnpm install --frozen-lockfile

COPY . .
ARG ORIGIN=http://localhost:3000
RUN DATABASE_URL=/tmp/build.db \
    BETTER_AUTH_SECRET=build-only-placeholder-secret-do-not-use-in-production \
    ORIGIN="$ORIGIN" pnpm build
RUN pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/app/data/local.db

WORKDIR /app
RUN apk add --no-cache su-exec \
    && mkdir -p /app/data/.db-backups \
    && ln -s /app/data/.db-backups /app/.db-backups \
    && chown -R node:node /app

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/src/lib/server/db ./src/lib/server/db
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --chown=node:node scripts/migrate.mjs scripts/create-admin.mjs scripts/expire-locations.mjs ./scripts/

RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
