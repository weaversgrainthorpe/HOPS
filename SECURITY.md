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

## Security Best Practices for Users

- **Change the default admin password** immediately after first login
- **Use HTTPS** in production via a reverse proxy (Caddy, nginx, Traefik, etc.)
- **Restrict network access** if HOPS is only needed on your local network
- **Keep HOPS updated** to the latest release
- **Back up your data** regularly (HOPS creates automatic backups, but keep off-site copies too)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
