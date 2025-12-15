# Navis AI — System Architecture  
Version: MVP v0.1  
Status: Updated With PWA Starter Integration

---

# 1. High-Level Architecture Overview

Navis is composed of three primary executables and several shared internal packages:

- **Daemon** — local backend (HTTP + WebSocket)
- **CLI** (`navisai`) — entrypoint for developers; manages daemon
- **PWA** — mobile-first UI for monitoring and approvals
- **Shared Packages** — core logic, discovery engine, DB access layer, API contracts

```
 ┌──────────────┐        WebSocket/HTTP         ┌──────────────┐
 │   PWA (SK)    │ <───────────────────────────► │   Daemon     │
 │ phone/laptop  │                                │ local core  │
 └──────────────┘                                └──────────────┘
         ▲                                                  ▲
         │                                                  │
         │ QR + BLE + mDNS pairing                          │
         │                                                  │
         ▼                                                  ▼
 ┌──────────────┐                                 ┌────────────────┐
 │   CLI        │ ──────────── IPC/HTTP ───────► │ SQLite (Local) │
 │  navisai     │                                 │ navis.db       │
 └──────────────┘                                 └────────────────┘
```

---

# 2. Application Components

---

## 2.1 Navis Daemon

**Location:** `apps/daemon`

The daemon is the operational nerve center of Navis. Responsibilities:

- HTTP server (REST)
- WebSocket server (live updates)
- Device pairing: BLE, mDNS, QR token, HTTP hint service
- Project discovery + classification pipeline
- Session registry (terminal, ACP, other agents)
- Approvals pipeline
- Persistence in SQLite

**Tech Stack:**

- Node.js LTS
- Fastify or Hono for HTTP
- ws or socket.io for real-time events
- SQLite via better-sqlite3 or Prisma (recommended)

---

## 2.2 CLI (`navisai`)

**Location:** `apps/cli`

Responsibilities:

- Start/stop daemon (`navisai up/down`)
- Run system checks (`navisai doctor`)
- Trigger onboarding (`navisai pair`)
- Display project list / logs
- Provide a “simple mirror” of daemon status

CLI communicates with daemon via HTTP on local loopback.

**CLI Output Principles:**

- Minimal
- Helpful
- Never duplicate complex UI from the PWA

---

## 2.3 PWA UI  
### ⚡ **Updated with Chosen Starter Template**

**Location:** `apps/pwa`  
**Framework:** **SvelteKit**  
**Starter:** **vite-pwa-sveltekit (Vite Plugin PWA + SvelteKit)**  
Repo: https://github.com/vite-pwa/sveltekit

### Why This Starter?

1. **Battle-tested**: SvelteKit + Vite + vite-pwa is the most stable path for PWAs in 2025.
2. **Full offline support**: Service worker, caching, app shell.
3. **Installable on iOS and Android** with proper manifest defaults already included.
4. **Easy environment integration** with Node services and WebSockets.
5. **Perfect fit for Navis**:
   - Mobile-first UI
   - Fast hydration
   - Offline caching of device profile + settings
   - Simple API fetch+WS integration

### PWA Responsibilities:

- Initial onboarding UI
- Device pairing UI (BLE/mDNS/QR)
- Terminal stream viewer (read-only)
- ACP mirror UI
- Git view + commit templates UI
- Project switcher
- System Status panel
- Settings and metadata

The PWA connects to the daemon using:

- `fetch()` for control operations (REST)
- WebSocket for:
  - terminal output
  - ACP updates
  - approval requests
  - project updates

---

# 3. Shared Packages

All shared logic lives in `packages/`.

### 3.1 `@navisai/core`
- Domain types
- State machines
- Validation logic
- Config resolution

### 3.2 `@navisai/db`
- SQLite connection wrapper
- Migration runner
- Repository interfaces:
  - projects
  - signals
  - classification
  - sessions
  - approvals
  - devices
  - settings

### 3.3 `@navisai/discovery`
- Filesystem scanners
- Signal generation
- Classification rules
- Incremental scheduling

