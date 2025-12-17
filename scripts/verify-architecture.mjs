#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()

function fail(message) {
  console.error(`\nARCH VERIFY FAILED: ${message}\n`)
  process.exit(1)
}

function isDirectory(entryPath) {
  try {
    return fs.statSync(entryPath).isDirectory()
  } catch {
    return false
  }
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function listDirNames(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

function ensureTopLevelDirectories() {
  const allowedNonHidden = new Set(['apps', 'packages', 'docs', 'node_modules', 'scripts'])

  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (!allowedNonHidden.has(entry.name)) {
      fail(
        `Unexpected top-level directory "${entry.name}". Allowed: ${Array.from(allowedNonHidden)
          .sort()
          .join(', ')}`
      )
    }
  }
}

function ensureWorkspacePackagesHaveManifest() {
  const appDirs = path.join(repoRoot, 'apps')
  const packageDirs = path.join(repoRoot, 'packages')

  for (const root of [appDirs, packageDirs]) {
    if (!isDirectory(root)) continue
    for (const child of listDirNames(root)) {
      const manifest = path.join(root, child, 'package.json')
      if (!fs.existsSync(manifest)) {
        fail(`Workspace folder "${path.relative(repoRoot, path.join(root, child))}" is missing package.json`)
      }
    }
  }
}

function ensureRequiredDocsExist() {
  const required = [
    'docs/NETWORKING.md',
    'docs/SETUP.md',
    'docs/IPC_TRANSPORT.md',
    'docs/SECURITY.md',
    'docs/ONBOARDING_FLOW.md',
    'docs/PAIRING_PROTOCOL.md',
    'docs/AUTH_MODEL.md',
    'docs/LOCAL_FIRST_GUARANTEES.md',
    'docs/MACOS_SETUP_EXPERIENCE.md',
    'docs/BEADS_WORKFLOW.md',
  ]

  for (const doc of required) {
    const full = path.join(repoRoot, doc)
    if (!fs.existsSync(full)) {
      fail(`Missing required doc: ${doc}`)
    }
  }
}

function ensureCanonicalOriginInPwa() {
  const clientPath = path.join(repoRoot, 'apps/pwa/src/lib/api/client.ts')
  if (!fs.existsSync(clientPath)) return

  const text = readUtf8(clientPath)
  if (!text.includes("const API_BASE = 'https://navis.local'")) {
    fail('PWA API base must use canonical origin: https://navis.local (no port)')
  }
}

function ensureBeadsIntegration() {
  const agentsDoc = path.join(repoRoot, 'AGENTS.md')
  if (!fs.existsSync(agentsDoc)) {
    fail('Missing AGENTS.md')
  }

  const agentsContent = readUtf8(agentsDoc)

  // Check for Section 1 - Beads Task Management Protocol
  if (!agentsContent.includes('## 1. Beads Task Management Protocol')) {
    fail('AGENTS.md must include Section 1: Beads Task Management Protocol')
  }

  // Check for BEADS_WORKFLOW.md reference in Section 0
  if (!agentsContent.includes('docs/BEADS_WORKFLOW.md')) {
    fail('AGENTS.md must reference docs/BEADS_WORKFLOW.md in Required Doc Cross-Checks')
  }
}

function main() {
  ensureTopLevelDirectories()
  ensureWorkspacePackagesHaveManifest()
  ensureRequiredDocsExist()
  ensureCanonicalOriginInPwa()
  ensureBeadsIntegration()
}

main()
