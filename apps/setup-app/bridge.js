import { exec as execCb } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execAsync = promisify(execCb)
const require = createRequire(import.meta.url)

export function resolveDaemonBridgeEntrypoint() {
  if (typeof require.resolve === 'function') {
    try {
      return require.resolve('@navisai/daemon/bridge')
    } catch {}
    try {
      return require.resolve('@navisai/daemon/src/bridge.js')
    } catch {}
  }

  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'daemon',
    'src',
    'bridge.js'
  )
}

export async function hasCommand(cmd) {
  try {
    await execAsync(`command -v ${cmd}`)
    return true
  } catch {
    return false
  }
}

export async function runMacOSAdminShell(shellCommand) {
  const script = `do shell script "${escapeAppleScriptShell(shellCommand)}" with administrator privileges`
  await execAsync(`osascript -e "${escapeAppleScriptShell(script)}"`)
}

function escapeAppleScriptShell(command) {
  return command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function installMacOSBridge() {
  const bridgeEntrypoint = resolveDaemonBridgeEntrypoint()
  const nodePath = process.execPath

  const localDir = path.join(homedir(), '.navis', 'bridge')
  const localPlist = path.join(localDir, 'com.navisai.bridge.plist')
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'

  if (!existsSync(localDir)) {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(localDir, { recursive: true }))
  }

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
</plist>`

  await writeFile(localPlist, plist, 'utf8')

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

export async function uninstallMacOSBridge() {
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const shellCommand = [
    'set -euo pipefail',
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    `rm -f "${systemPlist}"`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand)
}

export async function runLinuxAdminShell(shellCommand) {
  const wrapped = `sh -c '${shellCommand.replace(/'/g, "'\\\\''")}'`
  if (await hasCommand('pkexec')) {
    return execAsync(`pkexec ${wrapped}`)
  }
  return execAsync(`sudo ${wrapped}`)
}

export async function installLinuxBridge() {
  const bridgeEntrypoint = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'daemon', 'src', 'bridge.js')
  const nodePath = process.execPath

  const localDir = path.join(homedir(), '.navis', 'bridge')
  const localService = path.join(localDir, 'navisai-bridge.service')
  const systemService = '/etc/systemd/system/navisai-bridge.service'

  if (!existsSync(localDir)) {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(localDir, { recursive: true }))
  }

  const service = `[Unit]
Description=NavisAI Bridge (443 -> 127.0.0.1:47621)
After=network.target

[Service]
Type=simple
Environment=NAVIS_BRIDGE_HOST=0.0.0.0
Environment=NAVIS_BRIDGE_PORT=443
Environment=NAVIS_DAEMON_HOST=127.0.0.1
Environment=NAVIS_DAEMON_PORT=47621
ExecStart=${nodePath} ${bridgeEntrypoint}
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
`

  await writeFile(localService, service, 'utf8')

  const shellCommand = [
    'set -euo pipefail',
    `install -m 0644 "${localService}" "${systemService}"`,
    'systemctl daemon-reload',
    'systemctl enable --now navisai-bridge.service',
  ].join('; ')

  await runLinuxAdminShell(shellCommand)
}

export async function uninstallLinuxBridge() {
  const systemService = '/etc/systemd/system/navisai-bridge.service'
  const shellCommand = [
    'set -euo pipefail',
    'systemctl disable --now navisai-bridge.service >/dev/null 2>&1 || true',
    `rm -f "${systemService}"`,
    'systemctl daemon-reload',
  ].join('; ')

  await runLinuxAdminShell(shellCommand)
}

export async function runWindowsAdminCommand(command) {
  const escaped = command.replace(/`/g, '``').replace(/"/g, '`"')
  const psCommand = `Start-Process -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"${escaped}" -Verb RunAs -Wait`
  await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`)
}

export async function installWindowsBridge() {
  const bridgeEntrypoint = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'daemon', 'src', 'bridge.js')
  const nodePath = process.execPath
  const binPath = `"${nodePath}" "${bridgeEntrypoint}"`
  const commands = [
    'sc stop navisai-bridge 2>$null || true',
    'sc delete navisai-bridge 2>$null || true',
    `sc create navisai-bridge binPath= "${binPath}" start= auto`,
    'sc config navisai-bridge obj= LocalSystem',
    'sc description navisai-bridge "Navis AI bridge (443 -> 127.0.0.1:47621)"',
    'sc start navisai-bridge',
  ].join('; ')
  await runWindowsAdminCommand(commands)
}

export async function uninstallWindowsBridge() {
  const commands = [
    'sc stop navisai-bridge 2>$null || true',
    'sc delete navisai-bridge 2>$null || true',
  ].join('; ')
  await runWindowsAdminCommand(commands)
}

export async function installBridge(platformOverride = undefined) {
  const os = platformOverride || process.platform
  if (os === 'darwin') {
    return installMacOSBridge()
  }
  if (os === 'linux') {
    return installLinuxBridge()
  }
  if (os === 'win32') {
    return installWindowsBridge()
  }
  throw new Error(`Unsupported platform for bridge installation: ${os}`)
}

export async function uninstallBridge(platformOverride = undefined) {
  const os = platformOverride || process.platform
  if (os === 'darwin') {
    return uninstallMacOSBridge()
  }
  if (os === 'linux') {
    return uninstallLinuxBridge()
  }
  if (os === 'win32') {
    return uninstallWindowsBridge()
  }
  throw new Error(`Unsupported platform for bridge uninstallation: ${os}`)
}
