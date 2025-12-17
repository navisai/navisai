# Local AGENTS.md — NavisAI Project Protocol

Use this file **together with Global @AGENTS.md**.
This document defines **NavisAI-specific architecture, guardrails, and workflows** that supplement the global agent rules.

If a conflict exists, **this file overrides Global AGENTS.md** for this repository.

**🔗 Task Tracking**: This project uses **Beads** (`bd` command) for persistent task tracking and multi-agent coordination. All implementation work must be tracked in Beads issues.

---

## 📌 Project Snapshot (5-Min Overview)

**NavisAI** is a **local-first AI control plane** that helps developers manage and monitor their projects through a single, clean LAN URL.

### Core Components
- **Daemon**: Unprivileged backend serving HTTPS + WSS at `https://navis.local`
- **CLI**: `navisai` command for control and automation
- **PWA**: Mobile-first web UI served by daemon
- **Packet Forwarding**: OS-level routing (not reverse proxy)

### Current Architecture Status
- ✅ **Packet forwarding bridge** implemented (macOS pfctl, Linux iptables, Windows netsh)
- ❌ **mDNS/Bonjour** - NOT IMPLEMENTED (critical blocker for LAN access)
- ✅ **PWA** built and serving at root path
- ✅ **HTTPS certificate** generation and management
- ⚠️ **CLI logs** - shows "not implemented"
- ⚠️ **Doctor diagnostics** - checks old bridge, not packet forwarding

### Critical Path
1. **Implement mDNS service advertisement** (navisai-d0n) - BLOCKING
2. Update CLI doctor for packet forwarding (navisai-jsh)
3. Implement CLI log streaming (navisai-jma)

---

## 🚀 Agent Quick Start (First 3 Commands)

```bash
cd /Volumes/Macintosh\ HD/Users/vsmith/navisai
bd quickstart   # Load project context
bd ready    # Find work to do
bd create "Task" -t task -d "Details"  # Create new issue
```

**⚠️ CRITICAL**: **DO NOT CODE WITHOUT READING DOCS FIRST**. See Section 0 "Docs Are Canonical".

**Before You Implement (Checklist)**:
- [ ] Read the governing doc(s) from Section 0.4
- [ ] Created/updated Beads issue with doc references
- [ ] Checked `bd ready` for unblocked work
- [ ] Verified dependencies are properly linked

---

## 0. Docs Are Canonical (No Veering)

- The `docs/` folder is the source of truth for architecture, onboarding, setup, pairing, networking, IPC, auth, local-first guarantees, and security. Before implementing or changing behavior, identify the relevant doc(s) and keep code aligned to them.
- The canonical doc for navis.local / LAN access is `docs/NETWORKING.md`. Other domain-specific canonicals include `docs/ONBOARDING_FLOW.md`, `docs/SETUP.md`, `docs/MACOS_SETUP_EXPERIENCE.md`, and `docs/LOCAL_FIRST_GUARANTEES.md`. Reference the applicable doc(s) before making cross-cutting changes.
- Doc sweeps (multi-file documentation alignment passes or anytime more than one subsystem doc is touched) require explicit user verification/approval **before** editing. List the targeted doc(s), describe the scope, and wait for the user to confirm the proposed sweep before starting work.
- Always cite the doc(s) you are following in your implementation plan, commit message, and final report; if behavior changes, spell out which doc dictated the change.
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
- Beads workflow / multi-agent coordination: `docs/BEADS_WORKFLOW.md`, `docs/BEADS_AGENT_GUIDE.md`

### Verification & Enforcement System

NavisAI enforces architectural compliance through a multi-layered verification system:

**1. Automated Verification Scripts** (`scripts/verify-architecture.mjs`):
- Enforces top-level directory structure (only apps/, packages/, docs/, scripts/)
- Validates all required documentation exists
- Checks PWA uses canonical origin `https://navis.local`
- **NEW**: Verifies Beads integration documentation and configuration

**2. Git Hooks** (`scripts/install-git-hooks.mjs`):
- Pre-commit hooks automatically run `pnpm verify`
- Prevents non-compliant commits from entering the codebase
- Checks Beads integration status and provides setup guidance

**3. Package.json Pipeline** (`pnpm verify`):
```bash
pnpm verify  # Runs complete verification chain:
# ├── verify:arch      # Architecture compliance
# ├── verify:npm-layout # Workspace structure
# ├── format:check      # Code formatting
# └── @navisai/pwa check # Svelte validation
```

