# Navis AI — Beads Workflow Integration

Version: v0.1
Status: Canonical
Scope: Agent memory, task tracking, and multi-agent coordination for NavisAI development

This document defines the integration patterns for Beads task management within the NavisAI development workflow. All agents working on this repository must follow these protocols.

---

## 1. Purpose & Scope

Beads provides persistent agent memory and task tracking for NavisAI's complex, multi-component development. It prevents architectural drift, manages dependencies across sessions, and enables coordination between multiple agents working simultaneously.

**Integration Scope**:
- Agent memory across sessions
- Task dependency tracking
- Multi-agent coordination
- Architecture compliance enforcement
- Implementation progress tracking

---

## 2. Core Architecture

### 2.1 Beads Database Structure

**Location**: `.beads/` (Git-tracked) + SQLite cache (local)

**Key Components**:
- Issues with hash-based IDs (e.g., `bd-a1b2`)
- Dependency types: `blocks`, `related`, `parent-child`, `discovered-from`
- Labels for NavisAI components and domains
- Status tracking workflow

### 2.2 Integration Points

**With NavisAI Architecture**:
- References governing docs in issue descriptions
- Tracks implementation of v0.2 bridge specifications
- Manages cross-component dependencies
- Enforces documentation-first development

**With Claude Code**:
- Project-local hooks in `.claude/settings.local.json`
- Automatic `bd prime` for context loading
- SessionStart and PreCompact hooks

---

## 3. NavisAI-Specific Workflow

### 3.1 Required Labels System

**Component Labels**:
- `daemon` - Core daemon implementation
- `cli` - CLI tooling and commands
- `pwa` - SvelteKit progressive web app
- `setup-app` - Apple-like setup helper
- `bridge` - Intelligent reverse proxy bridge

**Package Labels**:
- `db` - Database and persistence
- `api-contracts` - REST/WS schema definitions
- `logging` - Shared logging utilities
- `discovery` - Project classification engine
- `core` - Domain types and validation

**Domain Labels**:
- `networking` - Network architecture and protocols
- `security` - Security model and authentication
- `auth` - Device pairing and trust
- `ui` - User interface components
- `mobile` - Mobile-specific features

**Type Labels**:
- `feature` - New functionality
- `bug` - Bug fixes and corrections
- `tech-debt` - Refactoring and improvements
- `docs` - Documentation updates
- `testing` - Test coverage and quality

### 3.2 Documentation Compliance Rules

**All Beads issues MUST reference governing documentation**:
- Network/bridge changes → `docs/NETWORKING.md`
- API/endpoints → `docs/IPC_TRANSPORT.md` + `packages/api-contracts`
- Setup/UX changes → `docs/SETUP.md` + `docs/ONBOARDING_FLOW.md`
- Security/auth → `docs/SECURITY.md` + `docs/AUTH_MODEL.md`
- Architecture → `docs/ARCHITECTURE.md`

**Example Issue Creation**:
```bash
bd create "Implement intelligent reverse proxy per NETWORKING.md v0.2" \
  --type implementation \
  --labels bridge,networking,feature \
  --discovered-from "docs/BRIDGE_IMPLEMENTATION.md"
```

### 3.3 Dependency Management

**Blocks Dependencies**:
- Use when implementation is blocked by another issue
- Common for: spec blocks implementation, setup blocks development
- Example: Bridge implementation blocks daemon-pwa integration

**Parent-Child Dependencies**:
- Use for breaking work into subtasks
- Common for: multi-component features, phased implementations
- Example: Bridge v0.2 parent with service detection child

**Related Dependencies**:
- Use for cross-cutting concerns
- Common for: security updates, API changes affecting multiple components
- Example: Auth flow changes affect daemon, PWA, and CLI

**Discovered-From Dependencies**:
- Use when work reveals new requirements
- Common for: bug discoveries, feasibility issues
- Example: Performance testing discovers need for caching

---

## 4. Agent Coordination Protocols

### 4.1 Work Reservation System

**Single-Agent Work**:
1. Create Beads issue with clear description
2. Mark dependencies explicitly
3. Update status to `in_progress`
4. Update to `done` on completion

