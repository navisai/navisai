# Navis AI — Setup (Apple-like LAN Experience)
Version: v0.1  
Status: Draft (Implementable target)

Canonical networking model: see `NETWORKING.md`.
Preferred macOS UX: see `MACOS_SETUP_EXPERIENCE.md`.

---

## 1. What “setup” enables

Navis targets a single, clean LAN origin:

- `https://navis.local` (no port)
- Onboarding: `https://navis.local/welcome`
- WebSocket: `wss://navis.local/ws`

To make this work without requiring users to run `sudo` for daily usage, Navis requires a one-time setup step that:

1. Enables a local **Navis Bridge** that owns TCP 443 and forwards to the daemon port (default 47621).
2. Enables **mDNS/Bonjour** so `navis.local` resolves on the LAN to the host machine’s LAN IP.
3. Generates/refreshes local TLS material for `navis.local`.
4. Guides device trust for mobile clients (iOS requires explicit trust for local certificates).

This step is explicit, user-consented, and reversible.

---

## 2. One-time setup command

Most users should use the macOS installer / setup app described in `MACOS_SETUP_EXPERIENCE.md`.
The CLI setup command exists for power users and CI-like environments.

Install the CLI:

```bash
npm i -g @navisai/cli
```

Run setup:

```bash
navisai setup
```

`navisai setup` launches the cross-platform helper from `apps/setup-app` (`@navisai/setup-app`) so the privileged bridge install (macOS LaunchDaemon / Linux systemd / Windows service) happens with a user-facing dialog before normal `navisai up` runs without `sudo`.

Setup may require administrator privileges (OS prompt) to register the bridge service and bind 443. Normal usage must not require `sudo`.

---

## 3. What `navisai setup` must do (spec)

### 3.1 Bridge service (443 → 47621)

Requirements:

- Listens on `0.0.0.0:443` for inbound LAN traffic to `navis.local`.
- Forwards TCP to `127.0.0.1:47621` (daemon), preserving end-to-end TLS to the daemon.
- Managed by the OS service manager so it is “always there” when the daemon is running.
- Fully reversible (uninstall/disable).

Recommended OS integrations:

- macOS: launchd socket activation
- Linux: systemd socket activation
- Windows: service

Current implementation status:

- macOS: implemented via a `launchd` LaunchDaemon (`com.navisai.bridge`) that runs `navisai-bridge` and binds 443 (admin prompt required once).
- Linux: implemented via a `systemd` service (`navisai-bridge.service`) installed by `navisai setup` (admin privileges via `pkexec` if available, otherwise `sudo`).
- Windows: implemented via a Windows service (`navisai-bridge`) created by `navisai setup` (UAC prompt + `sc` service for automatic 443 → 47621 forwarding).

### 3.2 mDNS/Bonjour for `navis.local`

Requirements:

- Provide `navis.local` resolution on the LAN to the host’s current LAN IP (A/AAAA).
- Publish a discovery service record for diagnostics and future features:
  - service name: `_navisai._tcp.local`
  - include TXT `tls=1`, `version=1`, and canonical origin `origin=https://navis.local`

Notes:

- Do not use hosts-file strategies for LAN/phone access.
- Conflicts must be detected (if another host claims `navis.local`, setup must fail with actionable guidance).
- Implementation note (v0.1): mDNS advertisement is provided by the daemon at runtime; `navisai setup` is responsible for enabling the bridge and can add diagnostics later to confirm mDNS behavior.

### 3.3 Certificates and trust

Requirements:

- The daemon serves HTTPS with a certificate valid for `navis.local`.
- Setup generates and stores cert material under `~/.navis/certs/`:
  - `~/.navis/certs/navis.local.crt`
  - `~/.navis/certs/navis.local.key`
- On iOS, users must perform an explicit one-time trust action. Setup/onboarding must guide this.
- Implementation note (v0.1): certificate generation happens automatically on first daemon startup; `navisai setup` may later pre-generate and export trust material for mobile.

Minimum acceptable onboarding UX:

1. User opens `https://navis.local/welcome` on desktop and sees onboarding.
2. Phone connects to the same origin and is guided through trusting the certificate (or installing a local CA/profile).
3. After trust is established, pairing proceeds via QR token as described in `PAIRING_PROTOCOL.md`.

---

## 4. Daily use (no sudo)

Start Navis:

```bash
navisai up
```

Open onboarding:

- `https://navis.local/welcome`

---

## 5. Diagnostics (must be supported)

`navisai doctor` must report:

- Bridge status (installed/enabled, 443 reachable)
- mDNS status (`navis.local` resolves to the host LAN IP)
- TLS status (daemon cert present; validity window)
- Daemon status (`GET /status`)

Quick manual smoke test (macOS + iPhone on same Wi‑Fi):

1. Run `navisai setup` once (accept the macOS admin sheet).
2. Run `navisai up` (no sudo).
3. On the iPhone, open `https://navis.local/welcome` and follow the certificate trust steps if prompted.

---

## 6. Uninstall / reset (must be supported)

`navisai reset` (or equivalent) must be able to:

- disable/remove the bridge service
- stop advertising mDNS records
- remove local certificates (optional, with explicit confirmation)

Reset must never silently delete user data without approval.

### UX Plan (non-terminal, macOS)

For mainstream users, the preferred path is the macOS Setup app described in `MACOS_SETUP_EXPERIENCE.md`:

- **Enable** installs the bridge LaunchDaemon (one-time admin sheet), then opens `https://navis.local/welcome`.
- **Disable** removes the bridge LaunchDaemon (one-time admin sheet). This does not delete user data.
- “Reset data…” is separate and requires explicit confirmation if it removes `~/.navis/db.sqlite` or certificates.
