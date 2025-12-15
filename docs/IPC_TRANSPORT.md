# Navis AI — IPC & Transport Specification

Version: v0.1  
Scope: Daemon ⇄ CLI ⇄ PWA (SvelteKit + Tailwind CSS v4) communications

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

Daemon listens on:

- Host: `0.0.0.0` (LAN access allowed if enabled in config)
- Default port: `47621` (example; configurable)
- Protocol: HTTPS with self-signed cert

Configurable via:

- `navis.config.json`
- CLI flags: `navisai up --port=...`

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
wss://<host>:<port>/ws
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
  - CLI knows how to start daemon (e.g. `node apps/daemon/dist/index.js`)

Flow example:

- `navisai up`:
  - Check if daemon already running (`GET /status`)
  - If not, spawn daemon process
  - Poll until daemon ready

- `navisai status`:
  - `GET /status` and format to console.

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
  - Additional origins can be configured in `navis.config.json`.
- For LAN-based access:
  - PWA is served from daemon itself; origin is consistent.
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
