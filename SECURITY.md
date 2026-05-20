# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in HOPS, please report it responsibly. **Do not open a public GitHub issue.**

Instead, please email: **security@weaversgrainthorpe.com**

Include as much of the following as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive an acknowledgement within 48 hours. I'll work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This policy applies to the HOPS application code in this repository. It does not cover third-party dependencies, though reports about vulnerable dependencies are still appreciated.

## Built-in Security Features

HOPS ships with these protections enabled by default:

- **Forced password change** on first login (the default `admin/admin` cannot be left as-is)
- **Bcrypt password hashing** (no plaintext storage)
- **HttpOnly session cookies** (not accessible to JavaScript)
- **CSRF protection** via double-submit cookie pattern on all mutation endpoints
- **Per-IP rate limiting** on login (20 attempts/minute)
- **Path-traversal hardening** on backup operations
- **Browser hardening** — tells visitors' browsers to defend the page against common web attacks
- **Graceful shutdown** + HTTP timeouts (slow-loris mitigation)
- **SQLite foreign-key enforcement** with `ON DELETE CASCADE` where appropriate

## Security Testing

HOPS undergoes internal security review. The v1.5.4 and v1.5.5 releases
addressed findings from a structured assessment covering the common
web-application vulnerability classes — authentication and session
handling, injection, XSS, SSRF, path traversal, CSRF, and rate limiting —
combining static source review with dynamic probing of a disposable local
instance. The specific fixes are listed in the [CHANGELOG](CHANGELOG.md).

This is a self-performed, tooling-assisted review, **not an independent
third-party audit**. It reduces risk; it does not guarantee the absence of
vulnerabilities. Reports of anything it missed are very welcome — see
[Reporting a Vulnerability](#reporting-a-vulnerability) above.

## Security Best Practices for Users

- **Use HTTPS** via a reverse proxy (Caddy, nginx, Traefik, etc.) if exposed beyond your local network — HOPS does not terminate TLS itself
- **Restrict network access** if HOPS is only needed on your local network
- **Keep HOPS updated** to the latest release
- **Back up your data** regularly (HOPS creates automatic backups, but keep off-site copies too)
- **Don't expose HOPS to the public internet without an auth-aware reverse proxy** — HOPS authenticates the admin endpoints, but the dashboard pages are intentionally public
- **All dashboards are public — there is no per-dashboard privacy.** Anyone who can reach a HOPS instance can view *every* dashboard and the tiles within it, regardless of which dashboard path they were given. The navigation switcher lists them all, and the dashboard configuration is served unauthenticated so the pages can render. Do not put anything you consider private on a HOPS dashboard, and put the whole instance behind an auth-aware reverse proxy or a restricted network if any of its contents are sensitive.

## Reverse proxy configuration

If you run HOPS behind a reverse proxy:

- Set the **`HOPS_TRUSTED_PROXIES`** environment variable to the proxy's address as one or more comma-separated CIDR ranges (e.g. `HOPS_TRUSTED_PROXIES=10.0.0.0/8` or `192.168.1.5/32`). Only then will HOPS honour the `X-Forwarded-For` / `X-Forwarded-Proto` headers — for per-client login rate limiting and for marking cookies `Secure`. Left unset (the default), HOPS ignores those headers so they cannot be spoofed to bypass rate limiting.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.5.x   | Yes       |
