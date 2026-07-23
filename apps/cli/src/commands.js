import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, networkInterfaces, platform } from 'node:os'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import { NAVIS_PATHS } from '@navisai/api-contracts'
import { installBridge, uninstallBridge } from '@navisai/setup-app/bridge'
import { runPreflightChecks } from '@navisai/core/preflight'
import { refreshNavisSnapshot, readSnapshotState, navisSnapshotExists, isSnapshotFresh } from '@navisai/core/snapshot'
import { Agent as UndiciAgent } from 'undici'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const CANONICAL_ORIGIN = 'https://navis.local'
const CA_CERT_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local-ca.crt')
const CA_KEY_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local-ca.key')
const LEAF_CERT_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local.crt')
const LEAF_KEY_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local.key')
const CLI_LOG_PATH = path.join(homedir(), '.navis', 'logs', 'cli.log')

async function logCliPrompt(event, details) {
  try {
    await fs.mkdir(path.dirname(CLI_LOG_PATH), { recursive: true })
    const payload = {
      timestamp: new Date().toISOString(),
      event,
      ...details
    }
    await fs.appendFile(CLI_LOG_PATH, `${JSON.stringify(payload)}\n`)
  } catch {
    // Ignore logging errors.
  }
}

async function fetchNavis(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${CANONICAL_ORIGIN}${pathOrUrl}`

  const certPem = await fs.readFile(CA_CERT_PATH, 'utf8').catch(() => null)
  const dispatcher = new UndiciAgent({
    connect: certPem ? { ca: certPem } : { rejectUnauthorized: false },
  })

  return fetch(url, { ...options, dispatcher })
}

async function fetchDaemonDirect(path = NAVIS_PATHS.status, options = {}) {
  const certPem = await fs.readFile(CA_CERT_PATH, 'utf8').catch(() => null)
  const dispatcher = new UndiciAgent({
    connect: certPem ? { ca: certPem } : { rejectUnauthorized: false },
  })
  return fetch(`https://127.0.0.1:47621${path}`, {
    ...options,
    headers: { Host: 'navis.local', ...(options.headers || {}) },
    dispatcher,
  })
}

async function isDaemonReachable() {
  try {
    const response = await fetchDaemonDirect()
    return response.ok
  } catch {
    return false
  }
}

async function waitForDaemonReady({ timeoutMs = 8000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDaemonReachable()) return true
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return false
}

async function probeLoopbackBind(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error) => resolve({ ok: false, error }))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve({ ok: true }))
    })
  })
}

function getLanAddresses() {
  const interfaces = networkInterfaces()
  const addresses = []
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface || []) {
      if (!addr || addr.internal) continue
      if (addr.family === 'IPv4' || addr.family === 'IPv6') {
        addresses.push(addr.address)
      }
    }
  }
  return addresses
}

