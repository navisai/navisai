# Local AGENTS.md — NavisAI Project Protocol

Use this file **together with Global @AGENTS.md**.  
This document defines **NavisAI-specific architecture, guardrails, and workflows** that supplement the global agent rules.

If a conflict exists, **this file overrides Global AGENTS.md** for this repository.

---

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
- Daemon **MUST** serve HTTPS at `https://navis.local` 
- Daemon **MUST** include onboarding flow at `/welcome`
- Daemon **MUST** serve the PWA (not separate dev server)
- PWA connects to daemon via HTTPS, NOT separate ports

---

## 2. Monorepo Topology (NavisAI-specific)

```
apps/
  daemon/        # Control plane (authoritative)
  cli/           # navisai CLI
  pwa/           # SvelteKit PWA

packages/
  db/            # Drizzle ORM + SQLite (native driver optional)
  logging/       # Shared logging utilities
  create-navis/  # Project generator
  discovery/     # Project discovery and classification engine
  api-contracts/ # REST/WS schema definitions
  core/          # Domain types, state machines, validation

docs/
  *.md           # Architecture, pairing, IPC, auth, security specs
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
   - Nothing binds ports, pairs devices, or launches services on install.

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
  - Run `npx svelte-check` in apps/pwa directory to check for errors
  - Fix all TypeScript and Svelte-specific errors found

Agents must not introduce alternative package managers or global installs.

---

## 5. Command Discipline

Run only commands that exist in the relevant `package.json`.

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
   - Run `svelte-check` in apps/pwa directory: `pnpm check`
   - Fix all TypeScript and Svelte-specific errors found
   - Ensure no accessibility warnings

4. **Format Files**
   - Run `pnpm format` to format all files
   - Verify with `pnpm format:check` if needed

5. **Verify**
   - `pnpm install` succeeds cleanly
   - Touched apps still start/build

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
- Daemon is a privileged process
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

---

*This file should be updated whenever NavisAI-specific architecture, tooling, or workflow changes.*
