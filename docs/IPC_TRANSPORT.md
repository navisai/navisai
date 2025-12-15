# Navis AI — IPC & Transport Specification

Version: v0.1  
Scope: Daemon ⇄ CLI ⇄ PWA (SvelteKit + Tailwind CSS v4) communications

Canonical networking model: see `NETWORKING.md`.

---

## 1. Goals

- Simple, debuggable IPC between core components.
- Work seamlessly for:
  - local CLI
  - local browser
  - LAN-based PWA on mobile
- Avoid OS-specific IPC complexity for MVP.

---

## 2. Chosen Transports

### Primary:

1. **HTTP/HTTPS** for control requests (REST)
2. **WebSocket** for stream/event updates

### Not used in MVP:

- Unix domain sockets (future optimization)
- gRPC
- SSE (Server Sent Events)

---

## 3. Ports & Host Binding

### Canonical user-facing origin (LAN)

- `https://navis.local` (no port)
- `wss://navis.local/ws`

### Daemon internal listener (default)

The daemon listens on loopback and is reached via the Navis Bridge:

- Host: `127.0.0.1`
- Default port: `47621` (configurable)
- Protocol: HTTPS with a certificate valid for `navis.local`

### Bridge (443 entrypoint)

The Navis Bridge listens on TCP 443 and forwards to `127.0.0.1:47621` (TCP passthrough).
This enables the clean URL without running the daemon as a privileged process.

### Configuration

Daemon port is configurable via:

- `~/.navis/config.json`
- CLI flags: `navisai up --port=...` (advanced/debugging)

---

## 4. HTTP Endpoints (MVP)

Base path: `/`

Examples:

- `GET /status`  
  - Basic daemon health, version, pairing state.

- `GET /projects`  
  - List of projects (requires auth).

- `GET /projects/:id`  
  - Details for a single project.

- `GET /sessions`  
  - Active sessions (terminal, ACP, etc.).

- `POST /approvals/:id/approve`  
- `POST /approvals/:id/reject`  

- `POST /pairing/request`  
  - As defined in `PAIRING_PROTOCOL.md`.

---

## 5. WebSocket Channels

WebSocket endpoint:

```
wss://navis.local/ws
```

Client authenticates on connect via query params or headers (see `AUTH_MODEL.md`).

Message schema (envelope):

```ts
type NavisEvent<T = any> = {
  type: string;            // e.g. "terminal.output"
  projectId?: string;
  sessionId?: string;
  data: T;
  timestamp: string;       // ISO8601
};
```

Core event types to support:

- `daemon.status`
- `project.updated`
- `discovery.progress`
- `terminal.output`
- `session.update`
- `approval.request`
- `approval.updated`

---

## 6. CLI ⇄ Daemon IPC

CLI uses:

- HTTP for status & lifecycle:
  - `GET /status`
  - `POST /shutdown`
  - `GET /logs` (optional tail)
- Local environment detection:
  - CLI knows how to start the daemon from the published `@navisai/daemon` entrypoint, and from workspace sources in dev.

Flow example:

- `navisai up`:
  - Starts daemon process (unprivileged)
  - Polls `GET /status` via `https://navis.local`

- `navisai status`:
  - `GET /status` via `https://navis.local` and format to console.

---

## 7. PWA ⇄ Daemon IPC

PWA uses:

- HTTP for:
  - project listing
  - approvals
  - pairing
- WebSocket for:
  - streaming terminal output
  - real-time updates

All calls are authenticated via Authorization header (see `AUTH_MODEL.md`).

---

## 8. CORS & Origin Rules

Daemon enforces CORS:

- Allowed origins:
  - PWA origin (same host/port)
  - Additional origins can be configured in `~/.navis/config.json`.
- For LAN-based access:
  - PWA is served from the daemon and reached via `https://navis.local`; origin is consistent.
- No wildcard `*` allowed for protected endpoints.

---

## 9. Error Semantics

HTTP error codes:

- `400 Bad Request` — malformed input
- `401 Unauthorized` — missing/invalid auth
- `403 Forbidden` — auth ok, but action forbidden
- `404 Not Found` — unknown resource
- `409 Conflict` — invalid state (e.g. already pairing)
- `500 Internal Server Error` — generic

WebSocket errors are surfaced as events:

```ts
{
  type: "error",
  data: {
    code: "UNAUTHORIZED" | "INVALID_REQUEST" | "INTERNAL",
    message: string
  },
  timestamp: "..."
}
```

---

## 10. Future Extensions

- Optional Unix domain sockets on localhost for CLI only.
- gRPC or JSON-RPC layer for advanced integrations.
- Dedicated channels per project/session for improved isolation.

---
