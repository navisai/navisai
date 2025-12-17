import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, networkInterfaces, platform } from 'node:os'
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import { NAVIS_PATHS } from '@navisai/api-contracts'
import { installBridge, uninstallBridge } from '@navisai/setup-app/bridge'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const CANONICAL_ORIGIN = 'https://navis.local'
const CERT_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local.crt')
const KEY_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local.key')

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

async function checkTlsCertificate() {
  try {
    const pem = await fs.readFile(CERT_PATH, 'utf8')
    const { X509Certificate } = await import('node:crypto')
    const cert = new X509Certificate(pem)
    const validFrom = new Date(cert.validFrom)
    const validTo = new Date(cert.validTo)

    return {
      exists: true,
      path: CERT_PATH,
      validFrom,
      validTo,
      isExpired: validTo < new Date(),
    }
  } catch (error) {
    return {
      exists: false,
      error: error.message,
    }
  }
}

async function removeTlsMaterials() {
  try {
    await Promise.all([
      fs.rm(CERT_PATH, { force: true }),
      fs.rm(KEY_PATH, { force: true }),
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
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} (y/N): `)
    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

async function confirmTyped(promptText, requiredPhrase) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${promptText}\nType "${requiredPhrase}" to continue: `)
    return answer.trim() === requiredPhrase
  } finally {
    rl.close()
  }
}

function escapeAppleScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

async function runMacOSAdminShell(shellCommand) {
  const script = `do shell script "${escapeAppleScriptString(shellCommand)}" with administrator privileges`
  return execAsync(`osascript -e "${escapeAppleScriptString(script)}"`)
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

async function hasCommand(cmd) {
  try {
    await execAsync(`command -v ${cmd}`)
    return true
  } catch {
    return false
  }
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

  await fs.mkdir(localDir, { recursive: true })

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.navisai.bridge</string>

    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${bridgeEntrypoint}</string>
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

  const shellCommand = [
    'set -euo pipefail',
    `install -m 0644 "${localPlist}" "${systemPlist}"`,
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    `launchctl bootstrap system "${systemPlist}"`,
    `launchctl enable system/com.navisai.bridge >/dev/null 2>&1 || true`,
    `launchctl kickstart -k system/com.navisai.bridge >/dev/null 2>&1 || true`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand)
}

async function uninstallMacOSBridge() {
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const shellCommand = [
    'set -euo pipefail',
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    `rm -f "${systemPlist}"`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand)
}

async function launchMacOSSetupApp() {
  const setupAppPath = (() => {
    try {
      return require.resolve('@navisai/setup-app')
    } catch {
      return path.join(__dirname, '..', '..', 'setup-app', 'index.js')
    }
  })()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [setupAppPath], {
      stdio: 'inherit'
    })

    child.on('exit', (code) => {
      if (code === 0) return resolve()
      reject(new Error('Navis Setup app exited with code ' + code))
    })
    child.on('error', (error) => reject(error))
  })
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

