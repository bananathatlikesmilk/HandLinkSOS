# AI report summaries

HandLink defaults to Ollama on the configured server. Admin can select Ollama or Google Gemini under **AI settings**. The selection is saved in the database and applies to all dispatchers. No OpenAI integration or automatic provider fallback is used. Ollama requires a downloaded model and server resources. Gemini sends approved notes to Google's cloud and is subject to the Google project's quota, terms, and any applicable charges.

## Admin provider selection and Gemini

1. Set the private server `.env` values:

   ```dotenv
   GEMINI_API_KEY="your-google-ai-studio-api-key"
   GEMINI_SUMMARY_MODEL="gemini-3.5-flash-lite"
   ```

2. Restart local development, or recreate the deployed app container with the updated environment. Production Compose passes these values to the app. Never commit the key or put it in browser code or the APK.
3. Deploy migration `0012_ai_provider_setting.sql`. Normal Docker startup applies migrations before serving requests. Existing databases default to Ollama until an MFA-verified Admin saves another selection.
4. Open **Admin → AI settings**, choose **Gemini (Google cloud)**, and save. The page shows configuration status and model names, never the API key. Gemini cannot be selected without a configured key and valid model name.
5. Dispatchers prepare and review a new preview. Gemini requires explicit consent to send the approved text to Google. Changing the system provider invalidates old previews. Requests reserved before a provider change cannot publish a late result. Older clients without provider consent fields can continue using Ollama but cannot invoke Gemini.

Both providers select sentence IDs. The server reconstructs summaries only from the approved source and applies the same validation, redaction, ownership, MFA, cooldown, retry, and review rules. Gemini failures preserve saved summaries and never switch to Ollama automatically. The selected provider and model are retained in each generation's existing audit record. No registered medical records are automatically sent to either provider.

Migration 0012 only adds a settings table. Roll application code back with that table retained. Set the provider to Ollama before rolling back to an older application version that only understands Ollama. Back up the database before deployment; restoring an old backup would also remove later data.

## Setup

1. Install [Ollama for Windows](https://ollama.com/download/windows).
2. Disable cloud features by setting the Windows user environment variable `OLLAMA_NO_CLOUD` to `1`, then restart Ollama. Setting this only in HandLink's `.env` does not configure a separately running Ollama application.
3. Download the default model in a terminal:

   ```powershell
   ollama pull qwen2.5:3b
   ```

4. Keep Ollama running. If its background application is not running, use `ollama serve` in a separate terminal.
5. Restart HandLink with `pnpm dev` and use `http://localhost:5173`.

The default model requires no HandLink environment change. To select another downloaded local model, set `OLLAMA_SUMMARY_MODEL` in the private server `.env` and restart HandLink. Cloud model tags are rejected. `OLLAMA_SERVER_URL` selects the server address without a host allowlist. Only an absent setting defaults to `http://127.0.0.1:11434`; an empty or invalid setting produces a configuration error instead of silently using localhost. Supply an HTTP(S) origin without credentials, a path, query, or fragment. Redirects are rejected. Keep Ollama on a trusted network; do not expose its unauthenticated API publicly.

The phone does not run the model. It uses the HandLink server, which calls its own local Ollama installation. A future deployed server needs its own Ollama process, sufficient memory, and the model installed on that server.

## Server Docker deployment

To use the optional private Ollama service, set this in the server `.env`:

```dotenv
OLLAMA_SERVER_URL=http://ollama:11434
```

Then use the production configuration:

```powershell
docker compose -f compose.production.yaml -f compose.ollama.yaml up -d --build
```

If push is also configured, include `-f compose.firebase.yaml` before `up`. The Ollama service runs on the server, stores downloaded models in a persistent volume, and publishes no host port. The initialization service downloads `qwen2.5:3b`; the app waits for successful initialization. Initial download needs internet and several GB of disk/memory. Generation uses the server CPU by default and can be slower on small hosts.

The Docker extension does not override `OLLAMA_SERVER_URL` from `.env`. To use an existing Ollama server instead, configure its address, for example `OLLAMA_SERVER_URL=http://192.168.254.63:11434`. The app uses that origin and calls `/api/chat`. Server operators control this setting; browser requests cannot select the destination. Recreate the app container after changing its environment. Keep private model text out of logs. These files must be deployed by the server operator; local edits do not update the running server.

## Dispatcher workflow

1. Confirm and handle the incident, then save incident notes.
2. Open the incident report and select **Prepare notes for AI**.
3. Review the exact text and selected provider. Delete identifying or unnecessary private information and confirm the checkbox. Edits reset consent. Gemini's checkbox explicitly consents to sending the text to Google.
4. Generate a draft. The first request can take longer while the model loads. The server allows 90 seconds; this generation request allows 100 seconds in the browser. Other API requests retain their existing 20-second timeout.
5. Compare every statement against the notes, then approve the summary if accurate.

Only the assigned, active, MFA-verified dispatcher can prepare, generate, or approve a summary. Admin can read saved summaries through authorized reports. Other dispatchers cannot access them. Medical profiles are not automatically read or sent. Automatic redaction is incomplete; dispatcher review remains required for either provider. The AI selects whole sentences from the approved notes instead of writing new prose. The server validates integer sentence IDs, requires original order without duplicates, reconstructs the draft only from the approved source, enforces length limits, and applies another redaction pass before saving. This prevents model-authored urgency, advice, or diagnoses from being added. Common copied prompts are rejected before inference; delete those instructions from the preview and confirm the edited text again. This check does not detect every possible malicious instruction. Sentence selection can still omit relevant context, and source notes themselves can be inaccurate, so dispatcher review remains required. Summaries are drafts, not diagnoses or treatment advice.

## Saved reports and failures

Existing reports, previous summaries, and review history remain intact. New audit rows identify the model as `ollama:qwen2.5:3b` by default; old model names remain unchanged. No database migration or report rewrite is needed for the provider change.

Stopped Ollama, missing models, incomplete results, and failed validation do not overwrite a saved summary. Connection and missing-model errors explain what to fix. A definite failed generation can use a new request ID after the cooldown. Uncertain transport failures retain the same ID for safe retries. Each incident allows one pending request, a 60-second cooldown, and the existing dispatcher hourly limit. Notes changing or access being revoked during generation prevents publication. Notes changing after generation makes the draft stale and blocks approval.

## Verification

Run `pnpm exec playwright test --config=playwright.ai.config.ts` for the API and browser workflow. Tests use a separate database, fake Gemini credentials, and mocked Ollama and Gemini endpoints. Live Gemini and cloud OpenAI requests are forbidden in the mock. Tests do not send incident data to an external provider or require a downloaded model. Real model inference needs a separate check using fictional notes; mocked tests do not establish model accuracy or phone performance.

To exercise the installed model through the real HandLink API with a fictional incident and a separate test database, explicitly opt in from PowerShell:

```powershell
$env:HANDLINK_LIVE_OLLAMA = '1'
pnpm exec playwright test --config=playwright.ai.config.ts -g 'installed local Ollama'
Remove-Item Env:HANDLINK_LIVE_OLLAMA
```

The live check uses only the fixed local Ollama endpoint. It is skipped during normal test runs.
