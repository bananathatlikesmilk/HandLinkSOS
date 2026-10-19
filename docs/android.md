# Android phone testing

## Current online test APK

The debug APK rebuilt on 18 October 2026 targets `https://thebois.fyi/user`. Its embedded server URL and APK signature were verified. This build needs internet access and the deployed backend; it does not need USB forwarding or a local development server. Install the updated APK over the previous localhost build before disconnecting USB.

To reproduce this target, set `HANDLINK_MOBILE_SERVER_URL=https://thebois.fyi` in the terminal environment before running `pnpm android:prepare`, then build the APK. Running preparation without that variable selects localhost again. The localhost instructions below apply only to builds prepared for USB testing.

The public site served HandLink pages during verification. Its `/api/push/devices` endpoint returned 404 at that time, so the deployed backend still needed the push integration update. Changing the APK URL does not deploy backend code or configure the remote server's private Firebase credentials.

This project now includes a Capacitor 8 Android client (`com.handlink.sos`), native permission-aware GPS, and an opt-in foreground location service. The client loads the existing SvelteKit server so login, database access, and validation remain on the computer/server. No database or SMTP secrets are bundled into Android assets.

A debug APK was built and its signature verified on 17 October 2026 using Java 21, Android SDK 36, and Gradle 8.14.3. Native Java/Kotlin compilation passed. The localhost release guard was exercised and correctly rejected a release pre-build. Physical-phone behavior, permission flows, and screen-off reliability still require device testing; compilation and simulated bridge tests do not establish those results.

## Staying signed in

User login saves a persistent, HttpOnly session cookie. Closing and reopening the app returns an authenticated User to the dashboard. The normal server session lasts seven days and renews with continued use; logout, password reset, account deactivation, session revocation, or clearing app data can require another login. No password is stored on the phone. Admin and Dispatcher login policies are unchanged.

Deploy the updated web code and sign in once to replace an older session-only cookie. This change does not require a new APK. Browser restart tests verify persistent-cookie restoration and logout revocation; Android process-restart behavior still needs a physical-phone check.

## Diagnosing `ERR_SSL_PROTOCOL_ERROR`

On 19 October 2026, the error was reproduced on a connected Samsung Note10+ running Android 12 and WebView 155. The installed APK targeted `https://thebois.fyi/user`. Other HTTPS sites loaded in the same app WebView, while HandLink failed with Chromium error `-107`. A separate HTTPS request from the phone also received `TLSV1_ALERT_ACCESS_DENIED`. This established that the failure was not limited to the app interface or authentication code.

A credential-free HTTP diagnostic request to the domain returned an explicit filtering page: `403 Forbidden`, `The URL is forbidden`, and classification `Non-Managed`. The phone and computer used different public network addresses. The evidence identifies a web filter on the phone's connection as the blocker for this incident; it does not establish that every SSL protocol error has the same cause. Chrome loading the website does not rule out different handling of app traffic.

Have the authorized network administrator allow `thebois.fyi` in the relevant web-filter policy and review HTTPS inspection rules for the domain. Alternatively, verify on another network the phone owner is permitted to use. Then reopen HandLink and confirm the User screen loads without a TLS error. Successful loading after a network change or policy correction still requires device verification. Do not disable certificate verification, accept SSL errors, or change the public app URL to HTTP as a workaround. Rebuilding an unchanged APK does not repair a network filtering rule.

## Install the build tools

