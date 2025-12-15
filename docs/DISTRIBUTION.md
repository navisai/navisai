# Navis AI — NPM Distribution & Package Roles
Version: v0.1  
Status: Draft (Implementable target)

This repository is a pnpm-workspace monorepo for development, but the end-user install path is via npm under the `@navisai` organization.

---

## 1. End-user installation

The supported end-user entrypoint is the CLI:

```bash
npm i -g @navisai/cli
```

This installs the `navisai` command.

Requirements:

- Installing packages must not auto-start services.
- Privileged/system changes only occur during explicit, user-approved commands (e.g. `navisai setup`).

macOS user-friendly setup:
- The preferred “Apple-like” path is a signed installer / setup app that performs the one-time bridge install with a standard macOS authentication sheet (see `MACOS_SETUP_EXPERIENCE.md`).

---

## 2. Published packages (OSS)

### `@navisai/cli`

- Provides the `navisai` binary.
- User commands:
  - `navisai setup` (one-time OS integration; may require admin)
  - `navisai up` / `navisai down`
  - `navisai status` / `navisai doctor`
  - `navisai pair`
- Starts and manages the local daemon process.

### `@navisai/daemon`

- The authoritative local control plane.
- Serves:
  - PWA (static assets)
  - onboarding route `/welcome` (PWA route)
  - REST API + WSS (see `IPC_TRANSPORT.md`)
- Depends on shared packages:
  - `@navisai/core`, `@navisai/discovery`, `@navisai/db`, `@navisai/logging`, `@navisai/api-contracts`

### `@navisai/pwa`

- SvelteKit PWA source + build tooling.
- Not required for end-users at runtime if the daemon package ships with prebuilt PWA assets.
- For development, build with:
  - `pnpm --filter @navisai/pwa build`

### `@navisai/core`

- Domain types, validation, configuration primitives, state machines.

### `@navisai/discovery`

- Project discovery and classification engine.

### `@navisai/db`

- SQLite persistence via Drizzle.
- Native drivers remain optional; install must succeed even if native builds fail.
- The DB package itself is required for the daemon to store state (`~/.navis/db.sqlite`), while the optional `better-sqlite3` dependency is a performance/tuning choice; the fallback path keeps the app working even when native compilation fails.

### `@navisai/api-contracts`

- REST/WS schema definitions shared across daemon/CLI/PWA.

### `@navisai/setup-app`

- GUI-friendly helper that `navisai setup` launches on macOS/Linux/Windows to install the Navis Bridge.
- Shows the Apple-like approval dialog, runs the privileged install once, and then opens `https://navis.local/welcome`.
- The bridge owns TCP 443, forwards to `127.0.0.1:47621`, and ensures the canonical `https://navis.local` origin works without requiring `sudo` during `navisai up`.
- The helper also calls the bridge uninstall path during reset so the setup flow is reversible.

---

## 3. How the PWA ships to users

Canonical runtime requirement:

- The PWA is served by the daemon at `https://navis.local` (see `NETWORKING.md`).

Distribution requirement:

- `@navisai/daemon` must include prebuilt PWA assets inside its npm tarball so end-users do not need build tooling.

Development path:

- In repo development, `apps/pwa` is built and the daemon serves the local build output.

---

## 4. Versioning and publishing

Navis uses SemVer across published packages.

Publishing:

- `pnpm -r publish --access public`

See: `RELEASE_PROCESS.md`
