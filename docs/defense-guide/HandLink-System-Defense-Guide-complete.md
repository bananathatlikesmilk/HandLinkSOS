## Read first | How to use this guide

This guide explains the local repository as inspected on 19 October 2026. It does not claim that the public server contains every local change. It does not certify security or guarantee emergency delivery. No private .env values, real records, private keys, or passwords were copied into this document.

Read one numbered lesson at a time. Trace its files in the editor. Explain the flowchart aloud. Answer its practice question before checking the answer in the defense practice chapter. Use fictional data. Never place a real emergency call for a demonstration.

### Read the diagrams

- Rounded box: start or outcome.
- Rectangle: work performed.
- Diamond: decision. Continue downward on Yes; follow the side branch on No.
- Red side box: rejection, failure, or an alternative outcome. The next main step does not follow from that side outcome unless the text says to retry.
- A polling flow repeats only while its owner remains active. A flowchart describes behavior, not simultaneous execution timing.

### Four study passes

1. Understand the purpose and roles: lessons 01-03.
2. Follow one request: lessons 04-10.
3. Study feature workflows: lessons 11-26.
4. Review data, deployment, tests, and defense questions: lessons 27-34 and appendices.

### Never confuse these terms

| Term | Plain meaning | HandLink example |
|---|---|---|
| Authentication | Which account is this? | Verify password and session |
| Authorization | May this account do this? | Only assigned dispatcher changes status |
| Validation | Does the input satisfy rules? | Latitude must be -90 to 90 |
| Database integrity | Do stored relationships and constraints remain valid? | A profile must reference an existing account |
| Native permission | Has the phone allowed device access? | Camera or location permission |
| Consent | Has the person approved this relationship or use? | QR approval before sending SOS for someone |

## 01 | Purpose, boundaries, and system architecture

### What the system does

HandLink helps collect and present information useful to emergency dispatchers. Users save profiles, approve trusted relationships, submit SOS alerts, and choose time-limited location sharing. Dispatchers claim alerts, view authorized information, write notes, and update status. Admins manage staff accounts and review assigned incident reports.

The phone call remains separate. HandLink can open an Android dialer with 911 prepared. The person must press Call. Saving an SOS does not establish a call, prove the alert was seen, or guarantee a response.

### Components and ownership

| Component | Responsibility |
|---|---|
| Svelte pages and components | Display information; collect actions |
| SvelteKit server | Receive requests; load protected pages; enforce rules |
| Better Auth | Password login, sessions, email OTP, staff second factor |
| Zod | Check and transform runtime input |
| Drizzle and better-sqlite3 | Query and write the SQLite database |
| SQLite | Persist relational records and constraints |
| Nodemailer and SMTP | Submit verification/recovery email to the mail service |
| Ollama | Run a local model for extractive note summaries |
| Firebase Cloud Messaging | Transport generic Android push alerts |
| Capacitor and Android Java | Bridge the website to native phone features |
| Docker and Cloudflare Tunnel | Run the server and expose the public HTTPS site |

### End-to-end connection

```flow
HandLink system overview
User or staff opens browser / Android app
Svelte interface sends HTTPS request
SvelteKit hook identifies current session
? Account, input, and permission allowed? | Reject request; show error
Feature service queries or writes SQLite
Server returns protected response
Interface updates; optional email / AI / push work follows
```

### Explain at defense

> HandLink supports information gathering and dispatcher coordination. The backend owns access decisions. The phone call uses a separate system.

Practice: Why does an SOS success message not prove that a call connected?

## 02 | User account: every page and responsibility

### User journey

Public User pages include welcome, registration, login, email verification, and recovery. Protected pages include the dashboard, profiles, SOS, sharing, notifications, and settings. The server layout checks the account before loading protected pages.

| Page | Main job |
|---|---|
| /user | Welcome; signed-in eligible Users redirect to dashboard |
| /user/register | Collect email, password, personal and contact data |
| /user/login | Sign in with persistent User session |
| /user/verify | Verify an account email |
| /user/forgot-password and /user/reset-password | Recover access with an email code |
| /user/dashboard | Start SOS for self or approved people; see recent submitted alerts |
| /user/profiles | Manage incoming/outgoing trusted requests and saved relationships |
| /user/profiles/details and /user/profiles/edit | Read or edit own saved profile |
| /user/profiles/qr and /user/profiles/scan | Create a protected QR invitation or scan one |
| /user/sos | Acquire device location; countdown; submit and track SOS |
| /user/call | Explain and offer supported phone-dialer handoff |
| /user/sharing | Start or stop time-limited sharing |
| /user/sharing/current and /user/sharing/view | List sessions and view authorized latest points |
| /user/notifications | Read account-scoped SOS/sharing notices |
| /user/settings | Permissions, phone alerts, privacy notes, logout, deactivation |

### What Users cannot do

Users cannot choose a staff role during registration, claim dispatcher work, change another account, or access arbitrary medical profiles. A trusted relationship grants specific access; it is not unrestricted access to another account.

```flow
User account journey
Open welcome; register or sign in
? Account verified and active? | Verify email or recover access
Load own profile and dashboard
Choose SOS, profiles, sharing, or notifications
Server checks the chosen action
Review result in the app
Logout ends session; deactivation blocks account
```

### Files and defense

Start with src/routes/user/+layout.server.ts, +layout.svelte, and the selected page. Shared account conversion lives in src/lib/user/account.ts. UI preview state mirrors server-loaded data; it does not grant server permissions.

> The User workspace gives people control over their saved information, trusted relationships, and location-sharing duration.

Practice: Can adding someone as an emergency contact automatically grant SOS authority?

## 03 | Dispatcher and Admin accounts

### Staff access

Both staff roles need a verified, active account and current-session MFA proof. Password-only staff sessions can reach security setup but do not gain workspace access. Staff profile pages show the signed-in name, email, and role through StaffProfile.svelte.

| Action | Dispatcher | Admin |
|---|---|---|
| View unassigned alert queue | Yes | Read-only overview |
| Claim an unassigned alert | Yes | No |
| View another dispatcher's assigned alert/report | No | Authorized oversight |
| View full registered medical/contact panel | Assigned dispatcher only | Not through incident-detail endpoint |
| Add incident notes or advance status | Assigned dispatcher only | No |
| Generate or approve AI draft | Assigned dispatcher only | No |
| Read saved assigned report and saved summary | Own assigned incidents | Read-only oversight |
| Create Admin/Dispatcher accounts | No | Yes, with limits |
| Deactivate/reactivate accounts | No | Yes, with self/last-admin safeguards |
| View own staff profile/security | Yes | Yes |

Admin report access includes report metadata, GPS, relationship, notes, and saved AI state. It must not be described as zero sensitive access. The full registered medical/contact panel remains restricted to the assigned dispatcher. Future privacy changes need explicit design and verification.

```flow
Staff account journey
Open role-specific staff login
? Password and verified active role valid? | Reject login / portal access
? Current session has verified MFA? | Complete security setup or factor check
Dispatcher handles owned work; Admin oversees accounts/reports
Server rechecks role and record permissions
Save allowed action and audit record
Logout revokes the current session
```

### Where the distinction is enforced

src/lib/server/portal.ts protects page access. api.ts exposes requireStaff and requireAdmin. incidents.ts applies assignment rules. accounts.ts owns account-management rules. A hidden button is not the security boundary.

> Admins moderate the system; dispatchers handle incidents. Backend ownership checks prevent one dispatcher from reading or changing another dispatcher's assigned work.

Practice: Why does an Admin role not automatically allow incident status changes?

## 04 | Files, routing, and frontend state

### Read a Svelte file

A .svelte file usually contains a script, visible markup, and styles. $state creates reactive values. $derived computes values from other state. onclick runs an action. bind:value connects input text to a variable. onMount starts browser-only work; returned cleanup stops timers/listeners when the component unmounts.

```ts
let busy = $state(false);
let error = $state('');
```

busy tracks an operation. error holds a visible message. Neither value is an authorization check.

### Know the filenames

- +page.svelte: visible page.
- +layout.svelte: shared shell around nested pages.
- +layout.server.ts: server-side shared page loader.
- +page.server.ts: page-specific server data/actions.
- +server.ts: HTTP endpoint, with exported GET/POST/PATCH handlers.
- src/lib/server: private server implementation; database and credentials stay here.
- src/lib/native: TypeScript wrappers for native Android plugins.
- android/app/src/main/java: native Java compiled into the APK.

The URL follows the route folder. src/routes/api/incidents/+server.ts becomes /api/incidents. [id] is a dynamic URL segment. Type files in src/lib describe payloads; they do not write records.

```flow
Frontend interaction and rendering
Page receives server-loaded account data
Svelte renders markup from reactive state
Person presses a button or submits a form
Client sends API request; busy state disables duplicates
? Response successful? | Show error; preserve retry context
Replace local display with returned server data
Unmount cleans timers and subscriptions
```

### Files and defense

src/lib/client/request.ts centralizes client request/error handling. src/lib/user/preview.svelte.ts holds User display state. StaffWorkspace.svelte, Reports.svelte, and StaffSecurity.svelte reuse staff interfaces across routes. Demo files remain separate from live operations.

> The frontend improves usability. The server remains the source of truth for identity, saved records, and permissions.

Practice: Why can changing a local role variable never be enough to grant Admin access?

## 05 | A request from phone to database and back

### Trace an SOS request

The frontend gathers the selected profile and device GPS, then sends JSON. The server receives a RequestEvent. event contains request headers/body, URL, parameters, and request-local account data. It is not itself an emergency event.

```ts
requireUser(event);
const input = await readInput(event, incidentInput);
const result = createIncident(event, input);
return privateJson({ incident: result.incident }, result.created ? 201 : 200);
```

Line 1 checks the eligible signed-in User. Line 2 reads and validates submitted data. Line 3 applies incident rules and database work. Line 4 returns JSON; a new incident uses 201, an existing safe retry uses 200.

await pauses this function until its operation settles. It does not pause the entire server or limit the system to one request. Concurrent requests are controlled by transaction locks and database constraints where required.

### Error boundaries

Throwing error(...) stops normal execution. Invalid input does not reach createIncident. A failed database transaction rolls back its own writes. Network failure after a commit can leave the client unsure; a retry key handles that uncertainty.

```flow
Server request pipeline
HTTP request enters SvelteKit
Hook reads session into event.locals
? Required role and active session valid? | 401 or 403
? Origin, JSON, body size, fields valid? | 400 / 403 / 413 / 415 / 422
Feature rules and transaction execute
? Operation committed? | Return error; rollback transaction writes
Return no-store JSON; update interface
```

> Each endpoint coordinates access checks, validated input, feature logic, and a controlled response. It does not trust the page alone.

Practice: Why can a timeout occur even when the server already saved the incident?

## 06 | Registration and email verification

### Registration path

POST /api/register accepts email, a 12-128 character password, and profileInput. Public registration never accepts a staff role. Missing SMTP configuration blocks account creation because verification is required.

The custom route calls Better Auth's signup HTTP endpoint. This preserves its normal rate limiting and verification hooks. It then saves the new unverified identity's profile, medical row, and emergency contacts. Existing profiles are not overwritten when an email already exists.

