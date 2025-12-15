import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform } from 'node:os'
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import { NAVIS_PATHS } from '@navisai/api-contracts'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const CANONICAL_ORIGIN = 'https://navis.local'

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

function escapeAppleScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

async function runMacOSAdminShell(shellCommand) {
  const script = `do shell script "${escapeAppleScriptString(shellCommand)}" with administrator privileges`
  return execAsync(`osascript -e "${escapeAppleScriptString(script)}"`)
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

export async function setupCommand() {
  console.log('NavisAI Setup')
  console.log('=============\n')
  console.log(`Goal: clean LAN origin at ${CANONICAL_ORIGIN}\n`)
  console.log('This command will enable (one-time, user-approved):')
  console.log('- Navis Bridge (443 -> 47621)')
  console.log('- mDNS/Bonjour for navis.local on LAN')
  console.log('- TLS certificates and guided mobile trust\n')

  if (!(await confirm('Continue with setup?'))) {
    console.log('Canceled.')
    return
  }

  const os = platform()
  if (os !== 'darwin') {
    console.log('\nSetup is currently implemented for macOS only.')
    console.log('See `docs/SETUP.md` for the cross-platform spec.')
    return
  }

  console.log('\nInstalling the Navis Bridge (requires an OS admin prompt)...')
  await installMacOSBridge()
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

  const os = platform()
  if (os !== 'darwin') {
    console.log('\nReset is currently implemented for macOS only.')
    console.log('See `docs/SETUP.md` for the cross-platform spec.')
    return
  }

  console.log('Removing the Navis Bridge (requires an OS admin prompt)...')
  await uninstallMacOSBridge()
  console.log('✅ Bridge removed.')
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

    // Start daemon with spawn
    const daemon = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: 'ignore',
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
        return
      } catch {
        console.log('\n⚠️  Daemon started but is not reachable at the canonical origin')
        console.log(`   Expected: ${CANONICAL_ORIGIN}`)
        console.log('   Run: navisai doctor')
      }
    } else {
      console.log('❌ Failed to start daemon')
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

  if (allGood) {
    console.log('\n🎉 All systems ready!')
  } else {
    console.log('\n⚠️  Some issues found. See above for details.')
    process.exit(1)
  }
}

export async function logsCommand() {
  try {
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('Daemon is not running')
      return
    }

    console.log('Following daemon logs (Ctrl+C to stop)...\n')

    // In a real implementation, this would connect to daemon's log stream
    // For now, just show that daemon is running
    console.log('Daemon is running with PID:', daemonProcess.pid)
    console.log('Note: Log streaming not yet implemented')
  } catch (error) {
    console.error('Failed to fetch logs:', error.message)
  }
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
