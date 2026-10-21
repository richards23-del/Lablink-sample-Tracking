# LabLink — Laboratory Specimen Tracking

[![Checks](https://github.com/richards23-del/Lablink-sample-Tracking/actions/workflows/checks.yml/badge.svg)](https://github.com/richards23-del/Lablink-sample-Tracking/actions/workflows/checks.yml)

**A full-stack specimen workflow and result-coordination platform.**
LabLink helps laboratory teams track samples, coordinate follow-ups, and share status updates through role-restricted portals.

> **Demo and privacy note:** Use synthetic data for demonstrations. Do not enter real patient information into temporary or free deployments. Review the production guidance before real-world use.

### At a glance

- **Workflow:** registration, processing, verification, release, recollection, and follow-up.
- **Access control:** separate roles for staff, patients, clinicians, and transporters.
- **Communication:** SMS, email, and WhatsApp workflows; preview mode is enabled by default.
- **Engineering:** React, TypeScript, Express, SQLite, automated checks, and browser tests.
[![Checks](https://github.com/richards23-del/Lablink-sample-Tracking/actions/workflows/checks.yml/badge.svg)](https://github.com/richards23-del/Lablink-sample-Tracking/actions/workflows/checks.yml)

**A full-stack specimen workflow and result-coordination platform** built to help laboratory teams track samples, coordinate follow-ups, and share status updates through role-restricted portals.

> **Demo and privacy note:** Use synthetic data for demonstrations. Do not enter real patient information into temporary/free deployments. Review the production and data-storage guidance below before any real-world use.

### At a glance

- **Workflow:** specimen registration, processing, verification, release, recollection, and follow-up.
- **Access control:** distinct administrator, technician, reviewer, patient, clinician, and transporter capabilities.
- **Communication:** configurable SMS, email, and WhatsApp workflows, with preview mode enabled by default.
- **Engineering:** React + TypeScript frontend, Express API, SQLite persistence, automated checks, and browser tests.

[![Checks](https://github.com/richards23-del/Lablink-sample-Tracking/actions/workflows/checks.yml/badge.svg)](https://github.com/richards23-del/Lablink-sample-Tracking/actions/workflows/checks.yml)
![Node.js](https://img.shields.io/badge/Node.js-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?logo=sqlite&logoColor=white)

LabLink is a full-stack specimen-tracking application built around auditable laboratory workflows, role-based access, private portals, and configurable status notifications. It is designed to demonstrate practical application engineering: typed frontend/API contracts, server-enforced authorization, persistent storage, automated tests, and deployment safeguards.

> **Safety note:** This repository is a software demonstration, not a certified clinical product. Use synthetic data for evaluation. Do not enter real patient information into the free preview deployment.

## At a glance

- **Frontend:** React, TypeScript, Vite
- **API:** Node.js, Express, TypeScript
- **Storage:** SQLite
- **Verification:** TypeScript checks, unit/API tests, Playwright browser tests, formatting checks, GitHub Actions
- **Integrations:** Authenticated event API; optional Twilio SMS/WhatsApp and Resend email delivery
- **Deployment:** Docker/Compose and documented review deployment options

## Key workflows

- Register specimens, track processing, submit for verification, and release results through explicit role-controlled transitions.
- Keep an audit timeline and detect conflicting updates rather than silently overwriting another user's work.
- Provide patients, clinicians, and transporters with separate, explicitly assigned portal access.
- Queue status messages with preview mode as the default; external messages do not include clinical result contents.
- Track overdue specimens and follow-ups, with configurable targets and workspace timezone support.
- Connect an existing laboratory information system through an authenticated, idempotent event API.

## Run locally

**Requirements:** Node.js 22.12+ (Node 20.19+ is also supported).

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). On first launch, create a workspace and administrator account. The development frontend proxies API requests to the local server. Configuration options are documented in [`.env.example`](.env.example).

## Verify the project

```bash
npm run format:check
npm run check
npx playwright install chromium
npm run test:e2e
```

The automated checks use isolated test data. CI runs formatting, application checks, and Chromium workflow tests; it does not require external messaging credentials.

## Architecture and documentation

| Location | Purpose |
| --- | --- |
| `src/pages`, `src/features` | User-facing pages and specimen workflows |
| `server/app.ts`, `server/samples.ts` | API entry points, authorization and specimen operations |
| `server/database.ts` | SQLite schema and password handling |
| `server/communications.ts` | Notification queue and provider adapters |
| `server/integration.ts` | Authenticated event imports and idempotency |
| [Integration guide](docs/INTEGRATION.md) | Existing LIS/LIMS integration |
| [Environment example](.env.example) | Configuration reference without live credentials |

## Production and security considerations

- Keep credentials in a secret manager or protected deployment environment; never commit real `.env` files.
- Use HTTPS, a durable protected database volume, restricted administrator access, and tested backups before any production use.
- Preview mode is the default. Enable live messaging only after validating provider credentials, sender identities, recipient data, and approved templates.
- The free review deployment uses ephemeral storage and is intended for demonstration data only.
- Structured clinical result validation, analyzer interfaces, and independent-reviewer separation are not implemented. The audit history is application-managed and is not a claim of tamper-proof storage or regulatory certification.

See [Operations and deployment details](README.md#production-process) in the full documentation below for database provisioning, hosting notes, backup/restore, and deployment configuration.

## Contributing

Bug reports and improvements are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and review [SECURITY.md](SECURITY.md) before reporting a potential vulnerability.

---

The detailed workflow, role matrix, delivery configuration, production deployment instructions, backup procedure, and full project layout follow below.

## Detailed documentation

The sections below describe the supported workflows, role permissions, message delivery, production deployment, backup and recovery, and project layout in detail.