The identity signup and subsequent profile transaction are separate steps. Do not claim that the entire registration operation is one atomic transaction. The profile/contact writes themselves are grouped in an immediate transaction.

### Verification path

Better Auth Email OTP sends a code to the inbox. Normal verification/recovery codes expire after five minutes and allow five attempts in the configured plugin. Codes are stored using a server-secret HMAC hash. Verification proves access to the inbox, not a real-world identity or medical truth.

```flow
Register and verify
Person submits email, password, and profile
? Email delivery configured and input valid? | Block registration; explain setup/input error
Better Auth creates unverified User identity
Save initial profile details without overwriting existing records
Send verification code through SMTP
? Valid unused code within limits? | Reject code or request resend
Mark email verified; person can sign in
```

### Files and defense

Read src/routes/api/register/+server.ts, src/lib/server/auth.ts, email.ts, and User register/verify pages. Input validation is not identity verification. Email submission to SMTP is not proof of inbox delivery.

> Public signup creates User accounts only. Email verification is required before login, and staff accounts follow a separate administrative provisioning path.

Practice: Why must the backend refuse a submitted role: admin during public signup?

## 07 | Login, persistent sessions, and logout

### Successful login

The User login form POSTs email/password to /api/auth/sign-in/email. rememberMe: true requests a persistent session cookie. finishLogin reads /api/auth/get-session, checks User role and verified email, clears password/code variables, invalidates page data, and opens the dashboard.

Better Auth manages password verification and session cookies. The phone does not save the readable password. Closing the app should preserve the persistent cookie. The User server layout redirects eligible signed-in visitors from /user or /user/login to /user/dashboard.

The normal Better Auth session lasts seven days and renews with continued use under its configured/default renewal policy. Persistence is not forever. Logout, reset, deactivation, revocation, expiration, or clearing app data can require login again. Staff login policies were not changed by the User remember-me fix.

### Every later request

hooks.server.ts checks the cookie-backed session and puts session/user into event.locals. Server helpers recheck current database identity and active session. An old browser display cannot override a revoked database session.

```flow
Persistent User login and logout
Submit password login with rememberMe true
? Credentials and account accepted? | Show login error
Server creates session and persistent cookie
Reopen app; server validates saved session
? Saved session still valid and eligible? | Return to login
Open dashboard without another password prompt
Explicit logout revokes session and clears signed-in state
```

### Logout work

User settings first attempts to stop native overlay/location work, calls /api/auth/sign-out, clears User display state, and navigates to login. Failed requests show an error. Do not fake a successful logout merely by hiding the dashboard.

> Persistent login saves a session cookie, not a password. Every protected request still requires a valid session and account.

Practice: Does an HttpOnly cookie make a stolen unlocked phone safe to hand to another person?

## 08 | Password recovery and staff MFA

### Password recovery

Forgot-password pages request an email code, verify it, collect a new confirmed password, and call Better Auth's reset flow. Password length remains 12-128. Successful reset revokes previous sessions. Email recovery does not change role, grant MFA proof, or remove an authenticator.

### Staff second factor

Admin/Dispatcher security pages ask for the current password before enrollment. Better Auth creates a TOTP setup secret and backup codes. The person adds the secret to an authenticator, saves backup codes privately, and verifies a time-based code. A setup key is a secret, not a normal account identifier.

The current database session needs MFA proof. auth.ts marks mfaVerifiedAt only for trusted factor-verification session creation. requireStaff/requireAdmin and staff-mfa.ts enforce this proof. A client cannot submit its own verified marker. Trusted-device bypass is disabled in the application's MFA input rules.

```flow
Staff login and MFA
Verify staff email and password
? Account has completed authenticator setup? | Open security enrollment
Enter current TOTP or single-use backup code
? Factor valid and attempts allowed? | Reject factor; preserve limits
Create MFA-proven current session
Allow role-appropriate staff workspace
Replacement retires old access; reset alone does not bypass MFA
```

### Recovery limitations

Backup codes provide an alternate factor and are single-use. Staff can replace the authenticator from authorized security settings after password confirmation. Lost phone plus lost backup codes has no public MFA-reset shortcut. Secrets must never appear in documentation, screenshots, Git, or support messages.

> Staff need both password authentication and current-session MFA proof. Password recovery does not bypass the second factor.

Practice: Why is twoFactorEnabled alone insufficient to prove this particular session completed MFA?

## 09 | Authorization and request protection

### Account checks

currentAccount in api.ts requires event.locals.user and session. It queries the current user and verifies that the session ID/user ID match and expiresAt is later than now. Unverified or banned identities fail. requireUser also checks User role and profile deactivation. Staff helpers check role and MFA.

```ts
if (!event.locals.user || !event.locals.session)
  error(401, 'Sign in first.');
```

! means not. || means at least one condition true. Missing either value rejects the request. AND is different: every condition must pass. AND does not mean values must be equal.

### Request defenses

readInput requires an Origin matching the request's server origin, JSON content type, a body no larger than 32,768 bytes, valid JSON, and a passing Zod schema. It bounds actual reads even if Content-Length is absent or false. Origin comparison helps protect cookie-authenticated writes; correct proxy/origin configuration still matters.

privateJson adds Cache-Control: no-store and X-Content-Type-Options: nosniff. no-store addresses HTTP caching, not database retention or screenshots. nosniff tells browsers not to infer a different content type.

```flow
Access and request boundary
Read request-local identity/session
? Database session current and account available? | Reject 401 / 403
? Role, MFA, and ownership satisfy operation? | Reject 403 or privacy-preserving 404
? Same origin, JSON, and bounded body? | Reject request
? Runtime schema accepts fields? | Return 422
Run feature rule and transaction
Return private response
```

> Hiding UI is not authorization. The backend checks identity, current account status, role, and feature-specific permissions on the request.

Practice: What differs between 401, 403, and a deliberate 404 for another person's incident?

## 10 | Validation: read the rules line by line

### Example from validation.ts

```ts
export const cancellationInput = z.strictObject({
  reason: z.string().trim().min(1).max(500)
});
```

export allows other modules to import the schema. const names the schema. strictObject accepts only listed keys. reason must be a string. trim removes outer whitespace. The transformed string must contain 1-500 characters. Spaces between words stay. A whitespace-only string becomes empty and fails.

```ts
export const incidentInput = z.strictObject({
  personProfileId: z.uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationLabel: z.string().trim().max(250),
  idempotencyKey: z.uuid()
});
```

z.uuid checks format. It does not prove that a profile exists or that the requester owns it. z.number rejects numeric strings unless the schema explicitly coerces them. Limits include their endpoints. Valid coordinates are not proof of physical presence.

### Parsing result

schema.safeParse(body) returns success or failure. On failure, readInput throws 422. On success, result.data contains validated/transformed input. No record is saved by safeParse itself. TypeScript types only help during development; Zod validates actual runtime input.

```flow
Validate submitted fields
Read bounded JSON body
Check object keys and required fields
? Types and formats accepted? | Return 422
Apply allowed transforms such as trim
? Lengths and ranges accepted? | Return 422
Return result.data
Feature logic checks existence and permission separately
```

> We validate on the server because direct requests can bypass browser forms. Format, existence, and permission remain separate checks.

Practice: Why does { reason: 'Help', role: 'admin' } fail cancellationInput?

## 11 | Profile, medical information, and emergency contacts

### Read and save

GET /api/profile returns the signed-in User's saved personal row, medical row, and emergency contacts. PUT validates profileInput and creates/updates the owned profile. The server chooses profile ownership; clients cannot assign userId or linked contact accounts.

The write transaction rechecks the account after async input reading. It inserts/updates personal data, upserts medical data, replaces emergency contacts, updates the account display name, and revokes now-ineligible location recipients. All those writes commit together or roll back together.

### Data rules

Personal fields include name, birthday, sex, and phone. Birthday must be a real date, not in the future, using Manila's current date for validation. Phone validation expects an international number; frontend normalization can convert a Philippine 09 number. Medical details have length limits and controlled blood-type values. There must be 1-10 emergency contacts.

Contact names/emails do not automatically grant access to another account. linkedUserId is privileged server-owned data. Replacing contact information clears links until properly verified again. Do not claim the application has independently verified medical statements.

```flow
Read or update own profile
Eligible User opens profile page
GET returns owned personal, medical, and contact data
Person edits and submits PUT
? Profile schema and current account valid? | Reject; keep previous saved profile
Immediate transaction updates related records
Revoke location recipients no longer eligible
Commit; refresh profile display
```

### Files and defense

Read src/routes/api/profile/+server.ts, UserProfileFields.svelte, user/account.ts, and server/location-policy.ts. Displaying the saved email does not create an email-change feature.

> Profile updates preserve account ownership and save related records in one transaction. Entering contact details alone cannot create a privileged account link.

Practice: Why clear a previously linked account after someone edits the emergency contact email?

## 12 | QR invitation, scanning, and owner approval

### Owner creates an invitation

A verified User with a profile requests a challenge from /api/trusted/qr/challenge. The code goes only to that signed-in account's email. The challenge lasts five minutes, allows five guesses, has a 60-second resend cooldown and a five-per-hour limit. Failed guesses commit their count before an error response. Mail failure invalidates the code.

Submitting requestId/code to /api/trusted/qr consumes the challenge and creates a single-use invitation valid for ten minutes. Its payload is handlink:qr:v1:<token>. The random token has 256 bits of entropy; the database stores its SHA-256 hash. No name or medical data needs to be embedded in the QR.

### Requester scans

The scanner decodes a camera view or uploaded image in the browser. /api/trusted/scan receives token and relationship. The server checks expiry, consumption, ownership, and active accounts, consumes the invitation in the transaction, and creates a pending directional connection. Identical scanner retries can return the same pending request. A different scanner cannot reuse the token.

```flow
Trusted QR approval
Owner requests email challenge
? Correct code within expiry and attempts? | Reject or request a fresh code
Create single-use ten-minute QR token
Requester scans and submits relationship
? Token and both profiles eligible? | Reject scan; no access granted
Create pending connection; consume QR
Owner approves in Profiles; SOS permission begins
```

### Defense and limits

Hiding/locking an unused QR prevents future scans; it does not delete existing approvals. A QR scan requests access, not instant trust. An account can have at most 100 active pending/approved connections under the implemented limit. Real camera scanning still requires physical-device verification.

> The QR contains a short-lived opaque token. Server-side approval creates the permission; scanning alone does not.

Practice: Why store a token hash rather than the QR token itself?

## 13 | Mutual requests and revocation

### Direction matters

If Alex approves Sam, Sam may send SOS for Alex. Alex does not automatically gain SOS permission for Sam. During approval, requestMutual can create the reverse relationship as pending. Sam must approve that reverse request separately.

changeTrusted checks the acting profile's role in the connection and verifies the invitation/version context. Only the profile owner approves a request. Duplicate or stale changes fail or return their existing safe state. Removal marks the connection revoked; retained records are not silently deleted.

### Sharing differs from SOS

The sharing candidate policy recognizes eligible active trusted relationships from either direction, or a verified linked emergency-contact account. That makes someone selectable for sharing; it does not automatically share coordinates. The owner must still select recipients for a particular timed session.

On revocation, location-policy persists removal of ineligible recipient grants. Restoring a relationship must not resurrect an old sharing grant. This protects the owner's previous stop/revoke decision.