async function resolveNavisLocal() {
  try {
    const { lookup } = await import('node:dns/promises')
    const result = await lookup('navis.local')
    return { success: true, address: result.address }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function queryMdnsARecord(hostname, timeoutMs = 6000) {
  if (!(await hasCommand('dns-sd'))) {
    return { success: false, error: 'dns-sd not available' }
  }

  const alarmSeconds = Math.max(2, Math.ceil(timeoutMs / 1000))
  const execTimeout = timeoutMs + 2000

  try {
    const { stdout } = await execAsync(
      `perl -e 'alarm ${alarmSeconds}; exec "dns-sd", "-Q", "${hostname}", "A"' 2>/dev/null || true`,
      { encoding: 'utf8', timeout: execTimeout }
    )
    const line = stdout
      .split('\n')
      .find((row) => row.includes(`${hostname}.`) && row.includes('Addr') && row.trim().match(/\d+\.\d+\.\d+\.\d+/))
    const ip = line?.trim().match(/(\d+\.\d+\.\d+\.\d+)/)?.[1]
    if (!ip) return { success: false, error: `No mDNS A answer observed for ${hostname}` }
    return { success: true, address: ip }
  } catch (error) {
    const stdout = error?.stdout ?? ''
    const line = stdout
      .split('\n')
      .find((row) => row.includes(`${hostname}.`) && row.includes('Addr') && row.trim().match(/\d+\.\d+\.\d+\.\d+/))
    const ip = line?.trim().match(/(\d+\.\d+\.\d+\.\d+)/)?.[1]
    if (ip) return { success: true, address: ip }
    return { success: false, error: error.message }
  }
}

async function queryMdnsAAAARecord(hostname, timeoutMs = 6000) {
  if (!(await hasCommand('dns-sd'))) {
    return { success: false, error: 'dns-sd not available' }
  }

  const alarmSeconds = Math.max(2, Math.ceil(timeoutMs / 1000))
  const execTimeout = timeoutMs + 2000

  try {
    const { stdout } = await execAsync(
      `perl -e 'alarm ${alarmSeconds}; exec "dns-sd", "-Q", "${hostname}", "AAAA"' 2>/dev/null || true`,
      { encoding: 'utf8', timeout: execTimeout }
    )
    const line = stdout
      .split('\n')
      .find((row) => row.includes(`${hostname}.`) && row.includes('Addr') && row.includes(':'))
    const ip = line?.trim().match(/([0-9a-fA-F:]+)/)?.[1]
    if (!ip) return { success: false, error: `No mDNS AAAA answer observed for ${hostname}` }
    return { success: true, address: ip }
  } catch (error) {
    const stdout = error?.stdout ?? ''
    const line = stdout
      .split('\n')
      .find((row) => row.includes(`${hostname}.`) && row.includes('Addr') && row.includes(':'))
    const ip = line?.trim().match(/([0-9a-fA-F:]+)/)?.[1]
    if (ip) return { success: true, address: ip }
    return { success: false, error: error.message }
  }
}

async function queryMdnsRecord(name, recordType, timeoutMs = 6000) {
  if (!(await hasCommand('dns-sd'))) {
    return { success: false, error: 'dns-sd not available' }
  }

  const alarmSeconds = Math.max(2, Math.ceil(timeoutMs / 1000))
  const execTimeout = timeoutMs + 2000

  try {
    const { stdout } = await execAsync(
      `perl -e 'alarm ${alarmSeconds}; exec "dns-sd", "-Q", "${name}", "${recordType}"' 2>/dev/null || true`,
      { encoding: 'utf8', timeout: execTimeout }
    )
    const line = stdout
      .split('\n')
      .map((row) => row.trim())
      .find((row) => row.includes(`${name}.`) && row.includes(` ${recordType} `))
    if (!line) return { success: false, error: `No mDNS ${recordType} answer observed for ${name}` }
    return { success: true, line }
  } catch (error) {
    const stdout = error?.stdout ?? ''
    const line = stdout
      .split('\n')
      .map((row) => row.trim())
      .find((row) => row.includes(`${name}.`) && row.includes(` ${recordType} `))
    if (line) return { success: true, line }
    return { success: false, error: error.message }
  }
}

function extractMdnsToken(line, marker) {
  if (!line) return null
  const normalized = line.replace(/\s+/g, ' ').trim()
  const index = normalized.indexOf(marker)
  if (index === -1) return null
  const slice = normalized.slice(index + marker.length).trim()
  return slice.split(' ')[0]?.replace(/\.$/, '') || null
}

function parsePtrTarget(line) {
  if (!line) return null
  if (line.includes('No Such Record')) return null
  const match = line.match(/\bPTR\s+IN\s+(\S+)/)
  return match?.[1]?.replace(/\.$/, '') || null
}

function parseSrvRecord(line) {
  if (!line) return null
  if (line.includes('No Such Record')) return null
  const match = line.match(/\bSRV\s+IN\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/)
  if (!match) return null
  return {
    port: Number.parseInt(match[3], 10),
    target: match[4].replace(/\.$/, '')
  }
}

function parseTxtPayload(line) {
  if (!line || line.includes('No Such Record')) return null
  const bytesIndex = line.indexOf('bytes:')
  if (bytesIndex === -1) return line
  const hexPart = line.slice(bytesIndex + 'bytes:'.length).trim()
  const bytes = hexPart
    .split(/\s+/)
    .filter((token) => /^[0-9a-fA-F]{2}$/.test(token))
    .map((token) => Number.parseInt(token, 16))
  if (bytes.length === 0) return line
  return Buffer.from(bytes).toString('utf8')
}

async function browseMdnsService(serviceType, domain = 'local', timeoutMs = 6000) {
  if (!(await hasCommand('dns-sd'))) {
    return { success: false, error: 'dns-sd not available' }
  }

  const alarmSeconds = Math.max(2, Math.ceil(timeoutMs / 1000))
  const execTimeout = timeoutMs + 2000

  try {
    const { stdout } = await execAsync(
      `perl -e 'alarm ${alarmSeconds}; exec "dns-sd", "-B", "${serviceType}", "${domain}"' 2>/dev/null || true`,
      { encoding: 'utf8', timeout: execTimeout }
    )
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    const found = lines.some((l) => l.includes(serviceType))
    return { success: true, found, output: lines.slice(0, 8).join('\n') }
  } catch (error) {
    const stdout = error?.stdout ?? ''
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    const found = lines.some((l) => l.includes(serviceType))
    if (found) return { success: true, found, output: lines.slice(0, 8).join('\n') }
    return { success: false, error: error.message }
  }
}

async function loadX509(certPath) {
  const pem = await fs.readFile(certPath, 'utf8')
  const { X509Certificate } = await import('node:crypto')
  return new X509Certificate(pem)
}

async function checkCertificateValidity(certPath) {
  try {
    const cert = await loadX509(certPath)
    const validFrom = new Date(cert.validFrom)
    const validTo = new Date(cert.validTo)

    return {
      exists: true,
      path: certPath,
      validFrom,
      validTo,
      isExpired: validTo < new Date(),
    }
  } catch (error) {
    return {
      exists: false,
      path: certPath,
      error: error.message,
    }
  }
}

async function readOpenSslText(certPath) {
  const { stdout } = await execAsync(`openssl x509 -in "${certPath}" -noout -text`, { encoding: 'utf8' })
  return stdout
}

function extractCommonName(subjectLine) {
  const match = subjectLine.match(/CN\s*=\s*([^,\/]+)/i)
  return match ? match[1].trim() : null
}

async function getCertSubjectIssuer(certPath) {
  const { stdout } = await execAsync(`openssl x509 -in "${certPath}" -noout -subject -issuer`, { encoding: 'utf8' })
  const subjectLine = stdout.split('\n').find((line) => line.includes('subject=')) ?? ''
  const issuerLine = stdout.split('\n').find((line) => line.includes('issuer=')) ?? ''
  return {
    subject: subjectLine.replace(/^subject=\s*/i, '').trim(),
    issuer: issuerLine.replace(/^issuer=\s*/i, '').trim(),
    subjectCN: extractCommonName(subjectLine),
    issuerCN: extractCommonName(issuerLine),
  }
}

async function getCertSha1(certPath) {
  try {
    const { stdout } = await execAsync(`openssl x509 -in "${certPath}" -noout -fingerprint -sha1`, { encoding: 'utf8' })
    const match = stdout.match(/Fingerprint=([0-9A-F:]+)/i)
    if (!match) return null
    return match[1].replaceAll(':', '').toUpperCase()
  } catch {
    return null
  }
}

async function hasAdminTrustSettings(certPath) {
  if (platform() !== 'darwin') return null
  const sha1 = await getCertSha1(certPath)
  if (!sha1) return false
  const trustFile = path.join(homedir(), '.navis', 'trust-settings.plist')
  try {
    await execAsync(`security trust-settings-export -d "${trustFile}"`)
    const { stdout } = await execAsync(`plutil -p "${trustFile}"`, { encoding: 'utf8' })
    const lines = stdout.split('\n')
    const index = lines.findIndex((line) => line.includes(sha1))
    if (index === -1) return false
    const snippet = lines.slice(index, index + 20).join('\n')
    return snippet.includes('trustSettings')
  } catch {
    return false
  } finally {
    try {
      await fs.unlink(trustFile)
    } catch {
      // Ignore cleanup errors.
    }
  }
}

async function checkLeafCertificate() {
  const validity = await checkCertificateValidity(LEAF_CERT_PATH)
  if (!validity.exists) return { ...validity, ok: false }

  const text = await readOpenSslText(LEAF_CERT_PATH)
  const hasSan = text.includes('DNS:navis.local')
  const hasEku = text.includes('Extended Key Usage') &&
    (text.includes('TLS Web Server Authentication') || text.includes('serverAuth'))
  const { issuerCN } = await getCertSubjectIssuer(LEAF_CERT_PATH)

  return {
    ...validity,
    ok: hasSan && hasEku,
    hasSan,
    hasEku,
    issuerCN,
  }
}

async function checkCaCertificate() {
  const validity = await checkCertificateValidity(CA_CERT_PATH)
  if (!validity.exists) return { ...validity, ok: false }

  const text = await readOpenSslText(CA_CERT_PATH)
  const isCa = text.includes('CA:TRUE')
  const { subjectCN } = await getCertSubjectIssuer(CA_CERT_PATH)
  const trustSettingsOk = await hasAdminTrustSettings(CA_CERT_PATH)

  return {
    ...validity,
    ok: isCa && trustSettingsOk !== false,
    isCa,
    trustSettingsOk,
    subjectCN,
  }
}

async function checkTlsChainServed() {
  try {
    const { stdout } = await execAsync(
      `openssl s_client -connect navis.local:443 -servername navis.local -CAfile "${CA_CERT_PATH}" -verify_return_error -showcerts </dev/null`,
      { encoding: 'utf8', timeout: 8000 }
    )
    const certCount = (stdout.match(/BEGIN CERTIFICATE/g) || []).length
    const verified = stdout.includes('Verify return code: 0 (ok)') || stdout.includes('Verification: OK')
    return { ok: verified, certCount }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function removeTlsMaterials() {
  try {
    await Promise.all([
      fs.rm(CA_CERT_PATH, { force: true }),
      fs.rm(CA_KEY_PATH, { force: true }),
      fs.rm(LEAF_CERT_PATH, { force: true }),
      fs.rm(LEAF_KEY_PATH, { force: true }),
      fs.rm(path.join(homedir(), '.navis', 'certs', 'navis.local-ca.srl'), { force: true }),
    ])
    return true
  } catch (error) {
    console.error('Failed to remove TLS materials:', error.message)
    return false
  }
}

function resolveDaemonEntrypoint() {
  try {
    return require.resolve('@navisai/daemon/src/index.js')
  } catch {
    return path.join(__dirname, '..', '..', 'daemon', 'src', 'index.js')
  }
}

function resolveBridgeEntrypoint() {
  try {
    return require.resolve('@navisai/daemon/src/bridge.js')
  } catch {
    return path.join(__dirname, '..', '..', 'daemon', 'src', 'bridge.js')
  }
}

async function confirm(question) {
  const start = Date.now()
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} (y/N): `)
    const accepted = answer.trim().toLowerCase() === 'y'
    await logCliPrompt('confirm', {
      question,
      accepted,
      elapsedMs: Date.now() - start,
      defaultNo: true
    })
    return accepted
  } finally {
    rl.close()
  }
}

async function confirmTyped(promptText, requiredPhrase) {
  const start = Date.now()
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${promptText}\nType "${requiredPhrase}" to continue: `)
    const accepted = answer.trim() === requiredPhrase
    await logCliPrompt('confirm_typed', {
      promptText,
      accepted,
      elapsedMs: Date.now() - start
    })
    return accepted
  } finally {
    rl.close()
  }
}

function escapeAppleScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

async function runMacOSAdminShell(shellCommand, options = {}) {
  const { preferSudo = false, allowSudoFallback = false } = options
  const wrapped = `sh -c '${shellCommand.replaceAll("'", "'\\''")}'`

  if (preferSudo) {
    return execAsync(`sudo ${wrapped}`)
  }

  const script = `do shell script "${escapeAppleScriptString(shellCommand)}" with administrator privileges`
  try {
    return await execAsync(`osascript -e "${escapeAppleScriptString(script)}"`)
  } catch (error) {
    if (!allowSudoFallback) {
      throw error
    }
    return execAsync(`sudo ${wrapped}`)
  }
}

async function runMacSetupApp() {
  const dialog = `
tell application "System Events"
  activate
  set dialogText to "Navis needs to install a helper bridge that owns port 443 so https://navis.local works.\\n\\nPress Continue to run the one-time setup. This will prompt for your password via the standard macOS security sheet."
  set userChoice to button returned of (display dialog dialogText buttons {"Cancel", "Continue"} default button "Continue" with title "Navis Setup" giving up after 30)
end tell
return userChoice
`
  try {
    const { stdout } = await execAsync(`osascript -e ${escapeAppleScriptCommand(dialog)}`)
    return stdout.trim() === 'Continue'
  } catch {
    return false
  }
}

function escapeAppleScriptCommand(command) {
  return command.replaceAll('"', '\\\\"').replaceAll('\\n', '\\\\n')
}

async function runPreflightGate(context, options = {}) {
  const { requireOclpAck = true } = options
  if (platform() !== 'darwin') return true
  console.log(`\nPreflight checks (${context})...`)
  const result = await runPreflightChecks()
  if (result.ok) {
    console.log('✅ Preflight checks passed')
    const oclpDetected = result.checks.some((check) => check.name === 'OCLP detected' && check.detected)
    if (oclpDetected) {
      console.log('⚠️  OCLP detected: stricter safeguards are required.')
      if (requireOclpAck && (context.startsWith('setup') || context.startsWith('reset'))) {
        const ok = await confirmTyped(
          'OCLP detected. Proceeding will create a Navis snapshot before mutations.',
          'I UNDERSTAND'
        )
        if (!ok) return false
      }
    }
    const warnings = result.checks.filter((check) => check.warning)
    warnings.forEach((check) => {
      console.log(`⚠️  ${check.name}: ${check.warning}`)
    })
    return true
  }
  console.log('❌ Preflight checks failed:')
  result.checks.forEach((check) => {
    const status = check.ok ? 'ok' : 'fail'
    console.log(`   - ${check.name}: ${status}${check.error ? ` (${check.error})` : ''}`)
  })
  console.log('   Fix the issues above before retrying setup.')
  console.log('   If mDNSResponder is down, reboot or clear policy overrides first.')
  const oclpDetected = result.checks.some((check) => check.name === 'OCLP detected' && check.detected)
  if (oclpDetected) {
    console.log('   OCLP detected: stricter safeguards apply, but snapshot creation is still allowed.')
  }
  return false
}

async function runSnapshotGate(context) {
  const preflightOk = await runPreflightGate(context)
  if (!preflightOk) return false
  if (platform() !== 'darwin') return true
  try {
    const snapshotState = await readSnapshotState()
    const exists = await navisSnapshotExists(snapshotState)
    const fresh = isSnapshotFresh(snapshotState)
    if (exists && fresh) {
      console.log('✅ Navis snapshot is fresh')
      return true
    }
    console.log('Creating Navis snapshot...')
    await refreshNavisSnapshot()
    console.log('✅ Navis snapshot recorded')
    return true
  } catch (error) {
    console.log(`❌ Snapshot creation failed: ${error.message}`)
    console.log('   Fix system health issues and retry.')
    return false
  }
}

async function hasCommand(cmd) {
  try {
    await execAsync(`command -v ${cmd}`)
    return true
  } catch {
    return false
  }
}

async function execWithTimeout(command, options = {}) {
  const { timeoutMs = 15000, ...rest } = options
  return execAsync(command, { ...rest, timeout: timeoutMs })
}

async function findRepoRoot(startDir) {
  let current = startDir
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(current, 'package.json')
    try {
      const content = await fs.readFile(pkgPath, 'utf8')
      const pkg = JSON.parse(content)
      if (pkg?.name === 'navisai') return current
    } catch {
      // Not a repo root.
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

async function runLinuxAdminShell(shellCommand) {
  const wrapped = `sh -c '${shellCommand.replaceAll("'", "'\\''")}'`
  if (await hasCommand('pkexec')) {
    return execAsync(`pkexec ${wrapped}`)
  }
  return execAsync(`sudo ${wrapped}`)
}

async function installMacOSBridge() {
  const bridgeEntrypoint = resolveBridgeEntrypoint()
  const nodePath = process.execPath

  const localDir = path.join(homedir(), '.navis', 'bridge')
  const localPlist = path.join(localDir, 'com.navisai.bridge.plist')
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const runnerPath = '/usr/local/libexec/navisai-bridge-runner'

  await fs.mkdir(localDir, { recursive: true })

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.navisai.bridge</string>

    <key>ProgramArguments</key>
    <array>
      <string>${runnerPath}</string>
      <string>${bridgeEntrypoint}</string>
      <string>start</string>
      <string>--setup-approved</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
      <key>NAVIS_BRIDGE_HOST</key>
      <string>0.0.0.0</string>
      <key>NAVIS_BRIDGE_PORT</key>
      <string>443</string>
      <key>NAVIS_DAEMON_HOST</key>
      <string>127.0.0.1</string>
      <key>NAVIS_DAEMON_PORT</key>
      <string>47621</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/var/log/navis-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/navis-bridge.err</string>
  </dict>
</plist>
`

  await fs.writeFile(localPlist, plist, 'utf8')

  const systemPfConf = '/etc/pf.conf'
  const systemPfConfBackup = '/etc/pf.conf.backup'
  const pfAnchorBlock = [
    '',
    '# NavisAI anchors (do not modify Apple anchors)',
    'nat-anchor "navisai/*"',
    'rdr-anchor "navisai/*"',
    'anchor "navisai/*"',
    ''
  ].join('\n')

  const shellCommand = [
    'set -euo pipefail',
    // Install a root-owned runner; launchd can refuse to bootstrap LaunchDaemons that directly
    // execute user-owned Homebrew binaries (common cause of I/O error on bootstrap).
    `install -d -m 0755 "/usr/local/libexec"`,
    `printf '%s\\n' '#!/bin/sh' 'set -e' 'exec \"${nodePath}\" \"$@\"' > \"${runnerPath}\"`,
    `chmod 0755 "${runnerPath}"`,
    `chown root:wheel "${runnerPath}"`,
    // Install plist
    `install -m 0644 "${localPlist}" "${systemPlist}"`,
    `chown root:wheel "${systemPlist}"`,
    // Ensure log files exist and are writable by launchd (root)
    `touch /var/log/navis-bridge.log /var/log/navis-bridge.err`,
    `chown root:wheel /var/log/navis-bridge.log /var/log/navis-bridge.err`,
    // Backup existing pf.conf if it exists and hasn't been backed up
    `if [ -f "${systemPfConf}" ] && [ ! -f "${systemPfConfBackup}" ]; then cp "${systemPfConf}" "${systemPfConfBackup}"; fi`,
    // Add navisai anchors without overwriting existing pf.conf, validate with dry-run
    `if ! grep -q "navisai/\\"" "${systemPfConf}" 2>/dev/null; then ` +
      `tmpPf="$(mktemp /var/tmp/navis-pf.XXXXXX)"; ` +
      `if [ -f "${systemPfConf}" ]; then cat "${systemPfConf}" > "$tmpPf"; fi; ` +
      `printf '%s\\n' '${pfAnchorBlock.replace(/'/g, "'\\''")}' >> "$tmpPf"; ` +
      `pfctl -nf "$tmpPf"; ` +
      `if [ -f "${systemPfConf}" ]; then printf '%s\\n' '${pfAnchorBlock.replace(/'/g, "'\\''")}' >> "${systemPfConf}"; else install -m 0644 "$tmpPf" "${systemPfConf}"; fi; ` +
      `rm -f "$tmpPf"; ` +
      `fi`,
    // Load the service
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    // If the service was previously disabled (e.g., via System Settings → Login Items), bootstrap can fail.
    `launchctl enable system/com.navisai.bridge >/dev/null 2>&1 || true`,
    `launchctl bootstrap system "${systemPlist}"`,
    `launchctl kickstart -k system/com.navisai.bridge >/dev/null 2>&1 || true`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand, { preferSudo: false })
}

async function uninstallMacOSBridge() {
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const systemPfConf = '/etc/pf.conf'
  const systemPfConfBackup = '/etc/pf.conf.backup'
  const runnerPath = '/usr/local/libexec/navisai-bridge-runner'
  const systemBridgeDir = '/usr/local/libexec/navisai-bridge'
  const shellCommand = [
    'set -euo pipefail',
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    `rm -f "${systemPlist}"`,
    `rm -f "${runnerPath}"`,
    `rm -rf "${systemBridgeDir}"`,
    // Restore original pf.conf if backup exists
    `if [ -f "${systemPfConfBackup}" ]; then mv "${systemPfConfBackup}" "${systemPfConf}"; fi`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand, { preferSudo: false })
}

async function launchMacOSSetupApp({ requireFreshAuth = false } = {}) {
  const setupAppPath = (() => {
    try {
      return require.resolve('@navisai/setup-app')
    } catch {
      return path.join(__dirname, '..', '..', 'setup-app', 'index.js')
    }
  })()
  const consoleUid = await getConsoleUid()
  return new Promise((resolve, reject) => {
    const command = consoleUid ? 'launchctl' : process.execPath
    const args = consoleUid
      ? ['asuser', String(consoleUid), process.execPath, setupAppPath]
      : [setupAppPath]
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(requireFreshAuth ? { NAVIS_SETUP_REQUIRE_FRESH_AUTH: '1' } : {})
      }
    })

    child.on('exit', (code) => {
      if (code === 0) return resolve()
      reject(new Error('Navis Setup app exited with code ' + code))
    })
    child.on('error', (error) => reject(error))
  })
}

