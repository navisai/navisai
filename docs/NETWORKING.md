# Navis AI — Canonical Networking Model
Version: v0.2  
Status: Canonical (Doc-of-record)

This document defines the single source of truth for how Navis is reached over LAN.
If another document conflicts with this one, update the other document.

Setup details: see `SETUP.md`.

---

## 1. Goal (Apple-like UX)

- One clean LAN URL: `https://navis.local` (no port).
- **Intelligent routing**: Navis integrates seamlessly with existing development apps.
- No `sudo` during normal daily usage (`navisai up`).
- Daemon is not a privileged process.
- Works from phones and browsers on the same LAN.
- **Zero conflict with development servers** on port 443.

---

## 2. Key Constraints (Why this design exists)

- In every browser, `https://navis.local` with no port implies TCP port **443**.
- Development apps commonly need port 443 for HTTPS testing.
- Navis must **defer to existing port 443 services** while providing its functionality.
- mDNS/Bonjour enables **LAN name resolution and discovery**; it does not change the browser's default port behavior.
- Users should not have to configure routing manually.

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
- **Paths are prefixed with `/navis`** when routed through the bridge.

### 3.2 Navis Bridge (intelligent reverse proxy)

- Listens on **LAN** port **443** for `navis.local`.
- **Automatically detects existing port 443 services** and configures routing accordingly.
- **Routing behavior**:
  - `/navis/*` → Navis daemon on `127.0.0.1:47621`
  - `/*` (all other paths) → Local development app on port 443
  - If no app on port 443: `/` → Navis daemon root (redirects to `/navis/welcome`)
- Terminates TLS for routing, re-encrypts to daemon when forwarding.
- **Graceful deferral**: If another service binds port 443 first, bridge waits and monitors.

OS integration:
- macOS: launchd LaunchDaemon (installed via `navisai setup`)
- Linux: systemd service
- Windows: service

Implementation note:
- The bridge is an intelligent reverse proxy that can detect and route around existing services.
- It installs itself with lower priority so existing services take precedence.

### 3.3 mDNS/Bonjour (LAN name resolution + discovery)

- Ensures `navis.local` resolves on the LAN to the host machine's LAN IP.
- Advertises the Navis service for discovery/diagnostics.
- Clients use the canonical URL:
  - `https://navis.local` (development app or Navis if no app present)
  - `https://navis.local/navis/welcome` (always Navis onboarding)
  - `https://navis.local/navis/*` (all Navis API/UI paths)
  - `wss://navis.local/navis/ws` (Navis WebSocket)

---

## 4. Setup vs Daily Use (Human-in-the-loop)

### 4.1 One-time setup (explicit user consent)

`navisai setup` performs OS-level configuration:

- Installs the Navis Bridge as an intelligent reverse proxy.
- Enables mDNS advertisement for `navis.local`.
- Generates/refreshes the `navis.local` certificate.
- Detects existing port 443 usage and configures routing automatically.
- Provides user guidance when port conflicts are detected.

This step may require admin privileges once. It's explicit, reversible, and never silent.

### 4.2 Daily use (no sudo)

`navisai up`:
- Starts the daemon unprivileged.
- Bridge automatically handles routing.
- Prints (and optionally offers to open) `https://navis.local/navis/welcome`.

### 4.3 Development workflow

1. Start your development app on port 443 (if needed)
2. Run `navisai up`
3. Navis automatically routes:
   - Your app: `https://navis.local`
   - Navis UI: `https://navis.local/navis/*`

---

## 5. Conflict Detection and Resolution

The bridge continuously monitors port 443:

- **If port 443 is free**: Bind and route all traffic to Navis
- **If port 443 is occupied**: 
  - Monitor the service
  - Attempt to inject routing for `/navis/*` paths
  - If injection fails, notify user with clear guidance
- **If service changes**: Automatically reconfigure routing

---

## 6. Optional “debug mode” (not the default)

For development/debugging, the daemon may optionally be reachable directly at:

- `https://127.0.0.1:47621` or `https://localhost:47621`

This bypasses the bridge and is not the canonical user experience.