```flow
Mutual trust and revocation
Owner approves incoming directional SOS request
? Reverse request explicitly requested? | Keep current one-way permission
Create reverse pending request
? Other person approves reverse request? | Reverse SOS permission remains unavailable
Both directional SOS permissions now exist
Either allowed party removes a connection
Persist revocation; invalidate affected sharing grants
```

### Files and defense

src/lib/server/trusted.ts owns connection transitions. location-policy.ts owns recipient eligibility and revocation. Do not treat visual appearance in a profile list as proof of bidirectional SOS consent.

> Mutual access requires two approvals. Location sharing also requires a separate session-level recipient choice.

Practice: If Alex removes Sam and later adds Sam again, should old location sessions automatically become visible?

## 14 | SOS countdown, GPS, retries, and creation

### Before submission

The dashboard loads /api/incidents/targets. Eligible targets are the caller's own profile and active profiles that approved this caller. Starting SOS obtains current device GPS and runs a five-second countdown. Cancelling or leaving before submission sends no alert. Denied/unavailable GPS prevents submission; fake coordinates are not substituted.

When sending for someone else, GPS still belongs to the initiating device. The system cannot assume that person's location equals the caller's location. This is important during defense and real use.

### Server creation

createIncident rechecks the current User/profile inside an immediate transaction. It checks retry-key reuse, target availability, directional permission, unresolved duplicate incidents, and the ten-new-requests-per-minute caller limit. It derives caller name, relationship, status, and timestamps on the server. It saves the incident, reference, creation event, and relevant notice together.

The client stores an account-scoped pending payload in session storage before sending. An uncertain retry uses the same idempotency key and payload. Existing identical requests return the original incident with 200; changed data under the same key fails with 409. A new saved incident returns 201.

```flow
SOS from dashboard to saved alert
Choose self or approved target
? Current device location available? | Explain location error; send no SOS
Five-second countdown; allow cancellation
Submit account-scoped payload and retry key
? Session, target, approval, and limits valid? | Reject or return matching safe retry
Transaction saves incident, reference, event, and notice
Show saved alert; offer supported dialer handoff
```

> Retry keys prevent duplicate creation after network uncertainty. They do not prevent every possible repeated emergency report by different callers.

Practice: Why must retrying an uncertain request keep the same key and coordinates?

## 15 | SOS on behalf, notifications, and cancellation

### Recipient awareness

When an approved trusted person sends SOS for another User, the server creates an SOS notification for the person receiving help. The notification page returns only the current User's eligible notices. The original caller can see their submitted incident summaries; they do not receive unrestricted private profiles.

### Cancellation is a request

After an SOS has been submitted, stopping the original countdown cannot erase it. The person receiving the SOS may request cancellation with a 1-500 character trimmed reason. The backend checks that personProfileId belongs to that requester, the incident is unresolved, and no cancellation already exists for that incident.

Only the assigned dispatcher can review a pending cancellation. Approval marks the incident Resolved and records the decision/time; rejection leaves operational status unchanged. The cancellation decision and relevant incident/audit changes share a transaction. The normal resolve path requires pending cancellation review first.

```flow
On-behalf SOS cancellation
Approved caller submits SOS for another User
Save recipient SOS notification
Recipient opens notice and submits cancellation reason
? Recipient owns target profile and incident unresolved? | Reject cancellation request
Save pending cancellation for dispatcher review
Assigned dispatcher approves or rejects
Approval resolves incident; rejection preserves current status
```

### Files and defense

Read incidents.ts requestCancellation/reviewCancellation, notifications.ts, User notifications page, and IncidentCancellationReview.svelte. The relevant endpoints are /api/incidents/[id]/cancellation and /api/staff/incidents/[id]/cancellation.

> The recipient can request cancellation. The assigned dispatcher decides it, so a submitted operational record is not silently erased.

Practice: Does submitting a cancellation reason immediately stop dispatcher handling?

## 16 | Dispatcher queue, claiming, and competing requests

### Queue

The staff queue is server-backed. Dispatchers see unassigned alerts and their own assigned incidents. Another dispatcher's assigned incidents are excluded from rows and counts. Search/filter results are paginated, normally 20 rows. Visible queue polling runs about every five seconds; this is not a guaranteed real-time delivery channel.

### Claiming an incident

The confirmation endpoint requires verballyConfirmed: true. This records the dispatcher's assertion; code cannot prove a conversation occurred. Only a Dispatcher can claim an alert. An Admin cannot claim it.

An immediate transaction checks Not assigned and no dispatcherUserId. It sets In progress, assigns the acting dispatcher, records confirmedAt, and writes an event. If two dispatchers compete, the write lock serializes their transactions; the later claimant sees the changed state and receives a conflict.

```flow
Dispatcher alert claim
MFA-verified Dispatcher loads eligible queue
Select unassigned alert; confirm verbal check
POST confirmation request
? Current role/session and confirmation valid? | Reject request
Take immediate write transaction
? Still unassigned and Not assigned? | Return 409; refresh queue
Assign dispatcher, set In progress, save confirmation event
```

### Why not a frontend flag?

Both dispatchers could see the same unassigned row before either clicks. Disabling a button on one browser cannot protect the other browser. The database transaction is the coordination point.

### Files and defense

Read incidents.ts listStaffIncidents and changeIncident, StaffWorkspace.svelte, and /api/staff/incidents/[id]/confirm. Permissions are checked again in the write path, not only when the queue loads.

> Claiming is exclusive because the server rechecks assignment while holding the transaction lock. Seeing an alert does not mean a dispatcher owns it.

Practice: What response should the second dispatcher get after the first claim commits?

## 17 | Incident details, notes, status, and report views

### Sensitive details

getIncidentDetail initially builds a minimal result with personal: null, medical: null, empty emergencyContacts, notes, and events. Only the assigned Dispatcher receives the expanded registered information. Another dispatcher's assigned incident returns 404. Admin incident detail stays minimal.

The personal/medical panel is read from current profile tables. It is not a complete immutable snapshot of every field at SOS time. Caller name/relationship and incident coordinates are stored on the incident. Be precise about what is historical and what is currently registered.

### Status transitions

Normal handling follows Not assigned, In progress, On route, Resolved. Claiming performs the first transition. The assigned Dispatcher alone can add notes and advance status. Notes are limited to 2,000 characters. Resolved incidents cannot be edited through the note/status paths. Normal resolution requires On route and pending cancellation review; approved cancellation has its own resolution path.

Each change writes an incident_event in the same immediate transaction. Latest notes are selected consistently by incident-notes.ts. Event history retains changes instead of using the current screen as the only record.

```flow
Incident handling and report lifecycle
Claim sets In progress and dispatcher ownership
Assigned Dispatcher reads details and saves notes
? Assigned account still active with MFA? | Reject access or write
Advance from In progress to On route
? Pending cancellation already reviewed? | Review cancellation first
Advance from On route to Resolved; record end time
Read retained report; handling notes/status now locked
```

### Reports and references

Report pages derive metadata and notes from the incident/events. A report view is not a second independently handled incident. The report table stores AI summary publication/review state. UUID remains the internal ID. incident_reference adds a human-readable sequence formatted HL-0000001 and longer as needed; it is not a secret access token.

> Status is a controlled workflow, not free text. Ownership, previous state, and audit writes are enforced together on the server.

Practice: Can a correctly formatted status request skip directly from In progress to Resolved through the normal path?

## 18 | Local AI summaries: preparation, generation, review

### AI's limited job

AI summarizes saved incident notes for review. It does not diagnose, choose dispatch priority, place calls, or control status. HandLink calls local Ollama at 127.0.0.1:11434/api/chat. The default model is qwen2.5:3b. The phone does not run the model. The deployed server needs its own reachable Ollama runtime and model.

### Preparation

Only the assigned active MFA-verified Dispatcher can prepare/generate/approve. previewAiSummary reads the latest note, derives identifiers for redaction, and returns a sourceNoteId plus redacted text. Medical profiles are not automatically submitted to the model. The Dispatcher reviews the exact preview, deletes unnecessary/private content, and confirms consent. Server logic permits deletion-only edits to the prepared text; edited consent must be reconfirmed.

### Generation and approval

A generation request reserves a version with its request ID, input hash, model, source note, and pending state. One pending generation per incident, a 60-second cooldown, and ten generations per dispatcher per hour apply. Slow inference runs outside the short write transaction. On return, the server checks ownership/session/source note again before publication.

Ollama selects sentence IDs. The server reconstructs original sentences, then saves an unreviewed draft. The Dispatcher compares it to the notes and explicitly approves. Approved summary state records reviewer and time. Changed notes make an older draft stale and block approval.

```flow
AI summary from notes to approval
Assigned Dispatcher saves incident notes
Prepare redacted preview; review and confirm text
? Consent, source, ownership, and limits valid? | Reject; refresh or wait
Reserve request; call local Ollama
? Output and current source/access still valid? | Mark failure; keep saved summary
Save extractive draft and version history
Dispatcher checks content and explicitly approves
```

> AI drafts are local, extractive, and human-reviewed. A valid output format does not guarantee a complete or accurate summary.

Practice: Why check the source note again after the model finishes?

## 19 | AI privacy, hallucination control, and failure paths

### Extractive design

Earlier free-form quality tests found added urgency/advice and copied malicious instructions in fictional notes. The current design asks for sentence IDs rather than fresh prose. Zod validates the model envelope and selection. summary-extract.ts rejects invalid IDs, duplicates, reordering, extra invented prose, and excessive length. The server rebuilds the result from approved sentences.

This constrains new wording. It cannot fix inaccurate notes or guarantee that the model selected every necessary sentence. A source sentence can itself contain advice. Redaction removes known identifiers and patterns, but cannot detect every private detail. Common embedded instruction patterns are rejected before inference; unfamiliar attacks can evade pattern checks. Human review remains mandatory.

### Failure handling

The local inference timeout is 90 seconds; the generation UI allows 100 seconds. Missing model, stopped Ollama, non-OK response, malformed result, truncated generation, oversized response, or changed source/access prevents a new draft from replacing a saved one. Responses are bounded. Cloud-model tags and HTTP redirects are rejected.

```flow
AI validation and failure protection
Prepare approved source sentences
? Copied instruction checks pass? | Reject input before inference
Ollama returns structured sentence IDs
? Envelope, IDs, order, and size valid? | Reject model result
Reconstruct source text; apply redaction checks
? Source note and access unchanged? | Keep previous report; mark failure
Save unreviewed draft; require human approval
```

### What to claim

Say local processing reduces external disclosure, not that all processing is automatically anonymous. The Ollama call uses localhost HTTP because the process is local, not because public HTTP is acceptable. In Docker, 127.0.0.1 means the app container itself; the supplied base Compose file does not provision an Ollama server. Container deployment needs a reviewed local inference arrangement consistent with this fixed endpoint.

> We restrict the model to selecting existing sentences and validate its output. We still require review because omission and source errors remain possible.

Practice: Does temperature: 0 prove that summaries are always correct?

## 20 | Time-limited location sharing

### Start a session

A User chooses recipients and a duration of 1-240 minutes. Recipients come from current approved trusted relationships or eligible verified linked emergency-contact accounts. The owner chooses which eligible people receive this session; eligibility alone sends nothing.

