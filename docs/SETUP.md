# Navis AI — Setup (Apple-like LAN Experience)
Version: v0.2  
Status: Draft (Implementable target)

Canonical networking model: see `NETWORKING.md`.
Preferred macOS UX: see `MACOS_SETUP_EXPERIENCE.md`.

---

## 1. What "setup" enables

Navis targets a single, clean LAN origin:

- `https://navis.local` (no port)
- Navis UI: `https://navis.local/navis/welcome`
- Your app: `https://navis.local` (when port 443 is occupied)
- WebSocket: `wss://navis.local/navis/ws`

To make this work without requiring users to run `sudo` for daily usage, Navis requires a one-time setup step that:

1. **Installs an intelligent Navis Bridge** that can handle port 443 conflicts gracefully.
2. Enables **mDNS/Bonjour** so `navis.local` resolves on the LAN to the host machine's LAN IP.
3. Generates/refreshes local TLS material for `navis.local`.
4. **Detects and routes around existing port 443 services** automatically.
5. Guides device trust for mobile clients (iOS requires explicit trust for local certificates).

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

### 3.1 Intelligent Bridge service (reverse proxy on port 443)

Requirements:

- **Detects existing port 443 services** before binding
- **Routes `/navis/*` paths** to Navis daemon on `127.0.0.1:47621`
- **Routes all other paths** to the user's development app on port 443
- **Terminates TLS** for path inspection, re-encrypts when forwarding
- **Monitors for service changes** and reconfigures routing automatically
- Managed by the OS service manager so it's "always there"
- Fully reversible (uninstall/disable)

Routing behavior:

1. **Port 443 free**: Bridge binds directly, all traffic to Navis
2. **Port 443 occupied**: 
   - Attempts to inject itself as a proxy
   - Routes `/navis/*` → daemon
   - Routes `/*` → existing service
3. **Injection fails**: Clear error message with alternatives

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
- Navis UI: `https://navis.local/navis/welcome`
- Your app: `https://navis.local` (if port 443 was occupied during setup)

The bridge handles routing transparently.

---

## 5. Diagnostics (must be supported)

`navisai doctor` must report:

- Bridge status (installed/enabled, routing mode)
- Port 443 detection (free/occupied, service name)
- mDNS status (`navis.local` resolution)
- TLS status (certificate validity)
- Daemon status (`GET /navis/status`)
- Routing table (what paths go where)

Example output:
```
✅ Bridge: Enabled (intelligent routing mode)
✅ Port 443: Occupied by nginx
✅ Routing: /navis/* → Navis, /* → nginx
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

When `navisai setup` detects port 443 usage:

1. **Identify the service** (process name, PID)
2. **Explain the situation**: "Port 443 is used by [nginx]. Navis will route to your app at https://navis.local and to Navis at https://navis.local/navis/*"
3. **Show routing plan**:
   - Your app: https://navis.local
   - Navis UI: https://navis.local/navis/welcome
4. **Attempt installation**
5. **If routing fails**:
   - Clear explanation of why
   - Offer alternatives:
     - Temporarily stop the other service
     - Use a different port for testing
     - Manual proxy configuration
