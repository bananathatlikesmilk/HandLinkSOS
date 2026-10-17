# sv

## Docker Desktop

Start Docker Desktop with Linux containers. Create `.env` from `.env.example` if needed, and set a random `BETTER_AUTH_SECRET` of at least 32 characters. Keep the same secret across restarts. Set the SMTP values for email verification and password recovery.

```sh
docker compose up --build -d
```

Open <http://localhost:3000>. Compose reads credentials from `.env`, sets the container database path, and overrides the development origin. For a different public URL, set `DOCKER_ORIGIN` in `.env` and rerun `docker compose up --build -d`. SvelteKit 3 embeds the server origin during the build, so changing it requires rebuilding. For a plain `docker build`, pass `--build-arg ORIGIN=https://your-domain.example` and set the same `ORIGIN` when running the image. Use HTTPS outside localhost for camera and location features.

Startup prepares ownership of `/app/data`, then drops to the non-root `node` user before applying the existing Drizzle migrations and starting the production Node server. The named `handlink-data` volume holds a **new, separate database**, plus backups made before subsequent migrations. Your existing `local.db` is not copied into the image. `docker compose down` keeps this volume; `docker compose down -v` deletes it and its data.

Linux bind mounts such as `./data:/app/data` are also supported. Startup creates the backup directory and gives UID/GID `1000:1000` ownership of the mounted data, including existing SQLite files. It preserves database contents. Mount only the dedicated HandLink data directory there. If your platform requires `user: '1000:1000'`, prepare that ownership on the host first; startup cannot repair it without root. Read-only mounts are unsupported.

For a custom Compose deployment using `ORIGIN` (including Cloudflare Tunnel), also pass the same value in `services.app.build.args.ORIGIN`. Setting only the runtime environment does not update SvelteKit 3's built-in origin. Rebuild and recreate the app after pulling these source changes; restarting or pulling an older published image does not include the fix.

```sh
# View startup and migration logs
docker compose logs -f app

# Provision the first administrator (interactive, password hidden)
docker compose exec --user node app node scripts/create-admin.mjs

# Stop the app while keeping its database
docker compose down
```

Admin provisioning still requires email verification and staff MFA. The image excludes local secrets, databases, Android files, and test artifacts. Docker Hub publishing uses the `DOCKER_USERNAME` and `DOCKER_PASSWORD` repository secrets and tags `<DOCKER_USERNAME>/handlink-sos`.

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