startSharing takes an immediate transaction, checks current User/profile, retry ID/payload, existing active session, recipient eligibility, and the ten-sessions-per-hour limit. It saves a location_session and recipient grants. The same retry settings return the same logical request; changed settings under a reused key fail.

### View and stop

The owner or an authorized selected recipient can retrieve the session. Recipient permission is rechecked against current relationships/account status and the persisted grant. Active sessions use server expiry, not only the phone's countdown. The owner stops sharing; a recipient cannot end the owner's session for everyone.

```flow
Location sharing start to stop
Owner chooses eligible recipients and 1-240 minute timer
? User, retry settings, recipients, and limits valid? | Reject; keep existing session
Save timed session and explicit recipient grants
Owner publishes eligible device points
Selected recipients read latest authorized point
? Session still active and grant valid? | Stop recipient access
Owner stops session or server time reaches expiry
```

### Practical limits

Session status and notification timing are separate. Expiry access checks apply even if a scheduled notification is late. Old grants stay revoked after relationship restoration. Sharing is not continuous guaranteed tracking; it samples points and depends on permissions, network, process life, and device power policy.

### Files and defense

Read sharing.ts, location-policy.ts, User sharing pages, and src/lib/sharing.ts. Notifications describe start/expiry; they do not grant access independently.

> Sharing requires both an eligible relationship and an explicit session grant. Server time and current permissions control access.

Practice: Why must a recipient grant be checked again after the owner removes a trusted relationship?

## 21 | Location point publishing: browser and Android

### Foreground browser path

LocationPublisher.svelte runs only for an authenticated protected User workspace. It checks sessions and publishes while visible, avoiding points when the last accepted point is less than five minutes old. It polls its work loop more often than the GPS upload interval. The server rate-limits accepted point updates to once every five minutes.

Only the owner publishes points. The API checks the session's active status, ownership, coordinates, accuracy, and relevant account state. A valid coordinate does not prove that GPS was not spoofed. The viewer shows point age, accuracy/staleness, and map availability rather than inventing a fresh position.

### Native screen-off path

The separate Android foreground location service requires explicit enablement, location access, and an ongoing notification. It obtains device location, uses the app's authenticated cookie context, sends to the configured server, and stops under its expiry/account/network rules. Browser publishing avoids duplicating native publishing when native service state applies.

```flow
Publish and view location points
Active owner session exists
? Native screen-off service explicitly enabled? | Use visible-browser publishing path
Native service samples device GPS with notification
? Owner session active and update interval due? | Skip point or stop ended service
POST point; server checks ownership and current grant/session
Save accepted point in SQLite
Authorized viewer fetches latest point and its age
```

### Limits and defense

Foreground-service permission is not unrestricted background execution. Battery restrictions, force-stop, poor GPS, network failure, and process termination can delay updates. Maps and external map links also need available network services. The floating overlay is not the location service; enabling one does not automatically enable the other.

> We provide sampled, permission-controlled sharing. We show point timing because a saved coordinate is not necessarily the person's current position.

Practice: If the last accepted point was one minute ago, why should another upload usually be skipped?

## 22 | One-minute warning, expiry, and in-app notifications

### Server scheduler

hooks.server.ts starts the location expiry scheduler outside build mode. It sweeps immediately, then every 15 seconds. A global timer guard avoids duplicate startup within that Node runtime. Durable delivery keys and expiry markers coordinate overlapping sweeps in the database.

Within the final 60 seconds, the sweep creates location_expiring notices for the owner and selected currently eligible trusted recipients. Emergency-contact-only recipients are excluded from this warning path. At expiry it creates location_expired notices for the owner and selected eligible recipients, then marks expiry notification complete. A delayed sweep may miss the final-minute window; this is not an exact alarm.

### Reading notices

GET /api/notifications returns current User notices, pagination, unread count, and an eligible active warning. The warning can remain surfaced even when newer notices fill a page. A mark-read endpoint checks account ownership. SOS and location notices have different eligibility rules. Stored counts and visible filtered rows can reflect retained notices differently; never use the unread count as proof of current sharing access.

```flow
Sharing warning and expiry notices
Persistent server runs 15-second expiry sweep
? Session in final minute and owner eligible? | Skip warning; check later sessions
Insert owner and selected trusted-recipient warnings
At deadline, server access checks treat session as ended
Insert eligible expiry notices once
User polls own Notifications and unread state
Optional push delivery uses the same stored notices
```

### Local reminder distinction

The native location service can schedule a local owner reminder. That is separate from the server's in-app notice and FCM push, and may produce a second reminder. Clock/process restrictions affect delivery. No reminder should be presented as a guaranteed emergency channel.

> The server enforces expiry independently of notification delivery. Warnings improve awareness but are best-effort.

Practice: If a phone misses the expiry notification, may it keep fetching the owner's location indefinitely?

## 23 | Android push notifications and Firebase

### Device opt-in

Phone push is separate from stored in-app notifications. In Settings, the User explicitly enables phone notifications. Capacitor obtains Android permission/token. The server registers a bounded Android token against the active User and current session. Tokens are not returned in the status response. Logout/session deletion makes that binding ineligible or removes it through the schema relationship.

Firebase provides Cloud Messaging, not this application's account database or authentication. Server credentials stay outside the repository and APK. FIREBASE_SERVICE_ACCOUNT_FILE must be an absolute server-readable path. Android google-services.json configures the client project; it is not a substitute for the server's private service-account credential.

### Delivery loop

Every five seconds the persistent Node scheduler checks eligible notices/devices. push-delivery.ts uses one durable row per notification/device pair and a lease for concurrent workers. It skips stale/read/unauthorized notices, retries transient failures with backoff up to five attempts inside freshness rules, and revokes invalid tokens. Payloads are generic: no medical details, names, or coordinates. Opening an alert leads to the protected Notifications page.

```flow
Push from stored notice to phone
User opts in; register token to current session
Server finds eligible notification and device
? Account, session, notice, and access current? | Skip delivery
Reserve durable delivery lease
Send generic message through Firebase Cloud Messaging
? Firebase accepts message? | Retry eligible transient failure or revoke bad token
Phone may display; tap opens protected Notifications
```

### What acceptance means

accepted_at means Firebase accepted the request. It does not prove phone display. A crash after acceptance can cause a retry; exactly-once delivery is not promised. Google Play services, permission, internet, battery policy, and force-stop affect delivery. Disabling Firebase delivery leaves stored notices available.

> Firebase transports a generic alert. The signed-in server endpoint supplies authorized details after the User opens the app.

Practice: Why not put a person's medical condition directly in a push payload?

## 24 | Camera, location prompts, and Settings

### Startup behavior

UserPermissionStartup requests location and camera after an eligible User enters a protected User page. Native startup attempts are marked once in private preferences; browser attempts use local storage plus an in-memory guard. Already answered prompts do not intentionally repeat each launch. Settings provides explicit retries.

Prompts are sequential. Denying location does not prevent the camera request. Permission does not start SOS, sharing, overlay, recording, or a call. On the browser camera-permission check, getUserMedia requests video only and immediately stops every returned track. Native permission requests ask Android for permission without starting a capture stream.

### Settings controls

UserPermissionControls shows current camera/location status and Android overlay state. It can request access, refresh status, and open app settings. A permanent OS denial may require changing system settings. Browser support varies; HTTPS or a permitted secure context is needed for device APIs. Display over other apps is Android-only in this build.

```flow
Startup permissions and later retries
Eligible User enters protected workspace
? Initial permission attempt still needed? | Read current status without repeating prompts
Request location, then camera
? Both grants available? | Keep app usable; link to Settings
Save attempt state; do not start sharing/recording
User opens Settings and retries or opens OS settings
Refresh actual grants after returning to app
```

### Async safety

Account/unmount guards ignore late results for a previous account. Generation counters cancel stale starts. These protect against enabling a service after logout while an OS dialog was open. A Settings success message is not a replacement for actual OS status.

> Device permission allows access to a sensor. Sharing someone else's data still requires application-level consent and authorization.

Practice: Does Allow location automatically start a sharing session?

## 25 | Floating button and phone-dialer handoff

### Floating dashboard shortcut

Android special overlay access needs a separate settings screen. The User grants display permission, returns, and explicitly enables the button. The native foreground service shows one draggable 48-by-48 dp control with four dots and a persistent notification. Tap opens the configured server's protected dashboard. It never sends SOS or opens a call by itself.

Swiping the task away no longer intentionally stops this service: the manifest sets stopWithTask=false and the previous onTaskRemoved stop was removed. Hide it through Settings or its notification. Logout, deactivation, portal cleanup, or overlay-permission removal can stop it. Force-stop, battery policy, and process death can still remove it; it does not auto-restart after reboot/process death. Native behavior still needs physical-device testing.

```flow
Floating button lifecycle
User grants special display permission
User explicitly enables floating button
? Overlay and required notification access available? | Explain error; keep overlay off
Native foreground service displays compact four-dot control
Minimize or swipe task; service may remain visible
Tap opens protected dashboard; no SOS or call action
Hide, logout, revoke permission, or Android stop removes it
```

### Dialer is separate

HandLinkPhonePlugin uses Intent.ACTION_DIAL with tel:911. ACTION_DIAL opens the dial screen, not ACTION_CALL. The person presses Call. The browser fallback uses an Android intent URI; generic automatic tel navigation was removed after unsafe iOS behavior was reported. Universal iOS prefilled-dialer behavior is not implemented or guaranteed. Unsupported devices must open their Phone app manually. Do not test by calling 911.

```flow
SOS and safe Android dialer handoff
SOS request returns saved confirmation
Supported app flow requests dialer handoff once
? Android native dialer available? | Show supported manual browser / Phone fallback
Start ACTION_DIAL with 911 prepared
Android Phone displays dial screen
Person decides whether to press Call
Call uses external phone system; HandLink has no call-state feed
```

> Overlay and dialer are convenience handoffs. Neither submits an automatic call. Android capabilities are not a promise of identical iOS behavior.

Practice: What is the difference between ACTION_DIAL and ACTION_CALL?

## 26 | Admin account creation, bootstrap seed, and safeguards

### First Admin

Docker startup runs migrations, scripts/seed.ts, then the server. seedAdmin looks for key initial-admin-v1 in seed_history. No settings means skip without recording completion. Valid private seed name/email/password create a new Admin and hashed credential. The operator-provisioned bootstrap email is marked verified; staff MFA is still required.

The seed record and account creation commit in one immediate transaction. The code rechecks under the lock after password hashing. Once recorded, later startups never reseed or reset that account, even if settings change. Existing accounts are never overwritten or promoted. Partial/invalid configuration or duplicate email stops startup without a partial seed. Remove bootstrap credentials from the runtime configuration after successful setup.

```flow
One-time Admin bootstrap
Container validates config and migrates database
? Bootstrap seed not completed yet? | Continue with existing database; no reseed
? Complete seed settings supplied? | Skip if all absent; fail if partial/invalid
Validate details and hash password
Immediate transaction rechecks marker and email uniqueness
Create verified bootstrap Admin and seed-history row together
Start server; Admin enrolls MFA
```

### Later staff accounts

