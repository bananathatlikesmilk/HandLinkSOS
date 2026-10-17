# sv

## Docker Desktop

Start Docker Desktop with Linux containers. Create `.env` from `.env.example` if needed, and set a random `BETTER_AUTH_SECRET` of at least 32 characters. Keep the same secret across restarts. Set the SMTP values for email verification and password recovery.

```sh
docker compose up --build -d
```

Open the URL set by `ORIGIN` in `.env` (use `http://localhost:3000` for local Docker). Compose reads credentials and the public origin from `.env` and sets the container database path. `ORIGIN` is read at runtime; the same image supports different domains without rebuilding. Recreate the container after changing `.env`. Use HTTPS outside localhost for camera and location features.

Startup prepares ownership of `/app/data`, then drops to the non-root `node` user before applying the existing Drizzle migrations and starting the production Node server. The named `handlink-data` volume holds a **new, separate database**, plus backups made before subsequent migrations. Your existing `local.db` is not copied into the image. `docker compose down` keeps this volume; `docker compose down -v` deletes it and its data.

Linux bind mounts such as `./data:/app/data` are also supported. Startup creates the backup directory and gives UID/GID `1000:1000` ownership of the mounted data, including existing SQLite files. It preserves database contents. Mount only the dedicated HandLink data directory there. If your platform requires `user: '1000:1000'`, prepare that ownership on the host first; startup cannot repair it without root. Read-only mounts are unsupported.

The runtime launcher (`pnpm start` or `node scripts/start-server.mjs`) reads `ORIGIN`, then sets the adapter's request origin before each request. It overwrites incoming origin-routing headers with server-owned values while preserving browser `Origin` checks, authentication, and the adapter's graceful shutdown. No origin build argument or GitHub Actions origin variable is needed. Do not bypass the launcher with `node build`.

```sh
# View startup and migration logs
docker compose logs -f app

# Provision the first administrator (interactive, password hidden)
docker compose exec --user node app node scripts/create-admin.mjs

# Stop the app while keeping its database
docker compose down
```

Admin provisioning still requires email verification and staff MFA. The image excludes local secrets, databases, Android files, and test artifacts. Docker Hub publishing uses the `DOCKER_USERNAME` and `DOCKER_PASSWORD` repository secrets and tags `<DOCKER_USERNAME>/handlink-sos`.

### Hosting through Cloudflare Tunnel

Use `compose.production.yaml` for the hosted app and tunnel. On the server, set `ORIGIN` to your public HTTPS URL, set `BETTER_AUTH_SECRET` and `CLOUDFLARE_TUNNEL_TOKEN`, and configure all five SMTP fields in `.env`. Port 465 uses implicit TLS; port 587 requires STARTTLS. Use your email provider's SMTP credentials and an authorized sender address.

```sh
docker compose -f compose.production.yaml up --build -d
```

This configuration keeps the existing `./data` database directory and forwards SMTP settings explicitly to the app. Compose's `.env` file supplies interpolation values; variables are not automatically available inside a container unless its service declares `environment` or `env_file`. Missing SMTP settings cause a clear configuration error before deployment. The tunnel token is passed only to `cloudflared`. Configure the tunnel's service URL as `http://app:3000`.

When changing only SMTP values, recreate the app to load them; restarting an existing container keeps its old environment:

```sh
docker compose -f compose.production.yaml up -d --no-build --force-recreate app
```

For an existing deployment, publish or build the updated image once to get the runtime launcher. When using Docker Hub, pull it and recreate the app:

```sh
docker compose -f compose.production.yaml pull app
docker compose -f compose.production.yaml up -d --no-build --force-recreate app
```

For builds on the server, use `docker compose -f compose.production.yaml up --build -d app` instead. After this update, changing the domain requires only updating `ORIGIN` in `.env` and recreating the app. SMTP credentials also remain runtime settings.

AI summaries call Ollama at `127.0.0.1:11434`. With Docker's default bridge network, that address belongs to the container. To use Ollama on this computer without exposing its API, enable **host networking** in Docker Desktop Settings > Resources > Network. Replace `ports` in the Compose service with `network_mode: host`, then recreate the container. Requires Docker Desktop 4.34 or later. See [local AI setup](docs/ai-summaries.md) for model installation. Model inference is separate from building the web image.

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@1.1.1 create --template minimal --types ts --add prettier eslint playwright="demo:no" tailwindcss="plugins:none" better-auth="demo:password" drizzle="database:sqlite+sqlite:better-sqlite3" ai-tools="ide:vscode+tools:mcp,svelte-code-writer,svelte-core-bestpractices,svelte-file-editor+mcpSetup:remote" experimental="features:async,remoteFunctions" --install pnpm HandLink-SOS
```

## Adding features

Add features to your project with `sv add`:

```sh
npx sv add
```

For example, to add Tailwind CSS:

```sh
npx sv add tailwindcss
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
