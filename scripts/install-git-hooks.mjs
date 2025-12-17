#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const gitHooksDir = path.join(repoRoot, '.git', 'hooks')

async function exists(filePath) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

async function writeHook(name, content) {
  await fs.mkdir(gitHooksDir, { recursive: true })
  const hookPath = path.join(gitHooksDir, name)
  await fs.writeFile(hookPath, content, 'utf8')
  await fs.chmod(hookPath, 0o755)
}

async function install() {
  if (!(await exists(path.join(repoRoot, '.git')))) {
    console.error('Not a git checkout (missing .git). Skipping hook install.')
    process.exit(1)
  }

  const hook = `#!/bin/sh
set -e

echo "Running Navis architecture checks..."
pnpm verify

# Mandatory Beads verification if bd command is available
if command -v bd >/dev/null 2>&1; then
  echo "Verifying Beads integration and documentation compliance..."
  # Check if Beads is properly initialized
  if [ -d ".beads" ]; then
    echo "✅ Beads integration found"
    # Verify all Beads issues reference governing documentation
    if ! pnpm beads:verify; then
      echo ""
      echo "❌ Beads documentation compliance check failed!"
      echo "   All Beads issues must reference governing documentation."
      echo "   Docs are the canonical authority for all work."
      echo ""
      echo "   To fix:"
      echo "   1. Run 'pnpm beads:verify' to see detailed issues"
      echo "   2. Update Beads issues with proper doc references"
      echo "   3. Commit again"
      exit 1
    fi
    echo "✅ All Beads issues properly reference documentation"
  else
    echo "❌ Beads not initialized. Run 'pnpm beads:setup' to enable task tracking."
    echo "   Beads is mandatory for all work in this repository."
    exit 1
  fi
else
  echo "❌ Beads CLI not found. Install Beads for mandatory task tracking:"
  echo "   npm install -g beads"
  echo "   Then run: pnpm beads:setup"
  exit 1
fi
`

  await writeHook('pre-commit', hook)
  console.log('Installed git hook: .git/hooks/pre-commit')
}

async function uninstall() {
  const hookPath = path.join(gitHooksDir, 'pre-commit')
  if (await exists(hookPath)) {
    await fs.rm(hookPath)
    console.log('Removed git hook: .git/hooks/pre-commit')
  } else {
    console.log('No pre-commit hook found.')
  }
}

const command = process.argv[2]
if (command === 'install') {
  await install()
} else if (command === 'uninstall') {
  await uninstall()
} else {
  console.error('Usage: node scripts/install-git-hooks.mjs <install|uninstall>')
  process.exit(1)
}