An MFA-verified Admin creates Admin/Dispatcher accounts through /admin/accounts. Normal staff creation starts email-unverified. Account, credential, and audit writes share a transaction. Creation is limited to 20 staff accounts per actor per hour. Email verification sending is a separate retryable step. This build does not force a password change at first login.

### Status management

Admins cannot change their own status or deactivate the last active verified Admin. Counts/checks happen under the write transaction. Deactivation revokes sessions, cancels owned sharing, and revokes recipient grants without deleting incident history. Reactivation does not revive old sessions or sharing.

```flow
Admin manages account access
MFA-verified Admin selects account action
? Valid request, role, and current session? | Reject action
? Deactivation respects self and last-admin rules? | Return 409; keep account active
Transaction updates account/profile and sharing grants
Delete old sessions; write account audit
Commit; reactivation later requires a fresh login
```

> Bootstrap establishes the first moderator once. Later staff provisioning stays inside an audited Admin-only workflow.

Practice: Why store seed completion in the database instead of a container file?

## 27 | Database tables, relationships, and transactions

### Database in use

The application uses SQLite through better-sqlite3 and Drizzle. DATABASE_URL points to a database file, not a Firebase or PostgreSQL service. The supplied production Compose value is /app/data/local.db, persisted by the host data mount. Local development can use a different file.

db/index.ts enables foreign_keys=ON and busy_timeout=5000. Foreign keys reject broken references. The busy timeout allows a blocked operation to wait for a lock; it is not a correctness proof or a background queue. SQLite coordinates concurrent writes through its locking model.

| Table group | Records and relationship |
|---|---|
| user / account / session / verification / two_factor | Identity, hashed credential/provider data, sign-in sessions, auth codes, MFA |
| user_profile / medical_profile / emergency_contact | Account-owned personal data and dependent information |
| qr_invitation / trusted_connection / verification_request | Token invitation, directional trust, account-bound challenge |
| incident / incident_reference / incident_event | SOS record, short sequence reference, audit/notes history |
| incident_cancellation | Recipient request and Dispatcher decision |
| ai_summary_request / report | Versioned generation and currently saved summary/review state |
| location_session / location_recipient / location_point | Timed sharing, selected grants, sampled GPS history |
| device / notification / push_delivery | Session-bound token, stored notice, durable send attempt |
| account_audit / seed_history | Administrative history and one-time bootstrap completion |
| task / call_session | Schema/sample or reserved structures; not proof of integrated task management or live calls |

### Transaction principle

A transaction groups related writes. If any required write fails, its transaction rolls back. Immediate transactions acquire the SQLite write reservation early. Unique constraints provide a final barrier for retry keys, references, and concurrent duplicates. A transaction cannot roll back an email already accepted by SMTP or a push already accepted by Firebase.

```flow
Related database writes
Validate request and derive server-owned identity
Begin immediate transaction
Recheck current account, permissions, and record state
Insert/update related rows and audit history
? All operations and constraints succeed? | Roll back transaction; return error
Commit database changes
Return result; external delivery remains a separate concern
```

> We use application validation and database constraints together. Transactions prevent partially saved related records, not every possible external-service inconsistency.

Practice: Why do both the feature code and a database uniqueness constraint matter?

## 28 | Migration, backup, restore, and retained records

### Migration flow

scripts/migrate.mjs loads the configured SQLite file, enables foreign keys, creates a private pre-migration backup when the database already exists, applies committed Drizzle migrations, and checks foreign-key violations. .db-backups is private data, not a public artifact. Never publish real database backups with a defense presentation.

Migrations add or evolve schema. They do not automatically copy another laptop's records to the deployed server. db:push is useful for controlled development but is not the documented migration path for important live records. The bootstrap seed runs after migration so its history table exists.

```flow
Migration and backup
Operator targets the intended database
Open database with foreign keys enabled
? Existing database present? | Create initial schema without existing-data backup
Create private pre-migration SQLite backup
Apply committed migrations
? Foreign-key verification passes? | Stop startup; investigate or restore safely
Continue to one-time seed and server startup
```

### Restore procedure

Stop the application and all writers first. Keep the current database separately if it contains later records. Restore the verified backup to the configured path, fix ownership/permissions, run integrity/foreign-key checks, and start a compatible application version. Check login and a fictional workflow. Restoring an older backup loses writes made after that backup.

```flow
Safe restore
Identify backup date and compatible application version
Stop app and every database writer
Preserve current database before replacement
Restore backup to configured persistent path
? Integrity and foreign-key checks pass? | Keep app stopped; investigate
Start compatible app with correct secrets/permissions
Verify login, owned data, and a controlled workflow
```

### Retention and evidence

Deactivation blocks access but retains profiles/incidents/audits. The schema does not by itself provide a complete legal retention policy, automatic expiry of all personal records, or at-rest encryption. Backup tests in tests/database.test.mjs validate isolated copies; they do not prove an unseen server's backup schedule is working.

> We preserve operational history during deactivation and use verified backups for recovery. Restore is controlled maintenance because it can discard later writes.

Practice: Why must writers stop before a manual database replacement?

## 29 | Email configuration and delivery troubleshooting

### Code behavior

email.ts reads private SMTP settings and builds a Nodemailer transport only when required settings and a valid port exist. SMTP_HOST selects the mail server. SMTP_USER authenticates the sending account. SMTP_PASSWORD is its service/app password. SMTP_FROM sets the message sender. Port 465 uses implicit TLS; other configured ports require TLS upgrade through requireTLS.

sendCode submits a short code, purpose, and expiry text. It checks that the SMTP result accepted a recipient. Connection/greeting/socket timeouts prevent indefinite waits. It returns a generic failure without exposing credentials. Accepted by SMTP still does not prove inbox delivery; spam filtering and recipient/provider issues remain possible.

```flow
Verification email delivery
Server checks private SMTP configuration
Auth or QR flow creates bounded verification challenge
Nodemailer connects with required TLS and authentication
? SMTP accepts recipient/message? | Invalidate custom QR challenge as needed; show retry error
Mail provider routes the message
Person enters code in HandLink
Server verifies purpose, expiry, attempts, and consumption
```

### Clones and deployment

Git does not distribute private environment values. Another laptop/server must supply its own runtime settings and restart after changes. A container path must exist inside the container. A Windows path on your laptop is not a deployed Linux path. Never ask another person to paste secrets into chat or commit .env.

### Safe diagnostic order

Check required-variable presence without printing values. Check the actual server process/environment, not just the editor's .env. Restart/recreate the correct runtime. Verify sender authentication and provider restrictions. Send a controlled test to an inbox you own. Check application error category, inbox/spam, and rate limits without exposing codes.

> Email is a configured external dependency. Application readiness, SMTP acceptance, and actual inbox receipt are different checks.

Practice: Why can a clone show email unavailable even though your own laptop sends correctly?

## 30 | Deployment, Docker, HTTPS, APK, and updates

### Runtime path

The Docker image builds the SvelteKit Node application and includes operator scripts/migrations. The entrypoint validates configuration, prepares writable storage, drops root privileges to the application user, migrates, seeds, and starts the server. The app listens internally on port 3000 in the supplied production Compose setup.

Cloudflared connects the tunnel to the application service. The public domain uses HTTPS; the private container service is a different network hop. ORIGIN, tunnel routing, and actual request origin must agree. Private data and bootstrap history live in the mounted data directory so container replacement does not erase them.

```flow
Deploy and start server
Build or pull intended application image
Supply private runtime configuration and persistent data mount
Entrypoint validates settings and writable directory
Run migration backup/checks; attempt seed once
Start Node server and background schedulers
Cloudflare Tunnel exposes configured public HTTPS origin
Browser/APK loads deployed code and authorized APIs
```

### Git push is not deployment

The repository includes an image-publishing workflow. A push may build/publish an image if its workflow conditions and credentials are satisfied. The managed server still needs its own pull/rebuild/recreate step. Local edits, GitHub commit, image publication, running server version, and installed APK are different states.

The current Android client loads the configured server URL. Web-only changes require deploying server code. Native Java, permissions, launcher assets, and native bridge changes require a new APK. mobile-www/index.html is a packaged fallback/bootstrap artifact, not the complete offline backend. The app still needs the server for accounts and saved data.

### AI and credentials in containers

The base production Compose file does not start Ollama or automatically supply every optional setting. The fixed loopback inference endpoint needs an explicit compatible container arrangement. The Firebase extension mounts a private credential read-only; configure FIREBASE_SERVICE_ACCOUNT_FILE with its container absolute path. Never bake the service key into the image.

> Deployment means the running server uses the intended image, settings, migrations, and persistent volume. A successful Git push alone does not prove that.

Practice: Why can two installations show different accounts even when they share the same source code?

## 31 | Android SSL, connectivity, and offline limits

### What the APK needs

The manifest grants INTERNET. The APK's Capacitor configuration selects its server URL. A public build must target the public HTTPS origin; localhost on a phone refers to the phone unless USB reverse forwarding is active. Disconnecting USB breaks a localhost development connection.

ERR_SSL_PROTOCOL_ERROR concerns the HTTPS/TLS connection, before normal application login. Causes can include network filtering, TLS interception, wrong scheme/port, server TLS configuration, or client WebView/device differences. Browser success alone does not prove identical app traffic handling.

### Observed investigation

The project documentation records a particular phone/network failure: the app domain failed while unrelated HTTPS sites loaded. A separate phone TLS probe failed, and a credential-free diagnostic request returned an explicit filtering page. The user later confirmed that the same APK loaded on another network. That supports network filtering for that incident, not every future SSL error.

```flow
Diagnose APK connection failure
Read exact failing URL and error
? APK configured for intended HTTPS server? | Fix build target or USB forwarding
Compare same phone browser and app connection
? Same APK loads on another permitted network? | Investigate server TLS / WebView / device configuration
Review original network filter and TLS interception
Authorized operator corrects network/domain policy
Retest without disabling certificate checks
```

### Offline behavior

This is not a full offline-first emergency system. Without the server/network, sign-in checks, new SOS persistence, live queues, sharing uploads, and push delivery can fail. Pending retry context helps recover uncertainty; it does not prove an offline SOS was delivered. Never display success before the server confirms saving.

> We diagnose connection, configuration, and application failures separately. We do not bypass certificate verification to hide a TLS error.

Practice: Why is accepting all SSL errors an unsafe fix for a private-information application?

## 32 | Test coverage and what evidence proves

### Test layers

Unit tests check focused functions and policies. Database tests use isolated SQLite files and inspect constraints, migrations, rollback, and recovery behavior. API tests send requests through a real test server. Browser tests exercise pages with Playwright. Native bridge mocks simulate permissions/service responses; APK builds check Java/resources/manifest compilation. None alone proves real phone behavior.

| Area | Evidence locations |
|---|---|
| Database and bootstrap | tests/database.test.mjs, seed.test.mjs, create-admin.test.mjs |
| Login/profile/account access | account.frontend.ts, profile.api.ts, accounts.api.ts, staff-profile.frontend.ts |
| Recovery and MFA | recovery.api.ts, mfa.api.ts and dedicated Playwright configs |
| QR approval and revocation | trusted.api.ts, trusted.frontend.ts |
| SOS assignment and cancellation | incidents.api.ts, incidents.frontend.ts, sos-consent.* |
| Sharing and expiry | sharing.api.ts, sharing.frontend.ts |
| AI extraction/privacy/workflow | summary-extract.test.mjs, summary-privacy.test.mjs, ai-summary.* |
| Push | push-delivery.test.mjs, push.api.ts, firebase-mock.mjs |
| Android permission/lifecycle bridge | native.frontend.ts, permissions.frontend.ts, mobile-config.test.mjs |