export async function setupCommand(options = {}) {
  console.log('NavisAI Setup')
  console.log('=============\n')
  console.log(`Goal: clean LAN origin at ${CANONICAL_ORIGIN}\n`)
  console.log('This command will enable (one-time, user-approved):')
  console.log('- Navis Bridge (443 -> 47621)')
  console.log('- mDNS/Bonjour for navis.local on LAN')
  console.log('- TLS certificates and guided mobile trust\n')

  const { skipUI = false, autoConfirm = false } = options

  const os = platform()
  if (os === 'darwin' && !skipUI) {
    console.log('\nOpening the Navis macOS Setup app...')
    try {
      await launchMacOSSetupApp()
      console.log('\n✅ Navis macOS Setup completed.')
    } catch (error) {
      console.error('\n❌ Setup app failed:', error.message)
      process.exit(1)
    }
    return
  }

  if (!autoConfirm && !(await confirm('Continue with setup?'))) {
    console.log('Canceled.')
    return
  }

  console.log('\nInstalling the Navis Bridge (requires an OS admin prompt)...')
  await installBridge(os)

  console.log('✅ Bridge installed: https://navis.local will use port 443 (forwarded to the daemon).')
  console.log('\nNext:')
  console.log('- Start Navis: navisai up')
  console.log(`- Open onboarding: ${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
}

export async function resetCommand() {
  console.log('NavisAI Reset')
  console.log('=============\n')
  console.log('This will remove the OS bridge service and stop binding port 443.\n')

  if (!(await confirm('Remove Navis Bridge and reset setup?'))) {
    console.log('Canceled.')
    return
  }

  console.log('\nRemoving the Navis Bridge (requires admin privileges)...')
  await uninstallBridge()

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

    // Check if daemon is already running
    const daemonProcess = await findDaemonProcess()
    if (daemonProcess) {
      console.log('Navis daemon is already running (PID:', daemonProcess.pid, ')')
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

    // Handle errors
    daemon.on('error', (error) => {
      console.error('Failed to spawn daemon:', error.message)
      process.exit(1)
    })

    // Detach from parent process
    daemon.unref()

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify it started successfully
    const startedProcess = await findDaemonProcess()
    if (startedProcess) {
      console.log('✅ Navis daemon started successfully')

      // Check if daemon is responding on the canonical origin
      try {
        const response = await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.status}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        console.log(`🌐 Access at: ${CANONICAL_ORIGIN}`)
        console.log(`📱 Onboarding: ${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
        if (options.open !== false) {
          await openUrl(`${CANONICAL_ORIGIN}${NAVIS_PATHS.welcome}`)
        }
        return
      } catch {
        console.log('\n⚠️  Daemon started but is not reachable at the canonical origin')
        console.log(`   Expected: ${CANONICAL_ORIGIN}`)
        console.log('   Run: navisai doctor')
        if (existsSync(outLogPath) || existsSync(errLogPath)) {
          console.log(`   Logs: ${outLogPath}`)
          console.log(`         ${errLogPath}`)
        }
      }
    } else {
      console.log('❌ Failed to start daemon')
      if (existsSync(outLogPath) || existsSync(errLogPath)) {
        console.log(`   Logs: ${outLogPath}`)
        console.log(`         ${errLogPath}`)
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

    if (daemonProcess) {
      console.log('✅ Navis daemon is running')
      console.log('   PID:', daemonProcess.pid)
      console.log('   Command:', daemonProcess.cmd)

      // Try to get status from API
      try {
        const response = await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.status}`)
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

export async function doctorCommand() {
  console.log('Running Navis diagnostics...\n')

  let allGood = true
  const os = platform()

  // Check Node.js version
  const nodeVersion = process.version
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])
  if (majorVersion >= 18) {
    console.log('✅ Node.js version:', nodeVersion)
  } else {
    console.log('❌ Node.js version too old:', nodeVersion, '(requires 18+)')
    allGood = false
  }

  // Check if daemon entrypoint can be resolved
  const daemonPath = resolveDaemonEntrypoint()
  try {
    await fs.access(daemonPath)
    console.log('✅ Daemon binary found')
  } catch {
    console.log('❌ Daemon binary not found at:', daemonPath)
    allGood = false
  }

  // Check canonical origin reachability (best-effort)
  try {
    const response = await fetch(`${CANONICAL_ORIGIN}/status`)
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

  const lanAddresses = getLanAddresses()
  const mdnsResult = await resolveNavisLocal()
  if (mdnsResult.success) {
    const matchesLan = lanAddresses.includes(mdnsResult.address)
    if (matchesLan) {
      console.log(`✅ mDNS: navis.local resolves to ${mdnsResult.address} (host LAN)`)
    } else {
      console.log(
        `⚠️  mDNS: navis.local resolved to ${mdnsResult.address} but LAN IPs are ${lanAddresses.join(', ') ||
        'none'}`
      )
      if (lanAddresses.length > 0) {
        allGood = false
      }
    }
  } else {
    console.log(`⚠️  mDNS lookup failed: ${mdnsResult.error}`)
    allGood = false
  }

  const tlsStatus = await checkTlsCertificate()
  if (tlsStatus.exists) {
    const now = new Date()
    const expiresInMs = tlsStatus.validTo - now
    const expiresInDays = Math.max(0, Math.ceil(expiresInMs / (1000 * 60 * 60 * 24)))
    const validityMsg = tlsStatus.isExpired ? ' (expired)' : ` (expires in ~${expiresInDays} day${expiresInDays === 1 ? '' : 's'})`
    console.log(
      `✅ TLS cert: ${tlsStatus.path} (valid from ${tlsStatus.validFrom.toISOString()} to ${tlsStatus.validTo.toISOString()})${validityMsg}`
    )
    if (tlsStatus.isExpired) {
      allGood = false
    }
  } else {
    console.log(`⚠️  TLS certificate missing or unreadable: ${tlsStatus.error}`)
    allGood = false
  }

  // Bridge status (best-effort)
  try {
    if (os === 'darwin') {
      await execAsync('launchctl print system/com.navisai.bridge >/dev/null 2>&1')
      console.log('✅ Bridge: launchd service installed (com.navisai.bridge)')
    } else if (os === 'linux') {
      const { stdout } = await execAsync('systemctl is-active navisai-bridge.service || true')
      const status = stdout.trim()
      if (status === 'active') {
        console.log('✅ Bridge: systemd service active (navisai-bridge.service)')
      } else {
        console.log(`⚠️  Bridge: systemd service not active (${status || 'unknown'})`)
        allGood = false
      }
    } else if (os === 'win32') {
      try {
        const { stdout } = await execAsync('sc query navisai-bridge')
        if (stdout.includes('RUNNING')) {
          console.log('✅ Bridge: Windows service active (navisai-bridge)')
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
    console.log('- Optionally removes TLS certs from ~/.navis/certs')
    console.log('- Keeps local state (DB, paired devices, preferences)\n')
    await resetCommand()
    return
  }

  console.log('Mode: ALL (destructive factory reset)')
  console.log('- Removes OS bridge service (443 entrypoint)')
  console.log('- Optionally removes TLS certs from ~/.navis/certs')
  console.log('- Deletes local state under ~/.navis (including db.sqlite)\n')

  const daemonProcess = await findDaemonProcess()
  if (daemonProcess) {
    console.log('Stopping Navis daemon before deleting local state...')
    await downCommand()
  }

  const phrase = 'DELETE ~/.navis'
  const ok = await confirmTyped(
    `This will permanently delete local Navis state at ${path.join(homedir(), '.navis')}.\nThis cannot be undone.`,
    phrase
  )
  if (!ok) {
    console.log('Canceled.')
    return
  }

  console.log('\nRemoving the Navis Bridge (requires admin privileges)...')
  await uninstallBridge()
  console.log('✅ Bridge removed.')

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
    const response = await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.discovery.scan}`, {
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
        console.log(`${index + 1}. ${project.name}`)
        console.log(`   Path: ${project.path}`)
        console.log(`   Type: ${project.classification?.primary?.name || 'Unknown'}`)
        if (project.detection?.primary?.framework) {
          console.log(`   Framework: ${project.detection.primary.framework}`)
        }
        if (project.classification?.language) {
          console.log(`   Language: ${project.classification.language}`)
        }
        console.log(`   Confidence: ${(project.detection.confidence * 100).toFixed(1)}%`)
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
    const response = await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.discovery.index}`, {
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
        const devicesResponse = await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.devices.list}`)
        if (devicesResponse.ok) {
          const { devices } = await devicesResponse.json()
          for (const device of devices) {
            if (!device.isRevoked) {
              await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.devices.revoke(device.id)}`, {
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
    const response = await fetch(`${CANONICAL_ORIGIN}${NAVIS_PATHS.pairing.qr}`)
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
