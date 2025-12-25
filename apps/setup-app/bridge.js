import { exec as execCb } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { runPreflightChecks } from '@navisai/core/preflight'
import { readSnapshotState, recordLatestSnapshot, isSnapshotFresh, navisSnapshotExists } from '@navisai/core/snapshot'

const execAsync = promisify(execCb)
const require = createRequire(import.meta.url)

export function resolveDaemonBridgeEntrypoint() {
  if (typeof require.resolve === 'function') {
    try {
      return require.resolve('@navisai/daemon/bridge')
    } catch { }
    try {
      return require.resolve('@navisai/daemon/src/bridge.js')
    } catch { }
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
  // Write the command to a temporary script file to avoid escaping issues
  const tempScript = path.join(homedir(), '.navis', 'temp-install.sh')
  await writeFile(tempScript, shellCommand, 'utf8')

  try {
    const script = `do shell script "chmod +x '${tempScript}' && '${tempScript}'" with administrator privileges`
    const result = await execAsync(`osascript -e "${escapeAppleScriptShell(script)}"`)
    return result.stdout || result
  } finally {
    // Clean up temp script
    try {
      await import('node:fs/promises').then(({ unlink }) => unlink(tempScript))
    } catch {
      // Ignore cleanup errors
    }
  }
}

function escapeAppleScriptShell(command) {
  return command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function installMacOSBridge() {
  const preflight = await runPreflightChecks()
  if (!preflight.ok) {
    const details = preflight.checks
      .map((check) => `- ${check.name}: ${check.ok ? 'ok' : `fail (${check.error || 'unknown'})`}`)
      .join('\n')
    throw new Error(`Preflight checks failed:\n${details}`)
  }

  const previousSnapshot = await readSnapshotState()
  const bridgeEntrypoint = resolveDaemonBridgeEntrypoint()
  const nodePath = process.execPath

  const localDir = path.join(homedir(), '.navis', 'bridge')
  const localPlist = path.join(localDir, 'com.navisai.bridge.plist')
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const runnerPath = '/usr/local/libexec/navisai-bridge-runner'

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
</plist>`

  await writeFile(localPlist, plist, 'utf8')

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

  await writeFile(localPfConf, pfConf, 'utf8')

  // Enhanced setup with graceful failure handling
  const snapshotExists = await navisSnapshotExists(previousSnapshot)
  const snapshotFresh = isSnapshotFresh(previousSnapshot)
  const shouldRotate = !snapshotExists || !snapshotFresh
  const snapshotBlock = shouldRotate
    ? previousSnapshot?.id
      ? `\ttmutil deletelocalsnapshots "${previousSnapshot.id}" || true\n\ttmutil snapshot`
      : '\ttmutil snapshot'
    : ''
  const shellScript = `#!/bin/bash
\tset -euo pipefail
\t# Navis snapshot gate (mutations must be preceded by a fresh snapshot)
${snapshotBlock}

	# Install a root-owned runner; launchd can refuse to bootstrap LaunchDaemons that directly
	# execute user-owned Homebrew binaries (common cause of I/O error on bootstrap).
	install -d -m 0755 "/usr/local/libexec"
	cat > "${runnerPath}" <<'NAVIS_RUNNER'
	#!/bin/sh
	set -e
	exec "${nodePath}" "$@"
	NAVIS_RUNNER
	chmod 0755 "${runnerPath}"
	chown root:wheel "${runnerPath}"

	# Install plist
	rm -f "${systemPlist}"
	install -m 0644 "${localPlist}" "${systemPlist}"
	chown root:wheel "${systemPlist}"

	# Ensure log files exist and are writable by launchd (root)
	touch /var/log/navis-bridge.log /var/log/navis-bridge.err
	chown root:wheel /var/log/navis-bridge.log /var/log/navis-bridge.err

	# Backup existing pf.conf if it exists and hasn't been backed up
	if [ -f "${systemPfConf}" ] && [ ! -f "${systemPfConfBackup}" ]; then
	  cp "${systemPfConf}" "${systemPfConfBackup}"
	fi

# Install updated pf.conf if it doesn't have navisai anchors
if ! grep -q "rdr-anchor \\"navisai/\\"" "${systemPfConf}" 2>/dev/null; then
  install -m 0644 "${localPfConf}" "${systemPfConf}"
fi

	# Try to load the service with fallback handling
	LAUNCHCTL_SUCCESS=true
	/bin/launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true

	# If the service was previously disabled (e.g., via System Settings → Login Items), bootstrap can fail.
	/bin/launchctl enable system/com.navisai.bridge >/dev/null 2>&1 || true
	if /bin/launchctl print-disabled system | grep -q '"com.navisai.bridge" => disabled'; then
	  echo "ERROR: com.navisai.bridge is disabled; enable failed"
	  LAUNCHCTL_SUCCESS=false
	fi

	if [ "$LAUNCHCTL_SUCCESS" = true ] && ! /bin/launchctl bootstrap system "${systemPlist}" 2>/dev/null; then
	  LAUNCHCTL_SUCCESS=false
	  echo "WARNING: launchctl bootstrap failed, service will need manual start"
	fi

	if [ "$LAUNCHCTL_SUCCESS" = true ]; then
	  /bin/launchctl kickstart -k system/com.navisai.bridge >/dev/null 2>&1 || true
	  echo "SUCCESS: Bridge service installed and started via launchd"
	else
	  echo "FALLBACK: Bridge files installed, start manually with: sudo node '${bridgeEntrypoint}' start --setup-approved"
	fi
`

  const tempScript = path.join(homedir(), '.navis', 'install-bridge.sh')
  await writeFile(tempScript, shellScript, 'utf8')

  try {
    // Make script executable and run it with admin privileges
    const script = `do shell script "chmod +x '${tempScript}' && '${tempScript}'" with administrator privileges`
    const result = await execAsync(`osascript -e "${escapeAppleScriptShell(script)}"`)
    await recordLatestSnapshot()
    return result.stdout || result
  } finally {
    // Clean up temp script
    try {
      await import('node:fs/promises').then(({ unlink }) => unlink(tempScript))
    } catch {
      // Ignore cleanup errors
    }
  }

  // Return information about what was done
  return {
    launchctlSucceeded: true, // Will be updated after actual execution
    manualStartRequired: false,
    output: 'Bridge installation completed'
  }
}

export async function uninstallMacOSBridge() {
  const preflight = await runPreflightChecks()
  if (!preflight.ok) {
    const details = preflight.checks
      .map((check) => `- ${check.name}: ${check.ok ? 'ok' : `fail (${check.error || 'unknown'})`}`)
      .join('\n')
    throw new Error(`Preflight checks failed:\n${details}`)
  }

  const previousSnapshot = await readSnapshotState()
  const systemPlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
  const systemPfConf = '/etc/pf.conf'
  const systemPfConfBackup = '/etc/pf.conf.backup'
  const snapshotExists = await navisSnapshotExists(previousSnapshot)
  const snapshotFresh = isSnapshotFresh(previousSnapshot)
  const shouldRotate = !snapshotExists || !snapshotFresh
  const snapshotBlock = shouldRotate
    ? previousSnapshot?.id
      ? `tmutil deletelocalsnapshots "${previousSnapshot.id}" || true; tmutil snapshot`
      : 'tmutil snapshot'
    : ''
  const shellCommand = [
    'set -euo pipefail',
    snapshotBlock || 'true',
    `launchctl bootout system "${systemPlist}" >/dev/null 2>&1 || true`,
    `rm -f "${systemPlist}"`,
    // Restore original pf.conf if backup exists
    `if [ -f "${systemPfConfBackup}" ]; then mv "${systemPfConfBackup}" "${systemPfConf}"; fi`,
  ].join('; ')

  await runMacOSAdminShell(shellCommand)
  await recordLatestSnapshot()
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
ExecStart=${nodePath} ${bridgeEntrypoint} start --setup-approved
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
  const binPath = `"${nodePath}" "${bridgeEntrypoint}" start --setup-approved`
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
