# Navis AI — Setup (Apple-like LAN Experience)
Version: v0.2  
Status: Draft (Implementable target)

Canonical networking model: see `NETWORKING.md`.
Preferred macOS UX: see `MACOS_SETUP_EXPERIENCE.md`.

---

## 1. What "setup" enables

Navis targets a single, clean LAN origin:

- `https://navis.local` (no port)
- Navis UI: `https://navis.local/welcome`
- Your app: continues working as before (packet forwarding separates domains)
- WebSocket: `wss://navis.local/ws`

To make this work without requiring users to run `sudo` for daily usage, Navis requires a one-time setup step that:

1. **Installs intelligent packet forwarding** with transparent HTTPS proxy that selectively routes navis.local traffic to the daemon.
2. Enables **mDNS/Bonjour** so `navis.local` resolves on the LAN to the host machine's LAN IP.
3. Generates/refreshes local TLS material for `navis.local` and auto-detected development servers.
4. **Zero conflicts with existing services** - other development tools and HTTPS services continue working normally.
5. **Auto-detects local development servers** and creates convenient domain mappings (e.g., app.localhost, api.localhost).
6. Guides device trust for mobile clients (iOS requires explicit trust for local certificates).

This step is explicit, user-consented, and reversible.

---

## 2. One-time setup command

Most users should use the macOS installer / setup app described in `MACOS_SETUP_EXPERIENCE.md`.
The CLI setup command exists for power users and CI-like environments.

### Pre-publish local testing (this repo)

If you are testing before publishing to NPM, run commands from the repo root:

- `./navisai up`
- `./navisai setup`
- `./navisai doctor`

To make `navisai` available without `./`, run `pnpm dev:link` once to install a symlink into `~/.local/bin` (opt-in and reversible with `pnpm dev:unlink`). Ensure `~/.local/bin` is on your `PATH`.

Install the CLI:

```bash
npm i -g @navisai/cli
```

Run setup:

```bash
navisai setup
```

`navisai setup` launches the cross-platform helper from `apps/setup-app` (`@navisai/setup-app`) so the privileged bridge install happens with a user-facing dialog that explains routing and port detection.

---

## 3. What `navisai setup` must do (spec)

### 3.1 Packet forwarding service

Requirements:

- **Installs transparent HTTPS proxy** with intelligent domain-based routing
- **Routes `navis.local` traffic** to Navis daemon on `127.0.0.1:47621`
- **Routes all other domains** through unchanged (no interference)
- **Selective TLS termination** with end-to-end encryption preservation
- **Works alongside existing services** without conflicts
- **Auto-detects local dev servers** and creates domain mappings
- Managed by the OS service manager for persistence
- Fully reversible (uninstall/disable)
- See [DOMAIN_BASED_FORWARDING_DESIGN.md](./DOMAIN_BASED_FORWARDING_DESIGN.md) for technical details

Packet forwarding by platform:

1. **macOS**: pfctl with rdr rules for navis.local
2. **Linux**: iptables with string matching on Host header
3. **Windows**: netsh portproxy (forwards all 443 traffic)

### 3.2 mDNS/Bonjour for `navis.local`

Requirements:

- Provide `navis.local` resolution on the LAN to the host's current LAN IP (A/AAAA).
- Publish a discovery service record:
  - Service name: `_navisai._tcp.local`
  - TXT records: `tls=1`, `version=1`, `origin=https://navis.local`

### 3.3 Certificates and trust

Requirements:

- The bridge serves HTTPS with a certificate valid for `navis.local`.
- Setup generates and stores cert material under `~/.navis/certs/`:
  - `~/.navis/certs/navis.local.crt`
  - `~/.navis/certs/navis.local.key`
- For forwarding to user's app: either pass through original TLS or re-encrypt
- iOS trust guidance provided in onboarding

---

## 4. Daily use (no sudo)

Start Navis:

```bash
navisai up
```

Access URLs:
- Navis UI: `https://navis.local/welcome`
- Your app: continues working as before (domain-based routing separates traffic)

Packet forwarding handles routing transparently.

---

## 5. Diagnostics (must be supported)

`navisai doctor` must report:

- Bridge status (installed/enabled, routing mode)
- Port 443 detection (in use by other services)
- mDNS status (`navis.local` resolution)
- TLS status (certificate validity)
- Daemon status (`GET /status`)
- Packet forwarding rules status

Example output:
```
✅ Packet forwarding: Enabled (domain-based routing)
✅ Port 443: Available for other services
✅ Forwarding: navis.local → daemon:47621
✅ mDNS: navis.local → 192.168.1.100
✅ TLS: Valid until 2025-12-31
✅ Daemon: Running
```

---

## 6. Uninstall / reset (must be supported)

`navisai reset` must:
- Disable/remove the bridge service
- **Preserve user's port 443 service** - uninstall should not break their app
- Stop mDNS advertising
- Remove local certificates (optional, with confirmation)

The bridge uninstall must:
1. Stop the bridge process
2. **Ensure the original port 443 service continues uninterrupted**
3. Remove LaunchDaemon/service files

---

## 7. Cleanup (factory reset for testing)

For repeatable onboarding tests, Navis supports a **confirm-gated** cleanup command.

### 7.1 `navisai cleanup` modes

- `navisai cleanup --bridge-only` (safe/default):
  - Removes bridge service only
  - Does NOT affect the user's port 443 applications
  - Optionally removes TLS certs
  - Preserves all Navis data

- `navisai cleanup --all` (destructive):
  - Removes bridge service
  - Removes all Navis local state
  - **Leaves user's applications running on port 443 untouched**

### 7.2 Safety requirements

- Must confirm the bridge can be removed without disrupting user services
- Must verify port 443 remains accessible after bridge removal
- Clear warnings about what will/won't be affected
- Typed confirmation for destructive operations

---

## 8. Port Conflict Resolution Flow

When `navisai setup` runs (regardless of port 443 usage):

1. **Install packet forwarding rules** for navis.local domain
2. **Explain what's happening**: "Navis will use packet forwarding to route navis.local traffic to the daemon without interfering with other services"
3. **Show access plan**:
   - Navis UI: https://navis.local/welcome
   - Your apps: continue working unchanged
4. **Install OS service** to manage forwarding rules
5. **If installation fails**:
   - Clear explanation and manual steps
   - Offer alternatives:
     - Temporarily stop the other service
     - Use a different port for testing
     - Manual proxy configuration
