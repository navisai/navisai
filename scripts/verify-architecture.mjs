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

function main() {
  ensureTopLevelDirectories()
  ensureWorkspacePackagesHaveManifest()
  ensureRequiredDocsExist()
  ensureCanonicalOriginInPwa()
}

main()