async function getConsoleUid() {
  if (platform() !== 'darwin') return null
  try {
    const { stdout } = await execAsync('stat -f %u /dev/console', { encoding: 'utf8' })
    const uid = stdout.trim()
    return uid ? Number.parseInt(uid, 10) : null
  } catch {
    return null
  }
}

async function openUrl(url) {
  const os = platform()
  try {
    if (os === 'darwin') {
      await execAsync(`open "${url}"`)
    } else if (os === 'linux') {
      await execAsync(`xdg-open "${url}"`)
    } else if (os === 'win32') {
      await execAsync(`start "" "${url}"`, { shell: 'cmd.exe' })
    }
  } catch (error) {
    console.log('⚠️  Unable to open browser automatically:', error.message)
  }
}

async function hasRecentLogOutput(paths, sinceMs) {
  const checks = await Promise.all(
    paths.map(async (logPath) => {
      try {
        const stat = await fs.stat(logPath)
        return stat.mtimeMs >= sinceMs
      } catch {
        return false
      }
    })
  )
  return checks.some(Boolean)
}

export async function setupCommand(options = {}) {
  console.log('NavisAI Setup')
  console.log('=============\n')
  console.log(`Goal: clean LAN origin at ${CANONICAL_ORIGIN}\n`)
  console.log('This command will enable (one-time, user-approved):')
  console.log('- Navis Bridge (443 -> 47621)')
  console.log('- mDNS/Bonjour for navis.local on LAN')
  console.log('- TLS certificates and guided mobile trust\n')

  const { skipUI = false, autoConfirm = false } = options
  if (options.freshAuth) {
    process.env.NAVIS_SETUP_REQUIRE_FRESH_AUTH = '1'
    console.log('🔐 Fresh admin authorization required for this setup run.')
  }

  const os = platform()
  if (os === 'darwin' && !skipUI) {
    console.log('\nOpening the Navis macOS Setup app...')
    try {
      const preflightOk = await runPreflightGate('setup app', { requireOclpAck: false })
      if (!preflightOk) {
        process.exit(1)
      }
      await launchMacOSSetupApp({ requireFreshAuth: Boolean(options.freshAuth) })
      const bridgePlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
      const bridgeExists = await fs.access(bridgePlist).then(() => true).catch(() => false)
      const launchd = await checkLaunchdService('com.navisai.bridge')

      const launchdRunning = launchd.state === 'running' || Boolean(launchd.pid)
      const launchdStateUnknown = launchd.loaded && !launchd.state && !launchd.pid && !launchd.lastExitCode

      if (bridgeExists && launchd.loaded && (launchdRunning || launchdStateUnknown)) {
        console.log('\n✅ Navis macOS Setup completed (bridge installed + running).')
        if (launchdStateUnknown) {
          console.log('   launchd state unavailable; assuming active based on installed service.')
        }
        console.log(`🌐 Access at: ${CANONICAL_ORIGIN}`)
        console.log(`📱 Onboarding: ${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
        return
      }

      console.log('\n⚠️  Setup app completed but bridge is not active.')
      console.log(`   Plist installed: ${bridgeExists ? 'yes' : 'no'} (${bridgePlist})`)
      if (launchd.loaded) {
        console.log(`   launchd state: ${launchd.state ?? 'unknown'}`)
        if (launchd.lastExitCode) console.log(`   last exit code: ${launchd.lastExitCode}`)
      } else {
        console.log('   launchd: not loaded')
      }
      console.log('\nNext steps:')
      console.log(' - Run: ./navisai setup --skip-ui  (CLI installer + explicit admin prompt)')
      console.log(' - Then: sudo launchctl kickstart -k system/com.navisai.bridge')
      console.log(' - Recheck: ./navisai doctor')
      console.log('\nRefs: navisai-45k')
      process.exit(1)
    } catch (error) {
      console.error('\n❌ Setup app failed:', error.message)
      process.exit(1)
    }
  }

  if (!autoConfirm && !(await confirm('Continue with setup?'))) {
    console.log('Canceled.')
    return
  }

  const snapshotOk = await runSnapshotGate('setup')
  if (!snapshotOk) {
    process.exit(1)
  }

  console.log('\nInstalling the Navis Bridge (requires an OS admin prompt)...')
  const bridgeResult = os === 'darwin' ? await installMacOSBridge() : await installBridge(os)

  if (bridgeResult?.launchctlSucceeded) {
    console.log('✅ Bridge installed and started via launchd: https://navis.local will use port 443 (forwarded to the daemon).')
  } else if (bridgeResult?.manualStartRequired) {
    console.log('⚠️  Bridge installed but launchd service failed to start.')
    console.log('📋 To start the bridge manually, run:')
    console.log('   sudo node apps/daemon/src/bridge.js start --setup-approved')
    console.log('💡 The bridge files are installed and ready.')
  } else {
    console.log('✅ Bridge installation completed.')
  }

  console.log('\nNext:')
  console.log('- Start Navis: navisai up')
  console.log(`- Open onboarding: ${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
  if (bridgeResult?.manualStartRequired) {
    console.log('- If navis.local is not reachable, start the bridge manually as shown above')
  }

  const caStatus = await checkCaCertificate()
  if (!caStatus.exists) {
    console.log('\n⚠️  TLS CA certificate missing.')
    console.log('   Start Navis with `navisai up` to generate the CA, then re-run setup to confirm trust.')
    process.exit(1)
  }

  if (platform() === 'darwin' && caStatus.trustSettingsOk === false) {
    console.log('\n⚠️  TLS CA certificate is not trusted in macOS Keychain.')
    console.log('   Re-run setup without --skip-ui to install trust, or trust the CA in Keychain Access.')
    process.exit(1)
  }
}

export async function resetCommand() {
  console.log('NavisAI Reset')
  console.log('=============\n')
  console.log('This will remove the OS bridge service, stop binding port 443, and remove trusted navis.local certificates.\n')

  if (!(await confirm('Remove Navis Bridge, remove trusted navis.local certificate, and reset setup?'))) {
    console.log('Canceled.')
    return
  }

  if (platform() !== 'darwin') {
    const snapshotOk = await runSnapshotGate('reset')
    if (!snapshotOk) {
      process.exit(1)
    }
  }

  console.log('\nRemoving the Navis Bridge (requires admin privileges)...')
  await uninstallBridge({ removeTrustedCerts: true, userHome: homedir() })

  console.log('✅ Bridge removed.')
  console.log('\nStopping Navis daemon to halt mDNS advertising...')
  await downCommand()

  if (await confirm('Also remove TLS certificates from ~/.navis/certs?')) {
    const removed = await removeTlsMaterials()
    if (removed) {
      console.log('✅ TLS materials removed.')
    } else {
      console.log('⚠️  TLS materials removal failed; check permissions.')
    }
  } else {
    console.log('TLS materials left in place.')
  }
}

export async function upCommand(options = {}) {
  try {
    console.log('Starting Navis daemon...')

    if (options.foreground) {
      const daemonPath = resolveDaemonEntrypoint()
      const env = { ...process.env }
      if (options.port) {
        env.NAVIS_PORT = options.port
      }
      const daemon = spawn(process.execPath, [daemonPath], {
        stdio: 'inherit',
        env,
      })
      await new Promise((resolve) => {
        daemon.on('exit', () => resolve())
        daemon.on('error', () => resolve())
      })
      return
    }

    // Check if daemon is already running
    if (await isDaemonReachable()) {
      console.log('Navis daemon is already running (reachable at https://127.0.0.1:47621)')
      return
    }

    // Start daemon in background (published entrypoint or workspace fallback)
    const daemonPath = resolveDaemonEntrypoint()

    // Set up environment
    const env = { ...process.env }
    if (options.port) {
      env.NAVIS_PORT = options.port
    }

    // Start daemon with spawn (capture logs to ~/.navis/logs when possible)
    const logsDir = path.join(homedir(), '.navis', 'logs')
    const outLogPath = path.join(logsDir, 'daemon.out.log')
    const errLogPath = path.join(logsDir, 'daemon.err.log')
    const logStart = Date.now()

    let stdio = 'ignore'
    try {
      await fs.mkdir(logsDir, { recursive: true })
      const outFd = await fs.open(outLogPath, 'a')
      const errFd = await fs.open(errLogPath, 'a')
      stdio = ['ignore', outFd.fd, errFd.fd]
    } catch {
      // If we cannot write logs, keep the daemon detached and silent.
    }

    const daemon = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio,
      env,
    })

    let spawnExit = null

    // Handle errors
    daemon.on('error', (error) => {
      console.error('Failed to spawn daemon:', error.message)
      process.exit(1)
    })

    daemon.on('exit', (code, signal) => {
      spawnExit = { code, signal }
    })

    // Detach from parent process
    daemon.unref()

    const announceReady = async () => {
      console.log('✅ Navis daemon started successfully')
      try {
        const response = await fetchNavis(NAVIS_PATHS.status)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        console.log(`🌐 Access at: ${CANONICAL_ORIGIN}`)
        console.log(`📱 Onboarding: ${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
        if (options.open !== false) {
          await openUrl(`${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
        }
        return true
      } catch {
        console.log('\n⚠️  Daemon started but canonical origin is not reachable')
        console.log(`   Expected: ${CANONICAL_ORIGIN}`)
        console.log('   Run: navisai doctor')
        return false
      }
    }

    const ready = await waitForDaemonReady()
    if (ready) {
      await announceReady()
      return
    }

    if (spawnExit) {
      console.log(`❌ Daemon exited early (code: ${spawnExit.code ?? 'unknown'}, signal: ${spawnExit.signal ?? 'none'})`)
    } else {
      const daemonProcess = await findDaemonProcess()
      if (daemonProcess) {
        console.log('⏳ Daemon process detected; waiting for API to become ready...')
        const extendedReady = await waitForDaemonReady({ timeoutMs: 120000, intervalMs: 1000 })
        if (extendedReady) {
          await announceReady()
          return
        }
        console.log('⚠️  Daemon process detected but API is not responding')
        console.log('   PID:', daemonProcess.pid)
        console.log('   Command:', daemonProcess.cmd)
      } else {
        console.log('❌ Failed to start daemon')
      }
    }
    if (existsSync(outLogPath) || existsSync(errLogPath)) {
      console.log(`   Logs: ${outLogPath}`)
      console.log(`         ${errLogPath}`)
      const updated = await hasRecentLogOutput([outLogPath, errLogPath], logStart)
      if (!updated) {
        console.log('   No new daemon log output captured during this start attempt.')
      }
    }

    const bindProbe = await probeLoopbackBind(options.port ?? 47621)
    if (!bindProbe.ok) {
      console.log(`   Loopback bind check failed for 127.0.0.1:${options.port ?? 47621}`)
      console.log(`   Reason: ${bindProbe.error?.message ?? 'unknown error'}`)
      if (bindProbe.error?.code === 'EADDRINUSE') {
        console.log('   Another process is already using this port. Stop it or pass --port to navisai up.')
      }
      if (bindProbe.error?.code === 'EPERM') {
        console.log('   macOS denied binding this port. Check local security tools or policies blocking node from listening on 127.0.0.1.')
      }
    }
  } catch (error) {
    console.error('Failed to start daemon:', error.message)
    process.exit(1)
  }
}

export async function downCommand() {
  try {
    console.log('Stopping Navis daemon...')

    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('Navis daemon is not running')
      return
    }

    // Graceful shutdown
    process.kill(daemonProcess.pid, 'SIGTERM')

    // Give it a moment to shut down
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Check if it's still running
    const stillRunning = await findDaemonProcess()
    if (stillRunning) {
      console.log('Force killing daemon...')
      process.kill(daemonProcess.pid, 'SIGKILL')
    }

    console.log('✅ Navis daemon stopped')
  } catch (error) {
    console.error('Failed to stop daemon:', error.message)
    process.exit(1)
  }
}

export async function statusCommand() {
  try {
    const daemonProcess = await findDaemonProcess()
    const reachable = await isDaemonReachable()

    if (daemonProcess || reachable) {
      console.log('✅ Navis daemon is running')
      if (daemonProcess) {
        console.log('   PID:', daemonProcess.pid)
        console.log('   Command:', daemonProcess.cmd)
      } else {
        console.log('   PID: unknown (process inspection unavailable)')
      }

      // Try to get status from API
      try {
        const response = await fetchNavis(NAVIS_PATHS.status).catch(() => fetchDaemonDirect(NAVIS_PATHS.status))
        if (response.ok) {
          const status = await response.json()
          console.log('\nDaemon Status:')
          console.log('  Version:', status.version)
          console.log('  Database:', status.database ? '✅ Connected' : '❌ Disconnected')
          console.log('  Uptime:', new Date(status.timestamp).toLocaleString())
        }
      } catch {
        console.log('\n⚠️  Daemon appears to be running but API is not responding')
      }
    } else {
      console.log('❌ Navis daemon is not running')
      process.exit(1)
    }
  } catch (error) {
    console.error('Failed to check daemon status:', error.message)
    process.exit(1)
  }
}

async function checkLaunchdService(label) {
  if (platform() !== 'darwin') return { supported: false }

  try {
    const { stdout } = await execAsync(`launchctl print system/${label} 2>/dev/null || true`, { encoding: 'utf8' })
    const trimmed = stdout.trim()
    if (!trimmed) return { supported: true, loaded: false }
    if (/bad request/i.test(trimmed) || /could not find service/i.test(trimmed)) {
      return { supported: true, loaded: false }
    }
    let state = trimmed.match(/\\bstate = (\\w+)/)?.[1] ?? null
    let pid = trimmed.match(/\\bpid = (\\d+)/)?.[1] ?? null
    const lastExitCode = trimmed.match(/\\blast exit code = (\\d+)/)?.[1] ?? null
    if (!state && trimmed.includes('state = running')) state = 'running'
    const mayBePermissionLimited = !trimmed.includes('state =') && !trimmed.includes('pid =')

    if (!pid) {
      try {
        const { stdout: listOutput } = await execAsync('launchctl list 2>/dev/null || true', { encoding: 'utf8' })
        const line = listOutput.split('\\n').find((row) => row.trim().endsWith(label))
        if (line) {
          const [listPid] = line.trim().split(/\\s+/)
          if (listPid && listPid !== '-') pid = listPid
        }
      } catch {
        // Ignore fallback errors.
      }
    }

    return { supported: true, loaded: true, state, pid, lastExitCode, mayBePermissionLimited }
  } catch (error) {
    return { supported: true, loaded: null, error: error.message }
  }
}

async function readPfProxyTargets() {
  if (platform() !== 'darwin') return { success: false, error: 'pfctl not supported' }
  try {
    const { stdout } = await execWithTimeout('sudo -n pfctl -a navisai/proxy -s nat 2>/dev/null || true')
    const targets = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('rdr'))
      .map((line) => line.match(/\bto\s+(\d+\.\d+\.\d+\.\d+)/)?.[1])
      .filter(Boolean)
    return { success: true, targets: [...new Set(targets)] }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function readAliasIps() {
  if (platform() !== 'darwin') return { success: false, error: 'ifconfig not supported' }
  try {
    const { stdout } = await execWithTimeout('ifconfig -a 2>/dev/null || true')
    const aliases = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('inet ') && line.includes(' netmask '))
      .map((line) => line.split(/\s+/)[1])
      .filter((ip) => ip && ip !== '127.0.0.1')
    return { success: true, aliases: [...new Set(aliases)] }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function checkSudoAvailable() {
  try {
    await execWithTimeout('sudo -n -v 2>/dev/null', { timeoutMs: 3000 })
    return true
  } catch {
    return false
  }
}

export async function doctorCommand() {
  console.log('Running Navis diagnostics...\n')

  let allGood = true
  const os = platform()
  const daemonProcess = await findDaemonProcess().catch(() => null)

  // Check Node.js version
  const nodeVersion = process.version
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])
  if (majorVersion >= 18) {
    console.log('✅ Node.js version:', nodeVersion)
  } else {
    console.log('❌ Node.js version too old:', nodeVersion, '(requires 18+)')
    allGood = false
  }

  // Check if daemon entrypoint can be resolved and is valid
  const daemonPath = resolveDaemonEntrypoint()
  try {
    await fs.access(daemonPath)
    console.log('✅ Daemon binary found:', daemonPath)

    // Check daemon syntax for both entrypoint and daemon.js
    const syntaxChecks = [
      { file: daemonPath, name: 'Daemon entrypoint' },
      { file: daemonPath.replace('/src/index.js', '/daemon.js'), name: 'Daemon class' }
    ]

    for (const check of syntaxChecks) {
      try {
        await execWithTimeout(`node -c "${check.file}" 2>&1`, { timeoutMs: 15000 })
        console.log(`✅ ${check.name} syntax is valid`)
      } catch (error) {
        console.log(`❌ ${check.name} has syntax errors:`)
        error.stdout.split('\n').filter(line => line.trim()).forEach(line => {
          console.log(`   ${line}`)
        })
        allGood = false
      }
    }
  } catch {
    console.log('❌ Daemon binary not found at:', daemonPath)
    allGood = false
  }

  // Check canonical origin reachability (best-effort)
  try {
    const response = await fetchNavis('/status')
    if (response.ok) {
      console.log(`✅ Reachable: ${CANONICAL_ORIGIN}`)
    } else {
      console.log(`⚠️  Not reachable at ${CANONICAL_ORIGIN} (HTTP ${response.status})`)
      allGood = false
    }
  } catch (error) {
    console.log(`⚠️  Not reachable at ${CANONICAL_ORIGIN}`)
    console.log(`   ${error.message}`)
    allGood = false
  }

  console.log('\n🛡️  Safety Gates:')
  const preflight = await runPreflightChecks()
  if (preflight.ok) {
    console.log('✅ Preflight: mDNS/DNS checks passed')
    if (preflight.checks.some((check) => check.name === 'OCLP detected' && check.detected)) {
      console.log('⚠️  OCLP detected: stricter safeguards apply')
    }
    preflight.checks
      .filter((check) => check.warning)
      .forEach((check) => {
        console.log(`⚠️  ${check.name}: ${check.warning}`)
      })
  } else {
    console.log('❌ Preflight: checks failed')
    preflight.checks.forEach((check) => {
      const status = check.ok ? 'ok' : 'fail'
      const detail = check.error || check.warning
      console.log(`   - ${check.name}: ${status}${detail ? ` (${detail})` : ''}`)
    })
    console.log('   Resolve system DNS/mDNS health issues before running setup.')
    const dnsSdFailure = preflight.checks.find(
      (check) => check.name === 'dns-sd query' && !check.ok
    )
    if (dnsSdFailure?.error) {
      if (dnsSdFailure.error.includes('Service Not Running') || dnsSdFailure.error.includes('Alarm clock')) {
        console.log('   mDNSResponder appears unavailable; run non-mutative diagnostics first:')
        console.log('   - dns-sd -Q _services._dns-sd._udp local')
        console.log('   - dns-sd -B _services._dns-sd._udp local')
        console.log('   - dscacheutil -q host -a name apple.com')
        console.log('   - dig @224.0.0.251 -p 5353 _services._dns-sd._udp.local')
        console.log('   Mutative recovery steps require a fresh snapshot + explicit opt-in:')
        console.log('   - sudo launchctl kickstart -k system/com.apple.mDNSResponder')
        console.log('   - sudo launchctl kickstart -k system/com.apple.mDNSResponderHelper')
        console.log('   - sudo killall -INFO mDNSResponder (enables extra logging)')
        console.log('   - dns-sd -R $(hostname) .local _device-info._tcp local 0')
        const mdnsState = await checkLaunchdService('com.apple.mDNSResponder.reloaded')
        const helperState = await checkLaunchdService('com.apple.mDNSResponderHelper.reloaded')
        if (mdnsState.loaded || helperState.loaded) {
          console.log('   Launchd state:')
          if (mdnsState.loaded) {
            console.log(`   - mDNSResponder.reloaded: state=${mdnsState.state ?? 'unknown'} pid=${mdnsState.pid ?? 'unknown'}`)
          }
          if (helperState.loaded) {
            console.log(`   - mDNSResponderHelper.reloaded: state=${helperState.state ?? 'unknown'} pid=${helperState.pid ?? 'unknown'}`)
          }
        }
      }
    }
    if (preflight.checks.some((check) => check.name === 'OCLP detected' && check.detected)) {
      console.log('   OCLP detected: enable extra safeguards and verify snapshot gating before proceeding.')
    }
    allGood = false
  }

  if (os === 'darwin') {
    const snapshotState = await readSnapshotState()
    if (!snapshotState?.id) {
      console.log('❌ Snapshot: no Navis snapshot recorded')
      console.log('   Run navisai setup to create a fresh snapshot before mutations.')
      allGood = false
    } else {
      const exists = await navisSnapshotExists(snapshotState)
      const fresh = isSnapshotFresh(snapshotState)
      if (exists && fresh) {
        console.log(`✅ Snapshot: ${snapshotState.id}`)
      } else if (!exists) {
        console.log(`❌ Snapshot: ${snapshotState.id} not found`)
        console.log('   Create a new snapshot and retry setup/bridge actions.')
        allGood = false
      } else {
        console.log(`⚠️  Snapshot: ${snapshotState.id} is stale`)
        console.log('   Create a new snapshot before mutative actions.')
        allGood = false
      }
    }

    const policyResult = await execWithTimeout(
      'defaults read /Library/Preferences/com.apple.mDNSResponder.plist NoMulticastAdvertisements 2>/dev/null || true'
    )
    const policyValue = policyResult.stdout?.trim()
    if (policyValue === '1' || policyValue?.toLowerCase() === 'true') {
      console.log('❌ mDNS policy: NoMulticastAdvertisements=true')
      console.log('   Clear the policy override before enabling LAN routing.')
      allGood = false
    } else {
      console.log('✅ mDNS policy: multicast advertisements enabled')
    }
  }

  const bindProbe = await probeLoopbackBind(47621)
  if (!bindProbe.ok) {
    console.log('⚠️  Loopback bind check failed for 127.0.0.1:47621')
    console.log(`   Reason: ${bindProbe.error?.message ?? 'unknown error'}`)
    allGood = false
  } else {
    console.log('✅ Loopback bind check succeeded for 127.0.0.1:47621')
  }

  if (!allGood && !daemonProcess) {
    console.log('\n⛔ Doctor stopped early due to failed safety gates.')
    console.log('   Resolve the safety failures above, then re-run: navisai doctor')
    return
  }

  // Comprehensive bridge diagnostics
  console.log('\n🌉 Bridge Service Diagnostics:')
  const bridgePlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const bridgeExists = await fs.access(bridgePlist).then(() => true).catch(() => false)
  let bridgeRunningProcess = null

  if (bridgeExists) {
    console.log('✅ Bridge service plist installed')

    const launchd = await checkLaunchdService('com.navisai.bridge')
    if (launchd.supported && launchd.loaded) {
      const isRunning = launchd.state === 'running' || Boolean(launchd.pid)
      if (isRunning) {
        if (launchd.pid) {
          console.log(`✅ Bridge service running via launchd (PID: ${launchd.pid})`)
        } else {
          console.log('✅ Bridge service running via launchd')
        }
      } else {
        console.log('⚠️  Bridge service installed but not confirmed running via launchd')
        if (launchd.state) console.log(`   state: ${launchd.state}`)
        if (launchd.lastExitCode) console.log(`   last exit code: ${launchd.lastExitCode}`)
        if (launchd.mayBePermissionLimited) {
          console.log('   ℹ️  launchctl output may be permission-limited; checking for a running bridge process...')
        } else {
          console.log('   Try: sudo launchctl kickstart -k system/com.navisai.bridge')
        }
      }
    } else if (launchd.supported && launchd.loaded === false) {
      console.log('⚠️  Bridge service not loaded via launchd')
      console.log('   Try: ./navisai setup')
      allGood = false
    }
  } else {
    console.log('⚠️  Bridge service not installed')
    console.log('   Run: ./navisai setup')
    allGood = false
  }

  // Check if bridge is running manually
  try {
    const { stdout: bridgeProcesses } = await execWithTimeout('ps aux | grep "bridge.js.*start" | grep -v grep || echo "none"', {
      encoding: 'utf8'
    })

    if (bridgeProcesses.trim() !== 'none') {
      console.log('✅ Bridge process running manually')
      const lines = bridgeProcesses.trim().split('\n')
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/)
        console.log(`   PID: ${parts[1]}, User: ${parts[0]}`)
      })
      bridgeRunningProcess = lines[0] ?? null
    }
  } catch (procError) {
    // Ignore process check errors
  }

  if (bridgeExists && !bridgeRunningProcess) {
    // If we can’t see the bridge process and launchd didn't confirm running, treat as failure.
    // (When launchd output is permission-limited, the process check above is our fallback.)
    const launchd = await checkLaunchdService('com.navisai.bridge')
    const isRunning = launchd.state === 'running' || Boolean(launchd.pid)
    if (!isRunning) {
      allGood = false
    }
  }

  // Enhanced mDNS diagnostics
  console.log('\n🌐 Network & mDNS Diagnostics:')
  const lanAddresses = getLanAddresses()
  console.log(`   LAN addresses: ${lanAddresses.length > 0 ? lanAddresses.join(', ') : 'none detected'}`)
  const preferredIPv4 = lanAddresses.find((addr) => addr.includes('.') && !addr.startsWith('127.'))
  if (preferredIPv4) {
    console.log(`   Phone test (IP): https://${preferredIPv4}${NAVIS_PATHS.status} (expected cert warning; bypass to confirm reachability)`)
  }

  // Check if bridge is advertising mDNS
  let bridgeMdnsActive = false
  if (daemonProcess) {
    try {
      const { stdout: bridgeLogs } = await execWithTimeout('tail -10 /var/log/navis-bridge.log 2>/dev/null | grep -i "mdns.*active\\|advertising" || echo "no mdns"', {
        encoding: 'utf8'
      })

      if (bridgeLogs.includes('active')) {
        console.log('✅ Bridge mDNS service active')
        bridgeMdnsActive = true
      }
    } catch (logError) {
      // Ignore if can't read logs
    }
  }

  const mdnsResult = await resolveNavisLocal()
  const mdnsIp = mdnsResult.success ? mdnsResult.address : null
  if (mdnsResult.success) {
    const matchesLan = lanAddresses.includes(mdnsResult.address)
    if (matchesLan) {
      console.log(`✅ mDNS: navis.local resolves to ${mdnsResult.address} (matches LAN)`)
    } else {
      console.log(`⚠️  mDNS: navis.local resolves to ${mdnsResult.address} but doesn't match LAN IPs`)
      if (lanAddresses.length > 0) {
        console.log(`   Expected: ${lanAddresses.join(', ')}`)
        allGood = false
      }
    }
  } else {
    console.log(`⚠️  mDNS lookup failed: ${mdnsResult.error}`)
    if (bridgeMdnsActive) {
      console.log('   💡 Bridge is advertising but DNS not resolving (check router/firewall)')
    }
    allGood = false
  }

  // Directly query mDNS to catch "router blocks multicast between clients" issues (Refs: navisai-jsh)
  const mdnsQuery = await queryMdnsARecord('navis.local', 6000)
  if (mdnsQuery.success) {
    console.log(`✅ mDNS query: navis.local A -> ${mdnsQuery.address}`)
  } else {
    console.log(`⚠️  mDNS query: ${mdnsQuery.error}`)
    console.log('   💡 If IP access works but navis.local does not on a phone, your LAN may block Bonjour/mDNS between clients.')
  }

  const mdnsQueryV6 = await queryMdnsAAAARecord('navis.local', 6000)
  if (mdnsQueryV6.success) {
    console.log(`✅ mDNS query: navis.local AAAA -> ${mdnsQueryV6.address}`)
  } else {
    console.log(`⚠️  mDNS AAAA query: ${mdnsQueryV6.error}`)
  }

  const navisService = await browseMdnsService('_navisai._tcp', 'local', 6000)
  if (navisService.success && navisService.found) {
    console.log('✅ mDNS service: _navisai._tcp advertised')
  } else if (navisService.success) {
    console.log('⚠️  mDNS service: _navisai._tcp not observed')
  } else {
    console.log(`⚠️  mDNS service browse failed: ${navisService.error}`)
  }

  const mdnsServiceType = '_navisai._tcp.local'
  const mdnsInstance = 'NavisAI._navisai._tcp.local'
  const ptrResult = await queryMdnsRecord(mdnsServiceType, 'PTR', 6000)
  if (ptrResult.success) {
    const target = parsePtrTarget(ptrResult.line)
    if (!target) {
      console.log(`⚠️  mDNS PTR: no record found for ${mdnsServiceType}`)
      allGood = false
    } else {
      console.log(`✅ mDNS PTR: ${mdnsServiceType} -> ${target}`)
    }
    const instanceName = target || mdnsInstance

    const srvResult = await queryMdnsRecord(instanceName, 'SRV', 6000)
    if (srvResult.success) {
      const srvRecord = parseSrvRecord(srvResult.line)
      if (srvRecord && srvRecord.port === 443) {
        console.log(`✅ mDNS SRV: ${instanceName} -> ${srvRecord.target}:443`)
        if (mdnsIp && srvRecord.target !== 'navis.local') {
          console.log(`⚠️  mDNS SRV target mismatch: expected navis.local, got ${srvRecord.target}`)
          allGood = false
        }
      } else {
        console.log(`⚠️  mDNS SRV: unexpected data (${srvResult.line})`)
      }
    } else {
      console.log(`⚠️  mDNS SRV: ${srvResult.error}`)
    }

    const txtResult = await queryMdnsRecord(instanceName, 'TXT', 6000)
    if (txtResult.success) {
      if (txtResult.line.includes('No Such Record')) {
        console.log(`⚠️  mDNS TXT: no record found for ${instanceName}`)
      } else {
      const txtLine = parseTxtPayload(txtResult.line)
      const hasTls = txtLine.includes('tls=1')
      const hasOrigin = txtLine.includes('origin=https://navis.local')
      const hasVersion = txtLine.includes('version=1')
      if (hasTls && hasOrigin && hasVersion) {
        console.log(`✅ mDNS TXT: ${instanceName} (tls=1, origin=https://navis.local)`)
      } else {
        console.log(`⚠️  mDNS TXT: unexpected data (${txtLine})`)
      }
      }
    } else {
      console.log(`⚠️  mDNS TXT: ${txtResult.error}`)
    }

    if (mdnsIp && instanceName) {
      const srvRecord = parseSrvRecord(srvResult.line)
      if (srvRecord && srvRecord.target === 'navis.local') {
        const srvA = await queryMdnsARecord(srvRecord.target)
        if (srvA.success && srvA.address !== mdnsIp) {
          console.log(`⚠️  mDNS mismatch: SRV target A ${srvA.address} != navis.local A ${mdnsIp}`)
          allGood = false
        } else if (srvA.success) {
          console.log(`✅ mDNS SRV target A matches navis.local A (${srvA.address})`)
        }
      }
    }
  } else {
    console.log(`⚠️  mDNS PTR: ${ptrResult.error}`)
  }

  if (os === 'darwin') {
    const mdnsIp = mdnsResult.success ? mdnsResult.address : null
    const pfTargets = await readPfProxyTargets()
    const aliasIps = await readAliasIps()

    if (pfTargets.success) {
      console.log(`✅ pf rdr targets: ${pfTargets.targets.length > 0 ? pfTargets.targets.join(', ') : 'none'}`)
    } else {
      console.log(`⚠️  pf rdr targets unavailable: ${pfTargets.error}`)
    }

    if (aliasIps.success) {
      console.log(`✅ Alias IPs detected: ${aliasIps.aliases.length > 0 ? aliasIps.aliases.join(', ') : 'none'}`)
    } else {
      console.log(`⚠️  Alias IPs unavailable: ${aliasIps.error}`)
    }

    if (mdnsIp && pfTargets.success && pfTargets.targets.length > 0) {
      const matchesPf = pfTargets.targets.includes(mdnsIp)
      if (matchesPf) {
        console.log(`✅ Alias consistency: mDNS A matches pf rdr target (${mdnsIp})`)
      } else {
        console.log(`⚠️  Alias consistency: mDNS A ${mdnsIp} does not match pf rdr targets`)
        allGood = false
      }
    }
  }

  // Test direct daemon connectivity
  try {
    const certPem = await fs.readFile(CA_CERT_PATH, 'utf8').catch(() => null)
    const dispatcher = new UndiciAgent({
      connect: certPem ? { ca: certPem } : { rejectUnauthorized: false },
    })
    const daemonResponse = await fetch('https://127.0.0.1:47621/status', {
      headers: { Host: 'navis.local' },
      dispatcher,
    })
    if (daemonResponse.ok) {
      console.log('✅ Daemon reachable directly with navis.local header')
    }
  } catch (daemonError) {
    console.log('⚠️  Daemon not reachable directly')
    allGood = false
  }

  const caStatus = await checkCaCertificate()
  const leafStatus = await checkLeafCertificate()
  const chainStatus = await checkTlsChainServed()

  if (caStatus.exists) {
    const now = new Date()
    const expiresInMs = caStatus.validTo - now
    const expiresInDays = Math.max(0, Math.ceil(expiresInMs / (1000 * 60 * 60 * 24)))
    const validityMsg = caStatus.isExpired ? ' (expired)' : ` (expires in ~${expiresInDays} day${expiresInDays === 1 ? '' : 's'})`
    console.log(
      `✅ TLS CA cert: ${caStatus.path} (valid from ${caStatus.validFrom.toISOString()} to ${caStatus.validTo.toISOString()})${validityMsg}`
    )
    if (!caStatus.isCa) {
      console.log('⚠️  TLS CA cert missing CA:TRUE basic constraints')
      allGood = false
    }
    if (caStatus.trustSettingsOk === false) {
      console.log('⚠️  TLS CA cert not trusted in OS trust settings')
      allGood = false
    } else if (caStatus.trustSettingsOk === null) {
      console.log('ℹ️  TLS CA trust settings check not supported on this OS')
    }
    if (caStatus.isExpired) {
      allGood = false
    }
  } else {
    console.log(`⚠️  TLS CA certificate missing or unreadable: ${caStatus.error}`)
    allGood = false
  }

  if (leafStatus.exists) {
    const now = new Date()
    const expiresInMs = leafStatus.validTo - now
    const expiresInDays = Math.max(0, Math.ceil(expiresInMs / (1000 * 60 * 60 * 24)))
    const validityMsg = leafStatus.isExpired ? ' (expired)' : ` (expires in ~${expiresInDays} day${expiresInDays === 1 ? '' : 's'})`
    console.log(
      `✅ TLS leaf cert: ${leafStatus.path} (valid from ${leafStatus.validFrom.toISOString()} to ${leafStatus.validTo.toISOString()})${validityMsg}`
    )
    if (!leafStatus.hasSan) {
      console.log('⚠️  TLS leaf missing DNS SAN navis.local')
      allGood = false
    }
    if (!leafStatus.hasEku) {
      console.log('⚠️  TLS leaf missing EKU serverAuth')
      allGood = false
    }
    if (leafStatus.issuerCN && caStatus.subjectCN && leafStatus.issuerCN !== caStatus.subjectCN) {
      console.log(`⚠️  TLS leaf issuer CN (${leafStatus.issuerCN}) does not match CA CN (${caStatus.subjectCN})`)
      allGood = false
    }
    if (leafStatus.isExpired) {
      allGood = false
    }
  } else {
    console.log(`⚠️  TLS leaf certificate missing or unreadable: ${leafStatus.error}`)
    allGood = false
  }

  if (chainStatus.ok) {
    console.log(`✅ TLS chain served (certs: ${chainStatus.certCount})`)
  } else if (chainStatus.error) {
    console.log(`⚠️  TLS chain check failed: ${chainStatus.error}`)
    allGood = false
  } else {
    console.log('⚠️  TLS chain not trusted with local CA')
    allGood = false
  }

  // Check daemon process status
  if (daemonProcess) {
    console.log(`✅ Daemon process running (PID: ${daemonProcess.pid})`)

    // Check daemon logs for errors
    const errLog = path.join(homedir(), '.navis', 'logs', 'daemon.err.log')
    try {
      const { stdout: recentErrors } = await execWithTimeout(
        `tail -5 "${errLog}" 2>/dev/null | grep -v "No ALTQ" || echo "no recent errors"`,
        { timeoutMs: 15000 }
      )
      if (recentErrors && !recentErrors.includes('no recent errors')) {
        console.log('⚠️  Recent daemon errors detected:')
        recentErrors.split('\n').filter(line => line.trim()).forEach(line => {
          console.log(`   ${line}`)
        })
        allGood = false
      }
    } catch (e) {
      // Ignore log check errors
    }
  } else {
    console.log('⚠️  Daemon process not running')
    console.log('   Try: navisai up')
    allGood = false
  }

  console.log('\n🧾 Bridge Logs:')
  const bridgeStdout = '/var/log/navis-bridge.log'
  const bridgeStderr = '/var/log/navis-bridge.err'
  try {
    const { stdout: bridgeErr } = await execWithTimeout(
      `tail -5 "${bridgeStderr}" 2>/dev/null | grep -v "No ALTQ" || echo "no recent errors"`,
      { timeoutMs: 15000 }
    )
    if (bridgeErr && !bridgeErr.includes('no recent errors')) {
      console.log('⚠️  Bridge stderr (recent):')
      bridgeErr.split('\n').filter(line => line.trim()).forEach(line => {
        console.log(`   ${line}`)
      })
      allGood = false
    } else {
      console.log('✅ Bridge stderr: no recent errors')
    }
  } catch {
    console.log('⚠️  Bridge stderr unavailable (need sudo?)')
  }

  try {
    const { stdout: bridgeOut } = await execWithTimeout(
      `tail -5 "${bridgeStdout}" 2>/dev/null || echo "no logs"`,
      { timeoutMs: 15000 }
    )
    if (bridgeOut && !bridgeOut.includes('no logs')) {
      console.log('✅ Bridge stdout (recent):')
      bridgeOut.split('\n').filter(line => line.trim()).forEach(line => {
        console.log(`   ${line}`)
      })
    } else {
      console.log('⚠️  Bridge stdout empty')
    }
  } catch {
    console.log('⚠️  Bridge stdout unavailable (need sudo?)')
  }

  // Check database dependencies
  console.log('\n📊 Database Dependencies:')
  try {
    const repoRoot = await findRepoRoot(process.cwd())
    if (!repoRoot) {
      console.log('ℹ️  Skipping native SQLite check (not running inside repo)')
    } else {
      try {
        require.resolve('better-sqlite3', { paths: [repoRoot] })
        try {
          require('better-sqlite3')
          console.log('✅ Native SQLite module loaded (better-sqlite3)')
        } catch (error) {
          console.log('⚠️  Native SQLite module present but failed to load (optional)')
          if (error?.message) {
            console.log(`   ${error.message.split('\n')[0]}`)
          }
        }
      } catch {
        console.log('⚠️  Native SQLite module not found (optional)')
        console.log('   Daemon will run without persistent storage')
      }
    }
  } catch (e) {
    console.log('⚠️  Could not check database dependencies')
  }

  // Check log directory
  const logDir = path.join(homedir(), '.navis', 'logs')
  try {
    await fs.access(logDir)
    console.log('✅ Log directory exists:', logDir)
  } catch {
    console.log('⚠️  Log directory not found, will be created')
  }

  // Check data directory
  const dataDir = path.join(homedir(), '.navis')
  try {
    await fs.access(dataDir)
    console.log('✅ Data directory exists:', dataDir)
  } catch {
    console.log('⚠️  Data directory not found, will be created')
  }

  const repoRoot = await findRepoRoot(process.cwd())
  if (repoRoot) {
    console.log('\n📁 Repo Checks (dev only):')
    try {
      // Check package.json files
      console.log('  📦 Package validation:')
      const packageJsons = [
        'package.json',
        'apps/daemon/package.json',
        'apps/cli/package.json',
        'apps/pwa/package.json'
      ]

      for (const pkgPath of packageJsons) {
        const fullPath = path.join(repoRoot, pkgPath)
        try {
          const content = await fs.readFile(fullPath, 'utf8')
          JSON.parse(content)
          console.log(`   ✅ ${pkgPath}`)
        } catch (error) {
          console.log(`   ❌ ${pkgPath}: ${error.message}`)
          allGood = false
        }
      }

      // Check for required documentation
      console.log('  📚 Documentation check:')
      const requiredDocs = [
        'docs/NETWORKING.md',
        'docs/SECURITY.md',
        'docs/SETUP.md',
        'docs/BEADS_WORKFLOW.md',
        'docs/IPC_TRANSPORT.md'
      ]

      for (const docPath of requiredDocs) {
        const fullPath = path.join(repoRoot, docPath)
        try {
          await fs.access(fullPath)
          const stats = await fs.stat(fullPath)
          if (stats.size > 100) {
            console.log(`   ✅ ${docPath}`)
          } else {
            console.log(`   ⚠️  ${docPath} (too small)`)
          }
        } catch {
          console.log(`   ❌ ${docPath}: missing`)
          allGood = false
        }
      }

      // Run architecture verification if available
      console.log('  🏗️  Architecture verification:')
      try {
        const { stdout: verifyOutput } = await execWithTimeout('pnpm verify:arch 2>&1', { cwd: repoRoot, timeoutMs: 15000 })
        if (verifyOutput.includes('✅')) {
          console.log('   ✅ Architecture compliance verified')
        } else {
          console.log('   ⚠️  Architecture issues detected')
          verifyOutput.split('\n').forEach(line => {
            if (line.trim()) console.log(`      ${line}`)
          })
        }
      } catch (error) {
        console.log('   ⚠️  Could not run architecture verification')
        if (error.stdout) {
          error.stdout.split('\n').forEach(line => {
            if (line.trim() && !line.includes('Command failed')) {
              console.log(`      ${line}`)
            }
          })
        }
      }
    } catch (error) {
      console.log('   ⚠️  Repo checks failed:', error.message)
    }
  } else {
    console.log('\n📁 Repo Checks (dev only): skipped (not running inside repo)')
  }

  console.log('\n🌐 Network Configuration:')

  // Bridge status and packet forwarding tests (Refs: navisai-lss)
  try {
    if (os === 'darwin') {
      // Check launchd service
      await execAsync('launchctl print system/com.navisai.bridge >/dev/null 2>&1')
      console.log('✅ Bridge: launchd service installed (com.navisai.bridge)')

      // Test packet forwarding rules
      const sudoAvailable = await checkSudoAvailable()
      if (!sudoAvailable) {
        console.log('⚠️  Packet forwarding: Cannot check pfctl rules without sudo')
        console.log('   ℹ️  Bridge appears active; pfctl verification needs sudo to confirm rules.')
        console.log('   Try: sudo navisai doctor')
      } else {
        try {
          // Check NAT rules in correct anchor
          const { stdout: natRules } = await execWithTimeout('sudo -n pfctl -a navisai/proxy -s nat 2>/dev/null')
          if (natRules.includes('rdr') && natRules.includes('443') && natRules.includes('127.0.0.1')) {
            console.log('✅ Packet forwarding: NAT rules configured for 443 → 8443 (navisai/proxy)')
          } else {
            console.log('⚠️  Packet forwarding: NAT rules not found in navisai/proxy anchor')
            console.log('   Run: navisai setup to install packet forwarding')
            allGood = false
          }

          // Check filter rules
          const { stdout: filterRules } = await execWithTimeout('sudo -n pfctl -a navisai/filter -s rules 2>/dev/null')
          if (filterRules.includes('keep state')) {
            console.log('✅ Packet forwarding: Filter rules configured (navisai/filter)')
          } else {
            console.log('⚠️  Packet forwarding: Filter rules not found in navisai/filter anchor')
            allGood = false
          }

          // Check if pf is enabled
          const { stdout: pfEnabled } = await execWithTimeout('sudo -n pfctl -s info 2>/dev/null')
          if (pfEnabled.includes('Status: Enabled')) {
            console.log('✅ Packet filtering: pf is enabled')
          } else {
            console.log('⚠️  Packet filtering: pf is not enabled')
            allGood = false
          }
        } catch (error) {
          console.log('⚠️  Packet forwarding: Cannot check pfctl rules without sudo')
          console.log('   Try: sudo navisai doctor')
        }
      }

      // Test if proxy is listening
      if (!sudoAvailable) {
        console.log('⚠️  Transparent proxy: Cannot check without sudo')
      } else {
        try {
          const { stdout } = await execWithTimeout('sudo -n lsof -i :8443 -sTCP:LISTEN -n -P 2>/dev/null')
          if (stdout.includes('LISTEN')) {
            console.log('✅ Transparent proxy: Listening on port 8443')
          } else {
            console.log('⚠️  Transparent proxy: Not listening on port 8443')
            allGood = false
          }
        } catch (error) {
          console.log('⚠️  Transparent proxy: Cannot check without sudo')
        }
      }

    } else if (os === 'linux') {
      const { stdout } = await execAsync('systemctl is-active navisai-bridge.service || true')
      const status = stdout.trim()
      if (status === 'active') {
        console.log('✅ Bridge: systemd service active (navisai-bridge.service)')

        // Test iptables rules
        try {
          const { stdout: rules } = await execAsync('sudo iptables -t nat -L PREROUTING -n 2>/dev/null | grep navis || echo "no rules"')
          if (rules.includes('443') && rules.includes('8443')) {
            console.log('✅ Packet forwarding: iptables NAT rules configured')
          } else {
            console.log('⚠️  Packet forwarding: iptables NAT rules not found')
            allGood = false
          }
        } catch (error) {
          console.log('⚠️  Packet forwarding: Cannot check iptables rules (may need sudo)')
          allGood = false
        }
      } else {
        console.log(`⚠️  Bridge: systemd service not active (${status || 'unknown'})`)
        allGood = false
      }
    } else if (os === 'win32') {
      try {
        const { stdout } = await execAsync('sc query navisai-bridge')
        if (stdout.includes('RUNNING')) {
          console.log('✅ Bridge: Windows service active (navisai-bridge)')

          // Check netsh port forwarding
          try {
            const { stdout: netsh } = await execAsync('netsh interface portproxy show all | findstr "443"')
            if (netsh.includes('navisai')) {
              console.log('✅ Packet forwarding: netsh portproxy rules configured')
            } else {
              console.log('⚠️  Packet forwarding: netsh portproxy rules not found')
              allGood = false
            }
          } catch (error) {
            console.log('⚠️  Packet forwarding: Cannot check netsh rules')
            allGood = false
          }
        } else {
          console.log('⚠️  Bridge: Windows service installed but not running')
          allGood = false
        }
      } catch {
        console.log('⚠️  Bridge: Windows service not installed (run navisai setup)')
        allGood = false
      }
    }
  } catch {
    console.log('⚠️  Bridge: unable to determine status')
    allGood = false
  }

  if (allGood) {
    console.log('\n🎉 All systems ready!')
  } else {
    console.log('\n⚠️  Some issues found. See above for details.')
    process.exit(1)
  }
}

