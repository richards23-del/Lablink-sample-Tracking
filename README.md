# LabLink

LabLink tracks specimens and informs the people waiting for them. It aims to reduce missed results, unnecessary hospital visits and lost recollections through status notifications, clinician follow-up and private result portals. It combines React, an Express API and persistent SQLite storage. It can run as a laboratory workspace or connect to an existing laboratory system through an authenticated event API. No patient records or default credentials are bundled.

## Run locally

Use Node.js 22.12 or newer (Node 20.19 is also supported).

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. On the first visit, create the workspace and its administrator account, choose the laboratory timezone and set a password of at least 12 characters. Browser setup is limited to the local development server and is disabled after the first account exists. In Settings, add laboratory staff, clinicians, patients and transporters as needed. Link portal accounts to the correct request during specimen registration.

Patients, clinicians and transporters can also choose **Create a portal account** from the sign-in screen. Self-registration never creates administrator, technician or reviewer access. A portal account has no records until laboratory staff explicitly link it to a request; matching a name, email address or patient identifier does not grant access.

The API listens on `127.0.0.1:3001`. The development frontend proxies `/api` to it. Stop both processes with Ctrl+C. Accounts, specimens, notes, preferences, alerts and notification records remain in `data/lablink.sqlite` across restarts.

Optional configuration is documented in [.env.example](.env.example). Copy it to `.env` only if you need different ports, paths, allowed origins or turnaround targets. Both frontend configuration and server startup read `.env`. If changing ports, update the allowed browser origins accordingly.

## Supported workflow

1. An administrator or technician registers a collected specimen.
2. An administrator or technician starts processing.
3. Processing is submitted for verification with a result summary and quality-check confirmation.
4. An administrator or reviewer checks the recorded information and explicitly authorizes release.
5. An active specimen can instead require recollection. The replacement receives its own identifier and remains linked to the original specimen. The original history is retained.

The server enforces roles and transitions even for direct API requests. State-changing specimen actions include the record version; an intervening update causes a conflict instead of silently overwriting another user's work. Notes receive server-generated identifiers, timestamps and the authenticated author's name.

| Capability                                  | Administrator | Technician | Reviewer |
| ------------------------------------------- | ------------- | ---------- | -------- |
| View specimens, notes, timelines and alerts | Yes           | Yes        | Yes      |
| Add operational notes / acknowledge alerts  | Yes           | Yes        | Yes      |
| Register specimens and replacements         | Yes           | Yes        | No       |
| Start processing / submit for verification  | Yes           | Yes        | No       |
| Release verified results                    | Yes           | No         | Yes      |
| Request recollection                        | Yes           | Yes        | Yes      |
| Resolve alerts                              | Yes           | No         | Yes      |
| Add team accounts                           | Yes           | No         | No       |

Acknowledgement records that somebody has seen an alert; it does not resolve it. Recollection alerts are resolved when a replacement is registered. Overdue specimens retain their processing state; the overdue filter is a separate view of active specimens past their target. Default targets are 24 hours for routine, 8 for high priority and 2 for urgent, measured from receipt. These are configurable operational defaults and must be approved for the intended laboratory workflow.

Staff notification preferences affect future **in-app** messages. Request-form contacts and selected delivery channels separately control patient, clinician and transporter messages. Alerts remain available independently of notification preferences.

## Status messages and portals

At intake, select whether the request came from a clinician or directly from the patient. Record the relevant contact information and choose SMS, email and/or WhatsApp for each recipient. A contact without selected channels receives no external messages. Portal accounts are linked explicitly; matching an email address or patient identifier alone never grants access.

| Recipient   | Status notifications                                                                                                          | Portal access                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient     | Sample received; rejected, visit your healthcare provider; results delayed; results available, visit your healthcare provider | Own assigned specimens only. Clinician-requested results require permission from the assigned clinician. Direct customers can view their own released results. |
| Clinician   | Sample received; rejection with its reason; results delayed; results available; reminders for unacknowledged results          | Assigned requests and released results; acknowledge results and grant or revoke patient viewing permission.                                                    |
| Transporter | Sample received; results ready for collection                                                                                 | Assigned logistics status only; no clinical results, notes or rejection reasons.                                                                               |

