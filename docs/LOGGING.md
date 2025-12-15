# Navis AI — Logging Specification

Version: v0.1

---

## 1. Goals

- Provide consistent logging across daemon, CLI, PWA (SvelteKit with Tailwind CSS v4) server-side code, and plugins.
- Make logs easy to read in development.
- Provide structured logs for future analysis.
- Avoid leaking secrets.

---

## 2. Logging Package

Navis uses an internal logging package:

```
packages/logging/
  src/index.ts
```

Published as:

```
@navisai/logging
```

All internal modules import logging from this package instead of using `console` directly.

---

## 3. Log Levels

Supported levels:

- `debug`
- `info`
- `warn`
- `error`

Environment variables:

- `NAVIS_LOG_LEVEL` (default: `info`)
- `NAVIS_LOG_FORMAT`:
  - `pretty` (default for dev)
  - `json` (for structured logs/CI)

---

## 4. Log Destinations

1. **Console (stdout/stderr)**
   - Colorized output in dev.
   - Minimal noise in production.

2. **File logs**
   - Stored at:

     ```
     ~/.navis/logs/navis.log
     ```

   - Rotation policy (MVP):
     - Single log + optional max size check
     - Future: daily rotation / size-based rotation

---

## 5. Log Format

### 5.1 Pretty Output (Dev)

Example:

```
[2025-01-01T12:34:56.123Z] INFO  daemon   Daemon started on port 47621
[2025-01-01T12:35:02.456Z] WARN  pairing  Pairing token expired (tokenId=abc123)
[2025-01-01T12:35:10.789Z] ERROR db       Failed to write to devices table (err=SQLITE_BUSY)
```

Fields:

- timestamp
- level
- component (`daemon`, `cli`, `db`, `discovery`, `pairing`, etc.)
- message
- optional context metadata

### 5.2 JSON Output (Structured)

Example:

```json
{
  "ts": "2025-01-01T12:34:56.123Z",
  "level": "info",
  "component": "daemon",
  "msg": "Daemon started on port 47621",
  "meta": {
    "port": 47621
  }
}
```

Used for CI or advanced diagnostics.

---

## 6. Usage Pattern

```ts
import { createLogger } from "@navisai/logging";

const log = createLogger("daemon");

log.info("Daemon starting", { port });
log.warn("Pairing token expired", { tokenId });
log.error("Failed to connect to DB", { error });
```

Logger instances are typically singleton per module/component.

---

## 7. Secret Handling

Rules:

- Never log:
  - `deviceSecret`
  - raw pairing tokens
  - HMAC signatures
  - environment variables containing credentials
- When necessary, log only truncated identifiers:

  ```
  tokenId=abc123...
  deviceId=123e...
  ```

---

## 8. PWA Logging

- PWA logs to browser console for UI-level debugging.
- PWA should not send large logs back to daemon.
- Critical PWA events may be reported to daemon through a dedicated endpoint for troubleshooting, but never include secrets.

---

## 9. Plugin Logging

Plugins receive a logger via `NavisPluginAPI`:

```ts
api.log("info", "ServBay import suggestion added", { projectId });
```

Internally, this maps to the core logging package with `component="plugin:<id>"`.

---

## 10. Future Enhancements

- Configurable log retention and rotation.
- Integrations with external log aggregators (for self-hosters).
- Runtime toggling of log levels via CLI (`navisai logs level debug`).

---
