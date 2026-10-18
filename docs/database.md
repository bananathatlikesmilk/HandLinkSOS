# HandLink database foundation

SQLite and the existing Better Auth tables remain in place. Authentication identities live in `user`; Better Auth's `account` table contains login credentials/provider data, not a second application account.

## Apply and recover

### One-time Docker admin seed

Set `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD` in the server's private `.env` before running `docker compose up` (or `docker compose -f compose.production.yaml up -d`). Use an unused email and a unique password of 12–128 characters. Do not commit these values. Rebuild or pull an image containing this change before starting it.

Every container startup runs migrations, then `scripts/seed.ts`, then the server. Migration `0010_admin_seed_history` adds a `seed_history` table without changing existing data. The `initial-admin-v1` record commits in the same immediate transaction as the new admin and hashed credential. Concurrent startups recheck that record under the write lock. Once recorded, startup never seeds again or resets credentials, even if environment values change or are removed. The record belongs to the persistent database, not the container.

If all seed settings are absent, startup skips seeding without recording completion. Partially configured or invalid settings, duplicate emails, and database failures stop startup without a partial seed. Existing accounts are never promoted, overwritten, or treated as a successful seed. Fix configuration and restart. The seed creates one admin, not a User-role account or sample records.

After successful seeding, remove all three seed settings from `.env` and recreate the container to remove them from its environment. Verify the admin email at `/user/verify`, then sign in at `/admin/login` and set up the authenticator. Seeding sends no email and bypasses neither email verification nor MFA. `pnpm db:seed` can run the same seed manually after migrations.

Keep the database volume when recreating containers; deleting it deletes both accounts and seed history. Do not delete the seed record to reset an admin password. Use account recovery instead. When rolling back application code, leave the additive table and record in place; older code ignores them. Restoring a backup also restores its seed state, so remove bootstrap credentials after setup.

### Create an admin account locally

Run `pnpm admin:create` in the project terminal. Enter the admin name, email, and a password of 12–128 characters. Password entry is hidden and requires confirmation. This command requires access to the server and its configured database; it adds no public admin signup endpoint. It uses Zod validation, Drizzle transactions, and Better Auth password hashing. Existing accounts are never overwritten or promoted.

The account starts with an unverified email. With the app running, open `/user/verify`, enter the admin email, and click **Resend code**. Verify the emailed code, then go to `/admin/login` rather than the User login page. No email is sent by the setup command itself. Keep server and database access restricted to trusted operators.

Run `pnpm db:migrate`. The script loads `.env`, backs up an existing database into ignored `.db-backups`, applies committed migrations, and checks foreign keys. Never use `db:push` against a database containing important records.

Migration 0001 only adds application tables and indexes. It preserves the existing auth and task tables. Backups contain private data: restrict OS access and encrypt production backups. File permissions alone are not encryption; Windows access should be restricted with filesystem ACLs.

Migration 0002 adds `account_audit` and an email uniqueness index using `lower(email)`. It does not rebuild or delete existing tables. Check for case-insensitive email duplicates before applying; duplicates require manual review, never automatic account merging. To undo only this expansion, stop the new application first, export any audit rows for retention, then remove the new index/table using a reviewed migration and run the previous application version. The pre-migration backup is the recovery option if the migration fails.

To roll back, stop the application and database writers first. Restore the verified pre-migration backup to `DATABASE_URL`; preserve the newer database separately if it contains records created after migration. Restoring an older backup loses later writes. Do not restore while the app is running.

## Implemented API

`GET /api/profile` reads the authenticated User's personal, medical, and emergency-contact records. `PUT /api/profile` creates or replaces those records in one transaction. Send a strict JSON object containing `firstName`, `lastName`, `birthday` (YYYY-MM-DD), `sex`, international `phone`, `medical`, and `emergencyContacts`. Medical fields are `bloodType` (nullable), `chronicCondition`, `allergies`, `currentMedications`, and `additionalInformation`. Contact fields are `firstName`, `lastName`, `phone`, `email`, and `relationship`. At least one contact is required, up to ten.