### 3.4 `@navisai/api-contracts`
- REST/WS schema definitions (TS/JSON schema)
- Shared between CLI ⇄ daemon ⇄ PWA

### 3.5 `@navisai/ui-components` (optional)
- Shared low-level UI components for Svelte apps

---

# 4. API Boundaries

## 4.1 REST API Examples

```
GET   /status
GET   /projects
GET   /projects/:id
GET   /sessions
POST  /approvals/:id/approve
POST  /approvals/:id/reject
POST  /pairing/request
POST  /pairing/approve
```

## 4.2 WebSocket Events

```
terminal.output
session.update
acp.message
approval.request
project.updated
device.paired
```

All events come stamped with:

- projectId
- sessionId (if relevant)
- timestamp

---

# 5. State Machines

## 5.1 Daemon Startup

```
STOPPED
  ↓ navisai up
STARTING
  ↓ DB INIT OK
RUNNING_MINIMAL
  ↓ discovery/classification
RUNNING_ENRICHED
```

## 5.2 Onboarding State Machine

```
UNPAIRED
 DISCOVERABLE   (BLE + mDNS + QR)
   ↓ pairing request received
PAIRING_PENDING
   ↓ approved by user
PAIRED
   ↓ PWA connected
APP_READY
```

---

# 6. Discovery & Classification Pipeline

```
Filesystem scan
  ↓
DiscoverySignals[]
  ↓
Classification rules
  ↓
Project object
  ↓
SQLite registry
  ↓
PWA UI updates
```

Discovery is:

- async
- incremental
- resumable
- non-blocking
- cancellable

Stored in SQLite for persistence across sessions.

---

# 7. Persistence Layer – SQLite

SQLite chosen for:

- zero server overhead
- local-first control
- ACID transactions
- durability with WAL mode
- excellent tooling

Tables:

- projects
- project_signals
- project_classification
- devices
- approvals
- sessions
- settings

(See `DB_SCHEMA.md`)

---

# 8. Security Model

- Pairing requires explicit approval via local device.
- BLE/mDNS advertise *identity only*, no secrets.
- All HTTP/WS traffic served over local HTTPS.
- Approvals required for:
  - file writes
  - git commits
  - agent actions that mutate state

---

# 9. Extensibility & Premium Features

Premium modules live outside the OSS monorepo:

```
pro/
  remote-access/     # remote subdomains + tunnels
  teams/             # multi-user & project collaboration
  plugins/
    import-servbay/  # specialized import and automation tools
```

The OSS architecture exposes:

- Plugin API (future)
- Transport extension points
- Agent extension points

---

# 10. PWA Starter Integration Details

### 10.1 Installed Dependencies

The starter includes:

```
@vite-pwa/sveltekit
@vite-pwa/assets-generator
vite
sveltekit
typescript or js + jsdoc
```

### 10.2 Required Customizations for Navis

- WS client for streaming terminal & ACP output
- Pairing module (BLE/web Bluetooth + QR scanning)
- Navis theming
- Secure local session caching
- Integration with `/status`, `/projects`, `/sessions`, `/approvals` endpoints
- Manifest updates:
  - theme color
  - icons
  - offline fallback screen (optional)
- Progressive boot splash (Navis branded)

### 10.3 Offline Capability in MVP

- UI loads offline  
- Cached device profile  
- Cached project metadata  
- Live features require reconnecting to daemon  

---

# 11. Distribution Considerations (NPM Toolset)

The architecture is intentionally designed so that:

- `@navisai/daemon` can be embedded into other dev tools
- `@navisai/discovery` can be used standalone
- CLI can be installed globally (`npm i -g navisai`)
- PWA can be bundled and served by the daemon directly
- Plugin authors can depend on core libraries

This will allow the Navis ecosystem to grow using npm distribution channels.

---

# 12. Summary

Key points:

- **Daemon** = orchestration + local API surface  
- **CLI** = simple UX wrapper  
- **PWA** = the primary UX environment  
- **SQLite** = durable local persistence  
- **Discovery engine** = core differentiator  
- **SvelteKit + vite-pwa-sveltekit** = modern starter for installable PWA  
- **Extensible architecture** for premium modules down the line  

---
