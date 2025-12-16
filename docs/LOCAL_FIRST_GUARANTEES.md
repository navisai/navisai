# Local-First Guarantees (v0.1)

This document defines the **explicit local-first guarantees** for NavisAI.
These guarantees are architectural, operational, and user-visible.

Canonical networking model: `NETWORKING.md`.

---

## 1. Definition of Local-First (NavisAI)

In NavisAI, *local-first* means:

- The **local daemon is the single source of truth**
- All state is stored **on the user’s machine** (`~/.navis/`)
- The system functions **offline by default**
- No background sync or cloud dependency exists in the OSS build
- Remote or mobile clients are **never authoritative**

Local-first here prioritizes **control, safety, and determinism**, not collaborative editing semantics.

---

## 2. Authority Model

- Exactly **one daemon instance** is authoritative per machine
- CLI and PWA are **clients only**
- All privileged actions (filesystem, shell, git, network exposure) flow through the daemon
- No client can bypass daemon mediation

There are **no concurrent writers** in the MVP.

---

## 3. State Classification (Critical)

All daemon state falls into one of three categories:

### 3.1 Persistent State
Stored in the local SQLite database and survives restarts.

Examples:
- Paired devices
- Approved trust relationships
- Project metadata
- User preferences

Guarantee:
> Persistent state MUST survive daemon restarts and upgrades.

Location:
- Database: `~/.navis/db.sqlite` (see `SECURITY.md`)

---

### 3.2 Session State
Lives only for the lifetime of the daemon process.

Examples:
- Active terminal sessions
- Pending approvals
- Temporary execution context
- UI connection state

Guarantee:
> Session state MAY be lost on restart and must be safely recoverable or dismissible.

---

### 3.3 Derived State
Recomputed from the environment or persistent state.

Examples:
- Project discovery results
- Repo classification
- Running process lists
- Environment capabilities

Guarantee:
> Derived state MUST be re-derivable without user data loss.

---

## 4. Crash Recovery Semantics

NavisAI assumes crashes and restarts are normal events.

### Guarantees
- In-progress actions are **not resumed automatically** after a crash.
- Destructive actions require **explicit re-approval** after restart.

### Required Behavior
On startup, the daemon must:
1. Detect incomplete actions
2. Mark them as unresolved
3. Surface them to the user for explicit resolution

---

## 5. Degraded / Read-Only Mode

The daemon must support a **safe degraded mode**.

### Causes
- Database unavailable or locked
- Optional native dependency missing
- Permission errors
- Partial install

### Behavior
- Daemon starts and serves `GET /status` with actionable diagnostics.
- Protected/state-changing endpoints refuse requests with a clear error until healthy.
- CLI and PWA clearly indicate degraded status.

Guarantee:
> NavisAI never fails silently or becomes unusable without explanation.

---

## 6. Database & Migration Guarantees

- SQLite is the default persistence layer
- Drizzle ORM manages schema and migrations
- Native SQLite drivers are optional; the app must still run without them (fallback driver).

### On Startup
- If schema is outdated:
  - Migrate forward automatically **or**
  - Block startup with a clear, actionable error

Guarantee:
> Local data is never silently corrupted or discarded during upgrades.

Rollback migrations are explicitly **out of scope for MVP**.

---

## 7. Local Data Transparency

Users must be able to answer:
> “Where is my data?”

### MVP Requirements
- Local storage locations are stable and documented:
  - DB: `~/.navis/db.sqlite`
  - TLS material: `~/.navis/certs/` (see `SETUP.md`)
- CLI provides diagnostics (`navisai doctor`) and never hides privileged/system behavior.

Guarantee:
> Users can locate, back up, and trust their local data.

---

## 8. Networking & Sync Guarantees

- No WAN traffic in the OSS build.
- No background sync processes.

LAN access model (canonical):
- The daemon binds to loopback by default (`127.0.0.1:47621`).
- After explicit, one-time setup (`navisai setup`), an OS-managed bridge owns port 443 and forwards to the daemon, enabling the clean LAN origin: `https://navis.local` (no port).
- mDNS/Bonjour provides LAN name resolution and discovery for `navis.local` (see `NETWORKING.md`).
- `navisai setup` currently launches the helper in `apps/setup-app` (`@navisai/setup-app`) so the privileged bridge/mDNS installation is gated behind a single user approval dialog before daily use.

Explicit guarantee:
> NavisAI does not transmit data off-machine unless the user explicitly enables it.

---

## 9. CRDT & Multi-Authority Policy

### v0.1 Position
- No CRDTs are implemented
- No multi-authority writes exist
- No background replication occurs

Rationale:
> CRDTs solve concurrent write problems that do not exist in the MVP architecture.

### Future Scope
CRDTs may be introduced later for:
- Shared team workflows
- Cross-device UI state
- Collaborative features

Only when justified by real concurrency.

---

## 10. Summary of Local-First Guarantees

NavisAI guarantees:

- ✔ Single local authority
- ✔ Offline-first operation
- ✔ Explicit trust and pairing
- ✔ Crash-safe recovery
- ✔ Read-only degraded mode
- ✔ Transparent local storage
- ✔ No background sync
- ✔ No hidden cloud dependencies

These guarantees are **intentional, testable, and user-visible**.

## 11. Alignment & Next Steps

### 11.1 Guarantee map

- **Single local authority** is enforced by the unprivileged daemon on loopback while the CLI/PWA remain clients (`docs/NETWORKING.md`, `docs/SETUP.md`).
- **Offline-first operation** is enabled once `navisai setup` installs the OS-managed bridge + mDNS assets (`docs/SETUP.md`, `docs/ONBOARDING_FLOW.md`), letting users run without WAN dependencies.
- **Explicit trust and pairing** are spelled out in `docs/PAIRING_PROTOCOL.md`, `docs/AUTH_MODEL.md`, and the browser experiences outlined in `docs/ONBOARDING_FLOW.md`.
- **Crash-safe recovery & degraded mode** depend on the diagnostics described in `docs/SECURITY.md`, making sure `navisai doctor` / the daemon `/status` endpoint surface bridge, mDNS, and DB health.
- **No hidden cloud dependencies** reinforces the LAN-only origin contract from `docs/NETWORKING.md`.

### 11.2 Next steps forward

1. **Keep the docs synchronized with implementation**: any revisions to the bridge, mDNS, or onboarding UX (CLI, daemon, PWA, setup helper) should be reflected in `docs/NETWORKING.md`, `docs/SETUP.md`, and `docs/ONBOARDING_FLOW.md` before landing.
2. **Exercise the clean URL**: verify `navisai up`/`navisai setup` still deliver `https://navis.local` without asking for daily `sudo`, and that onboarding loads via the OS-managed bridge + mDNS.
3. **Re-evaluate pairing/auth flows after client changes**: ensure updates to `docs/AUTH_MODEL.md` or `docs/PAIRING_PROTOCOL.md` also inform this guarantee document so the human-in-the-loop story stays intact.
4. **Document new diagnostics**: when health checks expand (cert rotation, pairing timeouts, etc.), keep `navisai doctor`/UI messaging and this doc aligned so users immediately understand recovery paths.

---

*This document must be updated if any guarantee changes or is intentionally relaxed.*