The API requires a valid Better Auth session, verified email, User role, and active account/profile. Writes require an Origin matching the app URL and application/json; bodies are limited to 32 KiB even without Content-Length. Owner IDs, role, linked contact accounts, and timestamps are server-controlled. Private responses use no-store. Contact replacement clears linked-account references until links are verified again. Location-access revocation remains part of the future sharing APIs.

Public registration cannot choose a staff role. Real login now requires verified email and passwords of at least 12 characters. SMTP email verification and password recovery use Better Auth Email OTP. Codes expire after five minutes, allow five attempts, and are stored as server-secret HMAC hashes. Email delivery requires configured SMTP settings. Native Capacitor authentication will need an explicit approved-origin/session design before writes are enabled from native apps.

Successful password resets revoke all existing database sessions for every role. Password length is enforced server-side at 12–128 characters; the reset endpoint rechecks and consumes the email code. Admin and Dispatcher forgot-password pages now support requesting/resending a code, checking it, setting a confirmed new password, and returning to the correct role's login. Staff recovery keeps codes/passwords only in component memory; refreshing restarts the flow. Resetting a password does not change account roles or disable MFA.

### Required staff MFA

Admin and Dispatcher workspaces and Admin APIs require an active, verified staff identity, an enabled/verified authenticator, and MFA proof attached to the current database session. Password-only sessions can open only the staff security setup page. Existing sessions without MFA proof must enroll or sign in again; changing a user flag cannot upgrade old sessions.

Set up at `/admin/security` or `/dispatch/security`. After confirming the current password, enter the displayed private, time-based setup key into an authenticator app. Save the ten backup codes, then enter a six-digit authenticator code. Keys/codes appear only in browser memory and are cleared after setup. Better Auth encrypts stored TOTP secrets and backup codes using the auth secret; protect and back up `BETTER_AUTH_SECRET` alongside the database.

Every new staff login requires an authenticator code or a single-use backup code. Trusted-device bypass is disabled. Native challenge attempt limits and account lockouts remain enabled. The API applies strict Zod formats and rejects client-written MFA/session proof. Password-only sessions cannot disable MFA, retrieve setup secrets, or generate backup codes. Email password recovery does not bypass MFA.

With a backup-code login, staff can generate replacement backup codes or replace a lost authenticator from Account security after confirming their password. Replacement invalidates the old authenticator, retires other sessions, and blocks workspace access until new setup is verified. There is no public MFA reset when both the phone and all backup codes are lost.

Migration 0003 adds nullable `session.mfa_verified_at` without deleting session/account records. Existing rows remain unproven. The marker is server-owned, set only when native factor-verification handlers create a session, and excluded from returned session fields. To roll back the application, keep this additive column; an older version can ignore it. Rolling back enforcement weakens staff protection and should happen only during controlled maintenance.

### Admin account management

`/admin/accounts` reads real accounts with a bounded, paginated name/email search and role filters. `GET /api/admin/accounts` returns only account ID, name, email, role, access/verification status, and creation time. Medical data, contact details, password hashes, tokens, and sessions are excluded.

`POST /api/admin/accounts` accepts only `name`, `email`, `password` (12–128 characters), and `role` (`admin` or `dispatcher`, defaulting to `dispatcher`). Email starts unverified. Names/emails are normalized and validated by Zod; passwords use Better Auth hashing. Identity, credential, and role-specific creation audit writes share one immediate Drizzle transaction. Duplicate emails return 409, including case differences and concurrent creation. Each admin can create up to 20 staff accounts per hour across both roles, counted from the database audit log.

