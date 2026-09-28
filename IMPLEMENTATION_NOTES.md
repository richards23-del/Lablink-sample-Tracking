# LabLink remediation

Updated 27 September 2026. The original [project review](PROJECT_REVIEW.md) is retained as a historical baseline; this document describes the corrected application.

## Completed changes

- Replaced missing pnpm catalog/workspace references with a standalone npm project, explicit dependency versions, a lockfile and a local TypeScript configuration.
- Added an Express/SQLite backend and shared frontend/API contracts. Records start empty and persist across process restarts.
- Added local first-account setup, password hashing, expiring cookie sessions, CSRF checks, trusted-origin checks and failed-login throttling. Public production setup is disabled; an administrator provisioning command is available.
- Replaced temporary alert acknowledgement and preferences with database operations. Workspace sync now refetches the active views and reports failures accurately.
- Enforced specimen transitions and roles on the server. Verification requires a recorded result summary and quality-check confirmation; release requires an authorized user and explicit confirmation.
- Preserved recollection history through separately identified, linked replacement specimens. Completed/original recollected records cannot be silently reopened.
- Made specimen changes and audit events transactional. Notes use persisted server identifiers, authenticated authors and server timestamps. Concurrent state changes are rejected using record versions.
- Added SQL-backed queue pagination, literal search, recent-update ordering and a separate overdue filter. Corrected dashboard timezone boundaries, today's turnaround calculation and zero-volume chart rendering.
- Centralized cache refresh after changes and immediately rendered canonical specimen responses. Corrected sign-in/sign-out cache handling so session changes update the visible application.
- Split the compressed application into readable feature pages and dialogs. Retained navigation during page failures and distinguished missing records, request errors and empty workloads.
- Added accessible dialog focus behavior, named controls, mobile navigation, visible queue status/priority/due information, reduced-motion support and stronger text contrast. Corrected the toast dismissal button's accessible name.
- Replaced fixed identity/date/time values with account and laboratory data. Fonts are served locally; template metadata and obsolete Replit workspace configuration were removed.
- Added setup/deployment documentation, environment examples, automated tests and a CI workflow.
- Added request-form contact preferences for SMS, email and WhatsApp; a durable delivery queue; safe preview mode; provider adapters; delivery retry states; and an administrator communications view. Preview mode is the default and has not contacted any real recipient.
- Added patient, clinician and transporter portal roles with explicit request assignments. The server limits each account to its assigned records and redacts clinical information according to the role.
- Added clinician-controlled patient result access. Clinician-requested results remain hidden from the patient until the assigned clinician permits viewing; direct laboratory customers can view their own released result.
- Added clinician acknowledgement and reminder workflows, a follow-up queue for unacknowledged results and unresolved recollections, plus a background worker that checks delays and reminders without requiring an open browser.
- Added an authenticated, idempotent inbound API for an existing LIS/LIMS and workspace controls for standalone or connected operation. Integration keys are shown once, stored as hashes, can be rotated or revoked, and imported results retain external-system provenance.
- Added a schema version 1 to version 2 migration that preserves existing accounts, sessions, specimen history and identifiers while adding the portal roles.

## Verification

Final local checks on 27 September 2026:

| Check                                                                       | Result                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| TypeScript (`npm run typecheck`)                                            | Passed                                                              |
| Unit/API suite (`npm test`)                                                 | 62 passed, including portal privacy, delivery and integration tests |
| Production build (`npm run build`)                                          | Passed; compiled output in `dist/public`                            |
| Browser suite (`npm run test:e2e`)                                          | 15 Chromium tests passed, including clinician-controlled visibility |
| Formatting (`npm run format:check`)                                         | Passed                                                              |
| Production dependency audit (`npm audit --omit=dev --audit-level=moderate`) | No known vulnerabilities reported                                   |

Verification used isolated test databases and synthetic records. Browser scenarios exercised sign-in, sync, failed reads, logout, preference persistence, alert acknowledgement, notifications, role restrictions, intake, result review/release, recollection/replacement, clinician-controlled result visibility, mobile navigation and keyboard accessibility. The normal workspace database remains separate and starts empty.

Automated accessibility checks cover selected rendered workflows; they do not constitute a complete accessibility certification. The configured CI workflow has not been executed on a remote repository during this local task.

## Deployment boundary

The project is now self-contained for local operation and testing. It has not been deployed to an external service, no real patient records were imported, and no real SMS, email or WhatsApp messages were sent. External delivery defaults to preview mode until provider configuration is explicitly supplied.

Before using real records, the operator must approve the workflow and turnaround targets, arrange TLS and protected durable storage, verify backup/restore, configure providers and approved WhatsApp templates, and establish account lifecycle and monitoring procedures. This is a single-workspace implementation: laboratory staff can view the workspace's records; patient, clinician and transporter accounts can view only records assigned to them. Analyzer interfaces, structured clinical result validation, password recovery/account deactivation and independent-reviewer separation remain outside this implementation.

See [README.md](README.md) for the exact local startup, production provisioning, role policy and configuration instructions.
