# Android phone testing

This project now includes a Capacitor 8 Android client (`com.handlink.sos`), native permission-aware GPS, and an opt-in foreground location service. The client loads the existing SvelteKit server so login, database access, and validation remain on the computer/server. No database or SMTP secrets are bundled into Android assets.

The Android SDK and Java toolchain were not available during implementation. Capacitor sync, TypeScript checks, web regressions, configuration tests, and simulated bridge tests can run here; APK compilation and physical screen-off behavior still require the setup below. A simulated bridge does not verify Java services or Android battery policies.

## Install the build tools

1. Install [Android Studio 2025.2.1 or newer](https://developer.android.com/studio).
2. In Android Studio's SDK Manager, install Android SDK Platform 36, Android SDK Build-Tools, and Android SDK Platform-Tools. Accept SDK licenses yourself in Android Studio.
3. Use Java 21 or newer. Android Studio includes its Java runtime in its `jbr` folder. Set `JAVA_HOME` to that folder if Java is not on your terminal path.
4. Set `ANDROID_HOME` to your SDK folder. The usual Windows location is `%LOCALAPPDATA%\Android\Sdk`.
5. Reopen the terminal and run `pnpm android:doctor`. It reports missing Java, platform 36, or platform tools without printing credentials.

Do not install an arbitrary APK from an unknown source. Build this repository's debug app through Android Studio.

## Connect localhost by USB

1. On the phone, enable Developer options and USB debugging. Connect by USB and approve this computer's debugging prompt.
2. Start the existing web server with `pnpm dev`. Keep its configured `ORIGIN` consistent with `http://localhost:5173`. Do not expose the development server publicly.
3. Run `pnpm android:prepare`. It syncs the Android client to `http://localhost:5173/user` by default. The generated native config is ignored by Git.
4. Run `adb reverse tcp:5173 tcp:5173`. If `adb` is not on PATH, use `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:5173 tcp:5173` in PowerShell.
5. Run `pnpm android:open`. In Android Studio, select the physical phone and press Run to build/install the debug app.

The USB connection and computer server must remain running. The phone's `localhost` reaches the computer only while ADB forwarding is active; unplugging USB pauses uploads. This is a development setup, not public hosting. A released client needs a deployed HTTPS server and a reviewed deployment/client packaging plan. Capacitor's `server.url` mechanism is primarily intended for development/live reload. Release builds with HTTP or no server URL are blocked.

To target a deployed HTTPS server later, set `HANDLINK_MOBILE_SERVER_URL` for `pnpm android:prepare`. That variable is read by the preparation process, not from the private server `.env`. Remote HTTP, embedded credentials, URL queries, and fragments are rejected. Mixed content is disabled. Main Android network policy blocks cleartext; only debug localhost/127.0.0.1 allow it.

## Use screen-off updates

1. Sign in with a User account in the Android app.
2. Start location sharing for approved recipients and allow Android location access.
3. On the active sharing screen, press **Enable screen-off updates**. Allow notifications so the ongoing sharing notification stays visible.
4. Lock the screen. The native foreground service requests positions at five-minute intervals and sends only fresh positions to the existing owner-only API. Android may delay delivery; it is not an exact five-minute guarantee.
5. Use **Disable screen-off updates** or the notification's pause action to stop the native service while keeping the sharing session active. Use **Stop sharing** to remove server-side recipient access.

The sharing owner and selected trusted profiles each receive one in-app warning during the final minute. This appears across signed-in User screens and in Notifications. Recipients can open the shared location; the owner can manage sharing. Only currently approved trusted profiles selected for that session qualify, including profiles that are also emergency contacts. Emergency-contact-only recipients and unselected or revoked profiles do not receive this advance warning. The server checks timers every 15 seconds; foreground notification polling can add up to five seconds. Stopped or expired sessions no longer show an active warning. Incoming system notifications for recipients still require the separate background push integration.

Migration `0007_location_expiring_notification` expands the allowed notification types and preserves all existing notification fields, read states, indexes, and foreign keys. `pnpm db:migrate` creates a private backup before applying it. If rolling application code back, retain the expanded table constraint; older code ignores the new type. Do not restore an older backup over newer records merely to remove this warning feature.

While screen-off updates are enabled, Android also schedules one local notification for one minute before the timer ends. This requires notification permission and a running service. Android sleep, battery restrictions, or a force-stop can delay or prevent delivery; this is not an exact alarm. Disabling the service cancels its pending warning. Incoming background push remains separate and is not required for this local warning. Rebuild the Android app to include native changes and verify notification timing on the physical phone.

No passwords or auth tokens are exposed to JavaScript by the custom plugin. Native requests use the app WebView's current sign-in cookie, never store a separate credential, send only to the configured app server, reject redirects, and use bounded timeouts/response reads. Existing Origin, Zod, ownership, expiry, and five-minute update checks remain active. Login/role changes or unavailable sessions stop the service when detected; the server rejects invalid updates immediately. Pending permission requests cannot resume updates after Stop sharing or logout.

The service requests foreground location permission, not unrestricted Android background location. It starts only from an explicit in-app action and shows an ongoing notification. A short, bounded wake lock covers uploads; no indefinite wake lock is held. It does not restart automatically after Android kills it. Force-stop, revoked permissions, disabled location, battery restrictions, lost USB/network, or a stopped server can interrupt tracking. Reopen the app and explicitly enable the service again after interruption.

When the service is running at expiry, it can show a local timer-ended notification. The existing server expiry worker creates in-app notices for the owner and eligible recipients. This is not incoming push delivery to another closed app. Firebase Cloud Messaging, its Android application configuration, server credentials, device-token APIs, and delivery handling remain a separate integration. Display over other apps remains unconnected. SOS now opens an empty Android dialer after a confirmed save; it does not place a call.

## Physical-phone checks

- Confirm login, logout, QR camera access, SOS countdown/cancellation, and sharing start/stop work in the installed app.
- Deny location/notifications, then grant them through Android settings and retry. Approximate location must show its actual accuracy rather than claim precise GPS.
- Enable screen-off updates and compare the recipient view after at least two five-minute intervals. Test while moving somewhere safe; do not initiate real emergency calls.
- Stop sharing from the app and confirm a recipient's already-open map disappears. Expired sessions must expose no coordinates.
- Remove trusted access and deactivate/reactivate an account; old location links must remain inaccessible.
- Disconnect USB or network, reconnect, and check that stale positions are labelled and fresh uploads resume while the service is still running.
- Log out or change accounts and verify the ongoing location notification stops. Test force-stop and battery saver; the UI must never claim that uninterrupted tracking is guaranteed.

Run `pnpm test:mobile-config` for URL/network configuration checks. Run `pnpm exec playwright test --config=playwright.database.config.ts tests/native.frontend.ts tests/sharing.frontend.ts tests/incidents.frontend.ts` for web and simulated Android bridge regressions against a temporary database with disabled SMTP.

## Main files

- `capacitor.config.ts`: application ID, server URL validation, and native client configuration.
- `src/lib/native/location.ts`: browser/native GPS adapter and foreground-service bridge.
- `src/lib/user/NativeSharingControls.svelte`: explicit service controls and status.
- `android/app/src/main/java/com/handlink/sos/HandLinkLocationPlugin.java`: permission requests and trusted-server setup.
- `android/app/src/main/java/com/handlink/sos/LocationSharingService.java`: native service, ongoing notification, latest GPS, authenticated uploads, and stop/expiry handling.
- `scripts/prepare-android.mjs` and `scripts/android-doctor.mjs`: USB client preparation and tool checks.

## SOS phone handoff

After a successful SOS save, the user reaches a page showing the saved incident reference and status. The Android app opens the empty phone dialer once for that new submission using ACTION_DIAL. The user must enter a number and press Call. HandLink never places a call, requests call or contacts permissions, or connects to the dispatch phone system. No emergency number is configured yet.

Refreshing or directly opening a saved incident link does not automatically launch the dialer. The server checks that the signed-in user sent the incident. A failed dialer launch keeps the incident saved and provides a manual retry. In a browser, the user must tap the tel: link; support for an empty dialer varies by device and browser. Open the Phone app manually if needed.

Rebuild and install the Android app to include HandLinkPhonePlugin.java and its MainActivity registration. Simulated bridge tests verify the web handoff; they do not compile Java or prove device intent handling. On the physical phone, verify countdown cancellation, successful save, empty dialer opening once, returning to HandLink, refresh without reopening, and manual retry. Do not place a real emergency call during testing.