`POST /api/admin/accounts/[id]/verification` accepts an empty JSON object and sends through the existing rate-limited Email OTP endpoint. Saving and sending are separate operations: failed SMTP delivery leaves the saved account available for an email-only retry. Staff verify at `/user/verify`, then sign in at `/admin/login` or `/dispatch/login` for their role. Authenticator setup and verification are required before workspace access. Share initial passwords privately. This version does not force a password change at first login.

`PATCH /api/admin/accounts/[id]` accepts only `{ "active": true | false }`. Admins cannot change their own status or deactivate the last active verified admin. Deactivation revokes sessions, marks a linked profile deactivated, and cancels sharing without deleting records. Reactivation clears those account/profile flags; old sessions and sharing sessions stay revoked. Account changes write actor, target, action, and time to `account_audit` in the same transaction.

These APIs recheck current administrator role, verified email, active account, and the current database session with MFA proof after asynchronous work and inside write transactions. Writes reuse the Origin, JSON, and body-size checks above. The Better Auth admin plugin's parallel HTTP management endpoints are disabled, preventing deletion, role escalation, or impersonation from bypassing this API. Admin creation is available in Manage Accounts; the trusted local setup command remains available for initial provisioning. Website role editing and deletion are not provided.

Migration 0004 expands the audit action constraint to include `admin_created`, copying every existing audit row and restoring its indexes. Run `pnpm db:migrate` before deploying the updated application; the command backs up the database first. An older application can keep the expanded constraint. Restore the private pre-migration backup only during controlled rollback, accounting for any records added afterward.

## Connected SOS workflow

The User dashboard loads eligible profiles from `GET /api/incidents/targets`. Eligibility includes the caller's saved profile and active User profiles that explicitly approved that caller through a directional trusted connection. Client-side preview profiles never grant SOS permission.

The SOS page obtains current device GPS, then starts a five-second cancellable countdown. Cancellation or leaving the page before submission sends no alert. After submission starts, the UI waits for server confirmation and cannot cancel that incident. GPS is the initiating device's location, including when requesting help for another person. Denied or unavailable location prevents submission; no fictional coordinates are substituted.

`POST /api/incidents` accepts only the existing strict Zod incident schema. The server derives caller identity, name, relationship, status, and timestamps. One immediate transaction checks current session/account/permission, inserts the incident, and records its creation event. Reusing the same UUID retry key and payload returns the original incident; changed payloads return 409. Another unresolved incident for the same caller/person also returns 409. New requests are limited to 10 per caller per minute; successful retries are exempt. The client saves the pending payload per signed-in account in session storage before sending, preserving the key after network/server uncertainty. `GET /api/incidents` returns only that caller's latest 50 submitted incident summaries.

`GET /api/staff/incidents` requires an active, verified Admin or Dispatcher with current-session MFA. Its search/filter results are paginated to 20 rows, with minimal caller/person identification and status. Dispatchers see unassigned alerts and their own incidents; other dispatchers' assigned incidents are excluded from rows and counts. The SOS queue refreshes every five seconds while visible. This is an in-app queue update, not background push notification or a guarantee that a dispatcher has seen the alert.

`POST /api/staff/incidents/[id]/confirm` requires `{ "verballyConfirmed": true }`. Only a Dispatcher can claim an unassigned incident; immediate transactions serialize competing claims. `GET /api/staff/incidents/[id]` returns registered personal/medical/contact information and incident notes only to its assigned dispatcher. Other dispatchers receive 404 for assigned incidents; Admins receive a minimal overview. Claiming records the dispatcher and confirmation time.

The assigned dispatcher can `POST /api/staff/incidents/[id]/notes` with up to 2,000 characters and `PATCH /api/staff/incidents/[id]` through `In progress`, `On route`, then `Resolved`. Invalid transitions or other dispatchers' writes fail. Every change and audit event share a transaction; resolution records the server end time and prevents further edits. Writes reuse same-origin, JSON, bounded-body, and strict Zod checks. Admin oversight is read-only. No new schema migration is needed for these endpoints.

