# Navis AI — Pairing Protocol

Version: v0.1  
Status: Draft (MVP-aligned)

---

## 1. Goals

The pairing protocol defines how a **Navis client** (SvelteKit PWA built with Tailwind CSS v4, running on phone/desktop) is securely linked to a **Navis daemon** running on a local machine.

Goals:

- Local-first, no cloud required
- Explicit user consent for pairing
- Secure enough for LAN use
- Resilient to casual snooping
- Simple enough for MVP implementation

---

## 2. Roles

- **Daemon**: Trusted process running on the developer’s machine.
- **Client**: PWA running on a phone, tablet, or browser on the same LAN.
- **User**: Human who approves pairing on the daemon host.

---

## 3. Transport Overview

Pairing uses multiple discovery channels:

1. **QR Code** (primary)
2. **mDNS/Bonjour** (service advertisement)
3. **BLE Beacon** (optional, if hardware permits)
4. **HTTP Onboarding Page** (`https://navis.local` or `https://<host>:port/welcome`)

These are used only to **discover the daemon** and **bootstrap** a secure pairing flow.

---

## 4. Pairing States

Daemon pairing state machine:

1. `UNPAIRED` — No trusted client yet.
2. `DISCOVERABLE` — Daemon emits discovery signals.
3. `PAIRING_PENDING` — A client requests pairing; waiting for user approval.
4. `PAIRED` — At least one device is trusted.
5. `PAUSING_DISCOVERY` — Discovery is disabled except when explicitly re-enabled.

The daemon transitions into `DISCOVERABLE` when:

- It is run the first time (`navisai up` with fresh DB), or
- The user explicitly runs `navisai pair`.

---

## 5. QR Payload Format

When the daemon is in `DISCOVERABLE`:

1. It generates a **short-lived pairing token** (`pairingToken`).
2. It hosts an HTTPS endpoint:

   ```
   POST /pairing/start
   Content-Type: application/json

   {
     "pairingToken": "<random-128-bit-hex>"
   }
   ```

3. It encodes into QR:

   ```json
   {
     "type": "navis-pairing",
     "version": 1,
     "host": "<daemon-local-hostname-or-ip>",
     "port": <https-port>,
     "pairingToken": "<random-128-bit-hex>"
   }
   ```

4. The QR code is displayed in the onboarding UI and/or CLI.

The client scans the QR and sends the token to the daemon over HTTPS.

---

## 6. BLE & mDNS

### BLE

- BLE advertises a generic service name: `NavisAI-<short-host-id>`
- BLE payload includes:
  - a non-secret identifier
  - the same host/port as QR

BLE does **not** carry pairingToken or secrets.

### mDNS (Bonjour)

Daemon announces:

- Service: `_navisai._tcp.local`
- TXT records:
  - `version=1`
  - `host=<hostname>`
  - `tls=1`

Clients can discover the daemon and then request QR or start pairing through the onboarding page.

---

## 7. Pairing Request Flow

Sequence:

1. Client discovers daemon (QR, BLE, or mDNS).
2. Client sends:

   ```
   POST /pairing/request
   Content-Type: application/json

   {
     "pairingToken": "<from-qr>",
     "clientName": "<user friendly name>",
     "clientDeviceInfo": { ... }
   }
   ```

3. Daemon validates:
   - `pairingToken` is valid and not expired.
   - Rate limits requests.

4. If valid, daemon enters `PAIRING_PENDING` and prompts the user locally:

   - CLI prompt, desktop notification, or terminal UI.

5. User approves or rejects:

   - Approve → device becomes trusted.
   - Reject → pairingToken invalidated.

---

## 8. Trust Material on Approval

On approval, daemon:

1. Generates a new `deviceId` (UUID).
2. Generates a `deviceSecret` or an asymmetric keypair (MVP: symmetric secret).
3. Stores in `devices` table:

   ```ts
   {
     id: string,             // deviceId
     name: string,
     publicKey?: string,     // optional if using asymmetric
     secretHash?: string,    // hashed deviceSecret if symmetric
     pairedAt: Date,
     lastSeenAt: Date,
     isRevoked: boolean
   }
   ```

4. Returns to client:

   ```json
   {
     "deviceId": "<uuid>",
     "deviceSecret": "<random-secret>",
     "apiBaseUrl": "https://<host>:<port>"
   }
   ```

5. Client stores `deviceId` and `deviceSecret` in secure storage (e.g. IndexedDB + browser storage).

`pairingToken` is then invalidated and discovery can be turned off automatically.

---

## 9. Post-Pairing Authentication (Overview)

After pairing, all client API calls:

- Include an **Authorization header**:

  ```
  Authorization: Navis deviceId=<id> signature=<HMAC>
  ```

- Where signature is computed using `deviceSecret` and a canonical representation of the request (see `AUTH_MODEL.md`).

Daemon verifies signature and checks `devices.isRevoked`.

---

## 10. Re-Pairing and Device Revocation

- `navisai pair`:
  - Re-enters `DISCOVERABLE` state.
  - Creates new `pairingToken`.
  - Emits QR/BLE/mDNS again.

- Device revocation:
  - `navisai devices revoke <deviceId>`
  - Marks `devices.isRevoked = 1`.
  - All future requests from that device are rejected.

---

## 11. MVP Simplifications

For v0.1:

- Use symmetric secrets (HMAC) instead of full public-key infra.
- Short pairing token expiry (e.g. 5–10 minutes).
- Only one active pairingToken at a time.
- BLE is optional; QR + mDNS + direct URL is sufficient to ship.

---
