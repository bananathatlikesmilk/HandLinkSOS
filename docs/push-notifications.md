# Android push notifications

HandLink now connects its existing SOS and location-sharing notification records to Firebase Cloud Messaging. Notifications are generic: no names, GPS coordinates, medical history, incident details, or credentials appear in a push payload. Opening an alert leads only to the signed-in notifications page, where the existing authorization checks apply.

## Configuration

- Android package: `com.handlink.sos`.
- Android Firebase file: `android/app/google-services.json`. This belongs to the Android app and is excluded from Git.
- Server credential: a Firebase service-account JSON stored outside this repository. Set its **absolute path**, using forward slashes on Windows, in the private server `.env`:

  ```env
  FIREBASE_SERVICE_ACCOUNT_FILE="C:/private/handlink-firebase-service-account.json"
  ```

The configured server credential was checked against the Android project's ID and successfully authenticated with Google. No test notification was sent. Keep the file protected and readable only by the server operator/runtime. It must not be added to Git, pasted into chat, or placed in Android assets. For deployment, use a dedicated service account with only the FCM permissions needed to send messages.

Restart `pnpm dev` after configuring the server. Other clones need their own private setup; credentials do not travel with Git. The normal server remains responsible for account authentication, SQLite records, and validation; this does not introduce Firebase Authentication or move the database to Firebase.

For the supplied Docker deployment, use the optional `compose.firebase.yaml` extension:

```powershell
docker compose -f compose.production.yaml -f compose.firebase.yaml up -d --build
```

The host credential path must exist and be readable by the application's runtime user. The extension mounts it read-only at `/run/secrets/handlink-firebase.json`; it is never copied into the image. The base production configuration continues to work without Firebase when this extension is omitted.

## Phone setup and testing

1. Install the rebuilt `android/app/build/outputs/apk/debug/app-debug.apk` on the Android phone.
2. Start the computer's server and keep the debug USB forwarding active as described in [Android setup](android.md). This APK still targets `http://localhost:5173/user`.
3. Sign in with a User account and open **Settings → Phone notifications**.
4. Press **Enable phone notifications** and allow Android's permission prompt. Google Play services and internet access are required. The app never prompts automatically during ordinary navigation.
5. With two consenting test users and an approved trusted-profile connection, background the recipient app and start a location-sharing session directed to that recipient. Confirm that a generic system notification appears and opens HandLink's notifications page.
6. Test the final-minute sharing warning and expiry notice. Use fictional test records; do not place an emergency call. Verify SOS on behalf of a trusted user only in a controlled test incident.
7. Disable phone notifications, sign out, revoke trusted access, and stop or expire sharing. Verify that new ineligible alerts do not arrive. Previously queued generic messages can still arrive after logout; no personal details are included.

Normal backgrounding differs from force-stopping an Android app. Android settings, Google Play services, network loss, battery restrictions, force-stop, and Firebase delivery delays can prevent or postpone notifications. The one-minute warning is not an exact alarm or a guaranteed emergency channel. An owner with the separate native local sharing reminder enabled may also receive that local reminder.

## Server behavior

- `GET /api/push/devices` returns configuration and registration status without tokens.
- `POST /api/push/devices` accepts only an Android platform and a bounded token through Zod. Same-origin checks, verified active User authentication, and a device-count limit apply. It binds the token to the current session; token rotation revokes the old registration. Re-registering the same token/session is idempotent.
- `DELETE /api/push/devices` revokes only a token owned by the signed-in user. Deleting a sign-in session cascades to its device binding. Expired sessions, banned/deactivated accounts, and mismatched account/session ownership cannot receive newly dispatched push alerts.
- A persistent Node server checks for eligible notifications every five seconds. The existing location scheduler checks timing separately. Read, old, stopped, expired, or no-longer-authorized sharing alerts are skipped. Final-minute messages expire at the sharing deadline.
- Each eligible notification/device pair has one durable delivery row. A lease coordinates concurrent workers. Transient failures retry with backoff, up to five attempts within the freshness window. Invalid Firebase tokens are revoked. The notification tag reduces duplicate tray entries, but a server crash after Firebase accepts a message can cause a retry; exactly-once delivery is not promised.
- `push_delivery.accepted_at` means Firebase accepted the message. It does not prove the phone displayed it. Existing `notification.delivered_at` values are left unchanged.
- Hosting must keep the Node process running. A sleeping/suspended backend cannot run the delivery timer. FCM acceptance and real phone display remain distinct checks.

## Migration and rollback

Migration `0009_android_push` adds a nullable device-to-session binding and a delivery table. It preserves existing accounts, profiles, incidents, notification read states, and legacy device tokens. Legacy tokens with no session binding do not receive push until re-registered. The migration command creates a private backup and verifies foreign keys.

Application rollback can retain these additive fields and tables. Do not drop data or restore an old backup over newer records merely to disable push. Disable new delivery by removing the server's Firebase credential setting and restarting the backend; in-app notifications continue to work.

## Verification

```powershell
node --test tests/push-delivery.test.mjs tests/database.test.mjs
pnpm exec playwright test --config=playwright.push.config.ts
pnpm check
```

Automated API/browser tests use temporary SQLite databases, generated fictional service credentials, and a mocked Firebase sender. They never send to real phones. Delivery unit tests cover concurrency, retry behavior, invalid tokens, privacy, stale alerts, revoked sharing access, and session/account restrictions. APK compilation and signature checks pass. Physical phone display and tap behavior still require the steps above.
