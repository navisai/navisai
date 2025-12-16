import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function runNode({ cwd, code }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) return resolve({ stdout, stderr })
      reject(new Error(`node exited ${code}\n${stderr || stdout}`))
    })
  })
}

function realpathForSymlink(targetPath) {
  return targetPath
}

async function ensureSymlink(linkPath, targetPath) {
  await mkdir(path.dirname(linkPath), { recursive: true })
  try {
    await symlink(realpathForSymlink(targetPath), linkPath, 'dir')
  } catch (error) {
    if (error && error.code === 'EEXIST') return
    throw error
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const daemonPath = path.join(repoRoot, 'apps', 'daemon')
const setupAppPath = path.join(repoRoot, 'apps', 'setup-app')
const cliPath = path.join(repoRoot, 'apps', 'cli')

if (!existsSync(path.join(daemonPath, 'package.json'))) {
  throw new Error('Expected apps/daemon/package.json to exist')
}
if (!existsSync(path.join(setupAppPath, 'package.json'))) {
  throw new Error('Expected apps/setup-app/package.json to exist')
}
if (!existsSync(path.join(cliPath, 'package.json'))) {
  throw new Error('Expected apps/cli/package.json to exist')
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'navisai-npm-layout-'))
try {
  const nodeModules = path.join(tempDir, 'node_modules')

  await ensureSymlink(path.join(nodeModules, '@navisai', 'daemon'), daemonPath)
  await ensureSymlink(path.join(nodeModules, '@navisai', 'setup-app'), setupAppPath)
  await ensureSymlink(path.join(nodeModules, '@navisai', 'cli'), cliPath)

  await writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ name: 'navisai-npm-layout-test', private: true }, null, 2),
    'utf8'
  )

  const { stdout: resolvedBridge } = await runNode({
    cwd: tempDir,
    code: `
      import { resolveDaemonBridgeEntrypoint } from '@navisai/setup-app/bridge';
      import fs from 'node:fs';
      const p = resolveDaemonBridgeEntrypoint();
      if (!fs.existsSync(p)) throw new Error('Resolved bridge entrypoint does not exist: ' + p);
      console.log(p);
    `
  })

  const { stdout: resolvedSetupApp } = await runNode({
    cwd: tempDir,
    code: `
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      const p = require.resolve('@navisai/setup-app');
      console.log(p);
    `
  })

  console.log('✅ npm-layout simulation OK')
  console.log(`- @navisai/daemon bridge resolved: ${resolvedBridge.trim()}`)
  console.log(`- @navisai/setup-app entry resolved: ${resolvedSetupApp.trim()}`)
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