The server applies these restrictions to API responses as well as the interface. Unreleased results remain hidden from external roles. Clinical notes and internal audit details are not exposed through patient or transporter portals. Laboratory staff cannot grant patients access to clinician-requested results.

The Follow-ups page retains rejected specimens until a linked replacement is registered and clinician-requested results until the assigned clinician acknowledges them. A background worker checks delays and unacknowledged results every minute, even when nobody is viewing the application. Clinician reminders begin 24 hours after release and repeat at most once every 24 hours until acknowledgement. An assigned patient can also request a clinician reminder after release, subject to a 24-hour cooldown. Acknowledgement records receipt of the result; it does not claim that treatment has occurred.

## Delivery configuration

**Preview mode is the default.** Communications shows queued messages and their recipient, selected channel, masked destination and processing status. A preview means no message was sent. This allows the complete workflow to be reviewed without provider accounts.

For live delivery, configure `.env` using [.env.example](.env.example), then restart the server:

- SMS: Twilio account credentials and an SMS sender.
- WhatsApp: Twilio WhatsApp sender and three approved templates, one per recipient role. Template variables are `{{1}}` for the sample reference and `{{2}}` for the permitted status text.
- Email: a Resend API key and a verified sender address/domain.
- Set `LABLINK_DELIVERY_MODE=live` only when configuration and request-form contacts are ready.

Messages never include the actual clinical result. Patient messages also exclude rejection reasons and internal instructions. The clinician rejection message includes the recorded reason as requested by the workflow. Provider credentials remain server-side.

The persistent outbox deduplicates events, records attempts and applies bounded retries. Missing provider configuration is reported as blocked. Provider acceptance is shown as **accepted**, not delivered or read; delivery receipts are not implemented. Ambiguous SMS/WhatsApp outcomes are marked uncertain to avoid automatic duplicate sends. Check the provider console before manually retrying an uncertain message. Existing previews do not become live sends when configuration changes.

See [the integration guide](docs/INTEGRATION.md) for connecting an existing LIS/LIMS, event payloads, API keys and idempotent retries. Connected mode enables event imports; the laboratory workspace remains available. A vendor-specific connector must map the existing system's events to this API.

Daily dashboard counts use the workspace timezone. Timestamp inputs for collection use the browser's local time and are converted to an absolute timestamp; record displays use the laboratory timezone.

