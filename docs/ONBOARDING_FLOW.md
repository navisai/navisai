# Navis AI Onboarding Flow

Version: v0.1

Canonical networking model: see `NETWORKING.md`.

---

# 1. Trigger
User runs:

```
navisai up
```

Daemon enters `STARTING` then `UNPAIRED`.

---

# 2. One-time Setup (Required for clean LAN URL)

To deliver the clean, Apple-like LAN experience at `https://navis.local` (no port), the machine must be prepared once:

```
navisai setup
```

Setup responsibilities (explicit user consent; may require admin privileges):

1. Enable the Navis Bridge (TCP 443 → daemon port 47621).
2. Enable mDNS/Bonjour so `navis.local` resolves on the LAN to the host machine’s LAN IP.
3. Generate/refresh local certificates for `navis.local` (used by the daemon).
4. Provide guided steps for mobile trust (iOS requires an explicit trust action for local certificates).

Setup is never silent and is fully reversible.

The `navisai setup` command launches the platform helper (`apps/setup-app` / `@navisai/setup-app`) so installing the Navis Bridge (443 → 47621) and enabling mDNS is bundled with a friendly approval dialog before the canonical `https://navis.local` origin becomes available.

Preferred macOS UX:
- Users complete this “machine setup” via a signed installer or setup app (see `MACOS_SETUP_EXPERIENCE.md`).
- The CLI remains available for power users and development.

---

# 3. Daily Startup (No sudo)

On every run:

1. Start daemon (HTTPS + WSS), unprivileged.
2. Ensure discovery signals are active when `UNPAIRED`:
   - mDNS advertisement
   - BLE beacon (optional; time-limited)
   - QR code for pairing token
3. Print the canonical onboarding URL:

```
https://navis.local/welcome
```

Optionally offer to open the browser (opt-in or interactive prompt), rather than doing so silently.

---

# 4. Browser Onboarding Experience (PWA)

### 3.1 Welcome Screen
- “Navis is running locally”
- Explanation of local-first model
- If needed, show a guided mobile certificate trust step and provide a direct download link (e.g. `GET /certs/navis.local.crt`).

### 3.2 How Navis Works
- Visual overview:
  - Laptop ⇄ Phone ⇄ Navis Daemon

### 3.3 Connect Your Device
- BLE device discovery
- QR code
- mDNS fallback

### 3.4 Pairing Approval
Laptop receives prompt:
```
Pair device <name>?
[Approve] [Reject]
```
Real-time updates (WebSocket `approval.request` + `approval.updated`) keep that prompt live; the host UI auto-displays the latest pending approval without refresh.

### 3.5 Device Paired
BLE + QR + mDNS signals turn off automatically.

### 3.6 Project Summary
User sees:
- detected projects
- classifications
- readiness indicators

### 3.7 Install PWA
Offer installation for mobile. The PWA is built with SvelteKit and styled with Tailwind CSS v4 following the Navis brand guidelines.

---

# 4. Terminal Feedback (Parallel)

```
Navis AI is running.
Discovery active.
Pairing mode enabled.
Onboarding URL: https://navis.local/welcome
```

---

# 5. Recovery / Re-Pairing Flow

Triggered by:

```
navisai pair
```

Daemon re-enters DISCOVERABLE.
BLE and QR re-enabled with timeout.

---

# 6. Exit Conditions

Onboarding ends when:
- user is paired AND
- PWA acknowledges connection.

State transitions to `APP_READY`.

---
