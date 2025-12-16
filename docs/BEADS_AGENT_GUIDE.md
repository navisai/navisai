# Beads Agent Guide for NavisAI

This guide explains how agents should use Beads for task tracking, coordination, and memory persistence in the NavisAI project.

## Quick Start for Agents

### 1. Initialize Your Session
```bash
# Always start your session with:
cd /Volumes/Macintosh\ HD/Users/vsmith/navisai
bd prime  # Load project context and current issues
```

### 2. Find Available Work
```bash
# See what work is ready (no blockers):
bd ready

# List all issues with details:
bd list

# Show specific issue details:
bd show navisai-22h
```

### 3. Claim Work
```bash
# Mark issue as in-progress:
bd update navisai-22h --status in_progress

# Add yourself as assignee:
bd update navisai-22h --assignee <agent-name>
```

### 4. Create New Issues
When you discover new work:

```bash
# Basic issue creation:
bd create "Brief description of task" -t <type> -d "Detailed description"

# Example for architecture work:
bd create "Update bridge.js for intelligent routing" \
  -t feature \
  -d "Implement service detection and routing engine per docs/BRIDGE_IMPLEMENTATION.md" \
  -p 1

# Example for bug fixes:
bd create "Fix mDNS discovery on macOS" \
  -t bug \
  -d "Discovery fails on macOS 14+ due to network permission changes" \
  -p 0
```

### 5. Add Dependencies
```bash
# If work is blocked by another issue:
bd dep add <your-issue> <blocking-issue> --type blocks

# If work is related to another issue:
bd dep add <your-issue> <related-issue> --type related

# If this is a subtask:
bd dep add <your-issue> <parent-issue> --type parent-child

# If discovered during other work:
bd dep add <your-issue> <source-issue> --type discovered-from
```

### 6. Complete Work
```bash
# When done, close the issue:
bd close navisai-22h --reason "Implemented per spec in docs/BRIDGE_IMPLEMENTATION.md"

# Update status before closing:
bd update navisai-22h --status done
```

## Required Workflow for NavisAI

### Documentation References
ALL Beads issues MUST reference governing documentation:

- **Network/bridge changes** → `docs/NETWORKING.md`
- **API/endpoints** → `docs/IPC_TRANSPORT.md` + `packages/api-contracts`
- **Setup/UX changes** → `docs/SETUP.md` + `docs/ONBOARDING_FLOW.md`
- **Security/auth** → `docs/SECURITY.md` + `docs/AUTH_MODEL.md`
- **Beads workflow** → `docs/BEADS_WORKFLOW.md`

### Required Labels
Add NavisAI-specific labels (these are organized by convention):

**Components**: `daemon`, `cli`, `pwa`, `setup-app`, `bridge`
**Packages**: `db`, `api-contracts`, `logging`, `discovery`, `core`
**Domains**: `networking`, `security`, `auth`, `ui`, `mobile`
**Types**: `feature`, `bug`, `tech-debt`, `docs`, `testing`

### High-Risk Operations
For Section 7 high-risk operations (file system mutation, Git operations, etc.):

1. Add `high-risk` label
2. Include approval dependency in description
3. Document rollback plan
4. Link to approval issue: `bd dep add <risk-issue> <approval-issue> --type blocks`

## Examples for NavisAI

### Example 1: Bridge Implementation
```bash
# Main task
bd create "Implement intelligent reverse proxy bridge" \
  -t feature \
  -d "Implement the intelligent reverse proxy per docs/BRIDGE_IMPLEMENTATION.md v0.2. Includes service detection, routing engine, and TLS handling." \
  -p 0

# Subtask
bd create "Add service detection module" \
  -t task \
  -d "Create ServiceDetector class to identify existing port 443 services" \
  -p 1

# Create dependency
bd dep add navisai-abc navisai-def --type parent-child
```

### Example 2: API Change
```bash
bd create "Add device approval endpoint" \
  -t feature \
  -d "Add POST /approvals/:id/approve endpoint per docs/IPC_TRANSPORT.md. Update packages/api-contracts with new schema." \
  -p 1
```

### Example 3: High-Risk Operation
```bash
bd create "Update bridge installation to require admin" \
  -t feature \
  -d "Bridge installation now requires admin approval per security review. HIGH-RISK: modifies system services." \
  -p 0
bd label add navisai-xyz high-risk
bd dep add navisai-xyz navisai-approval --type blocks
```

## Coordination Between Agents

### Claiming Work
1. Always create an issue before starting work
2. Mark as `in_progress` to claim it
3. Check `bd ready` to find unblocked work

### Session Handoff
When ending session:
1. Update all issue statuses
2. Document progress in issue descriptions
3. Reference issues in commit messages

### Multi-Agent Work
When multiple agents work on related tasks:
1. Use `related` dependencies between issues
2. Coordinate through agent communication channels
3. Update dependencies as work progresses

## Integration with NavisAI Tooling

### Package.json Commands
```bash
pnpm beads:init     # Initialize Beads (already done)
pnpm beads:setup    # Setup Claude integration
pnpm beads:prime    # Load context
pnpm beads:ready    # Find unblocked work
pnpm beads:status   # Current status
```

### Git Hooks
Pre-commit hooks automatically:
- Run NavisAI architecture verification
- Check Beads integration status
- Prompt if Beads needs setup

### Claude Integration
Once `pnpm beads:setup` is run:
- Claude automatically loads Beads context
- SessionStart and PreCompact hooks run `bd prime`
- Issues are available in Claude context

## Current Issues in NavisAI

Run `bd list` to see current issues. As of initialization:

- `navisai-22h` [P0] Set up Beads integration for NavisAI
- `navisai-zjt` [P1] Configure Claude Code hooks for Beads
- `navisai-50j` [P2] Create Beads templates for NavisAI workflows

Use `bd ready` to see which issues are unblocked and ready for work.

## Best Practices

1. **Always** run `bd prime` at session start
2. **Always** reference governing docs in issue descriptions
3. **Always** add appropriate dependencies
4. **Always** update status when starting/completing work
5. **Never** work without creating an issue first
6. **Always** check `bd ready` before starting new work

## Troubleshooting

### Beads command not found
Beads is installed globally. If you get "command not found":
```bash
# Check installation
which bd

# If missing, install:
npm install -g beads
```

### Issues not showing
```bash
# Check you're in the right directory
pwd  # Should be /Volumes/Macintosh HD/Users/vsmith/navisai

# Check Beads database exists
ls -la .beads/

# Force database discovery
bd --db .beads/beads.db list
```

### Git sync issues
```bash
# Force sync with git
bd sync

# Check database health
bd validate
```

Remember: Beads integration is enforced by NavisAI's architecture verification. Non-compliance will be caught by `pnpm verify`.