### Evidence discipline

The recent User persistence/permission run recorded seven passing tests; the previous native/permission run recorded nine. APK builds and signature checks passed after native changes. docs/ai-verification.md records earlier isolated live-model quality checks and their limits. This guide did not rerun every historical suite or perform a new deployed-server audit.

```flow
Verification ladder
Define expected behavior and failure cases
Run focused unit / database checks
Exercise API authorization and invalid requests
Exercise browser workflow and race cases
Compile and inspect APK where native code changed
Test actual phone/network and deployed runtime separately
Report observed proof and unresolved limits accurately
```

### Responsible demonstration

Use fictional people and notes. Do not include real passwords, medical records, or private keys in slides. Do not place test calls to emergency services. A mocked push sender is useful for repeatable authorization tests but cannot prove an actual Android notification appeared.

> We test rules at several layers and distinguish simulation, local integration, device behavior, and deployment evidence.

Practice: Why does a successful APK build not prove that FCM displayed a phone notification?

## 33 | Code-reading toolkit and defense practice

### Operators you must recognize

| Code | Meaning | Example |
|---|---|---|
| !value | Not / false-like value | !emailVerified |
| a || b | At least one condition true | Missing user OR missing session |
| a && b | Both conditions true | Active AND verified |
| and(...) | SQL conditions must all hold | Matching session, owner, and future expiry |
| eq(a,b) | SQL values equal | Session user matches identity |
| gt(a,b) | SQL first value later/greater | Expiry later than now |
| !== | Strictly not equal | Role is not admin |
| condition ? A : B | Choose A if true, else B | New incident ? 201 : 200 |
| await | Pause this async function for result | Read submitted body |
| return | Give result back; exit function | Return summary |
| null | Explicit absence | No dispatcher assigned |
| string[] | Array of strings | A list, not one string |

### HTTP responses

200 means successful response. 201 means new resource created. 400 means malformed request. 401 means authentication required/invalid. 403 means forbidden. 404 means not found and can intentionally avoid revealing another person's resource. 409 means conflict with current state/retry. 410 means access/resource no longer available, such as ended sharing. 413 means body too large. 415 means wrong content type. 422 means fields fail validation. 429 means rate limit. 502/503 indicate dependency/service problems in the relevant paths.

### Practice answers

1. SOS success is a saved information record, not a telephone connection or delivery guarantee.
2. A contact entry alone creates no directional SOS approval.
3. Admin oversight and incident handling are separate permissions; changeIncident permits Dispatcher handling only.
4. Browser state is client-controlled; server checks the real role/session.
5. The server may commit before the response is lost, so retry uses the same idempotency key.
6. Public signup must never let the client grant itself a privileged role.
7. A persistent session can be usable by someone holding an unlocked signed-in phone; logout/device security still matter.
8. twoFactorEnabled describes account enrollment, not proof that this session completed a factor challenge.
9. 401 concerns authentication, 403 permission/account availability, and 404 can conceal another person's incident.
10. strictObject rejects the extra role field even if reason is valid.
11. An edited contact email must not inherit an old linked recipient's privilege.
12. Hashing an invitation token avoids retaining the usable token in the database.
13. Re-adding a relationship must not revive revoked historical sharing grants.
14. The same retry key plus changed data is ambiguous; matching payload is required.
15. Cancellation is pending until the assigned Dispatcher reviews it.
16. The second conflicting claimant gets 409 after the first assignment commits.
17. Normal status transition order is checked; valid enum input cannot skip workflow steps.
18. Notes may change or permission may be revoked while inference runs.
19. temperature: 0 reduces sampling variation; it does not prove truth or completeness.
20. Recipient access must reflect revocation immediately, not just session creation time.
21. The five-minute accepted-point interval avoids unnecessary duplicate updates.
22. Expiry is enforced by server time even if its notification is missed.
23. Generic push avoids exposing sensitive details on lock screens or messaging infrastructure.
24. Device permission alone does not create application sharing consent or a session.
25. ACTION_DIAL opens the dial screen; ACTION_CALL attempts a call. This plugin uses ACTION_DIAL.
26. A database marker survives container recreation and commits with the seed account.
27. Friendly application checks explain errors; unique constraints also defend concurrent writes.
28. Replacing a live database while writers run risks inconsistent or lost work.
29. Private runtime configuration does not travel with a Git clone.
30. Different DATABASE_URL files/volumes contain different account records.
31. Accepting SSL errors defeats server authentication and exposes private traffic to interception.
32. Compilation verifies build compatibility; physical permission/network/display behavior needs device testing.

### How to answer an unfamiliar panel question

```flow
Explain a feature during defense
Name the feature and its intended user
Point to page, endpoint, and responsible server module
Explain authentication, input rules, and permission
Describe database writes and failure handling
State visible result and external dependencies
Name limitations and evidence honestly
If uncertain, inspect code; do not invent implemented behavior
```

> Our design puts trust decisions on the server, uses explicit consent for sensitive actions, and keeps operational decisions with the assigned dispatcher.

## 34 | Demonstration plan and final boundaries

### Controlled start-to-finish demonstration

1. Identify the exact local or deployed origin and database. Use fictional demo accounts for User A, User B, two Dispatchers, and an Admin.
2. Show email verification and sign-in. Explain session persistence and logout revocation.
3. Show User A's saved personal/medical/contact profile. Explain these are supplied data, not medically verified facts.
4. Create User A's protected QR; scan as B. Show pending state and owner approval. If demonstrating mutual access, show the separate reverse approval.
5. In a controlled fictional SOS, show countdown cancellation before submission. Then show a saved test alert without placing a phone call.
6. Claim the alert as Dispatcher 1. Show Dispatcher 2 cannot read the assigned report or update its status.
7. Show assigned medical/contact access and notes. Show Admin read-only report oversight without the full registered medical panel.
8. Prepare AI notes with fictional text, inspect redaction, generate locally, compare source sentences, and approve. Show a failure preserves previous data if safe to simulate.
9. Demonstrate On route then Resolved, or separately demonstrate recipient cancellation and assigned Dispatcher review.
10. Start a short sharing session with selected trusted recipients. Show point timestamp, stop/expiry, and access revocation. Explain warnings are best-effort.
11. On a test Android phone, show explicit camera/location controls, push opt-in, compact overlay, and hiding through its notification. Do not press Call in an emergency dialer.
12. Show Admin account limits/last-admin guard with non-destructive fixtures. Explain seed_history and the persistent volume. Use isolated copies for restore demonstrations.

### Conditions to say aloud

- HandLink supports emergency information; it is not a certified emergency dispatch or telephony system.
- Calls remain external. There is no live call-state integration despite a reserved call_session schema.
- AI is assistive and extractive, not a clinical authority.
- Local implementation does not establish the exact public server version/configuration.
- Android overlay/background behavior is device-dependent. iOS does not have equivalent implemented native support here.
- GPS can be unavailable, stale, or manipulated. Sampled location is not continuous guaranteed tracking.
- Push and final-minute warnings are best-effort, not guaranteed alarms.
- Source-based access controls are not proof that all possible vulnerabilities have been eliminated.
- Filesystem permission is not at-rest encryption. Backups and private credentials need operational protection.

```flow
Whole-system demonstration finish
Verify controlled accounts and correct runtime
Register / verify / sign in; save own profile
Create QR approval and explicit sharing choices
Submit fictional SOS; assigned Dispatcher handles it
Review notes and optional local AI draft
Resolve incident; stop sharing; demonstrate logout
Show retained audit history and discuss tested limits
```

### Final study checklist

Explain the difference between authentication, authorization, validation, and database integrity. Trace an API call without saying event means emergency. Explain AND as every condition true, not equality. Identify source-of-truth records and server-owned fields. Name external dependencies and their failure outcomes. Show evidence instead of promising perfect security or delivery.

If asked something outside your verified implementation, say: I can explain the current design and check that exact path; I would not claim the behavior without verifying it.

## Appendix A | File-by-file map

Paths are relative to the repository root. Generated Android build files and dependencies are excluded. This map explains source ownership, not every generated artifact.

### Shared and server modules

