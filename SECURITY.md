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
- **Security headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- **Graceful shutdown** + HTTP timeouts (slow-loris mitigation)
- **SQLite foreign-key enforcement** with `ON DELETE CASCADE` where appropriate

## Security Best Practices for Users

- **Use HTTPS** via a reverse proxy (Caddy, nginx, Traefik, etc.) if exposed beyond your local network — HOPS does not terminate TLS itself
- **Restrict network access** if HOPS is only needed on your local network
- **Keep HOPS updated** to the latest release
- **Back up your data** regularly (HOPS creates automatic backups, but keep off-site copies too)
- **Don't expose HOPS to the public internet without an auth-aware reverse proxy** — HOPS authenticates the admin endpoints, but the public dashboard pages are intentionally accessible to anyone with the URL

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.5.x   | Yes       |
