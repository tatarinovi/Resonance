# Security Policy

## Supported Versions

Until the first tagged public release, only the current `master` branch and the
latest production image tag are supported for security fixes.

After v1.0, security fixes are provided for the latest minor release unless a
separate support agreement says otherwise.

## Reporting a Vulnerability

Do not open public GitHub issues for suspected vulnerabilities.

Report security issues privately to the project owner/maintainer. Include:

- affected version or image tag;
- reproduction steps;
- expected impact;
- relevant logs, screenshots, or request examples without real secrets.

The maintainer should acknowledge the report within 3 business days, triage the
issue, and coordinate a fix or mitigation before public disclosure.

## Secret Handling

Never commit `.env`, `.env.production`, access tokens, database dumps, private
keys, or production logs with secrets. If a secret is exposed, rotate it before
the next deployment and remove it from Git history before public publication.