1. Install [Android Studio 2025.2.1 or newer](https://developer.android.com/studio).
2. In Android Studio's SDK Manager, install Android SDK Platform 36, Android SDK Build-Tools, and Android SDK Platform-Tools. Accept SDK licenses yourself in Android Studio.
3. Use Java 21 for this project. A newer Android Studio can bundle Java 25, which this Gradle 8.14.3 wrapper does not support. Set `JAVA_HOME` to a compatible JDK rather than assuming the bundled `jbr` is compatible.
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

## Build the debug APK

On the workstation used for the verified build, a checksum-verified portable Eclipse Temurin JDK 21 is installed under the current user's local application data. It does not change global Java settings. From the project root, use:

```powershell
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'HandLink\build-tools\jdk-21.0.12.1+1'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
pnpm android:prepare
.\android\gradlew.bat -p android :app:assembleDebug --console=plain
```

On another computer, set JAVA_HOME to that computer's installed Java 21 folder. SDK components may download during the first build when their licenses are already accepted.

The installable artifact is `android/app/build/outputs/apk/debug/app-debug.apk` (about 4.8 MB for the verified build). It is debug-signed and configured for `http://localhost:5173/user` through USB forwarding. Keep the computer's server and USB forwarding running. Installing the APK alone does not host the backend, database, email delivery, or Ollama on the phone. A public standalone installation still requires a deployed HTTPS backend and a release build.

The first native compilation exposed two build blockers that are now fixed: the release check attaches when Android registers its task, and the main manifest explicitly overrides the generated library's cleartext flag. The debug network configuration continues to permit HTTP only for localhost/127.0.0.1. Release builds still require HTTPS.

## Use screen-off updates

1. Sign in with a User account in the Android app.
2. Start location sharing for approved recipients and allow Android location access.
3. On the active sharing screen, press **Enable screen-off updates**. Allow notifications so the ongoing sharing notification stays visible.
4. Lock the screen. The native foreground service requests positions at five-minute intervals and sends only fresh positions to the existing owner-only API. Android may delay delivery; it is not an exact five-minute guarantee.
5. Use **Disable screen-off updates** or the notification's pause action to stop the native service while keeping the sharing session active. Use **Stop sharing** to remove server-side recipient access.

The sharing owner and selected trusted profiles each receive one in-app warning during the final minute. This appears across signed-in User screens and in Notifications. Recipients can open the shared location; the owner can manage sharing. Only currently approved trusted profiles selected for that session qualify, including profiles that are also emergency contacts. Emergency-contact-only recipients and unselected or revoked profiles do not receive this advance warning. The server checks timers every 15 seconds; foreground notification polling can add up to five seconds. Stopped or expired sessions no longer show an active warning. Eligible Android recipients can now opt into Firebase background push in Settings. See [Android push notifications](push-notifications.md) for setup and phone checks.

Migration `0007_location_expiring_notification` expands the allowed notification types and preserves all existing notification fields, read states, indexes, and foreign keys. `pnpm db:migrate` creates a private backup before applying it. If rolling application code back, retain the expanded table constraint; older code ignores the new type. Do not restore an older backup over newer records merely to remove this warning feature.

While screen-off updates are enabled, Android also schedules one local notification for one minute before the timer ends. This requires notification permission and a running service. Android sleep, battery restrictions, or a force-stop can delay or prevent delivery; this is not an exact alarm. Disabling the service cancels its pending warning. Incoming background push remains separate and is not required for this local warning. Rebuild the Android app to include native changes and verify notification timing on the physical phone.

No passwords or auth tokens are exposed to JavaScript by the custom plugin. Native requests use the app WebView's current sign-in cookie, never store a separate credential, send only to the configured app server, reject redirects, and use bounded timeouts/response reads. Existing Origin, Zod, ownership, expiry, and five-minute update checks remain active. Login/role changes or unavailable sessions stop the service when detected; the server rejects invalid updates immediately. Pending permission requests cannot resume updates after Stop sharing or logout.

The service requests foreground location permission, not unrestricted Android background location. It starts only from an explicit in-app action and shows an ongoing notification. A short, bounded wake lock covers uploads; no indefinite wake lock is held. It does not restart automatically after Android kills it. Force-stop, revoked permissions, disabled location, battery restrictions, lost USB/network, or a stopped server can interrupt tracking. Reopen the app and explicitly enable the service again after interruption.

When the service is running at expiry, it can show a local timer-ended notification. The existing server expiry worker creates in-app notices for the owner and eligible recipients. This local service is separate from the Firebase push integration, which now supports generic SOS and location-sharing alerts for opted-in, authenticated Android installations. Physical-phone receipt still needs testing. Display over other apps now supports an explicitly enabled Android floating dashboard button; see the permission setup below. SOS now opens the Android dialer with 911 filled in after a confirmed save; the user must press Call.

## User startup permissions and floating dashboard button

After a User signs in and opens a protected User screen, HandLink requests location and camera access sequentially. The Android app records that initial attempt in private device preferences; declining does not cause repeated prompts on every navigation or restart. Browser startup uses a device-local attempt marker and makes a best-effort request because browser policies vary. Auth screens and staff portals do not trigger this setup. Denial leaves the app available; the User can retry from Settings. Permission requests never save coordinates or create a sharing session. Browser camera permission checks release their stream immediately; native startup only requests camera permission and does not start the camera.

Settings includes actual location and camera permission status, retry buttons, and an Android app-settings shortcut. Permanently denied permissions must be changed in Android Settings. Camera access is used for QR scanning, not recording in the background. Browser permission-status APIs vary; an unknown status is labelled as not checked rather than falsely shown as granted.

The Android floating button requires a separate opt-in: press **Allow display over apps**, enable HandLink on Android's special-access screen, return, then press **Enable floating button**. Android may also request notification access. Granting display permission alone never starts the button. The foreground service displays a persistent notification and one compact, draggable 48 dp dashboard button with four dots. Hide it through Settings or the notification's **Hide button** action. Its tap opens only the configured server's protected `/user/dashboard`; it never sends SOS, opens the dialer, or places a call. The overlay reads no camera, coordinates, screen content, or input from other apps.

Logout, deactivation, leaving the User portal, removing display permission, and dismissing the app task stop the button. Delayed permission/start results cannot restart it after a stop. It does not automatically restart after process death or reboot. Some apps deliberately hide overlays and Android can stop the service. Other platforms and web browsers do not support this Android overlay. Remote account revocation is enforced when the protected dashboard is opened; the shortcut itself displays no account information.

The manifest declares `CAMERA`, `SYSTEM_ALERT_WINDOW`, and the `specialUse` foreground-service type with its required permission and subtype explanation. A future Google Play release must declare and justify this foreground-service use for review. Rebuild/install the APK and deploy the web code together; the native bridge is not present in older APKs. Verify initial grant/denial, permanent denial and settings recovery, QR scanning, approximate GPS, special-access return, drag/tap/hide, notification hide, background display, logout, and permission revocation on a physical phone. Automated bridge simulations do not prove these OS behaviors.

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

After a successful SOS save, the user reaches a page showing the saved incident reference and status. The Android app opens the phone dialer once for that new submission using ACTION_DIAL with 911 filled in. The user must press Call. HandLink never places a call, requests call or contacts permissions, or connects to the dispatch phone system. The configured hotline is 911.

Refreshing or directly opening a saved incident link does not automatically launch the dialer. The server checks that the signed-in user sent the incident. A failed dialer launch keeps the incident saved and provides a manual retry. The web app never opens phone links automatically. Its manual **Open phone dialer** link explicitly requests Android ACTION_DIAL using an intent URI, rather than a generic `tel:911` link that a browser or phone could hand to a calling app. Supported Android browsers require a user tap. On other devices, or when unsupported, open the Phone app and enter 911 manually. Automatic opening is limited to the Android APK, whose native plugin uses ACTION_DIAL and requires pressing Call separately.

Rebuild and install the Android app to include HandLinkPhonePlugin.java and its MainActivity registration. Simulated bridge tests verify the web handoff; they do not compile Java or prove device intent handling. On the physical phone, verify countdown cancellation, successful save, the dialer opening once with 911 filled in, returning to HandLink, refresh without reopening, and manual retry. Do not place a real emergency call during testing.
