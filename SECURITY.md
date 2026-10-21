# Security Policy

## Scope

This repository is a software project and may be used for demonstration. Do not assume it is certified or suitable for handling sensitive production data without an independent security, privacy, and operational review.

## Reporting a vulnerability

Please do not publish exploitable details, credentials, patient/customer information, or proof-of-concept data in a public issue.

Use GitHub's **private vulnerability reporting** feature for this repository if it is enabled. If it is unavailable, contact the repository owner privately through their GitHub profile and include:

- A concise description and potential impact
- Steps to reproduce in a local, non-production environment
- Relevant logs or screenshots with secrets and personal information removed
- Any suggested mitigation

Please allow reasonable time to investigate before publicly disclosing an unresolved issue.

## If a secret is exposed

Revoke or rotate the credential immediately. Removing it from the latest commit does not invalidate a leaked secret; review repository history and service logs as appropriate.

## Responsible testing

Only test systems and data you own or are explicitly authorized to assess. Use synthetic records for demos and reports.
