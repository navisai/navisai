# Local AGENTS.md — NavisAI Project Protocol

Use this file **together with Global @AGENTS.md**.  
This document defines **NavisAI-specific architecture, guardrails, and workflows** that supplement the global agent rules.

If a conflict exists, **this file overrides Global AGENTS.md** for this repository.

---

## 0. Docs Are Canonical (No Veering)

- The `docs/` folder is the source of truth for architecture, onboarding, setup, pairing, networking, IPC, auth, local-first guarantees, and security. Before implementing or changing behavior, identify the relevant doc(s) and keep code aligned to them.
- Doc sweeps (multi-file documentation alignment passes) require explicit user verification/approval **before** making broad edits; when in doubt, limit changes to the minimum necessary doc(s) and ask first.
- If documentation conflicts:
  - Treat `docs/NETWORKING.md` as the doc-of-record for canonical origin and LAN access.
  - Update the conflicting doc(s) to match `docs/NETWORKING.md` (do not “split the difference”).
- If code and docs conflict, assume docs are canonical and update **code** first; only update docs when (a) docs are internally inconsistent/ambiguous, or (b) the user explicitly approves an architectural change.
- Do not improvise new architecture. If requirements are not covered, add/extend docs in `docs/` first, then implement.
- Before coding, explicitly name the doc(s) you are following and call those out in your plan/commit message; do not proceed with architectural work until you know which doc sets the rules.
- Never introduce new top-level folders, packages, or architectural layers without first documenting them in `docs/`; update the docs before creating the code structure so future agents can follow the same path.

### Documentation Change Policy (Feasibility-First)
- If you suspect a documented requirement is technically infeasible or would degrade UX/security, stop and write a short “feasibility note” proposal (what’s infeasible, why, and 1–2 alternatives) and wait for explicit user approval before changing the doc.
- Do not “edit while thinking” in docs. Propose, get approval, then apply the doc changes in a focused patch.

### Required Doc Cross-Checks (Use As a Map)
- Networking / origins / ports / bridge / mDNS: `docs/NETWORKING.md`, `docs/SETUP.md`, `docs/SECURITY.md`
- macOS user setup experience: `docs/MACOS_SETUP_EXPERIENCE.md`, `docs/ONBOARDING_FLOW.md`
- REST/WS endpoints: `docs/IPC_TRANSPORT.md`, `packages/api-contracts`
- Auth / device trust: `docs/AUTH_MODEL.md`, `docs/PAIRING_PROTOCOL.md`, `packages/db`
- Local-first guarantees: `docs/LOCAL_FIRST_GUARANTEES.md`, `docs/SECURITY.md`

### Change Log Discipline (For Every Patch)
- State which doc(s) you are implementing.
- If you introduce a new endpoint or event, update `packages/api-contracts` and `docs/IPC_TRANSPORT.md` in the same change.
- If you touch setup/onboarding UX, re-check alignment with `docs/SETUP.md` and `docs/ONBOARDING_FLOW.md` and update wording to match.


## 1. Project Snapshot (NavisAI)

- **Project type**: Local-first developer control plane
- **Primary components**:
  - Local daemon (authority, orchestration, approvals) - **SERVES HTTPS + ONBOARDING**
  - `navisai` CLI (control + automation)
  - SvelteKit PWA (mobile-first UI, served by daemon)
- **Distribution model**:
  - OSS monorepo (this repo)
  - NPM-distributed consumer tooling
  - Premium features implemented out-of-repo
- **Core principle**: Human-in-the-loop by default

### Critical Architecture Requirements
- Canonical origin is always `https://navis.local` (no port) for LAN clients (`docs/NETWORKING.md`).
- Daemon is unprivileged and binds loopback by default (`127.0.0.1:47621`); a one-time, OS-managed bridge owns 443 and forwards TCP to the daemon (TLS passthrough).
- Daemon **MUST** serve HTTPS + WSS with a certificate valid for `navis.local`.
- Daemon **MUST** include onboarding flow at `/welcome` (PWA route served by the daemon)
- Daemon **MUST** serve the PWA (not separate dev server)
- PWA connects to daemon via HTTPS, NOT separate ports
- mDNS/Bonjour is used for LAN name resolution/discovery for `navis.local` (no hosts-file hacks for phone/LAN clients).

---

## 2. Monorepo Topology (NavisAI-specific)

```
apps/
  daemon/        # Control plane (authoritative)
  cli/           # navisai CLI
  pwa/           # SvelteKit PWA
  setup-app/     # Apple-like setup helper (GUI)

packages/
  db/            # Drizzle ORM + SQLite (native driver optional)
  logging/       # Shared logging utilities
  create-navis/  # Project generator
  discovery/     # Project discovery and classification engine
  api-contracts/ # REST/WS schema definitions
  core/          # Domain types, state machines, validation

docs/
  *.md           # Architecture, pairing, IPC, auth, security specs

scripts/
  *.mjs          # Local guardrails (verify + git hooks)
```

Folder boundaries are intentional and must be respected.  
Do not collapse daemon subsystems or bypass the daemon from clients.

---

## 3. NavisAI Non-Negotiables (Overrides)

These rules **override** any permissive defaults in Global AGENTS.md:

1. **Daemon authority**
   - CLI and PWA never bypass the daemon.
   - All privileged actions flow through it.

2. **No mandatory native dependencies**
   - Native modules (e.g. SQLite drivers) must remain optional.
   - `pnpm install` must succeed even if native builds fail.

3. **No auto-starting behavior**
   - Installing packages must not start services or bind ports.
   - OS-level bridge/service installation is allowed only during explicit, user-consented setup flows (GUI setup app/installer or `navisai setup`).
   - The daemon must not auto-start at install time.

