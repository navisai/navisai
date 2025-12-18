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
import { Agent as UndiciAgent } from 'undici'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const CANONICAL_ORIGIN = 'https://navis.local'
const CERT_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local.crt')
const KEY_PATH = path.join(homedir(), '.navis', 'certs', 'navis.local.key')

async function fetchNavis(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${CANONICAL_ORIGIN}${pathOrUrl}`

  const certPem = await fs.readFile(CERT_PATH, 'utf8').catch(() => null)
  const dispatcher = new UndiciAgent({
    connect: certPem ? { ca: certPem } : { rejectUnauthorized: false },
  })

  return fetch(url, { ...options, dispatcher })
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

async function queryMdnsARecord(hostname) {
  if (!(await hasCommand('dns-sd'))) {
    return { success: false, error: 'dns-sd not available' }
  }

  try {
    const { stdout } = await execAsync(
      `perl -e 'alarm 3; exec "dns-sd", "-Q", "${hostname}", "A"' 2>/dev/null || true`,
      { encoding: 'utf8' }
    )
    const line = stdout
      .split('\n')
      .find((row) => row.includes(`${hostname}.`) && row.includes('Addr') && row.trim().match(/\d+\.\d+\.\d+\.\d+/))
    const ip = line?.trim().match(/(\d+\.\d+\.\d+\.\d+)/)?.[1]
    if (!ip) return { success: false, error: `No mDNS A answer observed for ${hostname}` }
    return { success: true, address: ip }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function browseMdnsService(serviceType, domain = 'local') {
  if (!(await hasCommand('dns-sd'))) {
    return { success: false, error: 'dns-sd not available' }
  }

  try {
    const { stdout } = await execAsync(
      `perl -e 'alarm 3; exec "dns-sd", "-B", "${serviceType}", "${domain}"' 2>/dev/null || true`,
      { encoding: 'utf8' }
    )
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    const found = lines.some((l) => l.includes(serviceType))
    return { success: true, found, output: lines.slice(0, 8).join('\n') }
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

async function runMacOSAdminShell(shellCommand, options = {}) {
  const { preferSudo = false } = options
  if (preferSudo) {
    const wrapped = `sh -c '${shellCommand.replaceAll("'", "'\\''")}'`
    return execAsync(`sudo ${wrapped}`)
  }

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

  // Create pf.conf with navisai anchors
  const pfConf = `#
# Default PF configuration file with NavisAI support
#
# This file contains the main ruleset, which gets automatically loaded
# at startup.  PF will not be automatically enabled, however.  Instead,
# each component which utilizes PF is responsible for enabling and disabling
# PF via -E and -X as documented in pfctl(8).  That will ensure that PF
# is disabled only when the last enable reference is released.
#
# Care must be taken to ensure that the main ruleset does not get flushed,
# as the nested anchors rely on the anchor point defined here. In addition,
# to the anchors loaded by this file, some system services would dynamically
# insert anchors into the main ruleset. These anchors will be added only when
# the system service is used and would removed on termination of the service.
#
# See pf.conf(5) for syntax.
#

#
# com.apple anchor point
#
scrub-anchor "com.apple/*"
nat-anchor "com.apple/*"
rdr-anchor "com.apple/*"
rdr-anchor "navisai/*"
dummynet-anchor "com.apple/*"
anchor "com.apple/*"
anchor "navisai/*"
load anchor "com.apple" from "/etc/pf.anchors/com.apple"
`

  const localPfConf = path.join(localDir, 'pf.conf')
  const systemPfConf = '/etc/pf.conf'
  const systemPfConfBackup = '/etc/pf.conf.backup'

  await fs.writeFile(localPfConf, pfConf, 'utf8')

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
    // Install updated pf.conf if it doesn't have navisai anchors
    `if ! grep -q "rdr-anchor \\"navisai/\\"" "${systemPfConf}" 2>/dev/null; then install -m 0644 "${localPfConf}" "${systemPfConf}"; fi`,
    // Load the service
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    // If the service was previously disabled (e.g., via System Settings → Login Items), bootstrap can fail.
    `launchctl enable system/com.navisai.bridge >/dev/null 2>&1 || true`,
    `launchctl bootstrap system "${systemPlist}"`,
    `launchctl kickstart -k system/com.navisai.bridge >/dev/null 2>&1 || true`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand, { preferSudo: true })
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

  await runMacOSAdminShell(shellCommand, { preferSudo: true })
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
  const bridgeResult = os === 'darwin' ? await installMacOSBridge() : await installBridge(os)

  if (bridgeResult?.launchctlSucceeded) {
    console.log('✅ Bridge installed and started via launchd: https://navis.local will use port 443 (forwarded to the daemon).')
  } else if (bridgeResult?.manualStartRequired) {
    console.log('⚠️  Bridge installed but launchd service failed to start.')
    console.log('📋 To start the bridge manually, run:')
    console.log('   sudo node apps/daemon/src/bridge.js start')
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
        const response = await fetchNavis(NAVIS_PATHS.status)
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
        const response = await fetchNavis(NAVIS_PATHS.status)
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
        await execAsync(`node -c "${check.file}" 2>&1`)
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

  // Comprehensive bridge diagnostics
  console.log('\n🌉 Bridge Service Diagnostics:')
  const bridgePlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const bridgeExists = await fs.access(bridgePlist).then(() => true).catch(() => false)

  if (bridgeExists) {
    console.log('✅ Bridge service plist installed')

    // Check if bridge service is loaded
    try {
      const { stdout: serviceStatus } = await execAsync('launchctl list | grep com.navisai.bridge 2>/dev/null || echo "not loaded"', {
        encoding: 'utf8'
      })

      if (serviceStatus.includes('com.navisai.bridge')) {
        const parts = serviceStatus.trim().split('\t')
        const pid = parts[0]
        const status = parts[1] || 'unknown'

        if (pid && pid !== '-') {
          console.log(`✅ Bridge service running (PID: ${pid})`)

          // Check if transparent proxy is listening
          try {
            const { stdout: lsofOutput } = await execAsync('lsof -i :8443 2>/dev/null | grep LISTEN || echo "not listening"', {
              encoding: 'utf8'
            })

            if (lsofOutput.includes('LISTEN')) {
              console.log('✅ Transparent proxy listening on port 8443')

              // Test packet forwarding rules
              try {
                const { stdout: pfRules } = await execAsync('sudo pfctl -a navis -s nat 2>/dev/null || echo "no rules"', {
                  encoding: 'utf8'
                })

                if (pfRules.includes('8443') || pfRules.includes('47621')) {
                  console.log('✅ Packet filtering rules installed')
                } else {
                  console.log('⚠️  Packet filtering rules not found')
                  allGood = false
                }
              } catch (pfError) {
                console.log('⚠️  Could not check packet filtering rules (requires sudo)')
              }
            } else {
              console.log('⚠️  Transparent proxy not listening on port 8443')
              allGood = false
            }
          } catch (proxyError) {
            console.log('⚠️  Could not check transparent proxy status')
          }
        } else if (status === '-12345') {
          console.log('⚠️  Bridge service loaded but not running')
          console.log('   Try: sudo launchctl kickstart -k system/com.navisai.bridge')
          allGood = false
        } else {
          console.log('⚠️  Bridge service status unknown:', status)
        }
      } else {
        console.log('⚠️  Bridge service not loaded')
        console.log('   Try: ./navisai setup')
        allGood = false
      }
    } catch (serviceError) {
      console.log('⚠️  Could not check bridge service status')
    }
  } else {
    console.log('⚠️  Bridge service not installed')
    console.log('   Run: ./navisai setup')
    allGood = false
  }

  // Check if bridge is running manually
  try {
    const { stdout: bridgeProcesses } = await execAsync('ps aux | grep "bridge.js.*start" | grep -v grep || echo "none"', {
      encoding: 'utf8'
    })

    if (bridgeProcesses.trim() !== 'none') {
      console.log('✅ Bridge process running manually')
      const lines = bridgeProcesses.trim().split('\n')
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/)
        console.log(`   PID: ${parts[1]}, User: ${parts[0]}`)
      })
    }
  } catch (procError) {
    // Ignore process check errors
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
      const { stdout: bridgeLogs } = await execAsync('tail -10 /var/log/navis-bridge.log 2>/dev/null | grep -i "mdns.*active\\|advertising" || echo "no mdns"', {
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
  const mdnsQuery = await queryMdnsARecord('navis.local')
  if (mdnsQuery.success) {
    console.log(`✅ mDNS query: navis.local A -> ${mdnsQuery.address}`)
  } else {
    console.log(`⚠️  mDNS query: ${mdnsQuery.error}`)
    console.log('   💡 If IP access works but navis.local does not on a phone, your LAN may block Bonjour/mDNS between clients.')
  }

  const navisService = await browseMdnsService('_navisai._tcp')
  if (navisService.success && navisService.found) {
    console.log('✅ mDNS service: _navisai._tcp advertised')
  } else if (navisService.success) {
    console.log('⚠️  mDNS service: _navisai._tcp not observed')
  } else {
    console.log(`⚠️  mDNS service browse failed: ${navisService.error}`)
  }

  // Test direct daemon connectivity
  try {
    const daemonResponse = await fetch('https://127.0.0.1:47621/status', {
      headers: { 'Host': 'navis.local' }
    })
    if (daemonResponse.ok) {
      console.log('✅ Daemon reachable directly with navis.local header')
    }
  } catch (daemonError) {
    console.log('⚠️  Daemon not reachable directly')
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

  // Check daemon process status
  if (daemonProcess) {
    console.log(`✅ Daemon process running (PID: ${daemonProcess.pid})`)

    // Check daemon logs for errors
    const errLog = '/Volumes/Macintosh HD/Users/vsmith/.navis/logs/daemon.err.log'
    try {
      const { stdout: recentErrors } = await execAsync(`tail -5 "${errLog}" 2>/dev/null | grep -v "No ALTQ" || echo "no recent errors"`)
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

  // Check database dependencies
  console.log('\n📊 Database Dependencies:')
  try {
    // Check if better-sqlite3 native bindings are available
    const dbPath = '/Volumes/Macintosh HD/Users/vsmith/navisai/node_modules/.pnpm/better-sqlite3@9.6.0/node_modules/better-sqlite3/build/better_sqlite3.node'
    try {
      await fs.access(dbPath)
      console.log('✅ Native SQLite bindings found')
    } catch {
      console.log('⚠️  Native SQLite bindings not found (optional per architecture)')
      console.log('   Daemon will run without persistent storage')
    }
  } catch (e) {
    console.log('⚠️  Could not check database dependencies')
  }

  // Check log directory
  const logDir = '/Volumes/Macintosh HD/Users/vsmith/.navis/logs'
  try {
    await fs.access(logDir)
    console.log('✅ Log directory exists:', logDir)
  } catch {
    console.log('⚠️  Log directory not found, will be created')
  }

  // Check data directory
  const dataDir = '/Volumes/Macintosh HD/Users/vsmith/.navis'
  try {
    await fs.access(dataDir)
    console.log('✅ Data directory exists:', dataDir)
  } catch {
    console.log('⚠️  Data directory not found, will be created')
  }

  console.log('\n📁 File System & Code Quality:')

  // Check file linting and syntax
  try {
    const projectRoot = '/Volumes/Macintosh HD/Users/vsmith/navisai'

    // 1. Check critical files for syntax errors
    const criticalFiles = [
      'apps/daemon/daemon.js',
      'apps/daemon/src/index.js',
      'apps/cli/src/commands.js',
      'apps/pwa/src/lib/api/client.ts'
    ]

    console.log('  🔍 Syntax validation:')
    for (const file of criticalFiles) {
      const fullPath = path.join(projectRoot, file)
      try {
        await fs.access(fullPath)
        const ext = path.extname(file)
        const checkCmd = ext === '.ts' ? `tsc --noEmit "${fullPath}"` : `node -c "${fullPath}"`
        await execAsync(`${checkCmd} 2>&1`)
        console.log(`   ✅ ${file}`)
      } catch (error) {
        console.log(`   ❌ ${file}:`)
        error.stdout?.split('\n').filter(line => line.trim()).forEach(line => {
          console.log(`      ${line}`)
        })
        if (error.stderr) {
          error.stderr.split('\n').filter(line => line.trim()).forEach(line => {
            console.log(`      ${line}`)
          })
        }
        allGood = false
      }
    }

    // 2. Check package.json files
    console.log('  📦 Package validation:')
    const packageJsons = [
      'package.json',
      'apps/daemon/package.json',
      'apps/cli/package.json',
      'apps/pwa/package.json'
    ]

    for (const pkgPath of packageJsons) {
      const fullPath = path.join(projectRoot, pkgPath)
      try {
        const content = await fs.readFile(fullPath, 'utf8')
        JSON.parse(content)
        console.log(`   ✅ ${pkgPath}`)
      } catch (error) {
        console.log(`   ❌ ${pkgPath}: ${error.message}`)
        allGood = false
      }
    }

    // 3. Check for required documentation
    console.log('  📚 Documentation check:')
    const requiredDocs = [
      'docs/NETWORKING.md',
      'docs/SECURITY.md',
      'docs/SETUP.md',
      'docs/BEADS_WORKFLOW.md',
      'docs/IPC_TRANSPORT.md'
    ]

    for (const docPath of requiredDocs) {
      const fullPath = path.join(projectRoot, docPath)
      try {
        await fs.access(fullPath)
        const stats = await fs.stat(fullPath)
        if (stats.size > 100) {
          console.log(`   ✅ ${docPath}`)
        } else {
          console.log(`   ⚠️  ${docPath} (too small)`)
        }
      } catch (error) {
        console.log(`   ❌ ${docPath}: missing`)
        allGood = false
      }
    }

    // 4. Run architecture verification if available
    console.log('  🏗️  Architecture verification:')
    try {
      const { stdout: verifyOutput } = await execAsync('pnpm verify:arch 2>&1', { cwd: projectRoot })
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

    // 5. Check ESLint configuration
    console.log('  🔧 Linting configuration:')
    try {
      await fs.access(path.join(projectRoot, '.eslintrc.js'))
      console.log('   ✅ ESLint configuration found')

      // Try to run ESLint on critical files
      try {
        const { stdout } = await execAsync('npx eslint apps/daemon/daemon.js --format=compact 2>&1 || true', { cwd: projectRoot })
        if (stdout.trim() === '') {
          console.log('   ✅ Daemon file passes linting')
        } else {
          console.log('   ⚠️  Linting issues in daemon.js:')
          stdout.split('\n').slice(0, 5).forEach(line => {
            if (line.trim()) console.log(`      ${line}`)
          })
        }
      } catch (error) {
        console.log('   ⚠️  Could not run ESLint')
      }
    } catch {
      console.log('   ⚠️  No ESLint configuration found')
    }

    // 6. Check for circular dependencies
    console.log('  🔄 Dependency check:')
    try {
      const { stdout: madgeOutput } = await execAsync('npx madge --circular apps/ 2>&1 || true', { cwd: projectRoot })
      if (madgeOutput.includes('0 circular')) {
        console.log('   ✅ No circular dependencies found')
      } else if (madgeOutput.includes('found')) {
        console.log('   ⚠️  Circular dependencies detected')
      }
    } catch {
      console.log('   ⚠️  Could not check for circular dependencies')
    }

    // 7. Check NavisDaemon class structure
    console.log('  🏛️  Daemon class structure:')
    try {
      const daemonPath = path.join(projectRoot, 'apps/daemon/daemon.js')
      const content = await fs.readFile(daemonPath, 'utf8')

      // Check if setupRoutes and subsequent methods are properly indented
      const setupRoutesMatch = content.match(/^(\s*)async setupRoutes\(\)/m)
      if (setupRoutesMatch) {
        const indent = setupRoutesMatch[1]
        if (indent.length === 4) {
          console.log('   ✅ Methods properly indented inside NavisDaemon class')
        } else {
          console.log(`   ❌ setupRoutes() has incorrect indentation (${indent.length} spaces, should be 4)`)
          allGood = false
        }
      }

      // Check if class has proper closing
      const classMatch = content.match(/export class NavisDaemon \{[\s\S]*?^(\s*)\}/m)
      if (classMatch) {
        console.log('   ✅ NavisDaemon class properly closed')
      } else {
        console.log('   ❌ NavisDaemon class structure issue detected')
        allGood = false
      }
    } catch (error) {
      console.log('   ⚠️  Could not verify daemon class structure')
    }

  } catch (error) {
    console.log('   ❌ File system check failed:', error.message)
    allGood = false
  }

  console.log('\n🌐 Network Configuration:')

  // Bridge status and packet forwarding tests (Refs: navisai-lss)
  try {
    if (os === 'darwin') {
      // Check launchd service
      await execAsync('launchctl print system/com.navisai.bridge >/dev/null 2>&1')
      console.log('✅ Bridge: launchd service installed (com.navisai.bridge)')

      // Test packet forwarding rules
      try {
        // Check NAT rules in correct anchor
        const { stdout: natRules } = await execAsync('sudo pfctl -a navisai/proxy -s nat 2>/dev/null || echo "no nat rules"')
        if (natRules.includes('rdr') && natRules.includes('443') && natRules.includes('127.0.0.1')) {
          console.log('✅ Packet forwarding: NAT rules configured for 443 → 8443 (navisai/proxy)')
        } else {
          console.log('⚠️  Packet forwarding: NAT rules not found in navisai/proxy anchor')
          console.log('   Run: navisai setup to install packet forwarding')
          allGood = false
        }

        // Check filter rules
        const { stdout: filterRules } = await execAsync('sudo pfctl -a navisai/filter -s rules 2>/dev/null || echo "no filter rules"')
        if (filterRules.includes('keep state')) {
          console.log('✅ Packet forwarding: Filter rules configured (navisai/filter)')
        } else {
          console.log('⚠️  Packet forwarding: Filter rules not found in navisai/filter anchor')
          allGood = false
        }

        // Check if pf is enabled
        const { stdout: pfEnabled } = await execAsync('sudo pfctl -s info 2>/dev/null | grep "Status: Enabled" || echo "disabled"')
        if (pfEnabled.includes('Enabled')) {
          console.log('✅ Packet filtering: pf is enabled')
        } else {
          console.log('⚠️  Packet filtering: pf is not enabled')
          allGood = false
        }
      } catch (error) {
        console.log('⚠️  Packet forwarding: Cannot check pfctl rules (may need sudo)')
        console.log('   Error:', error.message)
        allGood = false
      }

      // Test if proxy is listening
      try {
        await execAsync('lsof -i :8443 -sTCP:LISTEN -n -P | grep -q "LISTEN"')
        console.log('✅ Transparent proxy: Listening on port 8443')
      } catch (error) {
        console.log('⚠️  Transparent proxy: Not listening on port 8443')
        allGood = false
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