`/dispatch/reports` lists the signed-in dispatcher's assigned incidents using `GET /api/staff/incidents?view=reports`; rows, searches, and counts remain owner-scoped. `/admin/reports` shows all assigned incidents for read-only oversight. `GET /api/staff/reports/[id]` returns report metadata, caller relationship, GPS, timestamps, and saved response notes only to the assigned dispatcher or an Admin. Unknown, unassigned, and other dispatchers' report IDs return 404. Reports derive from the saved incident and its audit notes; no duplicate incident/status record is created. The assigned dispatcher can advance status from the report page through the same protected status endpoint. Resolved reports are read-only. AI summaries use local Ollama with dispatcher preview, approval, and version history; see [local AI setup](ai-summaries.md).

## Trusted-profile QR approval

In Profiles, a verified User with a saved profile requests a code through `POST /api/trusted/qr/challenge` with an empty JSON object. The server sends only to the signed-in account's email. Codes expire after five minutes, allow five guesses, and are stored as HMACs bound to account, purpose, and request ID. Failed guesses commit their attempt count before the HTTP error. Requests have a 60-second cooldown and a five-per-hour limit; mail failures invalidate their code and still count toward the limit.

`POST /api/trusted/qr` consumes `{ requestId, code }` once and returns a single-use QR invitation valid for ten minutes. The QR payload is `handlink:qr:v1:<token>`, containing only a random 256-bit token. The database stores its SHA-256 hash. The browser keeps the token in memory, and responses use `no-store`. Issuing a new QR invalidates older unused invitations. `DELETE /api/trusted/qr/[id]` with an empty JSON object locks the owner's unused code without deleting retained records or cancelling existing approval requests.

Camera or image decoding stays in the browser. `POST /api/trusted/scan` accepts only `{ token, relationship }` and creates a pending directional connection. A profile owner grants a requester permission to send SOS for that owner; it is never reciprocal automatically. The first scan consumes the QR inside the same immediate transaction as connection creation. An identical scanner retry returns the pending request; another scanner cannot use the same code. Self, expired, locked, inactive-owner, and malformed codes fail. An account can have at most 100 active pending/approved relationships.

`GET /api/trusted` returns only the signed-in profile's active relationships, names, IDs, and approval status, without medical or contact data. Profiles polls while visible. Pending incoming requests require explicit owner approval with `PATCH /api/trusted/[id]` and `{ action: "approve", invitationId }`. The invitation version prevents an old approval from authorizing a newer request. Either party can decline, cancel, or remove access with `{ action: "revoke" }`. Records remain in the database. Re-requesting a removed relationship requires a fresh verified QR and a new approval. All writes recheck session, account, profile, relationship ownership, and strict Zod inputs inside immediate transactions.

Approved profiles appear in SOS targets. Revocation blocks subsequent SOS submissions immediately; existing incident records remain. No background push notifications are sent for approval requests yet: the owner reviews them in Profiles. This workflow uses the existing database tables and needs no migration.

### On-behalf SOS notifications and cancellation

Creating SOS for an approved trusted profile saves one `notification` for the person in distress in the same immediate transaction as the incident and audit event. Retrying the same SOS cannot create duplicate notifications. Self SOS does not create this beneficiary notification. Existing incidents are not backfilled.

`GET /api/notifications?page=1` returns only the signed-in User's SOS and location-sharing notices, 20 per page, with unread notices first. SOS notices include caller name, incident status, and cancellation decision. Location notices include owner name, session ID, and current availability. Neither exposes medical data, contact details, or coordinates. `POST /api/notifications/[id]/read` accepts `{}` and marks only the recipient's own notice as read. The User bell and `/user/notifications` refresh every five seconds while visible. This is in-app polling. Optional Android FCM delivery now processes these existing notices with session-bound devices and a durable delivery table; see [push notifications](push-notifications.md). Email alerts for these events are not connected.