export async function cleanupCommand(options = {}) {
  const bridgeOnly = Boolean(options.bridgeOnly) || !options.all
  const destructiveAll = Boolean(options.all)

  console.log('NavisAI Cleanup')
  console.log('==============\n')

  if (bridgeOnly && destructiveAll) {
    console.error('Choose only one: --bridge-only or --all')
    process.exit(1)
  }

  if (bridgeOnly) {
    console.log('Mode: bridge-only (non-destructive)')
    console.log('- Removes OS bridge service (443 entrypoint)')
    console.log('- Removes trusted navis.local certificates (with notice)')
    console.log('- Optionally removes TLS certs from ~/.navis/certs')
    console.log('- Keeps local state (DB, paired devices, preferences)\n')
    await resetCommand()
    return
  }

  console.log('Mode: ALL (destructive factory reset)')
  console.log('- Removes OS bridge service (443 entrypoint)')
  console.log('- Removes trusted navis.local certificates (with notice)')
  console.log('- Optionally removes TLS certs from ~/.navis/certs')
  console.log('- Deletes local state under ~/.navis (including db.sqlite)\n')

  const daemonProcess = await findDaemonProcess()
  if (daemonProcess) {
    console.log('Stopping Navis daemon before deleting local state...')
    await downCommand()
  }

  const phrase = 'DELETE ~/.navis'
  const ok = await confirmTyped(
    `This will permanently delete local Navis state at ${path.join(homedir(), '.navis')} and remove trusted navis.local certificates.\nThis cannot be undone.`,
    phrase
  )
  if (!ok) {
    console.log('Canceled.')
    return
  }

  console.log('\nRemoving the Navis Bridge (requires admin privileges)...')
  try {
    await uninstallBridge({ removeTrustedCerts: true, userHome: homedir() })
    console.log('✅ Bridge removed.')
  } catch (error) {
    console.error('❌ Bridge removal failed:', error.message)
    console.error('   Ensure the macOS admin approval sheet is visible and retry.')
    process.exit(1)
  }

  const removeCerts = await confirm('Also remove TLS certificates from ~/.navis/certs?')
  if (removeCerts) {
    await removeTlsMaterials()
  }

  console.log('\nDeleting ~/.navis local state...')
  await fs.rm(path.join(homedir(), '.navis'), { recursive: true, force: true })
  console.log('✅ Local state removed.')
}