4. **Human-in-the-loop by default**
   - Destructive, privileged, or state-changing actions require approval paths.
   - Silent automation is forbidden.

5. **OSS boundary enforcement**
   - No premium / enterprise logic in this repository.
   - Premium features live out-of-repo only.

---

## 4. Tooling & Environment Constraints

- **Package manager**: `pnpm` only
- **Node**: modern Node (current dev on Node 22.x)
- **Workspace system**: pnpm workspaces
- **Language preference**:
  - JavaScript + JSDoc preferred
  - TypeScript only when localized and justified

**Styling framework**:
  - Tailwind CSS v4 is required for all UI components
  - Use design tokens from `apps/pwa/tailwind.config.js`
  - Follow brand guidelines in `BRAND_SPEC.md`

**Code formatting**:
  - Prettier is required for code formatting
  - Tailwind CSS classes are automatically sorted by prettier-plugin-tailwindcss
  - Use `pnpm format` to format all files
  - Use `pnpm format:check` to verify formatting before commits

**Svelte validation**:
  - Use `svelte-check` to validate Svelte components before commits
  - Run `pnpm --filter @navisai/pwa check` to check for errors
  - Fix all TypeScript and Svelte-specific errors found

Agents must not introduce alternative package managers or global installs.

---

## 5. Command Discipline

Run only commands that exist in the relevant `package.json`.

Notes:
- Prefer `pnpm --filter <pkg> <script>` over `npx` or ad-hoc global tooling.
- When a command requires network access or OS privileges, it must be tied to an explicit user action (setup/reset/doctor) and surfaced clearly in UX/logs.
- Before committing, run `pnpm verify` (recommended) or install local enforcement via `pnpm hooks:install`.

### Install
```bash
pnpm install
```

### Workspace usage
```bash
pnpm -r <command>
pnpm --filter <pkg> <command>
```

### PWA dev (if applicable)
```bash
# IMPORTANT: PWA is served by daemon, not separate dev server
# The PWA is built into the daemon for production HTTPS serving
pnpm --filter @navisai/pwa build  # Build PWA assets
pnpm --filter @navisai/daemon dev   # Daemon serves PWA at https://navis.local
```

### Formatting
```bash
pnpm format              # Format all files
pnpm format:check        # Check formatting without modifying
```

---

## 6. Database & Persistence Policy

- SQLite is the default persistence layer.
- Drizzle ORM is used for schema + queries.
- Native drivers must be **lazy-loaded and optional**.

If a driver is missing:
- install still succeeds
- runtime emits a clear, actionable message
- daemon does not crash at startup

Agents must not “fix” native build issues by making drivers mandatory.

---

## 7. High-Risk Operations (NavisAI-specific)

The following are always considered **high-risk** in this project:

- File system mutation
- Git operations
- Shell command execution
- Network exposure beyond localhost
- Device pairing / trust establishment
- Process lifecycle control

High-risk changes must:
- be minimal in scope
- be reversible
- anticipate approval mechanisms (even if stubbed)

When unsure, treat the action as high-risk.

---

## 8. Logging & Observability

- Use shared logging utilities (`@navisai/logging`)
- Logs must be structured, scoped, and meaningful
- Avoid raw `console.log` except for temporary debugging

Logs are part of the UX for a local control plane.

---

## 9. Change Workflow (Local)

1. **Plan**
   - Identify affected subsystems
   - List touched files

2. **Implement**
   - Keep changes focused
   - Respect daemon boundaries

3. **Lint Files & Remove Errors**
   - Run `pnpm --filter @navisai/pwa check`
   - Fix all TypeScript and Svelte-specific errors found
   - Ensure no accessibility warnings

4. **Format Files**
   - Run `pnpm format` to format all files
   - Verify with `pnpm format:check` if needed

5. **Verify**
   - `pnpm install` succeeds cleanly
   - Touched apps still start/build
   - Run `pnpm verify` before committing (recommended) or install `pnpm hooks:install` once to enforce locally

6. **Create Detailed Commit**
   - Include summary of changes
   - List key features implemented
   - Reference any issues or tasks

7. **Document**
   - Update relevant docs if behavior or architecture changes

---

## 10. Local Verification Checklist

- [ ] `pnpm install` succeeds on clean checkout
- [ ] No mandatory native deps introduced
- [ ] No services auto-start
- [ ] No premium logic added
- [ ] Daemon authority preserved
- [ ] Logs added where behavior is non-obvious
- [ ] Daemon serves HTTPS (not HTTP)
- [ ] Daemon includes onboarding at `/welcome`
- [ ] PWA served by daemon at `https://navis.local`
- [ ] All API endpoints use HTTPS
- [ ] Discovery and classification implemented

---

## 11. Security Posture (Local)

- Default to local-only
- **ALL network activity MUST use HTTPS** (per SECURITY.md)
- LAN exposure must be explicit and gated
- Daemon is an unprivileged process; the bridge/service is the only privileged component and is installed only with explicit user consent during setup
- Never assume trust without pairing + approval
- No cloud dependencies in OSS version
- All data stored locally in SQLite at `~/.navis/db.sqlite`

---

## 12. Notes for Agents Working Here

- Ask: **“What is the smallest correct change?”**
- Stop and ask if requirements are ambiguous
- Do not speculate about premium features
- Treat this file as binding
- **No attribution**: Do not add AI-generated attribution to commits, messages, or code
- Before acting, double-check this file (via `CLAUDE.md` if you need a shortcut) and the relevant `docs/` pages so you never drift from documented architecture.

---

*This file should be updated whenever NavisAI-specific architecture, tooling, or workflow changes.*
