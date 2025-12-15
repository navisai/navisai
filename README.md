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

  packages/
    core/         # types, state machines, helpers
    db/           # sqlite wrapper + migrations
    discovery/    # file scanning + classification
    api-contracts/
    ui-components/ (optional)

  pro/            # intentionally excluded (premium-only)
```

---

## 🚀 Getting Started

### 1. Install CLI Globally

```
npm install -g navisai
```

### 2. Start the daemon

```
navisai up
```

This will:

- Start the local daemon  
- Enable BLE + mDNS + QR pairing  
- Open browser onboarding UI automatically  

### 3. Open the Navis PWA

Visit:

```
https://navis.local
```

or scan the pairing QR from your phone.

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

You can start components individually:

```
pnpm --filter @navisai/daemon dev
pnpm --filter @navisai/pwa dev
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
