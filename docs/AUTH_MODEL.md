# Navis AI — Authentication Model

Version: v0.1  
Status: Draft (MVP)

---

## 1. Goals

- Authenticate **trusted devices** (SvelteKit PWA clients built with Tailwind CSS v4) to the daemon over HTTPS.
- Require **pairing** before access.
- Protect local API from other devices on LAN.
- Keep implementation simple enough for MVP (no PKI requirement).

---

## 2. Identity & Secrets

Each trusted client (device) is represented by:

- `deviceId` — UUID
- `deviceSecret` — random 256-bit secret (base64 or hex)

Stored in SQLite `devices` table:

```ts
type Device = {
  id: string;            // deviceId
  name: string;
  secretHash: string;    // e.g. bcrypt or scrypt hash of deviceSecret
  pairedAt: string;
  lastSeenAt: string | null;
  isRevoked: boolean;
};
```

The **plain `deviceSecret` is only known by the client** and never stored in plaintext by the daemon.

---

## 3. Request Authentication Scheme

All authenticated API calls from client → daemon use:

```http
Authorization: Navis deviceId="<id>",signature="<base64>",timestamp="<iso8601>"
```

Where:

- `deviceId`: UUID from pairing
- `timestamp`: ISO8601 string
- `signature`: HMAC-SHA256 over a canonical string

Canonical string (MVP):

```
<HTTP_METHOD>\n
<PATH>\n
<BODY_SHA256_HEX>\n
<TIMESTAMP_ISO8601>
```

The client:

1. Computes `BODY_SHA256_HEX` of JSON body (or empty string for GET).
2. Concatenates method, path, body hash, timestamp.
3. Computes `HMAC_SHA256(canonicalString, deviceSecret)`.
4. Base64 encodes that HMAC as the `signature`.

The daemon:

1. Looks up `deviceId` in DB.
2. Ensures `isRevoked = 0`.
3. Verifies `timestamp` within a skew window (e.g. ±5 minutes).
4. Recomputes HMAC using `deviceSecret` (derived from `secretHash` check or raw secret if stored in memory).
5. Compares signatures in constant time.

If any check fails → `401 Unauthorized`.

---

## 4. Transport Security

- All communication uses HTTPS (self-signed cert for local).
- `Origin` checking is enforced:
  - Only allowed origins: Navis PWA served by the daemon, or matching CORS config.
- `SameSite` cookies are not relied on for primary authentication (we use Authorization header).

---

## 5. Session Lifetimes

Navis uses **stateless auth** per request (HMAC-based), so no server-side session store is required for authentication itself.

For convenience:

- Daemon can cache last few valid `(deviceId, signature, timestamp)` combos to detect immediate replay within tolerance.
- Long-lived trust: devices remain valid until explicitly revoked.

---

## 6. Public vs Private Endpoints

- Public endpoints:
  - `/status` (minimal info)
  - `/welcome` (onboarding shell)
  - `/certs/navis.local.crt` (certificate download for mobile trust UX)
  - `/pairing/request` (requires valid pairingToken)
  - `/pairing/start` (alias of pairing request)
- Auth-required endpoints:
  - `/projects/*`
  - `/sessions/*`
  - `/approvals/*`
  - `/logs`
  - `/devices/*` (management)
  - WebSocket endpoints (must perform auth handshake).

---

## 7. WebSocket Authentication

WebSocket connection is opened with:

- Query string or headers:

  ```
  GET /ws?deviceId=<id>&timestamp=<iso>&signature=<base64>
  ```

- Uses the **same canonical string model**:

  ```
  "WEBSOCKET\n/ws\n-\n<TIMESTAMP_ISO8601>"
  ```

Daemon validates `deviceId`, `timestamp`, `signature`.

If valid, the WebSocket is considered authenticated for that device until disconnect.

---

## 8. Device Revocation

- `navisai devices list` — show trusted devices.
- `navisai devices revoke <deviceId>` — marks device as revoked.

After revocation:

- All Authorization checks fail for that `deviceId`.
- WebSocket connections from that device are closed.

---

## 9. Future Enhancements (Beyond MVP)

- Optionally switch to a full asymmetric model (per-device keypairs).
- Support multiple users on same daemon with distinct roles.
- Add fine-grained permissions (e.g. read-only client).
- Introduce short-lived access tokens derived from device secrets.

---
