# Local AI report summaries

HandLink uses Ollama on the same computer as the HandLink server. No OpenAI API key, paid AI account, or cloud fallback is used. Downloading Ollama and a model requires internet access; generation uses local resources after download. Computer hardware, electricity, and hosting still have costs.

## Setup

1. Install [Ollama for Windows](https://ollama.com/download/windows).
2. Disable cloud features by setting the Windows user environment variable `OLLAMA_NO_CLOUD` to `1`, then restart Ollama. Setting this only in HandLink's `.env` does not configure a separately running Ollama application.
3. Download the default model in a terminal:

   ```powershell
   ollama pull qwen2.5:3b
   ```

4. Keep Ollama running. If its background application is not running, use `ollama serve` in a separate terminal.
5. Restart HandLink with `pnpm dev` and use `http://localhost:5173`.

The default model requires no HandLink environment change. To select another downloaded local model, set `OLLAMA_SUMMARY_MODEL` in the private server `.env` and restart HandLink. Cloud model tags are rejected. The API address is fixed to `http://127.0.0.1:11434/api/chat`, and redirects are rejected. Keep Ollama bound to loopback; do not expose its unauthenticated API publicly.

The phone does not run the model. It uses the HandLink server, which calls its own local Ollama installation. A future deployed server needs its own Ollama process, sufficient memory, and the model installed on that server.

## Dispatcher workflow

1. Confirm and handle the incident, then save incident notes.
2. Open the incident report and select **Prepare notes for AI**.
3. Review the exact text. Delete identifying or unnecessary private information and confirm the checkbox. Edits reset consent.
4. Generate a draft. The first request can take longer while the model loads. The server allows 90 seconds; this generation request allows 100 seconds in the browser. Other API requests retain their existing 20-second timeout.
5. Compare every statement against the notes, then approve the summary if accurate.

Only the assigned, active, MFA-verified dispatcher can prepare, generate, or approve a summary. Admin can read saved summaries through authorized reports. Other dispatchers cannot access them. Medical profiles are not automatically read or sent. Automatic redaction is incomplete; dispatcher review remains required even though processing stays local. The AI selects whole sentences from the approved notes instead of writing new prose. The server validates integer sentence IDs, requires original order without duplicates, reconstructs the draft only from the approved source, enforces length limits, and applies another redaction pass before saving. This prevents model-authored urgency, advice, or diagnoses from being added. Common copied prompts are rejected before inference; delete those instructions from the preview and confirm the edited text again. This check does not detect every possible malicious instruction. Sentence selection can still omit relevant context, and source notes themselves can be inaccurate, so dispatcher review remains required. Summaries are drafts, not diagnoses or treatment advice.

## Saved reports and failures

Existing reports, previous summaries, and review history remain intact. New audit rows identify the model as `ollama:qwen2.5:3b` by default; old model names remain unchanged. No database migration or report rewrite is needed for the provider change.

Stopped Ollama, missing models, incomplete results, and failed validation do not overwrite a saved summary. Connection and missing-model errors explain what to fix. A definite failed generation can use a new request ID after the cooldown. Uncertain transport failures retain the same ID for safe retries. Each incident allows one pending request, a 60-second cooldown, and the existing dispatcher hourly limit. Notes changing or access being revoked during generation prevents publication. Notes changing after generation makes the draft stale and blocks approval.

## Verification

Run `pnpm exec playwright test --config=playwright.ai.config.ts` for the API and browser workflow. Tests use a separate database and intercept only the local Ollama endpoint. Cloud OpenAI requests are forbidden in the mock. Tests do not send incident data to an external provider or require a downloaded model. Real model inference needs a separate local check using fictional notes; mocked tests do not establish model accuracy or phone performance.

To exercise the installed model through the real HandLink API with a fictional incident and a separate test database, explicitly opt in from PowerShell:

```powershell
$env:HANDLINK_LIVE_OLLAMA = '1'
pnpm exec playwright test --config=playwright.ai.config.ts -g 'installed local Ollama'
Remove-Item Env:HANDLINK_LIVE_OLLAMA
```

The live check uses only the fixed local Ollama endpoint. It is skipped during normal test runs.