The person receiving an on-behalf SOS can submit `POST /api/incidents/[id]/cancellation` with `{ reason }`, trimmed to 1–500 characters. The caller and unrelated users cannot submit it. One request per incident is retained in `incident_cancellation`; rejected requests cannot be resubmitted. An identical pending retry returns the existing request. Requesting cancellation does not change incident status.

Only the assigned, MFA-verified dispatcher can submit `POST /api/staff/incidents/[id]/cancellation` with `{ decision: "approve" | "reject" }`. Approval records reviewer/time and closes the incident as `Resolved` with an end time, including from `In progress`. Rejection retains the current response status. Normal resolution is blocked while review is pending. Reviews, incident updates, audit events, and resetting the beneficiary notice to unread share one immediate transaction. Concurrent decisions cannot overwrite a completed review. Dispatchers must confirm through their separate dispatch process before stopping a response; this application does not control external calls or dispatch systems.

Unassigned dispatchers see a pending badge, without the reason. The assigned dispatcher sees the reason in SOS alerts and Incident reports. Admin reports show the request for oversight without mutation controls. Other assigned dispatchers cannot access that incident's report.

Migration `0005_sos_cancellation.sql` adds the request table and expands incident audit event types while copying all existing event rows. The migration command creates a private backup first. Existing records, foreign keys, and SQLite integrity were checked after applying it. For application rollback, retain the additive table and expanded check: old readers remain compatible. Do not drop cancellation records or restore an older backup over newer incidents.

### Optional mutual trusted access

During initial approval, an owner may send `{ action: "approve", invitationId, requestMutual: true, mutualRelationship }`. The relationship is required and limited to 100 characters. Approval creates a separate reverse request in `pending` status; the other person must approve it independently. Leaving the checkbox unchecked preserves one-way permission. Existing pending/approved reverse relationships stay unchanged. A removed reverse request can be renewed only during approval of a fresh original request. Replaying an already-approved original never recreates removed reverse access. Both directions share the existing connection limits and transactional checks.

### Location sharing

The sharing pages use real sessions, selected recipients, and browser GPS. `GET /api/sharing` returns the owner's latest session, up to 100 active sessions shared with the signed-in User, and eligible recipient choices. Approved trusted connections in either direction qualify. Emergency contacts qualify only when their server-maintained `linked_user_id` matches an active, verified User and the saved contact email still matches that account. Typing an email does not create a link or grant access. Contacts without a verified link can use the existing QR approval flow.

`POST /api/sharing` accepts strict `{ id, durationMinutes, recipientUserIds, point }`. The UUID `id` is a retry key; duration is 1–240 minutes and the owner explicitly selects 1–20 distinct eligible recipients. `point` contains latitude, longitude, accuracy, and a recent ISO `recordedAt` capture timestamp. Zod rejects malformed, stale, out-of-range, privileged, and duplicate fields. An immediate transaction rechecks current identity and recipient eligibility, limits each owner to one active session and ten starts per hour, and saves the session, initial position, recipients, and their in-app invitations together. Reusing a key returns the existing session only for the same owner, duration, and recipient set; it never starts a second session.

`POST /api/sharing/[id]/points` accepts the same point fields. Only the active owner can update. The server saves its own receipt time and permits at most one position update per five minutes. It replaces the latest position instead of accumulating a movement history. The global User layout publishes while visible, including after navigation away from the sharing page. Hidden tabs, screen locking, closed apps, denied location permission, and network failures can pause updates. No browser-only code guarantees background tracking. GPS needs a secure context such as HTTPS or localhost.

`GET /api/sharing/[id]` checks the current account, current trusted/contact eligibility, and the saved recipient grant on every request. Unselected users and staff cannot read coordinates. Recipients see no other recipient identities. `POST /api/sharing/[id]/stop` accepts `{}` and only the owner can stop the session. Stopped or expired sessions return no coordinates, including to the owner. Recipients receive 410 for ended sessions or 404 when access is unavailable. Trust removal, linked-contact edits, and account deactivation persist recipient revocation; reapproval or reactivation does not restore an old grant.

