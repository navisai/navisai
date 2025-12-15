# Navis AI — Product Requirements Document (PRD)
Version: MVP v0.1  
Status: Locked

---

## 1. Product Overview

Navis AI is a **local-first developer control plane** that exposes the laptop’s development environment (terminals, AI agents, ACP sessions, Git repos, discovery metadata, etc.) to a **mobile-first PWA**.

The system enables remote oversight, approvals, and light interaction with development workflows using a secure LAN-based pairing system (BLE, mDNS, QR, HTTP hint).

Navis does **not** modify user files without explicit approval.  
Navis does **not** require cloud accounts in MVP.

---

## 2. Core Value Proposition

Navis helps developers:

- View and monitor AI code sessions (Codex, Claude Code, ACP).
- Stream terminal output remotely (read-only in MVP).
- Approve or reject code actions safely.
- Switch between multiple local projects.
- View Git diff summaries and commit with template messages.
- View rich metadata extracted from classification.
- Pair devices seamlessly using a near-zero-friction onboarding experience.
- Use a mobile-friendly PWA or desktop browser.

---

## 3. System Components

### 3.1 Navis Daemon (Core)
- Local HTTP + WebSocket server.
- Responsible for:
  - pairing + presence
  - project registry
  - discovery + classification
  - SQLite persistence
  - ACP and terminal session metadata
  - approvals engine

### 3.2 CLI (`navisai`)
Commands:

```
navisai up
navisai down
navisai status
navisai doctor
navisai pair
navisai projects
navisai logs
```

### 3.3 PWA (Phone + Desktop)
- Mobile-first
- Real-time project switching
- Terminal & ACP mirroring
- Approvals UI
- Git inspector
- System Status panel

### 3.4 SQLite Local Database
- Durable state for:
  - projects
  - classification
  - devices
  - approvals
  - sessions
  - settings

---

## 4. Presence & Pairing (Locked)

Four discovery signals:

1. mDNS broadcast  
2. BLE beacon  
3. Local HTTP hint (`navis.local/welcome`)  
4. QR pairing token  

Pairing approval requires explicit user consent through laptop UI/CLI.

---

## 5. Onboarding Experience

Triggered when user runs:

```
navisai up
```

Flow:

1. Daemon starts  
2. mDNS + BLE + QR enabled  
3. Browser auto-opens to onboarding shell  
4. Phone discovers via BLE or QR  
5. Pairing approval  
6. PWA offers installation  
7. User enters full Navis UI  

The terminal echoes simple progress messages without duplicating the UI.

---

## 6. Discovery & Classification

### Discovery (Core)
- Async, incremental, non-blocking.
- Sources include:
  - Zed workspace directories
  - tmux panes directories
  - CLI cwd
  - configured roots
- Emits **DiscoverySignals**.

### Classification (Core)
- Maps signals → categories, frameworks, languages.
- Stores confidence & metadata.

Resulting `Project` object includes:

```
id, name, path,
signals[],
classification,
metadata
```

---

## 7. Git Integration (MVP)
- View:
  - branch
  - status
  - diff summary
  - history
- Write:
  - commit (with templates)
  - amend last commit

No push/pull in MVP.

---

## 8. Terminal / ACP Sessions
- Terminal: read-only streamed output.
- ACP (Anthropic Code) sessions: mirrored in PWA with approvals for file-changing actions.

---

## 9. Non-Goals (MVP)
- Cloud sync  
- Remote tunnels  
- Team features  
- File editing in PWA  
- Plugin marketplace  
- Push notifications  

---

## 10. Success Metrics
- Onboarding < 2 minutes  
- Pairing success > 95%  
- Terminal/ACP latency < 200ms  
- Correct project classification > 80%  

---

## 11. Dependencies & External Requirements
- macOS (daemon)
- Node LTS (CLI)
- SQLite 3.x
- BLE-compatible hardware

---

## 12. Future Scope
- Premium remote tunnels with custom subdomains
- Local/remote hybrid sync
- Import plugins (ServBay, Docker, LocalWP)
- AI agents with higher privileges
- Team collaboration
- Desktop app (Tauri)

---
