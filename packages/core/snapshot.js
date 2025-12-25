import { exec as execCb } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from './config.js'

const execAsync = promisify(execCb)
const SNAPSHOT_STATE_PATH = path.join(homedir(), '.navis', 'snapshot.json')
const TMUTIL_PREFIX = 'com.apple.TimeMachine.'

function ensureDarwin() {
  if (platform() !== 'darwin') {
    throw new Error('Snapshots are only supported on macOS')
  }
}

async function ensureStateDir() {
  const dir = path.dirname(SNAPSHOT_STATE_PATH)
  await mkdir(dir, { recursive: true })
}

function parseSnapshotId(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith(TMUTIL_PREFIX)) return null
  return trimmed.slice(TMUTIL_PREFIX.length)
}

function isRootUser() {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

function tmutilCommand(base) {
  return isRootUser() ? base : `sudo ${base}`
}

export async function readSnapshotState() {
  try {
    const data = await readFile(SNAPSHOT_STATE_PATH, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function writeSnapshotState(state) {
  await ensureStateDir()
  await writeFile(SNAPSHOT_STATE_PATH, JSON.stringify(state, null, 2))
}

export async function listLocalSnapshots() {
  ensureDarwin()
  const { stdout } = await execAsync('tmutil listlocalsnapshots /')
  return stdout
    .split('\n')
    .map(parseSnapshotId)
    .filter(Boolean)
}

export async function navisSnapshotExists(state) {
  if (!state?.id) return false
  const snapshots = await listLocalSnapshots()
  return snapshots.includes(state.id)
}

export function isSnapshotFresh(state) {
  if (!state?.createdAt) return false
  const freshnessHours = config.get('safety.snapshot.freshnessHours') ?? 24
  const createdAt = new Date(state.createdAt).getTime()
  if (!Number.isFinite(createdAt)) return false
  const ageMs = Date.now() - createdAt
  return ageMs <= freshnessHours * 60 * 60 * 1000
}

export async function deleteNavisSnapshot(state) {
  ensureDarwin()
  if (!state?.id) return { deleted: false }
  await execAsync(tmutilCommand(`tmutil deletelocalsnapshots ${state.id}`))
  return { deleted: true }
}

export async function createNavisSnapshot() {
  ensureDarwin()
  await execAsync(tmutilCommand('tmutil snapshot'))
  return recordLatestSnapshot()
}

export async function refreshNavisSnapshot() {
  ensureDarwin()
  const state = await readSnapshotState()
  if (state?.id) {
    await deleteNavisSnapshot(state)
  }
  return createNavisSnapshot()
}

export function getSnapshotStatePath() {
  return SNAPSHOT_STATE_PATH
}

export async function recordLatestSnapshot() {
  ensureDarwin()
  const snapshots = await listLocalSnapshots()
  const latest = snapshots[snapshots.length - 1]
  if (!latest) {
    throw new Error('Snapshot creation succeeded but no snapshot ID found')
  }
  const state = {
    id: latest,
    createdAt: new Date().toISOString(),
    platform: 'darwin',
    source: 'navis'
  }
  await writeSnapshotState(state)
  return state
}