export async function logsCommand(options = {}) {
  try {
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('❌ Daemon is not running')
      return
    }

    console.log('📋 Following daemon logs (Ctrl+C to stop)...\n')

    // Build URL with query parameters
    const url = new URL(`${CANONICAL_ORIGIN}/logs/stream`)
    if (options.level) {
      url.searchParams.set('level', options.level)
    }
    if (options.follow !== false) {
      url.searchParams.set('follow', 'true')
    }

    // Use native HTTPS to connect to Server-Sent Events endpoint
    const https = await import('node:https')
    const http = await import('node:http')

    const client = url.protocol === 'https:' ? https : http

    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      // Accept self-signed certificates for local development
      rejectUnauthorized: false
    }

    console.log('✅ Connecting to daemon log stream...\n')

    const req = client.request(requestOptions, (res) => {
      if (res.statusCode !== 200) {
        console.error(`❌ Server responded with ${res.statusCode}`)
        process.exit(1)
      }

      let buffer = ''

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6))

              if (data.type === 'connected') {
                console.log('📡 Streaming logs...\n')
                continue
              }

              if (data.type === 'log') {
                formatAndPrintLog(data, options)
              } else if (data.level && data.message) {
                // Handle direct log entries
                formatAndPrintLog(data, options)
              }
            } catch (error) {
              // Ignore parsing errors for heartbeat messages
              if (!line.startsWith(':')) {
                console.log('Raw:', line)
              }
            }
          }
        }
      })

      res.on('end', () => {
        if (options.follow !== false) {
          console.log('\n📡 Log stream ended')
        }
      })
    })

    req.on('error', (error) => {
      console.error('❌ Connection to daemon failed:', error.message)
      process.exit(1)
    })

    req.end()

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('\n\n👋 Stopping log stream...')
      req.destroy()
      process.exit(0)
    })

    // Keep the process alive if following
    if (options.follow !== false) {
      await new Promise(() => { })
    }

  } catch (error) {
    console.error('❌ Failed to fetch logs:', error.message)

    // Fallback to checking if daemon is running
    if (error.message.includes('Cannot resolve module')) {
      console.log('\n💡 Tip: Make sure you have run `pnpm install` to install dependencies')
    }
  }
}