## Checks

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run format:check
```

`npm run check` runs TypeScript checking, unit/API tests and the build. API tests use isolated databases. Browser tests start a separate frontend on port 5180 and API on port 3101 with a fresh database in the operating system's temporary directory; they do not modify the normal workspace database. Synthetic test accounts and specimens exist only in those test databases. Traces and screenshots are retained for failed browser tests under `test-results`.

CI runs formatting, application checks and Chromium workflow tests. No external service credentials are required.

## Production process

Build with `npm ci` and `npm run build`. `npm start` serves both the compiled frontend and API from the server; a static-only frontend upload is insufficient.

Provision an empty production database with `npm run admin:create`, using `LABLINK_ADMIN_NAME`, `LABLINK_ADMIN_EMAIL`, `LABLINK_ADMIN_PASSWORD`, and optionally `LABLINK_WORKSPACE_NAME` / `LABLINK_TIMEZONE`. Use a protected environment or secret manager. The command refuses to initialize a database that already contains users. Clear the provisioning password from the environment afterward. Do not commit credentials to source control.

Set `DATABASE_PATH` to a durable storage location and `APP_ORIGIN` to the exact HTTPS browser origin, without a trailing slash. Run behind a TLS-terminating reverse proxy. The server binds to loopback by default; change `HOST` only to match the deployment architecture. Production cookies are Secure, HttpOnly and SameSite=Strict; plain HTTP is not the supported production login path. Ensure the reverse proxy routes both application pages and `/api` to the server.

### Free review deployment on Render

For a short colleague review, deploy the public GitHub repository as a **Web Service** on [Render](https://render.com/docs/your-first-deploy). The included `render.yaml` selects the Node runtime, builds the application, binds it publicly and uses Render's HTTPS URL as the trusted application origin automatically. Create the service with the **Free** plan, then share its `onrender.com` address.

This configuration deliberately uses `/tmp/lablink.sqlite` and preview-only communications. Render's free web services lose local files when they restart or spin down, so it is suitable for demonstration records only. Do not enter real patient data or credentials there. A durable deployment needs a persistent database and configured messaging providers.

```powershell
$env:APP_ORIGIN = 'https://lab.example.org'
$env:DATABASE_PATH = 'C:\LabLinkData\lablink.sqlite'
npm start
```

### Replit deployment

This is a full-stack application, so publish it as a web-server deployment, not a static site. The included [.replit](.replit) file uses `npm run build` and starts the application on the platform-provided port. Replit deployments expose one application port, and the server must bind beyond `localhost`; the deployment command therefore sets `HOST=0.0.0.0`. Replit documents that requirement for Autoscale and Reserved VM deployments. [Replit port configuration](https://docs.replit.com/references/project-setup/ports)

In the Replit Publish panel, set the build command to `npm run build` and the run command to `npx cross-env HOST=0.0.0.0 npm start`. Add these deployment secrets:

```text
APP_ORIGIN=https://lab-link-sample-tracking--richardkiyimba9.replit.app
DATABASE_PATH=/path/to/durable/lablink.sqlite
```

Use the exact published URL for `APP_ORIGIN`; it protects authenticated write requests from untrusted origins. Add any SMS, WhatsApp and email provider values from [.env.example](.env.example) as deployment secrets, never source files. Keep `LABLINK_DELIVERY_MODE=preview` until the provider configuration, sender identities and WhatsApp templates have been checked.

This application needs durable persistent storage for the SQLite database. Select a deployment/storage arrangement that preserves the database across restarts and verify backup/restore before entering real records. A Reserved VM is appropriate for the app's background notifications and API service; Replit describes it as an always-on web-server deployment with configurable ports. [Replit Reserved VM deployments](https://docs.replit.com/references/publishing/reserved-vm-deployments)

The API rejects cross-origin writes, checks CSRF tokens, expires sessions, rate-limits login attempts, validates request bodies and returns no-store responses. Passwords are salted and hashed. Application fonts are served locally. Patient records and credentials are omitted from normal request-error logs.

This implementation is a **single-workspace application**. Laboratory staff can view workspace specimens; external roles see only explicitly assigned records. Separate laboratory tenants, structured clinical result validation, account deactivation/password recovery, analyzer interfaces and independent-reviewer separation are not implemented. Results currently use a text summary. Administrators can both process and release a specimen. The standalone package covers specimen operations and communications; inventory purchasing, billing and instrument quality control are future modules.

Before using real records, validate the laboratory's workflow and access policy, verify TLS and storage permissions, establish account lifecycle procedures, configure monitoring, and test backup/restore. The recorded audit history is application-managed; it is not a claim of tamper-proof storage or regulatory certification.

## Database backup

Stop the application before taking a file-level backup, and retain the SQLite database together with any accompanying `-wal`/`-shm` files that still exist. Use a protected destination outside the source directory. For live backups, use SQLite's supported online backup facility instead of copying an active database file. Verify restoration against an isolated installation and never overwrite the running production database as a test.

Fresh databases initialize automatically. Schema version 1 is migrated transactionally to version 2 while preserving accounts, sessions, specimens and history. Take a protected backup before upgrading an existing installation. A newer unsupported database version is rejected rather than modified.

## Project layout

| Path                       | Responsibility                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| `src/pages`                | Dashboard, authentication and feature views                          |
| `src/features/samples`     | Specimen forms and workflow dialogs                                  |
| `src/components`           | Application shell, accessible shared controls and recovery states    |
| `src/lib/api.ts`           | Typed API requests, CSRF handling and cache consistency              |
| `shared/types.ts`          | Frontend/server response contracts                                   |
| `server/app.ts`            | HTTP routes, sessions, authorization entry points and error handling |
| `server/samples.ts`        | Specimen workflows, audit records, alerts and metrics                |
| `server/database.ts`       | SQLite schema and password handling                                  |
| `server/validation.ts`     | Server-side request validation                                       |
| `server/communications.ts` | Durable delivery queue, recipient templates and provider adapters    |
| `server/integration.ts`    | Authenticated, idempotent imports from existing laboratory systems   |
| `server/worker.ts`         | Background delay checks, clinician reminders and delivery processing |
| `tests`                    | Browser workflows and accessibility checks                           |

[PROJECT_REVIEW.md](PROJECT_REVIEW.md) preserves the original review as a historical baseline. [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) records the remediation and verification results.
