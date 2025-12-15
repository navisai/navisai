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