function formatAndPrintLog(log, options) {
  const { level, message, timestamp, source } = log
  const time = options.timestamp
    ? new Date(timestamp).toLocaleTimeString()
    : ''

  let coloredLevel = level
  let coloredMessage = message

  // Add colors if supported
  if (process.stdout.isTTY) {
    const colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[37m'  // White
    }
    const reset = '\x1b[0m'

    coloredLevel = `${colors[level] || ''}${level}${reset}`

    if (level === 'ERROR') {
      coloredMessage = `\x1b[31m${message}\x1b[0m`
    } else if (level === 'WARN') {
      coloredMessage = `\x1b[33m${message}\x1b[0m`
    }
  }

  // Format output
  const parts = []
  if (time) parts.push(`[${time}]`)
  parts.push(`${coloredLevel}:`)
  if (source && options.verbose) parts.push(`[${source}]`)
  parts.push(coloredMessage)

  console.log(parts.join(' '))
}

export async function scanCommand(path, options = {}) {
  try {
    console.log('🔍 Scanning for projects...')

    const scanPath = path || homedir()
    console.log('Scanning path:', scanPath)

    // First check if daemon is running
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('❌ Navis daemon is not running. Please run `navisai up` first.')
      process.exit(1)
    }

    // Call daemon API to scan
    const response = await fetchNavis(NAVIS_PATHS.discovery.scan, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: scanPath,
        options: {
          depth: options.depth || 3,
          concurrency: options.concurrency || 5,
          ...options
        }
      })
    })

    if (!response.ok) {
      const error = await response.json()
      console.log('❌ Scan failed:', error.error || 'Unknown error')
      if (error.details) console.log('Details:', error.details)
      process.exit(1)
    }

    const result = await response.json()

    console.log(`\n✅ Scan completed! Found ${result.count} projects in "${result.scannedPath}"\n`)

      // Display discovered projects
      if (result.projects && result.projects.length > 0) {
        console.log('Discovered Projects:')
        console.log('===================\n')

        result.projects.forEach((project, index) => {
          const confidence = project?.detection?.confidence
          console.log(`${index + 1}. ${project.name}`)
          console.log(`   Path: ${project.path}`)
          console.log(`   Type: ${project.classification?.primary?.name || 'Unknown'}`)
          if (project.detection?.primary?.framework) {
            console.log(`   Framework: ${project.detection.primary.framework}`)
          }
          if (project.classification?.language) {
            console.log(`   Language: ${project.classification.language}`)
          }
          console.log(`   Confidence: ${typeof confidence === 'number' ? (confidence * 100).toFixed(1) : 'N/A'}%`)
          console.log(`   Detected: ${new Date(project.detectedAt).toLocaleString()}`)
          console.log('')
        })
      } else {
      console.log('No projects found. Try scanning a different directory.')
    }

    return result
  } catch (error) {
    console.error('❌ Scan failed:', error.message)
    process.exit(1)
  }
}

