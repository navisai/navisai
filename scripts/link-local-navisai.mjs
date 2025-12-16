import { mkdir, rm, symlink } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shimPath = path.join(repoRoot, 'navisai')

function getDefaultBinDir() {
  if (process.platform === 'win32') return null
  if (process.platform === 'darwin') return path.join(os.homedir(), '.local', 'bin')
  return path.join(os.homedir(), '.local', 'bin')
}

const mode = process.argv[2] || 'link'
const binDir = process.env.NAVISAI_BIN_DIR || getDefaultBinDir()

if (!binDir) {
  console.error('Unsupported platform for symlink helper. Use `pnpm --filter @navisai/cli exec navisai ...`.')
  process.exit(1)
}

const target = path.join(binDir, 'navisai')

if (!existsSync(shimPath)) {
  console.error(`Expected repo shim at ${shimPath}.`)
  process.exit(1)
}

if (mode === 'unlink') {
  await rm(target, { force: true })
  console.log(`✅ Removed ${target}`)
  process.exit(0)
}

if (mode !== 'link') {
  console.error('Usage: node scripts/link-local-navisai.mjs [link|unlink]')
  process.exit(1)
}

await mkdir(binDir, { recursive: true })

if (existsSync(target)) {
  try {
    const stat = lstatSync(target)
    if (!stat.isSymbolicLink()) {
      console.error(`Refusing to overwrite non-symlink at ${target}. Remove it manually or set NAVISAI_BIN_DIR.`)
      process.exit(1)
    }
  } catch {}
  await rm(target, { force: true })
}

await symlink(shimPath, target)
console.log(`✅ Linked ${target} -> ${shimPath}`)
console.log(`- Ensure your PATH includes ${binDir}`)
console.log(`  e.g. add to shell profile: export PATH=\"${binDir}:$PATH\"`)

