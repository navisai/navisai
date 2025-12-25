import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { platform } from 'node:os'

const execAsync = promisify(execCb)

async function hasCommand(cmd) {
  try {
    await execAsync(`command -v ${cmd}`)
    return true
  } catch {
    return false
  }
}

async function execWithTimeout(command, timeoutMs = 5000) {
  return execAsync(command, { timeout: timeoutMs })
}

async function isProcessRunning(name) {
  if (await hasCommand('pgrep')) {
    try {
      await execWithTimeout(`pgrep -x "${name}"`)
      return true
    } catch {
      return false
    }
  }

  try {
    const { stdout } = await execWithTimeout(`ps -ax -o comm= | grep -E "^${name}$" || true`)
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function checkMdnsSocket() {
  try {
    await access('/var/run/mDNSResponder')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function checkDnsSdQuery() {
  if (!(await hasCommand('dns-sd'))) {
    return { ok: false, error: 'dns-sd not available' }
  }

  try {
    await execWithTimeout(
      `perl -e 'alarm 3; exec "dns-sd", "-Q", "_services._dns-sd._udp", "local"' 2>/dev/null || true`,
      5000
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function checkDscacheutil() {
  if (!(await hasCommand('dscacheutil'))) {
    return { ok: false, error: 'dscacheutil not available' }
  }

  try {
    await execWithTimeout('dscacheutil -q host -a name apple.com', 5000)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function checkMdnsPolicy() {
  if (platform() !== 'darwin') return { ok: true }
  if (!(await hasCommand('defaults'))) {
    return { ok: false, error: 'defaults not available' }
  }

  try {
    const { stdout } = await execWithTimeout(
      'defaults read /Library/Preferences/com.apple.mDNSResponder.plist NoMulticastAdvertisements 2>/dev/null || true',
      5000
    )
    const value = stdout.trim()
    if (value === '1' || value.toLowerCase() === 'true') {
      return { ok: false, error: 'NoMulticastAdvertisements=true' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

export async function runPreflightChecks() {
  if (platform() !== 'darwin') {
    return { ok: true, checks: [] }
  }

  const results = []

  const mdnsResponder = await isProcessRunning('mDNSResponder')
  results.push({ name: 'mDNSResponder', ok: mdnsResponder })

  const mdnsHelper = await isProcessRunning('mDNSResponderHelper')
  results.push({ name: 'mDNSResponderHelper', ok: mdnsHelper })

  const mdnsSocket = await checkMdnsSocket()
  results.push({ name: 'mDNSResponder socket', ...mdnsSocket })

  const dnsSd = await checkDnsSdQuery()
  results.push({ name: 'dns-sd query', ...dnsSd })

  const dscache = await checkDscacheutil()
  results.push({ name: 'dscacheutil', ...dscache })

  const mdnsPolicy = await checkMdnsPolicy()
  results.push({ name: 'mDNS policy', ...mdnsPolicy })

  const oclp = await detectOclp()
  results.push({ name: 'OCLP detected', ...oclp })

  const ok = results.every((check) => check.ok)
  return { ok, checks: results }
}

export async function detectOclp() {
  if (platform() !== 'darwin') return { ok: true, detected: false }
  const paths = [
    '/System/Library/CoreServices/OpenCore-Legacy-Patcher.app',
    '/Applications/OpenCore Legacy Patcher.app',
    '/Applications/OpenCore-Patcher.app',
    '/Library/Application Support/OpenCore-Patcher',
    '/Library/Application Support/OpenCore Legacy Patcher'
  ]

  for (const candidate of paths) {
    try {
      await access(candidate)
      return { ok: false, detected: true, error: `OCLP detected: ${candidate}` }
    } catch {
      // ignore
    }
  }

  return { ok: true, detected: false }
}