export async function indexCommand(paths, options = {}) {
  try {
    if (!paths || paths.length === 0) {
      console.log('❌ No paths provided')
      console.log('Usage: navisai index <path1> <path2> ...')
      process.exit(1)
    }

    console.log(`📁 Indexing ${paths.length} path(s)...`)

    // Check if daemon is running
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('❌ Navis daemon is not running. Please run `navisai up` first.')
      process.exit(1)
    }

    // Call daemon API to index
    const response = await fetchNavis(NAVIS_PATHS.discovery.index, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paths })
    })

    if (!response.ok) {
      const error = await response.json()
      console.log('❌ Index failed:', error.error || 'Unknown error')
      if (error.details) console.log('Details:', error.details)
      process.exit(1)
    }

    const result = await response.json()

    console.log(`\n✅ Index completed! ${result.discovered}/${result.total} paths contained projects\n`)

    // Display results
    result.results.forEach((item, index) => {
      if (item.success && item.project.detected) {
        const p = item.project
        console.log(`✅ ${item.path}`)
        console.log(`   Name: ${p.name}`)
        console.log(`   Type: ${p.classification?.primary?.name || 'Unknown'}\n`)
      } else {
        console.log(`❌ ${item.path}`)
        if (item.error) console.log(`   Error: ${item.error}\n`)
      }
    })

    return result
  } catch (error) {
    console.error('❌ Index failed:', error.message)
    process.exit(1)
  }
}