**4. Manual Verification Commands**:
```bash
pnpm verify:arch      # Run architecture checks only
pnpm format:check     # Check code formatting
pnpm --filter @navisai/pwa check  # Svelte-specific validation
```

**5. Enforcement Results**:
- ✅ Pass: Commit allowed, proceed with work
- ❌ Fail: Commit blocked, must fix violations first

All agents must run `pnpm verify` before committing. Install persistent hooks with `pnpm hooks:install`.

### Change Log Discipline (For Every Patch)
- State which doc(s) you are implementing.
- If you introduce a new endpoint or event, update `packages/api-contracts` and `docs/IPC_TRANSPORT.md` in the same change.
- If you touch setup/onboarding UX, re-check alignment with `docs/SETUP.md` and `docs/ONBOARDING_FLOW.md` and update wording to match.
- ALWAYS Reference Beads issue IDs (e.g., "Refs: navisai-abc")


## 1. Beads Task Management Protocol

### Quick Start (3 Commands)
```bash
cd /Volumes/Macintosh\ HD/Users/vsmith/navisai
bd quickstart    # Load project context
bd ready    # Find work to do
bd create "Brief task description" -t task -d "Details"  # Create new issue
```

### 1.1 Canonical Task Tracking System

- **Beads is the canonical task tracking system** for NavisAI development
- All multi-agent work must use Beads for coordination and memory persistence
- Beads issues provide dependency-aware task management across sessions
- Integration is enforced via architecture verification scripts

### 1.1.1 Agent Onboarding with Beads

**First-Time Setup (One-Time)**:
```bash
# 1. Install Beads globally
npm install -g beads

# 2. Initialize Beads in this repository (already done)
# If needed: bd init

# 3. Setup Claude Code integration (recommended)
pnpm beads:setup

# 4. Load project context
bd prime
```

**Daily Onboarding (Every Session)**:
```bash
cd /Volumes/Macintosh\ HD/Users/vsmith/navisai
bd quickstart  # Quick start guide for bd
bd ready  # See available work
```

**Troubleshooting**:
- Beads command not found: `npm install -g beads`
- Issues not showing: Check you're in navisai directory, run `bd list`
- For complete guidance: See `docs/BEADS_AGENT_GUIDE.md`
- Help: `bd --help` or `bd <command> --help`

### 1.2 Required Workflow Integration

**Before ANY implementation work**:
1. Create Beads issue with clear description and governing docs referenced
2. Mark all dependencies using `bd dep add` (blocks, related, parent-child, discovered-from)
3. Use required NavisAI labels: components, packages, domains, types
4. Update status with `bd update <id> --status <state>`

**Issue Creation Requirements**:
- Title format: "Brief action-oriented description"
- Description MUST reference governing docs (Section 13.3)
- Priority (0-4, 0=highest): P0 for critical, P1 for important, P2 for normal, P3+ for low
- Type: `feature`, `bug`, `task`, `epic`, `chore`
- Labels: At least one component/domain label per `docs/BEADS_WORKFLOW.md`

**Session Management**:
- Run `bd quickstart` at session start to load project context
- Update issue statuses before session end
- Reference Beads IDs in commit messages when applicable
- Use `bd ready` to find unblocked work before starting new tasks

**Dependency Management**:
- `blocks`: Task B must complete before Task A
- `related`: Soft connection, doesn't block progress
- `parent-child`: Epic/subtask hierarchical relationship
- `discovered-from`: Auto-created when discovering related work

### 1.3 Documentation Compliance (Mandatory)

