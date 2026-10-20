# Account, navigation, and dispatch update

## Accounts and forms

All three account roles sign in at `/login`. The old User, Dispatcher, and Admin login addresses redirect there. The server reads the signed-in account's role and selects the destination. Entering a staff address does not grant staff access. Staff still need MFA setup and verification.

Login has one password field with a visibility button. Registration and password reset retain confirmation fields. Required fields show an asterisk. Registration checks each step before continuing. Medical information remains optional. Philippine phone fields start with `+639`; a complete Philippine number needs nine more digits. Relationship fields use dropdowns and preserve previously saved custom values.

## Navigation and appearance

User pages have a fixed bottom navigation on phones and a fixed sidebar on wide screens. Staff pages have a desktop sidebar and a mobile navigation drawer. Buttons have readable labels and larger touch targets. Light and dark preferences persist in browser storage and synchronize across tabs. Storage restrictions can prevent persistence.

The Admin dashboard reads actual database counts, including accounts and incident stages. The incident queue is under Alerts. Dashboard counts refresh every 15 seconds while visible. The Updates page refreshes every five seconds and when an opted-in foreground Android push arrives. The notification permission control also refreshes when the app regains focus. Browser and Android settings can still block notifications.

The QR scanner releases camera tracks after a successful scan, when hidden, and when leaving the page. Camera access still requires the device owner's permission.

App permissions use switches with visible On, Off, or Blocked labels. Location and camera switches request access; when Android refuses to show another permission prompt, the app opens its Android settings. Turning an allowed permission off also opens Android settings because applications cannot revoke their own system permissions. The switch reflects the actual permission when the user returns. In a browser, changing an already allowed permission requires the browser's site settings. The floating-button switch requests overlay access if needed, starts the button after approval, and stops it directly when switched off. Its state reports whether the floating button is running, separately from the Android overlay permission.

## Dispatcher notes and resolved reports

Dispatchers confirm the verbal confirmation checkbox before using the confirmation button underneath it. Personal, contact, and medical information appears in tables.

Assigned dispatchers' active incident notes autosave after a 1.2-second typing pause. Saves run in sequence. Each new client sends the note version it edited; a conflicting save returns 409 and preserves the draft. Reloading saved notes requires explicitly discarding that draft. Internal navigation flushes pending notes; browser navigation warns about unsaved changes. Status changes wait for pending notes to save. Older clients remain compatible but do not provide the new version check.

After resolution, original incident notes remain locked. The assigned dispatcher can append a dated addendum. The server records the author and timestamp. Addenda are append-only and do not replace original notes, the original AI source, or the saved summary. Repeating an identical request ID does not duplicate an addendum. The server rechecks role, MFA, assignment, and resolved status for every request.

## Deployment

These changes are local until the server operator deploys them. Pushing Git changes alone does not prove the running server updated.

1. Back up the server database and persistent data.
2. Deploy the updated application image and retain the existing data volume.
3. Startup runs database migrations through the existing startup script. Migration `0011_incident_addenda.sql` adds the addendum table and index. Confirm migration success before accepting traffic.
4. To run AI on the server, use `compose.ollama.yaml` together with the existing production Compose files. See [AI setup](ai-summaries.md). Initial model download requires internet, disk space, and sufficient server memory. No Ollama host port is published.
5. Verify each account role, staff MFA, notification settings, QR scanning, autosave, and a resolved-report addendum using fictional test data.

Migration 0011 is additive. A local backup was created before applying it. For application rollback, retain the addendum table and its data; older application code can ignore it. Do not drop the table to roll back application code. Restore a full database backup only with an explicit recovery plan, because restoration also removes changes made after that backup.

The APK's native permissions and plugins are unchanged by this update. An APK connected to the deployed site loads the deployed web changes. Real camera, notification delivery, and phone-specific appearance still need device checks. Server AI container startup and real inference need operator verification.

Admin now has **AI settings** to select Ollama or Google Gemini system-wide. Gemini requires `GEMINI_API_KEY` in the private server `.env`, an app restart, and migration `0012_ai_provider_setting.sql`. Dispatchers explicitly consent to cloud processing before Gemini receives reviewed notes. See [AI setup](ai-summaries.md) for configuration, privacy, and rollback details. Apply all pending migrations when deploying, including 0012.

## Verification

Type checking, the production build, ESLint, Prettier, and Svelte autofixer checks passed. Twenty database and mobile configuration checks passed, including preservation of existing records through migration 0011. Ten final account, navigation, registration, and QR browser checks passed. The AI suite passed seven mocked API/browser checks; two opt-in real-model checks were skipped. Focused incident tests also exercised autosave sequencing, conflicts, navigation, locked resolved notes, dated addenda, and retries after a lost response.

Useful commands:

```powershell
pnpm check
pnpm build
node --test tests/addenda-migration.test.mjs tests/database.test.mjs tests/mobile-config.test.mjs
pnpm exec playwright test --config=playwright.usability.config.ts
pnpm exec playwright test --config=playwright.ai.config.ts
```

The browser suites use isolated test databases. Do not replace their test configuration with production credentials. Mocked AI checks prove request handling and data preservation, not model accuracy. See the AI setup document for the separate opt-in fictional-data inference check.