**Multi-Agent Coordination**:
1. Announce intent in agent coordination channel
2. Create issue to claim work area
3. Check `bd ready` for unblocked work
4. Update status to prevent conflicts
5. Mark `done` to unblock dependent work

### 4.2 Cross-Session Continuity

**Session Start**:
- Run `bd prime` to load active context
- Review `in_progress` issues
- Check for new dependencies

**Session End**:
- Update all issue statuses
- Commit with Beads IDs in message
- Document any discovered dependencies

### 4.3 Architecture Compliance

**High-Risk Operations** (per AGENTS.md Section 7):
- Must have Beads issue with `high-risk` label
- Must include approval dependency in description
- Must document rollback plan in comments
- Example: `bd dep add <issue-id> <approval-id> --type blocks`

**Cross-Subsystem Changes**:
- Create separate issue for each subsystem
- Link with `related` dependencies
- Ensure each issue references relevant docs

---

## 5. Integration with NavisAI Tooling

### 5.1 Verification Pipeline

Beads integrates with existing `pnpm verify` pipeline:
- Architecture verification checks Beads doc exists
- Ensures `.claude/settings.local.json` has proper hooks
- Validates Beads references in commits (when applicable)

### 5.2 Git Hook Integration

Pre-commit hooks include:
- Standard NavisAI architecture checks
- Beads workflow verification
- Prevent commits breaking Beads integration

### 5.3 Command Integration

Available commands (added to package.json):
- `pnpm beads:verify` - Verify Beads integration
- `pnpm beads:setup` - Initialize Beads for project
- `pnpm beads:status` - Show current Beads state
- `pnpm beads:prime` - Load project context

---

## 6. Examples & Templates

### 6.1 Common Issue Patterns

**Feature Implementation**:
```bash
bd create "Implement [FEATURE] per docs/[DOC].md" \
  --type implementation \
  --labels feature,[component] \
  --blocks <parent-issue>
```

**Bug Fix**:
```bash
bd create "Fix [BUG] in [COMPONENT]" \
  --type bugfix \
  --labels bug,[component] \
  --related <affected-issues>
```

**Architecture Work**:
```bash
bd create "Update [COMPONENT] for [ARCHITECTURE-CHANGE]" \
  --type architecture \
  --labels architecture,[component] \
  --discovered-from "docs/[SPEC].md"
```

### 6.2 Commit Message Format

Include Beads IDs when relevant:
```
feat(bridge): implement service detection module

Implements intelligent service detection per NETWORKING.md v0.2.
Adds UDP/TCP probe capabilities and service fingerprinting.

Refs: bd-a1b2, bd-c3d4
```

---

## 7. Compliance & Verification

### 7.1 Required Documentation

This document (`docs/BEADS_WORKFLOW.md`) is referenced in:
- AGENTS.md Section 0 (Required Doc Cross-Checks)
- AGENTS.md Section 13 (Beads Task Management Protocol)
- Verification scripts in `scripts/verify-architecture.mjs`

### 7.2 Verification Checklist

- [ ] Beads database initialized (`.beads/` exists)
- [ ] Claude hooks installed (`bd setup claude --project`)
- [ ] Issues reference governing documentation
- [ ] Labels follow NavisAI conventions
- [ ] Dependencies properly marked
- [ ] High-risk operations have approval dependencies
- [ ] All agents have reviewed `docs/BEADS_AGENT_GUIDE.md`

### 7.3 Non-Compliance Detection

The verification pipeline detects:
- Missing Beads integration documentation
- Issues without required doc references
- Unauthorized high-risk operations
- Missing dependency links
- Invalid label usage

---

## 8. Implementation Status

- [x] Core Beads integration specification
- [ ] Verification script integration
- [ ] Git hook enforcement
- [ ] Package.json command integration
- [ ] Claude Code hook installation
- [ ] Cross-agent coordination testing

---

## 9. Maintenance & Updates

This document must be updated when:
- New NavisAI components are added
- Workflow processes change
- Verification requirements evolve
- New Beads features are integrated

All changes must follow AGENTS.md Section 0 protocols and reference this document in commit messages.

---

*This document is canonical for Beads integration in NavisAI. Conflicts should be resolved by updating this document rather than circumventing its protocols.*