| File | Responsibility |
|---|---|
| src/lib/ai-summary.ts | Shared AI draft/history/review response types for server and interface. |
| src/lib/client/request.ts | Shared fetch wrapper, timeout/HTTP error handling, and structured client request behavior. |
| src/lib/components/AiReportSummary.svelte | Dispatcher AI preview, privacy consent, generation, history, stale draft display, and explicit approval UI. |
| src/lib/components/AppShell.svelte | Staff workspace shell, role navigation, signed-in identity, and logout presentation. |
| src/lib/components/AuthScreen.svelte | Shared staff login/recovery presentation and relevant authentication actions. |
| src/lib/components/Brand.svelte | Shared brand presentation. |
| src/lib/components/IncidentCancellationReview.svelte | Assigned-dispatcher pending cancellation review/decision interface. |
| src/lib/components/MapPreview.svelte | Staff-facing coordinate/map preview. Map display is not a location authorization check. |
| src/lib/components/Reports.svelte | Role-scoped assigned report list/detail UI, status handling for owners, and saved AI summaries. |
| src/lib/components/StaffBrand.svelte | Staff portal logo/branding presentation. |
| src/lib/components/StaffProfile.svelte | Read-only signed-in staff name, email, role, and account-security link. |
| src/lib/components/StaffSecurity.svelte | Staff authenticator enrollment/verification, backup codes, and replacement workflows. |
| src/lib/components/StaffWorkspace.svelte | Shared staff alert queue, polling, incident detail, confirmation, notes, and status interface. |
| src/lib/demo/incidents.ts | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/lib/demo/report.ts | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/lib/demo/staff.svelte.ts | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/lib/incidents.ts | Shared incident/cancellation/detail/report TypeScript shapes. Types do not enforce runtime access or save records. |
| src/lib/index.ts | Supporting source module. Follow its imports and exports to trace its callers. |
| src/lib/native/location.ts | Capacitor/browser location bridge and foreground background-service status/control wrappers. |
| src/lib/native/permissions.ts | Android permission plugin wrapper and browser permission fallback; stopped camera tracks and stale async-start cancellation. |
| src/lib/native/phone.ts | Android ACTION_DIAL bridge, manual browser Android intent, and once-per-account/incident handoff marker. |
| src/lib/native/push.ts | Capacitor push registration/listeners, permission opt-in, server token binding, account synchronization, and notification navigation. |
| src/lib/notifications.ts | Shared notification response shapes, including SOS and sharing notices. |
| src/lib/server/accounts.ts | Paginated account listing; validated staff creation; quota; audited deactivation/reactivation; self and last-admin safeguards. |
| src/lib/server/ai-summaries.ts | Assigned-dispatcher preview/consent, request reservation, cooldown/versioning, post-inference source/access checks, saved draft/review history. |
| src/lib/server/api.ts | Current account/session checks; User/Staff/Admin gates; bounded same-origin JSON validation; private JSON responses. |
| src/lib/server/auth.ts | Better Auth configuration; SQLite adapter, password rules, email OTP, staff MFA session hooks, disabled parallel admin endpoints. |
| src/lib/server/db/auth.schema.ts | Generated authentication-schema artifact. Runtime db/index.ts imports schema.ts; do not confuse this artifact with a second live database. |
| src/lib/server/db/handlink.schema.ts | Application table definitions, foreign keys, checks, indexes, and relations for profiles, trust, SOS, AI, sharing, notices, push, and audit. |
| src/lib/server/db/index.ts | Opens configured SQLite database; enables foreign keys and five-second busy timeout; exports Drizzle connection. |
| src/lib/server/db/schema.ts | Main runtime schema: authentication identities/sessions plus seed/task definitions; re-exports application tables. |
| src/lib/server/email.ts | Private SMTP transport, TLS/timeout configuration, verification-code email submission and generic delivery errors. |
| src/lib/server/firebase-push.ts | Loads private absolute service-account path, initializes named Firebase Admin messaging instance, sends FCM requests. |
| src/lib/server/incident-notes.ts | Consistent selection of latest incident note for report and AI source versioning. |
| src/lib/server/incident-references.ts | SQL formatting for unique human-readable HL sequence references while UUID remains internal identity. |
| src/lib/server/incidents.ts | SOS targets and creation; safe retries; ownership-scoped queue/detail/report reads; exclusive claim; status/notes; recipient cancellation/review. |
| src/lib/server/location-expiry.ts | Final-minute owner/trusted warnings and eligible expiry notices, protected by durable deduplication keys/markers. |
| src/lib/server/location-policy.ts | Active sharing owner, eligible trusted/linked-contact candidates, and persisted invalid-recipient revocation. |
| src/lib/server/location-scheduler.ts | Starts one guarded local timer; initial expiry sweep and repeats every 15 seconds outside build execution. |
| src/lib/server/notifications.ts | Account-scoped notification list/read state, pagination, unread totals, and eligible active-sharing warnings. |
| src/lib/server/ollama-summary.ts | Fixed loopback Ollama chat call, local model validation, bounded 90-second inference, structured sentence-ID output. |
| src/lib/server/portal.ts | Role-specific page access, verified/active identity checks, staff MFA redirects, no-store page headers. |
| src/lib/server/push-delivery.ts | Persistent notification/device leases, eligibility/freshness checks, generic payload, retries, invalid-token revocation. |
| src/lib/server/push-devices.ts | Current-session Android token registration, status, ownership, token rotation, and opt-out. |
| src/lib/server/push-scheduler.ts | Five-second async delivery timer, configured-Firebase guard, and same-runtime overlap prevention. |
| src/lib/server/sharing.ts | Start/list/read/stop timed sessions; validate recipients and retries; owner-only point publishing and five-minute interval. |
| src/lib/server/staff-mfa.ts | Checks enabled staff authenticator and server-owned MFA proof on the current active session. |
| src/lib/server/summary-extract.ts | Sentence preparation, instruction-pattern checks, selection schemas, ordered bounded extraction from approved source. |
| src/lib/server/summary-privacy.ts | Known-identifier/pattern redaction, deletion-only preview edits, and usable-source checks. Not complete anonymization. |
| src/lib/server/trusted.ts | Account-bound email challenge; single-use QR issuance/locking/scanning; directional approval, optional pending mutual request, revocation. |
| src/lib/server/validation.ts | Strict runtime Zod input schemas for profiles, staff, incidents, QR, sharing, push, and AI operations. |
| src/lib/sharing.ts | Shared location-session, point, and recipient types. |
| src/lib/trusted.ts | Shared QR/trusted-connection request and response types. |
| src/lib/user/LocationPublisher.svelte | Visible-user sharing polling and point publishing with account cleanup, freshness, and native-service coordination. |
| src/lib/user/NativeSharingControls.svelte | Explicit Android foreground screen-off sharing enable/disable UI and status refresh. |
| src/lib/user/PushNotificationsControls.svelte | Explicit Android push opt-in/out, registration/configuration status, account-aware async updates. |
| src/lib/user/UserBrand.svelte | User portal logo/branding component. |
| src/lib/user/UserMap.svelte | User-facing coordinate map/link display, invalid-point fallback, and required map attribution. |
| src/lib/user/UserPermissionControls.svelte | Settings camera/location/overlay status, requests/retry, OS settings links, floating-button enable/hide. |
| src/lib/user/UserPermissionStartup.svelte | Initial protected-User permission attempt; non-blocking warning and stale account/unmount cleanup. |
| src/lib/user/UserProfileFields.svelte | Reusable personal/medical/emergency-contact form fields and constraints shown to users. |
| src/lib/user/account.ts | Profile-response conversion, phone normalization, saved profile payload, account operations, and refresh helpers. |
| src/lib/user/incidents-client.ts | User incident API calls and account-scoped pending SOS payload/retry coordination. |
| src/lib/user/preview.svelte.ts | Reactive User display/profile/clock state loaded from server data. Not a privileged local database. |

### Pages, layouts, and endpoints

| File | Responsibility |
|---|---|
| src/routes/+layout.svelte | Shared interface shell for nested pages. Owns layout and shared navigation/state. |
| src/routes/+page.ts | Page load or redirect logic. Check target before treating it as a standalone feature. |
| src/routes/admin/+layout.server.ts | Server layout loader. Supplies page data and enforces portal access before rendering. |
| src/routes/admin/+layout.svelte | Shared interface shell for nested pages. Owns layout and shared navigation/state. |
| src/routes/admin/+page.svelte | Visible page for /admin. Displays data and initiates user actions. |
| src/routes/admin/accounts/+page.server.ts | Page server loader/actions. Reads trusted server data for the corresponding page. |
| src/routes/admin/accounts/+page.svelte | Visible page for /admin/accounts. Displays data and initiates user actions. |
| src/routes/admin/forgot-password/+page.svelte | Visible page for /admin/forgot-password. Displays data and initiates user actions. |
| src/routes/admin/login/+page.svelte | Visible page for /admin/login. Displays data and initiates user actions. |
| src/routes/admin/profile/+page.svelte | Visible page for /admin/profile. Displays data and initiates user actions. |
| src/routes/admin/reports/+page.svelte | Visible page for /admin/reports. Displays data and initiates user actions. |
| src/routes/admin/security/+page.server.ts | Page server loader/actions. Reads trusted server data for the corresponding page. |
| src/routes/admin/security/+page.svelte | Visible page for /admin/security. Displays data and initiates user actions. |
| src/routes/api/account/deactivate/+server.ts | POST for /api/account/deactivate. Calls server helpers; see the endpoint index. |
| src/routes/api/admin/accounts/+server.ts | GET, POST for /api/admin/accounts. Calls server helpers; see the endpoint index. |
| src/routes/api/admin/accounts/[id]/+server.ts | PATCH for /api/admin/accounts/[id]. Calls server helpers; see the endpoint index. |
| src/routes/api/admin/accounts/[id]/verification/+server.ts | POST for /api/admin/accounts/[id]/verification. Calls server helpers; see the endpoint index. |
| src/routes/api/incidents/+server.ts | GET, POST for /api/incidents. Calls server helpers; see the endpoint index. |
| src/routes/api/incidents/[id]/cancellation/+server.ts | POST for /api/incidents/[id]/cancellation. Calls server helpers; see the endpoint index. |
| src/routes/api/incidents/targets/+server.ts | GET for /api/incidents/targets. Calls server helpers; see the endpoint index. |
| src/routes/api/notifications/+server.ts | GET for /api/notifications. Calls server helpers; see the endpoint index. |
| src/routes/api/notifications/[id]/read/+server.ts | POST for /api/notifications/[id]/read. Calls server helpers; see the endpoint index. |
| src/routes/api/profile/+server.ts | GET, PUT for /api/profile. Calls server helpers; see the endpoint index. |
| src/routes/api/profile/profile.e2e.ts | Handler for /api/profile/profile.e2e.ts. Calls server helpers; see the endpoint index. |
| src/routes/api/push/devices/+server.ts | GET, POST, DELETE for /api/push/devices. Calls server helpers; see the endpoint index. |
| src/routes/api/register/+server.ts | POST for /api/register. Calls server helpers; see the endpoint index. |
| src/routes/api/sharing/+server.ts | GET, POST for /api/sharing. Calls server helpers; see the endpoint index. |
| src/routes/api/sharing/[id]/+server.ts | GET for /api/sharing/[id]. Calls server helpers; see the endpoint index. |
| src/routes/api/sharing/[id]/points/+server.ts | POST for /api/sharing/[id]/points. Calls server helpers; see the endpoint index. |
| src/routes/api/sharing/[id]/stop/+server.ts | POST for /api/sharing/[id]/stop. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/incidents/+server.ts | GET for /api/staff/incidents. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/incidents/[id]/+server.ts | GET, PATCH for /api/staff/incidents/[id]. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/incidents/[id]/cancellation/+server.ts | POST for /api/staff/incidents/[id]/cancellation. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/incidents/[id]/confirm/+server.ts | POST for /api/staff/incidents/[id]/confirm. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/incidents/[id]/notes/+server.ts | POST for /api/staff/incidents/[id]/notes. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/reports/[id]/+server.ts | GET for /api/staff/reports/[id]. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/reports/[id]/summary/+server.ts | POST for /api/staff/reports/[id]/summary. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/reports/[id]/summary/preview/+server.ts | GET for /api/staff/reports/[id]/summary/preview. Calls server helpers; see the endpoint index. |
| src/routes/api/staff/reports/[id]/summary/review/+server.ts | POST for /api/staff/reports/[id]/summary/review. Calls server helpers; see the endpoint index. |
| src/routes/api/trusted/+server.ts | GET for /api/trusted. Calls server helpers; see the endpoint index. |
| src/routes/api/trusted/[id]/+server.ts | PATCH for /api/trusted/[id]. Calls server helpers; see the endpoint index. |
| src/routes/api/trusted/qr/+server.ts | POST for /api/trusted/qr. Calls server helpers; see the endpoint index. |
| src/routes/api/trusted/qr/[id]/+server.ts | DELETE for /api/trusted/qr/[id]. Calls server helpers; see the endpoint index. |
| src/routes/api/trusted/qr/challenge/+server.ts | POST for /api/trusted/qr/challenge. Calls server helpers; see the endpoint index. |
| src/routes/api/trusted/scan/+server.ts | POST for /api/trusted/scan. Calls server helpers; see the endpoint index. |
| src/routes/demo/DemoLinks.svelte | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/routes/demo/better-auth/+page.server.ts | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/routes/demo/better-auth/+page.svelte | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/routes/demo/better-auth/login/+page.server.ts | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/routes/demo/better-auth/login/+page.svelte | Demo/sample code. Not evidence of a production workflow. Keep separate from real server-backed behavior. |
| src/routes/dispatch/+layout.server.ts | Server layout loader. Supplies page data and enforces portal access before rendering. |
| src/routes/dispatch/+layout.svelte | Shared interface shell for nested pages. Owns layout and shared navigation/state. |
| src/routes/dispatch/+page.svelte | Visible page for /dispatch. Displays data and initiates user actions. |
| src/routes/dispatch/forgot-password/+page.svelte | Visible page for /dispatch/forgot-password. Displays data and initiates user actions. |
| src/routes/dispatch/login/+page.svelte | Visible page for /dispatch/login. Displays data and initiates user actions. |
| src/routes/dispatch/profile/+page.svelte | Visible page for /dispatch/profile. Displays data and initiates user actions. |
| src/routes/dispatch/reports/+page.svelte | Visible page for /dispatch/reports. Displays data and initiates user actions. |
| src/routes/dispatch/security/+page.server.ts | Page server loader/actions. Reads trusted server data for the corresponding page. |
| src/routes/dispatch/security/+page.svelte | Visible page for /dispatch/security. Displays data and initiates user actions. |
| src/routes/forgot-password/+page.ts | Page load or redirect logic. Check target before treating it as a standalone feature. |
| src/routes/login/+page.ts | Page load or redirect logic. Check target before treating it as a standalone feature. |
| src/routes/page.svelte.e2e.ts | Automated browser/API test. Checks behavior; not part of normal request handling. |
| src/routes/register/+page.ts | Page load or redirect logic. Check target before treating it as a standalone feature. |
| src/routes/user/+layout.server.ts | Server layout loader. Supplies page data and enforces portal access before rendering. |
| src/routes/user/+layout.svelte | Shared interface shell for nested pages. Owns layout and shared navigation/state. |
| src/routes/user/+page.svelte | Visible page for /user. Displays data and initiates user actions. |
| src/routes/user/call/+page.server.ts | Page server loader/actions. Reads trusted server data for the corresponding page. |
| src/routes/user/call/+page.svelte | Visible page for /user/call. Displays data and initiates user actions. |
| src/routes/user/dashboard/+page.svelte | Visible page for /user/dashboard. Displays data and initiates user actions. |
| src/routes/user/forgot-password/+page.svelte | Visible page for /user/forgot-password. Displays data and initiates user actions. |
| src/routes/user/login/+page.svelte | Visible page for /user/login. Displays data and initiates user actions. |
| src/routes/user/notifications/+page.svelte | Visible page for /user/notifications. Displays data and initiates user actions. |
| src/routes/user/profiles/+page.svelte | Visible page for /user/profiles. Displays data and initiates user actions. |
| src/routes/user/profiles/details/+page.svelte | Visible page for /user/profiles/details. Displays data and initiates user actions. |
| src/routes/user/profiles/edit/+page.svelte | Visible page for /user/profiles/edit. Displays data and initiates user actions. |
| src/routes/user/profiles/qr/+page.svelte | Visible page for /user/profiles/qr. Displays data and initiates user actions. |
| src/routes/user/profiles/scan/+page.svelte | Visible page for /user/profiles/scan. Displays data and initiates user actions. |
| src/routes/user/register/+page.svelte | Visible page for /user/register. Displays data and initiates user actions. |
| src/routes/user/reset-password/+page.svelte | Visible page for /user/reset-password. Displays data and initiates user actions. |
| src/routes/user/settings/+page.svelte | Visible page for /user/settings. Displays data and initiates user actions. |
| src/routes/user/sharing/+page.svelte | Visible page for /user/sharing. Displays data and initiates user actions. |
| src/routes/user/sharing/current/+page.svelte | Visible page for /user/sharing/current. Displays data and initiates user actions. |
| src/routes/user/sharing/view/+page.svelte | Visible page for /user/sharing/view. Displays data and initiates user actions. |
| src/routes/user/sos/+page.svelte | Visible page for /user/sos. Displays data and initiates user actions. |
| src/routes/user/user.e2e.ts | Automated browser/API test. Checks behavior; not part of normal request handling. |
| src/routes/user/verify/+page.svelte | Visible page for /user/verify. Displays data and initiates user actions. |

