# Navis AI Onboarding Flow

Version: v0.1

---

# 1. Trigger
User runs:

```
navisai up
```

Daemon enters `STARTING` then `UNPAIRED`.

---

# 2. Automatic Actions

1. Launch daemon (HTTP + WS)
2. Emit presence:
   - mDNS advertisement
   - BLE beacon (10 min timeout)
   - QR code for pairing token
   - HTTP onboarding shell (`navis.local/welcome`)
3. Auto-open browser (only if GUI session exists)

---

# 3. Browser Onboarding Experience

### 3.1 Welcome Screen
- “Navis is running locally”
- Explanation of local-first model

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

### 3.5 Device Paired
BLE + QR + mDNS signals turn off automatically.

### 3.6 Project Summary
User sees:
- detected projects
- classifications
- readiness indicators

### 3.7 Install PWA
Offer installation for mobile.

---

# 4. Terminal Feedback (Parallel)

```
Navis AI is running.
Discovery active.
Pairing mode enabled.
Opened browser for onboarding.
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
