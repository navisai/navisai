# Navis AI — Open Source Core

Navis AI is a **local-first developer control plane** that exposes your laptop’s development environment to a secure, mobile-first PWA.  
It enables remote visibility, agent oversight, approvals, Git inspection, and project intelligence — powered entirely by your local machine over LAN.

This repository contains **all open-source components**, including:

- **Navis Daemon** (local backend)
- **Navis CLI** (`navisai`)
- **Navis PWA** (SvelteKit + vite-pwa)
- **Discovery & Classification Engine**
- **SQLite persistence layer**
- **Shared packages (API contracts, core, db, discovery)**

Premium features (remote tunnels, cloud sync, team support, ServBay import/export plugins) are intentionally excluded and live outside this repo.

---

## ✨ Key Features (OSS)

- Mobile-first PWA to monitor local dev activity
- Terminal & ACP session mirroring (read-only in MVP)
- Local-only BLE + mDNS + QR pairing flow
- Project discovery + classification engine
- Git diff summaries + commit templates
- Real-time approvals for safe agent actions
- SQLite durable local state (projects, devices, sessions, approvals, metadata)
- Secure local HTTPS communication

---

## 📦 Repository Structure

```
navisai/
  README.md
  navis_prd.md
  ARCHITECTURE.md
  ONBOARDING_FLOW.md
  DB_SCHEMA.md
  agents.md
  SECURITY.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  ROADMAP.md
  RELEASE_NOTES.md
  LICENSE

apps/
    daemon/       # local backend
    cli/          # navisai CLI
    pwa/          # SvelteKit + vite-pwa PWA
    setup-app/    # Apple-like setup helper that installs packet forwarding rules

packages/
    core/         # types, state machines, helpers
    db/           # sqlite wrapper + migrations
    discovery/    # file scanning + classification
    api-contracts/
    logging/       # structured, shared logging utilities

  pro/            # intentionally excluded (premium-only)
```

---

## 🚀 Getting Started

### 0. Install the CLI

```
npm i -g @navisai/cli
```

### 1. One-time setup (clean LAN URL)

Navis targets a single Apple-like LAN origin:

`https://navis.local` (no port)

Run the one-time setup to install packet forwarding rules (443 → daemon port 47621), enable mDNS, and generate the certificate so `https://navis.local` works without needing `sudo` again:

```
navisai setup
```

`navisai setup` launches the GUI-ready helper (`apps/setup-app` / `@navisai/setup-app`) so mainstream macOS users see a friendly dialog and only approve the packet forwarding setup once. After setup, `navisai up` starts an unprivileged daemon that is reachable at `https://navis.local/welcome`.

### 2. Start Navis

```
navisai up
```

### 3. Onboard

Open:

`https://navis.local/welcome`

Scan the QR code from your phone to pair.

---

## 💻 Development Setup (Monorepo)

Install dependencies:

```
pnpm install
```

Start daemon + PWA together:

```
pnpm dev
```

The PWA is served by the daemon (no separate PWA dev server in the canonical architecture). `pnpm dev` builds the PWA then starts the daemon.

You can also run the explicit commands:

```
pnpm --filter @navisai/pwa build
pnpm --filter @navisai/daemon dev
```

Optional: standalone PWA dev server (not the canonical architecture):

```
pnpm dev:standalone-pwa
```

---

## 📱 PWA Starter Info (Integrated)

The Navis PWA uses:

- **SvelteKit**
- **vite-pwa-sveltekit**
- WebSocket-based real-time streams
- Native-like mobile installation

Starter reference:  
https://github.com/vite-pwa/sveltekit

---

## 🔒 Security Philosophy

- Local-first  
- No automatic modifications without explicit user approval  
- No cloud dependency in OSS build  
- Device pairing requires explicit approval  
- Terminal, ACP, and file operations are sandboxed behind approvals  

See: `SECURITY.md`

Networking doc-of-record: `docs/NETWORKING.md`

Setup guide: `docs/SETUP.md`

NPM distribution: `docs/DISTRIBUTION.md`

---

## 🛣️ Roadmap

Early roadmap includes:

- File editing sandbox (OSS)
- Navis Agents v2
- Plugin API
- Premium remote tunnels
- Premium Teams

See: `ROADMAP.md`

---

## 📜 License

This repository is licensed under the **MIT License** (see `LICENSE`).  
Premium modules are separately licensed and not open source.

---
