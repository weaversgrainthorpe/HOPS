# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 3.x     | Yes: security fixes go into the latest 3.x release |
| < 3.0   | No. HOPS 2 gets no further fixes; please upgrade (see [Upgrading from 2.x](DEPLOY.md#upgrading-from-2x)) |

## Reporting a vulnerability

If you find a security vulnerability in HOPS, please report it privately.
**Do not open a public GitHub issue.**

Instead, please email: **security@weaversgrainthorpe.com**

Include as much of the following as you can:

- what the vulnerability is;
- steps to reproduce it;
- what an attacker could do with it;
- a suggested fix, if you have one.

You should get an acknowledgement within 48 hours. I'll work with you to
understand the issue and coordinate a fix before anything is made public.

## Scope

This policy covers the HOPS code in this repository: the program, the web
interface, `install.sh` and `hops-proxmox.sh`. It does not cover third-party
dependencies, though reports about vulnerable dependencies are still
appreciated.

## The security model in brief

HOPS is a launcher for a home network. Its design assumes that:

- **There is one admin.** HOPS has a single admin account (`admin`) and no
  user accounts or roles. Signing in is needed to change anything.
- **Dashboards are public to anyone who can reach HOPS.** Anyone who can
  open HOPS can view *every* dashboard and its tiles, whichever dashboard
  address they were given. There is no per-dashboard privacy. Don't put
  anything you consider private on a dashboard, and if any of it is
  sensitive, put the whole of HOPS behind a restricted network, a VPN, or an
  authenticating reverse proxy.

What protects the admin side:

- **Password.** The first sign-in with `admin` / `admin` must set a new
  password (8 to 72 characters) before anything else. Passwords are stored
  only as bcrypt hashes.
- **Session cookie.** Signing in sets an `HttpOnly` session cookie that page
  scripts can't read. It is marked `Secure` when HOPS is reached over HTTPS.
  How long a session lasts, and whether an idle one is signed out, are set
  under **Settings › Global settings › Sign-in & security**.
- **CSRF protection.** Every change (POST, PUT, PATCH, DELETE) must carry a
  token tied to the session, sent back in a header and compared in constant
  time (the double-submit cookie pattern). Another website can't make your
  browser change HOPS.
- **Sign-in limit.** Failed sign-ins are limited per address (20 a minute
  by default, **Failed sign-ins allowed per minute**).

What protects the browser:

- **Content Security Policy.** HOPS's pages run only HOPS's own scripts: no
  inline scripts except its own fingerprinted start-up script, and no
  `eval`. Pages can only fetch from HOPS itself (and the Iconify icon
  service, for icons outside the offline set). Other sites can't frame HOPS.
- **Uploaded files are sandboxed.** Uploaded icons and backgrounds,
  including SVG files, are served with a policy that stops them running
  scripts.
- Other headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
  `Referrer-Policy: same-origin` (your dashboard addresses don't leak to the
  services you open), and a `Permissions-Policy` that turns off camera,
  microphone, location and similar features.

What protects the network HOPS sits on:

- **SSRF guard on outbound connections.** Status checks, Network
  Discovery, favicon fetches and the other connections HOPS makes to
  addresses you give it all go through one guard. Your LAN and the HOPS
  machine itself are allowed (that's what a homelab dashboard is for). What
  is refused: link-local addresses (including the `169.254.169.254` cloud
  metadata address) and other known metadata addresses, multicast, and
  reserved or unspecified addresses, whatever way they are written. The
  guard checks the address actually connected to, on every redirect, so a
  DNS name can't be switched to a blocked address after the check.
- **No telemetry.** HOPS never contacts its author or any other service on
  its own. See [TENETS.md](TENETS.md#10-no-telemetry-fully-offline-capable).

Other protections: backup names from requests are checked strictly (no path
separators, no links), uploads have size limits (**Settings › Global
settings › Uploads**), and the HTTP server has time limits against slow
clients.

## Reverse proxies

If you run HOPS behind a reverse proxy, add the proxy's address under
**Settings › Global settings › Sign-in & security › Trusted proxy ranges
(CIDR)** (for example `192.168.1.5/32`) and restart HOPS. Only then does
HOPS believe the `X-Forwarded-For` / `X-Forwarded-Proto` headers, for the
per-client sign-in limit and for marking cookies `Secure`. Left empty (the
default), HOPS ignores those headers, so they can't be faked to get round
the sign-in limit. See [Reverse proxy](DEPLOY.md#reverse-proxy).

## Security testing

HOPS is reviewed regularly for the common classes of web-application
vulnerability (authentication and sessions, injection, XSS, SSRF, path
traversal, CSRF, rate limiting), with static source review and with probing
of a throwaway local copy. The automated tests also check the security
headers, the CSRF and sign-in boundaries, and upload limits.

This is a self-performed review, **not an independent third-party audit**.
It reduces risk; it does not guarantee there are no vulnerabilities.
Reports of anything it missed are very welcome; see
[Reporting a vulnerability](#reporting-a-vulnerability).

## Good practice for users

- **Use HTTPS** through a reverse proxy (Caddy, nginx, Traefik) if HOPS is
  reachable from outside your home network. HOPS does not handle TLS
  itself.
- **Limit who can reach HOPS** if it's only needed at home.
- **Choose a strong admin password.**
- **Keep HOPS updated** to the latest release.
- **Keep off-site copies of your backups** (Settings › Backups ›
  Download). HOPS backs up automatically, but only on the same machine.