All Beads issues **must** reference governing documentation:
- Network/bridge changes → `docs/NETWORKING.md`
- API/endpoints → `docs/IPC_TRANSPORT.md` + `packages/api-contracts`
- Setup/UX changes → `docs/SETUP.md` + `docs/ONBOARDING_FLOW.md`
- Security/auth → `docs/SECURITY.md` + `docs/AUTH_MODEL.md`
- Beads workflow → `docs/BEADS_WORKFLOW.md` (this document's governing spec)

### 1.4 High-Risk Operations Protocol

Section 7 high-risk operations require Beads issues with:
- `high-risk` label applied
- Approval dependency noted in issue description
- Rollback plan documented in issue comments
- Dependency link: `bd dep add <issue-id> <approval-id> --type blocks`

### 1.5 Multi-Agent Coordination

**Work Reservation**:
- Create Beads issue immediately to claim work areas
- Check `bd ready` before starting to avoid conflicts
- Update status to `in_progress` when beginning work
- Mark `done` on completion to unblock dependent work

**Cross-Session Continuity**:
- Beads maintains context across agent sessions
- Issues track implementation progress against specifications
- Dependencies prevent work conflicts and ensure proper sequencing

### 1.6 Verification & Enforcement

Beads integration is verified by:
- `scripts/verify-architecture.mjs` checks Beads documentation and configuration
- Pre-commit hooks prevent non-compliant commits
- `pnpm verify` includes Beads compliance checks
- Claude Code hooks (`bd setup claude --project`) provide automatic context loading

### 1.7 Required Commands

All agents must use established Beads commands:
- `bd quickstart` - Load project context (~2k tokens)
- `bd create "Task"` - Create issue with doc references
- `bd ready` - Find unblocked work
- `bd dep add <id> <parent> --type <type>` - Add dependencies
- `bd update <id> --status <done|in_progress>` - Track progress

**Complete Command Reference**:
```bash
# Session workflow
bd quickstart                    # Load context at start
bd ready                    # Find unblocked work
bd list                     # Show all issues
bd show <issue-id>          # View issue details

# Issue management
bd create "Title" -t <type> -p <priority> -d "Description"
bd update <id> --status <open|in_progress|done>
bd close <id> --reason "Completed"
bd label add <id> <label>

# Dependencies
bd dep add <id> <dep-id> --type blocks|related|parent-child|discovered-from
bd dep tree <id>            # Visualize dependencies
```

**Example Issue Creation**:
```bash
# Bridge implementation
bd create "Add intelligent routing to bridge" \
  -t feature \
  -p 1 \
  -d "Implement routing engine per docs/BRIDGE_IMPLEMENTATION.md v0.2" \
  && bd label add <new-id> bridge,networking

# High-risk operation
bd create "Update bridge to require admin privileges" \
  -t task \
  -p 0 \
  -d "HIGH-RISK: Modifies system services. See docs/SECURITY.md" \
  && bd label add <new-id> high-risk,security
```

**Common Pitfalls**:
- ❌ Creating issues without doc references
- ❌ Forgetting to mark dependencies
- ❌ Not running `bd quickstart` at session start
- ❌ Using generic labels instead of required components/domains
- ❌ Implementing before checking `bd ready`

**Visual Workflow**:
```
Start Session → bd quickstart → bd ready → Select Work → bd update <id> --status in_progress
       ↓                                                          ↓
   Read Docs                                                 Implement
       ↓                                                          ↓
Create Issue (if needed) → bd create → Add Dependencies → bd update <id> --status done
```

### 1.8 Integration Status

Beads integration is enforced through:
- Governing document: `docs/BEADS_WORKFLOW.md`
- Protocol definition: This Section 13 in AGENTS.md
- Verification: `scripts/verify-architecture.mjs`
- Tool integration: `package.json` scripts
- Git hooks: Pre-commit enforcement

---

## 🔍 Key Files & Where to Find Them

### Core Implementation
- `apps/daemon/src/bridge-packet.js` - Packet forwarding implementation
- `apps/daemon/daemon.js` - Main daemon server
- `apps/cli/src/commands.js` - CLI command implementations
- `apps/pwa/src/lib/api/client.ts` - PWA API client

### Critical Docs (Read First!)
- `docs/NETWORKING.md` - **CANONICAL** for packet forwarding model
- `docs/SETUP.md` - Installation and setup flow
- `docs/SECURITY.md` - Security model and considerations
- `docs/ONBOARDING_FLOW.md` - User onboarding process

### CLI Reference
- `./navisai up` - Start daemon
- `./navisai setup` - One-time setup (admin required)
- `./navisai doctor` - Diagnostics
- `./navisai logs` - View logs (not implemented yet)

### Current Gotchas & Known Issues
1. **mDNS not implemented** - navis.local won't resolve without it
2. **Doctor checks old bridge** - Needs packet forwarding diagnostics
3. **Packet forwarding cleanup** - Test `./navisai cleanup` works properly
4. **Windows limitations** - netsh forwards ALL port 443 traffic (not domain-specific)

## 🔄 Common Workflows

### Adding a New Feature
1. Read relevant docs (NETWORKING.md, IPC_TRANSPORT.md)
2. Create Beads issue: `bd create "Feature" -t feature -d "Description"`
3. Implement in appropriate app (daemon/, cli/, pwa/)
4. Run tests: `pnpm verify`
5. Commit with docs reference

### Fixing a Bug
1. Create Beads issue: `bd create "Bug" -t bug -d "Description"`
2. Add reproduction steps
3. Fix with minimal change
4. Test fix works
5. Update docs if needed

### Updating Documentation
1. Always update doc first, then code
2. Reference changed sections in commit
3. Run `pnpm format` and `pnpm verify`
4. No doc sweeps without explicit approval

### Working with Packet Forwarding
1. Test with `sudo ./apps/daemon/src/bridge-packet.js`
2. Cleanup with `./navisai cleanup --bridge-only`
3. Verify rules: `sudo pfctl -a navisai -s rules` (macOS)

---



## 2. Project Snapshot (NavisAI)

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

## 3. Monorepo Topology (NavisAI-specific)

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

## 4. NavisAI Non-Negotiables (Overrides)

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

## 5. Tooling & Environment Constraints

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

## 6. Command Discipline

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

## 7. Database & Persistence Policy

- SQLite is the default persistence layer.
- Drizzle ORM is used for schema + queries.
- Native drivers must be **lazy-loaded and optional**.

If a driver is missing:
- install still succeeds
- runtime emits a clear, actionable message
- daemon does not crash at startup

Agents must not “fix” native build issues by making drivers mandatory.

---

## 8. High-Risk Operations (NavisAI-specific)

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

## 9. Logging & Observability

- Use shared logging utilities (`@navisai/logging`)
- Logs must be structured, scoped, and meaningful
- Avoid raw `console.log` except for temporary debugging

Logs are part of the UX for a local control plane.

---

## 10. Change Workflow (Local)

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

## 10. Quick Verification Tests

Before committing changes, run these essential checks:

```bash
# 1. Build passes
pnpm install
pnpm --filter @navisai/pwa build
pnpm verify

# 2. Daemon starts
./navisai up &
DAEMON_PID=$!
sleep 2
curl -k https://navis.local/status
kill $DAEMON_PID

# 3. Packet forwarding (if implemented)
sudo ./apps/daemon/src/bridge-packet.js &
# Test navis.local routing
# Kill with Ctrl+C

# 4. CLI basics work
./navisai doctor
./navisai status
```

## 11. Local Verification Checklist

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

## 12. Security Posture (Local)

- Default to local-only
- **ALL network activity MUST use HTTPS** (per SECURITY.md)
- LAN exposure must be explicit and gated
- Daemon is an unprivileged process; the bridge/service is the only privileged component and is installed only with explicit user consent during setup
- Never assume trust without pairing + approval
- No cloud dependencies in OSS version
- All data stored locally in SQLite at `~/.navis/db.sqlite`

---

## 13. Repository Hygiene (Keep It Clean)

### 13.1 Test File Organization Standards
- **Unit tests**: Place alongside source files with `.test.js` suffix or in `__tests__/` directories
- **Integration tests**: Use `tests/integration/` directory only
- **E2E tests**: Use `tests/e2e/` directory only
- **Temporary fixtures**: Use `tests/fixtures/` with `.fixture.` suffix
- **Manual test scripts**: Never commit manual test scripts - keep in local scratch space only

### 13.2 Pre-Commit Cleanliness Checks
Before every commit, agents must run:
```bash
# Remove common test debris
find . -name "*.test.log" -delete
find . -name ".coverage" -delete
find . -name "lcov.info" -delete
find . -name "*.tmp" -delete
find . -name "node_modules\.cache" -type d -exec rm -rf {} +

# Check for unwanted patterns
git status --porcelain | grep -E "\.(test|spec|tmp)\.(js|ts|json)$" && echo "Remove test files before committing"
```

### 13.3 Required .gitignore Patterns
Ensure these patterns are in `.gitignore`:
```
# Test artifacts
coverage/
.nyc_output/
lcov.info
*.test.log
*.coverage

# Temporary files
*.tmp
*.temp
node_modules/.cache/
.pnpm-store/

# IDE test files
.vscode-test/
test-results/
playwright-report/
```

### 13.4 Test Data Management
- **Never commit real user data**: Use anonymized fixtures only
- **Generate test data**: Create programmatically in test setup
- **External test data**: Document source but don't commit binaries
- **Database test files**: Use in-memory or temporary SQLite databases

### 13.5 Clean Development Workflow
1. **Before creating tests**:
   - Check if similar tests already exist
   - Verify test location follows organization standards
   - Use existing test utilities and fixtures

2. **While testing**:
   - Use `--watch` modes to avoid artifact generation
   - Direct temporary outputs to `/tmp` or system temp directory
   - Clean up immediately after test runs

3. **After testing**:
   - Run `pnpm test:clean` if available
   - Manually remove any test artifacts
   - Verify `git status` shows only intended changes

### 13.6 Periodic Repository Cleanup (Automated)
Agents should perform weekly cleanups:
```bash
# Remove orphaned test directories
find . -type d -name "__tests__" -empty -delete
find . -type d -name "test-results" -exec rm -rf {} +
find . -type d -name ".nyc_output" -exec rm -rf {} +

# Remove stale coverage reports
find . -name "coverage" -type d -mtime +7 -exec rm -rf {} +
```

### 13.7 Test File Lifecycle Rules
- **Pull Request tests**: Delete after PR merge unless specifically marked for reuse
- **Debug test files**: Never commit - use local branches only
- **Performance benchmarks**: Keep in dedicated `benchmarks/` directory only
- **Documentation examples**: Place in `docs/examples/` not as test files

---

## 14. Continuous Verification Workflow

### 14.1 Automated Verification Cadence
**Daily Checks**:
- Run `pnpm verify` to ensure all builds pass
- Check for new TODO/FIXME comments without Beads links
- Verify all endpoints have corresponding tests
- Scan for orphaned documentation (docs for non-existent features)

**Weekly Deep Verification**:
- Cross-reference `docs/` with implementation:
  - All documented endpoints exist in code
  - All documented config options are implemented
  - All security measures in SECURITY.md are active
- Check Beads for P1/P2 tasks without recent progress
- Verify test coverage remains above 80%
- Audit package.json for unused dependencies

### 14.2 Gap Detection Protocol
When gaps are detected:
1. **Document immediately**: Create Bead with descriptive title
2. **Assess impact**: Label P0 (critical), P1 (high), P2 (medium), P3 (low)
3. **Link dependencies**: Add cross-references to related Beads
4. **Create test**: Write failing test that documents expected behavior
5. **Assign owner**: Tag appropriate agent or team

### 14.3 Auto-Test Generation (For Gaps)
For critical gaps (P0/P1):
```javascript
// Example: Auto-generate test for missing endpoint
const generateEndpointTest = (method, path, expectedStatus) => ({
  type: 'test',
  file: `tests/api${path.replace(/\//g, '_')}.test.js`,
  content: `describe('${method} ${path}', () => {
    it('should return ${expectedStatus}', async () => {
      const response = await request(app)[method.toLowerCase()](${path})
      expect(response.status).toBe(${expectedStatus})
    })
  })`
})
```

### 14.4 Verification Scripts
Add to `package.json`:
```json
{
  "scripts": {
    "verify:docs": "node scripts/verify-docs-coverage.js",
    "verify:tasks": "node scripts/check-beads-coverage.js",
    "verify:clean": "node scripts/check-repo-hygiene.js",
    "verify:all": "pnpm verify:docs && pnpm verify:tasks && pnpm verify:clean"
  }
}
```

### 14.5 Monthly Architecture Review
- Verify all components in `docs/ARCHITECTURE.md` have current implementations
- Check performance benchmarks match documented targets
- Review security audit logs against SECURITY.md requirements
- Validate onboarding flow against ONBOARDING_FLOW.md
- Ensure all premium hooks are properly stubbed in OSS version

---

## 15. Notes for Agents Working Here

- Ask: **“What is the smallest correct change?”**
- Stop and ask if requirements are ambiguous
- Do not speculate about premium features
- Treat this file as binding
- **No attribution**: Do not add AI-generated attribution to commits, messages, or code
- Before acting, double-check this file (via `CLAUDE.md` if you need a shortcut) and the relevant `docs/` pages so you never drift from documented architecture.

---

*This file should be updated whenever NavisAI-specific architecture, tooling, or workflow changes.*