The current-sharing list and viewer poll every five seconds while visible. Maps and coordinates clear on authorization failure, expiry, tab hiding, or account/session change. The viewer labels positions over five minutes old as potentially stale. OpenStreetMap loads only after the viewer chooses **Load map**, with clear notice that the provider receives the viewed coordinates. It requires no API key. Third-party map availability and physical-device GPS still need device checks.

Expiry is server-owned. A long-running app server sweeps every 15 seconds; sharing and notification reads also catch up missed expiries. `pnpm locations:expire` runs the same database-backed sweep once, suitable for a scheduled task if deployment suspends the app process. Each sweep processes up to 100 pending expired sessions. The expiry marker and uniquely keyed owner/eligible-recipient notifications commit together, so restarts, overlapping sweeps, and retries cannot duplicate notices. Cancellation suppresses expiry notifications. Timer expiry removes access and notifies; it never creates SOS or controls the external dispatch system. Opted-in Android installations can receive generic FCM notices while backgrounded; delivery still depends on device and network conditions.

This feature reuses existing tables and needs no schema migration. Run `pnpm exec playwright test --config=playwright.database.config.ts tests/sharing.api.ts tests/sharing.frontend.ts` for isolated API/browser checks. Tests use temporary databases, blocked map responses, and empty SMTP configuration.

## Tables and ownership

- `user_profile` references one auth user; `medical_profile` and `emergency_contact` reference the profile.
- `trusted_connection` references owner and requester profiles. Approval is directional; no self-connections or duplicate pairs.
- `qr_invitation` stores only a token hash. `verification_request` stores a code hash, purpose, expiry, attempt count, and optional connection binding. Future OTP code hashing must use a server-secret HMAC to protect low-entropy codes; tokens must be cryptographically random. Issuance, delivery, expiry, cooldown, attempt counting, and single-use consumption require transactional APIs, not just table constraints.
- `incident` references person in distress, caller, and optional assigned dispatcher. Start/end times are server-owned. `incident_event`, `report`, and `call_session` reference an incident.
- `incident_cancellation` references one incident, the beneficiary requesting cancellation, and the dispatcher reviewing it. Review state, timestamps, reason length, and one-request uniqueness have database constraints.
- `location_session` belongs to a profile; `location_point` and `location_recipient` reference that session. Each recipient references an auth user.
- `device` stores a push token per installation. `notification` references recipient and optionally an incident or sharing session.
- `account_audit` references the administrator and affected identity. It stores account actions, never credentials or medical information.

Foreign keys are enabled on every application connection. Identity, profile, incident, and audit-record deletion is restricted to preserve incident history. Account deactivation revokes sessions and stops sharing; do not delete retained incident records.

## Remaining integration

An Android client, native GPS adapter, and opt-in screen-off location service are prepared. APK compilation and physical-phone behavior still require Java 21+, Android SDK 36, and device checks. See [Android setup and testing](android.md). The localhost client uses USB forwarding; it does not require exposing the development server to the internet. Incoming Firebase push is integrated with explicit Android opt-in; physical receipt must be tested. Overlay permission remains separate. Saved SOS submissions now hand off to an empty Android dialer or a browser phone link; see the Android guide for device checks.

The UI uses real login, server-protected role portals, database-backed profiles, logout, deactivation, Admin account management, trusted-profile QR approval, connected SOS/report workflows, and foreground location sharing. It no longer inserts or displays sample User profiles or staff accounts. Android screen-off tracking is prepared but still needs physical-device verification; incoming background push remains pending. AI summaries use local Ollama with validated requests and assigned-dispatcher approval. See [Android setup](android.md) and [local AI setup](ai-summaries.md).

