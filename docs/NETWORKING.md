# Navis AI — Canonical Networking Model
Version: v0.1  
Status: Canonical (Doc-of-record)

This document defines the single source of truth for how Navis is reached over LAN.
If another document conflicts with this one, update the other document.

Setup details: see `SETUP.md`.

---

## 1. Goal (Apple-like UX)

- One clean LAN URL: `https://navis.local` (no port).
- No nginx requirement.
- No `sudo` during normal daily usage (`navisai up`).
- Daemon is not a privileged process.
- Works from phones and browsers on the same LAN.

---

## 2. Key Constraints (Why this design exists)

- In every browser, `https://navis.local` with no port implies TCP port **443**.
- On macOS/Linux, binding to 443 is privileged at least once.
- mDNS/Bonjour enables **LAN name resolution and discovery**; it does not change the browser’s default port behavior.

---

## 3. Components

### 3.1 Navis Daemon (unprivileged)

- Listens on **loopback**: `127.0.0.1:47621` by default.
- Serves:
  - PWA assets (SvelteKit build output)
  - Onboarding at `/welcome` (a PWA route)
  - REST API (see `IPC_TRANSPORT.md`)
  - WebSocket at `/ws`
- Uses HTTPS + WSS with a certificate valid for `navis.local`.

### 3.2 Navis Bridge (privileged only at setup time)

- Listens on **LAN** port **443** for `navis.local`.
- Forwards raw TCP to the daemon on `127.0.0.1:47621`.
- Does not terminate TLS (TCP passthrough). TLS remains end-to-end between client and daemon, satisfying “HTTPS everywhere”.

OS integration:
- macOS: launchd socket activation (recommended)
- Linux: systemd socket activation (recommended)
- Windows: service (recommended)

### 3.3 mDNS/Bonjour (LAN name resolution + discovery)

- Ensures `navis.local` resolves on the LAN to the host machine’s LAN IP.
- Advertises the Navis service for discovery/diagnostics (implementation detail), while clients use the canonical URL:
  - `https://navis.local`
  - `https://navis.local/welcome`
  - `wss://navis.local/ws`

---

## 4. Setup vs Daily Use (Human-in-the-loop)

### 4.1 One-time setup (explicit user consent)

`navisai setup` (or equivalent) performs OS-level configuration needed for the clean LAN URL:

- Install/enable the Navis Bridge (443 → 47621).
- Enable mDNS advertisement for `navis.local`.
- Generate/refresh the `navis.local` certificate used by the daemon.
- Provide user-guided steps for device trust on mobile (iOS requires an explicit trust action for local certificates).

This step may require admin privileges. It must be explicit, reversible, and never performed silently.

### 4.2 Daily use (no sudo)

`navisai up`:
- Starts the daemon unprivileged.
- Prints (and optionally offers to open) `https://navis.local/welcome`.

---

## 5. Optional “debug mode” (not the default)

For development/debugging, the daemon may optionally be reachable directly at:

- `https://<host>:47621`

This is not the canonical user experience and must not be required for normal onboarding.
