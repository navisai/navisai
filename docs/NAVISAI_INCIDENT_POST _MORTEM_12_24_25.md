# NavisAI Incident Post-Mortem & System Safety Protocol
**Status: STABLE BASELINE CONFIRMED**
**Last Known-Good Snapshot:** 2025-12-24-142244
**System:** macOS Sonoma 14.7.6 on MacBookPro9,1 via OpenCore Legacy Patcher (OCLP)

---

## 0. Purpose of This Document

This document exists to:

- Capture the **true root cause** of the incident that disrupted development
- Prevent recurrence on **this system and user systems**
- Provide a **decision framework** for future agents reviewing:
  - Conversation history
  - Git commits
  - Bead tasks
  - Architectural changes

This is **not** a blame document.
This is a **guardrail and recovery document**.

---

## 1. Executive Summary (Corrected & Final)

### What Happened
- Terminal-based networking (curl, Codex, MCP, dscacheutil, dns-sd) failed
- Browsers continued to work
- mDNSResponder was not advertising or resolving multicast DNS
- The failure **persisted across OS reinstalls**

### What Did *Not* Happen
- No hardware failure
- No generic DNS outage
- No Wi-Fi chipset incompatibility
- No APFS corruption
- No OCLP bug in isolation

### Root Cause (Confirmed)
A **policy-level override** disabled multicast DNS:
- `NoMulticastAdvertisements` behavior (explicit or implicit)
- Stored in **persistent system preferences**
- Preserved intentionally across reinstalls by macOS

This caused:
- `.local` resolution failure
- `dns-sd` returning `Service Not Running`
- CLI tooling to fail
- DoH-enabled browsers to continue functioning

---

## 2. Why Reinstalling macOS Did NOT Fix the Issue

macOS reinstalls:
- Replace the **sealed system volume**
- **Preserve**:
  - `/Library/Preferences`
  - `/Library/LaunchDaemons`
  - `/var/db`
  - Network policy plists

This is **by design**, not a bug.

Therefore:
- Reinstalling macOS **cannot** fix policy-level network overrides
- APFS containers and snapshots were **not** the root issue
- The issue was **configuration persistence**, not corruption

---

## 3. Final Verified Resolution Path

### Successful Indicators (Post-Reboot)
- `mDNSResponder` running
- `mDNSResponderHelper` running
- `dns-sd` responds
- `dscacheutil` resolves hosts
- `curl` resolves and negotiates TLS
- Reboot does **not** reintroduce failure

### Snapshot Taken
A local APFS snapshot was created **after** verification:
```
tmutil snapshot
→ 2025-12-24-142244
```

This snapshot is the **baseline restore point**.

---

## 4. HARD PROHIBITIONS (Non-Negotiable Rules)

Any future agent, automation, or human MUST NOT:

❌ Restore or merge old `SystemConfiguration` folders
❌ Diff and reapply `.broken` network plists
❌ Copy plists from previous installs into `/Library/Preferences/SystemConfiguration`
❌ Assume reinstall == clean state
❌ Modify pf, certificates, mDNS, or networking **without a snapshot**
❌ Attempt “repair by replacement” of system networking folders

**If these rules are violated, recurrence is likely.**

---

## 5. User-Space Fallout Clarification (IMPORTANT)

Observed:
- Zed Editor initially opened with blank state
- User settings later returned

Interpretation:
- This is **expected collateral behavior** after:
  - SystemConfiguration regeneration
  - Network service re-enumeration
  - Login services restart

Rule:
> **User app state loss is NOT a rollback signal**
> It does NOT indicate system instability or corruption

Agents must **not escalate** due to user-space resets alone.

---

## 6. Stable Baseline Declaration

This system is now considered:

- Network healthy
- Resolver healthy
- mDNS healthy
- OCLP stable
- Safe for continued development

All future experimentation MUST:

1. Start **after** snapshot `2025-12-24-142244`
2. Create a new snapshot before:
   - pf rule changes
   - Local TLS interception
   - mDNS manipulation
   - Network daemon changes

---

## 7. NavisAI Architectural Implications (MANDATORY)

### 7.1 Preflight Checks (Must Exist)
NavisAI must detect and block operation if:
- `mDNSResponder` not running
- `/var/run/mDNSResponder` socket missing
- `dns-sd` reports service failure
- SystemConfiguration recently regenerated
- OCLP detected without snapshot

### 7.2 Snapshot Enforcement
NavisAI must:
- Require a snapshot before any system mutation
- Refuse to operate without explicit opt-in snapshot creation
- Offer snapshot restore **only when Doctor detects known failure patterns**

### 7.3 OCLP Awareness
NavisAI must:
- Detect OCLP environments
- Display explicit risk messaging
- Avoid assumptions of “standard macOS behavior”

---

## 8. Debugging Tools Policy

### lldb
- **Allowed** in internal / developer / deep-doctor mode
- **Forbidden** for end-users
- Used only when daemon launch failures are detected

---

## 9. Guidance for Future Agents

Before proposing any action, the agent MUST:
1. Review this document
2. Review the prior conversation context
3. Review recent git commits
4. Review open and closed bead tasks
5. Confirm a snapshot exists

If uncertainty remains:
> **Stop. Ask. Do not guess.**

Outside-scope guidance rule:
> Any suggestion outside documented scope must be explicitly labeled as outside scope with a clear reason. No covert recommendations.

---

## 10. Final Note

This incident did not invalidate NavisAI.

It **validated** the need for:
- Guardrails
- Preflight diagnostics
- Snapshot-backed innovation

NavisAI remains viable on:
- OCLP systems
- Regular macOS systems
- Single-machine developer environments

**This document marks closure of the incident.**