Background notifications need a delivery provider, device permissions, and retry handling. A suspended or serverless deployment must schedule the expiry command rather than relying on an in-process interval. AI needs an explicit approved, redacted input contract and reviewed output; never send registered medical history automatically. Calls use the dispatcher's separate system; no in-app voice provider is planned. The existing `call_session` table is a dormant legacy table retained to avoid deleting records.

Production also needs HTTPS, restricted database filesystem access, encrypted storage/backups, monitored rate limiting, and a defined retention policy. No schema can guarantee all system security by itself.

## Verification commands

Run `pnpm test:db` for migration, constraint, transaction, and Zod tests. Run `pnpm test:api` for profile/account/SOS API security tests, account browser flows, and SOS cancellation, retry, and dispatcher workflow checks against a temporary database, never your development database. Test SMTP settings are explicitly empty so tests cannot send through the configured real account. Run `pnpm exec playwright test` for existing browser regressions and anonymous API rejection.

## SMTP setup

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in your ignored local `.env`, using your provider's SMTP settings and app password where required. Port 465 uses implicit TLS; other ports require STARTTLS. Restart `pnpm dev` after changes. Keep credentials out of chat, browser code, and version control. Registration/verification/recovery remain unavailable when configuration is missing. Live SMTP delivery has not been tested without provider credentials.

`POST /api/register` validates registration details, calls Better Auth's rate-limited HTTP signup endpoint, and saves a newly created unverified account's profile. It never overwrites an existing account's profile. The account must verify its email before sign-in. Staff accounts require administrator provisioning; public signup cannot set staff roles.

Run `pnpm test:frontend` for database-backed login/profile browser tests in an isolated database.

Run `pnpm test:trusted` for QR code ownership, OTP expiry/guess limits, single-use races, owner approval, directional SOS authorization, revocation, transaction rollback, image scanning, and browser workflow checks. It uses a separate database and unusable SMTP settings. Browser tests intercept only code delivery and seed test HMACs; QR issuance, scanning, approval, and removal use the real server. No real email is sent. Physical camera scanning still needs a real-device check over HTTPS or localhost.

Run `pnpm exec playwright test --config=playwright.recovery.config.ts` for password-reset session revocation, code/length rejection, and staff recovery browser tests. This suite uses an isolated database and unusable local SMTP settings. Browser tests intercept only mail requests and seed HMAC codes; password updates and login use the real server. It does not send real email or replace a live delivery check.

Run `pnpm exec playwright test --config=playwright.mfa.config.ts` for staff enrollment, password-only access denial, TOTP and one-use backup login, replacement, lockout, and password-reset/MFA separation. Test authenticator secrets belong only to isolated fixtures. All database-backed test servers use separate generated output and Vite caches so they cannot overwrite the running main app's environment.

## Short incident references

Each incident retains its UUID for API URLs and database relationships. Screens show a separate reference such as `HL-0002415`. Alerts, report records, User recent alerts, and SOS notifications use the same reference. Staff can search by reference, UUID, or name; reference searches retain the same ownership and role checks. A reference grants no access by itself.

The `incident_reference` table maps one positive auto-increment number to each incident UUID. The database formats it with an `HL-` prefix and at least seven digits, expanding rather than truncating larger numbers. Migration `0008_incident_references` backfills old incidents by creation time and UUID, without rewriting incidents or their related records. Existing UUID links remain valid.

An insertion trigger allocates the number in the incident transaction, including for older code that inserts incidents without knowing about references. Unique constraints and immutable-update/deletion triggers preserve committed references. Failed incident transactions also roll back reference allocation. Keep these triggers in future migrations; do not replace this migration with a schema push that omits its custom SQL. Use `pnpm db:migrate`, which creates a private backup first.

For application rollback, retain the added table and triggers. Older code can continue using UUIDs while reference allocation stays intact. Never reset the sequence or delete mappings to shorten or renumber existing references.
