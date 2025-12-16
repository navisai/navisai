# Navis AI — macOS Setup Experience (Apple-like)

Version: v0.1  
Status: Spec (preferred UX)

Canonical networking model: `NETWORKING.md`.

This document specifies the most user-friendly macOS setup for enabling the clean LAN origin:

- `https://navis.local` (no port)

It intentionally avoids terminal-first workflows for mainstream users.

---

## 1. UX Goal

Deliver a “double-click installer” experience:

1. User installs Navis like a normal Mac app.
2. macOS shows a standard authentication sheet **once** (administrator approval).
3. After install, daily usage requires **no password** and **no sudo**.
4. User can uninstall cleanly.

---

## 2. Why one admin approval is unavoidable

Browsers interpret `https://navis.local` as TCP **443**.
On macOS, something must be authorized to bind 443 (directly or via launchd/system services).

The goal is not “no admin approval ever”, but:

> Admin approval once during install/setup, never during daily use.

---

## 3. Preferred macOS Delivery: Installer + Privileged Bridge

### 3.1 What gets installed (system-level)

Install a small “Navis Bridge” component that:

- Binds `0.0.0.0:443` (LAN)
- Forwards TCP to the daemon on `127.0.0.1:47621`
- Does **not** terminate TLS (TCP passthrough; daemon remains the TLS endpoint)

Managed by:

- `launchd` LaunchDaemon (system domain)

### 3.2 What the user sees

- A standard macOS installer UI (signed `.pkg`) or a small macOS Setup app.
- A single macOS authentication sheet for admin approval.
- A final success screen that opens:
  - `https://navis.local/welcome`

### 3.3 Setup app responsibilities (nice-to-have)

A “Navis Setup” app can make the experience Apple-like:

- Shows clear status: Bridge, mDNS, TLS, daemon
- Runs diagnostics equivalent to `navisai doctor`
- Offers “Enable” / “Disable” buttons (calls privileged install/uninstall)
- Provides QR + pairing onboarding deep link

## 3.4 UX Plan (Install + Uninstall)

This section is a concrete plan for implementing a clean, Apple-like setup experience while preserving the canonical architecture in `docs/NETWORKING.md` and the setup spec in `docs/SETUP.md`.

### Install (clean and easy)

Goal: one standard macOS admin sheet, then onboarding opens automatically.

1. User launches “Navis Setup”.
2. Setup app runs preflight checks (no privilege required):
   - Detect whether the bridge LaunchDaemon is already installed/enabled.
   - Detect whether `navis.local` is resolving (best-effort; mDNS requires the daemon at runtime in v0.1).
   - Detect whether TLS material exists at `~/.navis/certs/` (informational; daemon is the TLS endpoint).
3. User clicks **Enable**.
4. Setup app requests admin approval once and installs/bootstraps the bridge (LaunchDaemon) that binds TCP 443 and forwards to the daemon port (TCP passthrough).
5. Setup app shows a success screen and opens:
   - `https://navis.local/welcome`

### Uninstall / Disable (clean and easy)

Goal: an obvious “Disable” button that cleanly removes the privileged component without deleting user data.

1. User launches “Navis Setup”.
2. If the bridge is enabled, UI shows **Disable** (and a “Re-enable” affordance after disable).
3. User clicks **Disable**.
4. Setup app requests admin approval and:
   - `launchctl bootout` the LaunchDaemon if loaded
   - Removes `/Library/LaunchDaemons/com.navisai.bridge.plist`
5. Setup app confirms that `https://navis.local` will no longer be reachable without the bridge and offers:
   - “Open reset instructions” (optional)
   - “Keep data” (default)

Data deletion is explicitly out of scope for “Disable”.
If the user wants to remove local data (e.g. `~/.navis/db.sqlite`, certs), the app must present a separate, explicit “Reset data…” flow with clear warnings and confirmation.

---

## 4. Relationship to NPM CLI

The NPM CLI remains the developer/control surface:

- `navisai up` starts the daemon (unprivileged).
- `navisai doctor` validates readiness.

For mainstream macOS users, the GUI installer/setup app is the **default**.
The terminal command `navisai setup` is an **advanced alternative** for power users. It launches the `apps/setup-app` helper (a lightweight Node + AppleScript dialog) so the experience still feels like an installer before performing the bridge install.

---

## 5. Uninstall / Disable (must be supported)

The user must be able to remove the bridge cleanly:

- Disable/uninstall LaunchDaemon
- Remove installed binaries/config for the bridge

This must never delete `~/.navis/db.sqlite` without explicit confirmation.

---

## 6. Implementation Notes (for engineers)

Acceptable macOS implementation strategies:

- Signed `.pkg` that installs a LaunchDaemon + `navisai-bridge` binary
- `SMJobBless` privileged helper (more complex, most “Apple-like”)

Non-goals:

- Requiring nginx
- Requiring users to manually edit `/etc/hosts`
- Binding the daemon directly to 443

---

## 7. Implementation Checklist (Setup app v0.1)

This checklist is intentionally scoped to the OSS repo and the documented architecture.

### 7.1 Setup app behaviors

- Add an explicit mode selection:
  - **Enable** (install/enable bridge)
  - **Disable** (uninstall/disable bridge)
  - Optional: **Open onboarding** (non-privileged convenience)
- Add preflight status display (no privilege):
  - Bridge installed? (`launchctl print system/com.navisai.bridge`)
  - Daemon reachable? (`GET https://navis.local/status` best-effort)
  - Cert present? (`~/.navis/certs/navis.local.crt` best-effort)
- Ensure messaging is “Apple-like”: concise, calm, and clear about the one-time admin sheet.

### 7.2 Privileged operations (macOS)

- Enable:
  - Write plist to `/Library/LaunchDaemons/com.navisai.bridge.plist`
  - `launchctl bootstrap system ...`
  - `launchctl enable system/com.navisai.bridge`
  - `launchctl kickstart -k system/com.navisai.bridge`
- Disable:
  - `launchctl bootout system /Library/LaunchDaemons/com.navisai.bridge.plist || true`
  - Remove plist file

### 7.3 CLI integration

- `navisai setup`:
  - Default to launching the setup app on macOS (already intended).
  - Support a `--no-ui` mode for advanced users.
- `navisai reset`:
  - Remains the power-user/CI fallback.
  - Must never delete `~/.navis/db.sqlite` without explicit confirmation.