### Native Android source

| File | Responsibility |
|---|---|
| android/app/src/main/java/com/handlink/sos/HandLinkLocationPlugin.java | Capacitor GPS/foreground-location service bridge with permission and origin/session coordination. |
| android/app/src/main/java/com/handlink/sos/HandLinkOverlayService.java | Compact four-dot draggable dashboard shortcut; persistent hide notification; survives task swipe but not guaranteed process survival. |
| android/app/src/main/java/com/handlink/sos/HandLinkPermissionsPlugin.java | Serialized Android runtime/special permission requests, initial-attempt preference, overlay status/start/stop with stale-call guards. |
| android/app/src/main/java/com/handlink/sos/HandLinkPhonePlugin.java | Explicit ACTION_DIAL for tel:911. No ACTION_CALL; catches missing dialer/security failures. |
| android/app/src/main/java/com/handlink/sos/LocationSharingService.java | User-enabled foreground location service, authenticated point uploads, local expiry warning, and service cleanup. |
| android/app/src/main/java/com/handlink/sos/MainActivity.java | Registers native location, phone, and permissions plugins; opens dashboard only on configured permitted server origin. |

### Operator scripts

| File | Responsibility |
|---|---|
| scripts/android-doctor.mjs | Reports Android/Java/SDK setup readiness without exposing private environment values. |
| scripts/create-admin.mjs | Trusted local Admin provisioning utility; validates details, hashes password, never overwrites existing accounts. |
| scripts/expire-locations.mjs | Operator-invoked location expiry sweep using the configured database. |
| scripts/migrate.mjs | Open configured SQLite database, back up existing data, apply committed migrations, check foreign keys. |
| scripts/prepare-android.mjs | Validates chosen server URL and syncs Capacitor Android configuration/assets. Default is local development. |
| scripts/seed.ts | Transactional one-time verified bootstrap Admin, hashed credential, seed_history marker, safe startup skip/failure. |
| scripts/start-server.mjs | Starts the built Node application using runtime environment setup. |

## Appendix B | Complete custom API index

The methods below come from exported handlers. [id] is a URL parameter. Authentication endpoints are provided by Better Auth through hooks and listed separately in the lessons.

| Methods and endpoint | Source file |
|---|---|
| POST /api/account/deactivate | src/routes/api/account/deactivate/+server.ts |
| GET, POST /api/admin/accounts | src/routes/api/admin/accounts/+server.ts |
| PATCH /api/admin/accounts/[id] | src/routes/api/admin/accounts/[id]/+server.ts |
| POST /api/admin/accounts/[id]/verification | src/routes/api/admin/accounts/[id]/verification/+server.ts |
| GET, POST /api/incidents | src/routes/api/incidents/+server.ts |
| POST /api/incidents/[id]/cancellation | src/routes/api/incidents/[id]/cancellation/+server.ts |
| GET /api/incidents/targets | src/routes/api/incidents/targets/+server.ts |
| GET /api/notifications | src/routes/api/notifications/+server.ts |
| POST /api/notifications/[id]/read | src/routes/api/notifications/[id]/read/+server.ts |
| GET, PUT /api/profile | src/routes/api/profile/+server.ts |
| GET, POST, DELETE /api/push/devices | src/routes/api/push/devices/+server.ts |
| POST /api/register | src/routes/api/register/+server.ts |
| GET, POST /api/sharing | src/routes/api/sharing/+server.ts |
| GET /api/sharing/[id] | src/routes/api/sharing/[id]/+server.ts |
| POST /api/sharing/[id]/points | src/routes/api/sharing/[id]/points/+server.ts |
| POST /api/sharing/[id]/stop | src/routes/api/sharing/[id]/stop/+server.ts |
| GET /api/staff/incidents | src/routes/api/staff/incidents/+server.ts |
| GET, PATCH /api/staff/incidents/[id] | src/routes/api/staff/incidents/[id]/+server.ts |
| POST /api/staff/incidents/[id]/cancellation | src/routes/api/staff/incidents/[id]/cancellation/+server.ts |
| POST /api/staff/incidents/[id]/confirm | src/routes/api/staff/incidents/[id]/confirm/+server.ts |
| POST /api/staff/incidents/[id]/notes | src/routes/api/staff/incidents/[id]/notes/+server.ts |
| GET /api/staff/reports/[id] | src/routes/api/staff/reports/[id]/+server.ts |
| POST /api/staff/reports/[id]/summary | src/routes/api/staff/reports/[id]/summary/+server.ts |
| GET /api/staff/reports/[id]/summary/preview | src/routes/api/staff/reports/[id]/summary/preview/+server.ts |
| POST /api/staff/reports/[id]/summary/review | src/routes/api/staff/reports/[id]/summary/review/+server.ts |
| GET /api/trusted | src/routes/api/trusted/+server.ts |
| PATCH /api/trusted/[id] | src/routes/api/trusted/[id]/+server.ts |
| POST /api/trusted/qr | src/routes/api/trusted/qr/+server.ts |
| DELETE /api/trusted/qr/[id] | src/routes/api/trusted/qr/[id]/+server.ts |
| POST /api/trusted/qr/challenge | src/routes/api/trusted/qr/challenge/+server.ts |
| POST /api/trusted/scan | src/routes/api/trusted/scan/+server.ts |

## Appendix C | Configuration and supporting assets

Private settings are described by purpose only. Do not include real credentials in this guide.

| File or folder | Responsibility |
|---|---|
| src/hooks.server.ts | Checks incoming sessions; invokes Better Auth integration; starts expiry/push timers outside build mode. |
| src/env.ts | Environment typing/configuration support; actual runtime private settings remain server-side. |
| src/app.html | Base HTML document used by the web application. |
| src/app.d.ts | Shared application/request-local TypeScript declarations. |
| src/routes/layout.css | Global theme, layout, and component styles. CSS does not enforce access permissions. |
| package.json / pnpm-lock.yaml | Declared package versions, scripts, and locked dependency resolution. |
| svelte.config.js / vite.config.ts | Framework adapter/build/test-runtime configuration. |
| tsconfig.json | TypeScript checking and module configuration. |
| drizzle.config.ts / drizzle/ | Database migration configuration and committed SQL migration history. |
| .env / .env.example | Private local runtime values versus a shareable settings template. Never distribute the real .env. |
| Dockerfile / docker-entrypoint.sh | Image build, runtime permission/setup checks, migration, seed, and start sequence. |
| compose.production.yaml | Application container, private runtime values, persistent data mount, Cloudflare Tunnel service. |
| compose.firebase.yaml | Optional read-only Firebase service-account mount and in-container credential path. |
| .github/workflows/docker-publish.yml | Conditional image build/publication workflow. Does not establish that a managed server pulled the image. |
| capacitor.config.ts | Native app identity, bundled assets directory, and selected server configuration. |
| mobile-www/index.html | Packaged bootstrap/fallback HTML; not a complete offline copy of server/database features. |
| android/app/src/main/AndroidManifest.xml | Native permissions, activity/service declarations, special-use overlay foreground service, network policy. |
| android/app/src/main/res | Launcher assets, four-dot vector, network/file-provider resources. Generated build outputs are not source. |
| android/app/google-services.json | Android Firebase project configuration; private server signing credential is a different file. |
| static/ | Public images and other served assets. Never place private JSON keys or database files here. |
| playwright*.config.ts / tests/ | Isolated test servers, mock external dependencies, and API/browser policy checks. |
| docs/ | Setup, database, AI, Android, and push notes. Historical descriptions can lag current source. |
| android/app/build/outputs/apk/debug/app-debug.apk | Generated installable debug APK. Rebuild native changes; do not edit generated Java output. |
