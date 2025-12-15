# Navis AI — Security Overview

Version: v0.1

---

## 1. Threat Model Summary

Navis is a **local-first tool** that exposes a control plane over LAN.

Primary threats:

- Other LAN devices attempting to access Navis API.
- Malicious browser scripts trying to call Navis endpoints.
- Accidental approvals leading to undesired code changes.
- Local machine compromise (less in scope; OS is assumed trusted).

---

## 2. Security Principles

1. **Local-first & explicit consent**
   - Daemon runs locally.
   - No cloud tunnel or remote access in OSS MVP.
   - Pairing is explicit and user-approved.

2. **Least privilege**
   - PWA cannot mutate state without explicit approval.
   - Agent actions are gated behind approval flows.

3. **Defense in depth**
   - HTTPS for all transport.
   - HMAC-based request signing.
   - CORS + origin controls.
   - Device revocation.

---

## 3. Key Safeguards

### 3.1 Pairing Requirements

- Devices must pair using QR/BLE/mDNS flow.
- Pairing requires local user approval.
- Pairing tokens are short-lived and one-time use.

### 3.2 Encryption in Transit

- Daemon serves HTTPS (self-signed certificate).
- WebSocket uses WSS.
- Clients must accept and trust the self-signed cert for local use.

### 3.3 Authentication

- Request-level HMAC scheme (`AUTH_MODEL.md`).
- Each device gets a unique `deviceId` + `deviceSecret`.
- Device secrets never transmitted again after pairing.

### 3.4 Authorization

- Only authenticated devices may access internal endpoints.
- Approvals required for mutative actions, e.g.:
  - file writes
  - git commits
  - launching shell commands (future)

---

## 4. Data at Rest

Navis stores:

- Project metadata
- Device trust records
- Approvals
- Sessions
- Settings

In SQLite at:

```
~/.navis/db.sqlite
```

Security:

- Protected by OS-level user permissions.
- Disk encryption (FileVault on macOS) recommended.
- Navis does not store raw code changes; they remain in user’s workspace.

---

## 5. Logs

Log contents:

- do not include secrets
- may include project paths and file names
- reside under:

  ```
  ~/.navis/logs/
  ```

See `LOGGING.md` for details.

---

## 6. Browser Security

- PWA is served from daemon itself.
- CORS policy restricted to trusted origins.
- No wildcard `*` allowed on sensitive endpoints.
- Service worker caches only static assets + minimal metadata.

---

## 7. Misconfiguration Risks

Potential misconfigurations:

- Exposing daemon port publicly (e.g. NAT).
- Overly permissive CORS config (`*`).
- Running on untrusted networks without pairing carefully.

Mitigations:

- Default configuration binds to local network with conservative CORS.
- Documentation warns strongly against manual exposure.

---

## 8. Future Hardening

Potential future improvements:

- mTLS between daemon and clients.
- Asymmetric keys per device.
- Rate limiting + anomaly detection.
- Fine-grained permission profiles per device (read-only mode, etc.).
- Enhanced audit logging for agent actions.

---
