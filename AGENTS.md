# Navis AI Agents & ACP Sessions

Version: v0.1

---

# 1. Agent Definition

In Navis, an **agent** is any AI-assisted process that interacts with code, including:

- ACP (Anthropic Code panel in Zed)
- Codex / code assistants
- Terminal-based AI tools

Each agent session is mirrored into Navis so the user may observe and approve actions.

---

# 2. Session Lifecycle

### States
- `created`
- `active`
- `awaiting_approval`
- `completed`
- `error`

### Metadata Stored
- session ID
- project ID
- agent type
- timestamps
- diff / suggested changes (optional future)

---

# 3. Approval Model

Before an agent mutates files or Git history:

1. Agent proposes action
2. Daemon captures request
3. PWA displays approval card:
```
Agent wants to modify 3 files.
[View Details] [Approve] [Reject]
```

4. Approval status saved in DB

Daemon performs no mutation unless `APPROVED`.

---

# 4. ACP Mirroring

Daemon captures ACP request/response events by monitoring:

- Zed ACP API bridge (local)
- Project filesystem events (future)
- Inferred actions from agent output

Mirrored to PWA in real-time via WebSocket.

---

# 5. Future Agent Capabilities

Not in MVP but planned:

- agent chaining
- autonomous test running
- previewable diffs
- automatic rollback
- agent profiles per project

---

# 6. Security Rules

- Agents cannot bypass approval flow.
- File access is readonly until approved.
- Session replay logs stored locally only.
- Agent metadata never leaves machine.

---