export async function pairCommand(options = {}) {
  try {
    console.log('🔗 Initiating Navis device pairing...\n')

    // Check if daemon is running
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('❌ Navis daemon is not running. Please run `navisai up` first.')
      process.exit(1)
    }

    // If re-pairing is requested, revoke existing devices first
    if (options.rePair) {
      console.log('🔄 Revoking existing pairings...')
      try {
        const devicesResponse = await fetchNavis(NAVIS_PATHS.devices.list)
        if (devicesResponse.ok) {
          const { devices } = await devicesResponse.json()
          for (const device of devices) {
            if (!device.isRevoked) {
              await fetchNavis(NAVIS_PATHS.devices.revoke(device.id), {
                method: 'POST'
              })
              console.log(`   Revoked: ${device.name}`)
            }
          }
        }
      } catch (error) {
        console.log('⚠️  Could not revoke existing devices:', error.message)
      }
    }

    // Get pairing information from daemon
    const response = await fetchNavis(NAVIS_PATHS.pairing.qr)
    if (!response.ok) {
      console.log('❌ Failed to get pairing information')
      process.exit(1)
    }

    const { pairingData } = await response.json()

    console.log('✅ Pairing session started\n')
    console.log('Pairing Options:')
    console.log('================\n')
    console.log('1. Scan QR Code:')
    console.log('   - Open your phone camera')
    console.log(`   - Scan the QR code at: ${CANONICAL_ORIGIN}/pairing\n`)
    console.log('\n2. Pairing Code:')
    console.log('   - Open Navis app on your phone')
    console.log('   - Go to Settings > Pair New Device')
    console.log('   - Enter pairing code:', pairingData.id.toUpperCase(), '\n')
    console.log('3. Direct URL:')
    console.log(`   - On your phone, visit: ${CANONICAL_ORIGIN}`)
    console.log('   - Accept the security certificate')
    console.log('   - Follow the on-screen pairing instructions\n')

    console.log(`🌐 Pairing URL: ${CANONICAL_ORIGIN}/pairing`)
    console.log('📱 Pairing Code:', pairingData.id.toUpperCase())
    const pairingUrlWithToken = `${CANONICAL_ORIGIN}/pairing?token=${encodeURIComponent(pairingData.id)}`
    console.log(`🌐 Shortcut URL: ${pairingUrlWithToken}`)
    await openUrl(pairingUrlWithToken)
    console.log('\nWaiting for device to pair... (Press Ctrl+C to cancel)')

    // In a real implementation, this would monitor for pairing events
    // For now, just show instructions
    console.log('\nNote: Real-time pairing status monitoring not yet implemented')
    console.log(`      Check ${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome} for pairing status`)

  } catch (error) {
    console.error('❌ Pairing failed:', error.message)
    process.exit(1)
  }
}

// Helper function to find daemon process
async function findDaemonProcess() {
  try {
    const platform = process.platform
    let cmd

    if (platform === 'darwin' || platform === 'linux') {
      cmd = 'ps ax | grep -E \"node.*(apps/daemon/src/index.js|@navisai/daemon/src/index.js|navisai-daemon)\" | grep -v grep'
    } else if (platform === 'win32') {
      cmd = 'tasklist /fi "imagename eq node.exe" /fo csv | findstr index.js'
    } else {
      console.log('Unsupported platform for process detection')
      return null
    }

    const { stdout } = await execAsync(cmd)
    if (stdout.trim()) {
      const lines = stdout.trim().split('\n')
      const firstLine = lines[0]

      if (platform === 'darwin' || platform === 'linux') {
        const parts = firstLine.trim().split(/\s+/)
        return {
          pid: parseInt(parts[0]),
          cmd: parts.slice(4).join(' '),
        }
      } else {
        // Windows parsing would be different
        return null
      }
    }

    return null
  } catch (error) {
    return null
  }
}
