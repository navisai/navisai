#!/usr/bin/env node

import { exec as execCb, execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { installBridge, uninstallBridge } from './bridge.js'
import { detectOclp } from '@navisai/core/preflight'
import { getLogPath, logEvent } from './logging.js'

const execAsync = promisify(execCb)
const execFileAsync = promisify(execFileCb)

function escapeAppleScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

async function runOsascript(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script])
  return stdout.trim()
}

async function displayDialog(message, buttons = ['Cancel', 'Install'], defaultButton = 'Install') {
  const defaultIndex = Math.max(1, buttons.indexOf(defaultButton) + 1)
  await logEvent('info', 'Displaying dialog', { message, buttons, defaultButton })
  const script = `
tell application "System Events" to activate
set dialogText to "${escapeAppleScriptString(message)}"
set userChoice to button returned of (display dialog dialogText buttons {"${buttons.join('", "')}"} default button ${defaultIndex})
return userChoice
`
  const choice = await runOsascript(script)
  await logEvent('info', 'Dialog choice', { choice })
  return choice
}

async function showAlert(title, message) {
  await logEvent('info', 'Showing alert', { title, message })
  const script = `
tell application "System Events" to activate
display dialog "${escapeAppleScriptString(message)}" buttons {"OK"} default button "OK"
`
  await runOsascript(script)
}

async function openOnboarding() {
  await logEvent('info', 'Opening onboarding', { url: 'https://navis.local/welcome' })
  await execAsync('open https://navis.local/welcome')
}

async function readInstallLogSnippet() {
  const installLogPath = '/var/tmp/navis-bridge-install.log'
  try {
    const content = await fs.readFile(installLogPath, 'utf8')
    const lines = content.trim().split('\n')
    return {
      path: installLogPath,
      snippet: lines.slice(-40).join('\n')
    }
  } catch {
    return { path: installLogPath, snippet: null }
  }
}

async function isBridgeInstalled() {
  try {
    await execAsync('launchctl print system/com.navisai.bridge >/dev/null 2>&1')
    await logEvent('info', 'Bridge status checked', { installed: true })
    return true
  } catch {
    await logEvent('info', 'Bridge status checked', { installed: false })
    return false
  }
}

async function checkLaunchdService(label) {
  try {
    const { stdout } = await execAsync(`launchctl print system/${label} 2>/dev/null || true`, { encoding: 'utf8' })
    if (!stdout.trim()) return { loaded: false }
    const state = stdout.match(/\\bstate = (\\w+)/)?.[1] ?? null
    const pid = stdout.match(/\\bpid = (\\d+)/)?.[1] ?? null
    const lastExitCode = stdout.match(/\\blast exit code = (\\d+)/)?.[1] ?? null
    const mayBePermissionLimited = !stdout.includes('state =') && !stdout.includes('pid =')
    return { loaded: true, state, pid, lastExitCode, mayBePermissionLimited }
  } catch (error) {
    return { loaded: null, error: error.message }
  }
}

async function isNavisReachable() {
  try {
    const response = await fetch('https://navis.local/status')
    await logEvent('info', 'Navis reachability checked', { ok: response.ok })
    return response.ok
  } catch {
    await logEvent('warn', 'Navis reachability check failed')
    return false
  }
}

async function main() {
  await logEvent('info', 'Setup app started', { pid: process.pid })
  const bridgeInstalled = await isBridgeInstalled()
  const reachable = await isNavisReachable()
  const oclpStatus = await detectOclp()
  await logEvent('info', 'Detected environment', {
    bridgeInstalled,
    reachable,
    oclpDetected: oclpStatus.detected,
    oclpWarning: oclpStatus.warning
  })

  const statusLines = [
    `Bridge: ${bridgeInstalled ? 'Enabled' : 'Not enabled'}`,
    `Navis: ${reachable ? 'Reachable' : 'Not reachable (start with navisai up)'}`,
  ]

  const message = [
    'Navis uses a small system helper (Navis Bridge) to own port 443 so https://navis.local works on your LAN.',
    '',
    ...statusLines,
    '',
    bridgeInstalled
      ? 'Choose Disable to remove the bridge. This does NOT delete your local data.'
      : 'Choose Enable to install the bridge. This is a one-time action and will prompt for your password via the standard macOS security sheet.',
  ].join('\n')

  const buttons = bridgeInstalled ? ['Cancel', 'Disable', 'Open onboarding'] : ['Cancel', 'Enable']
  const defaultButton = bridgeInstalled ? 'Open onboarding' : 'Enable'

  const choice = await displayDialog(message, buttons, defaultButton)

  try {
    if (choice === 'Enable') {
      await logEvent('info', 'Enable selected')
      if (oclpStatus.detected) {
        const warning = [
          'OCLP detected on this Mac.',
          'Navis will apply stricter safeguards and create a snapshot before mutations.',
          'Proceed only if you understand the risks.',
        ].join('\n')
        const confirm = await displayDialog(warning, ['Cancel', 'Continue'], 'Continue')
        if (confirm !== 'Continue') {
          await logEvent('info', 'OCLP confirmation canceled')
          await showAlert('Setup canceled', 'No changes were made.')
          return
        }
      }
      await logEvent('info', 'Installing bridge')
      await installBridge('darwin')
      const bridgePlist = '/Library/LaunchDaemons/com.navisai.bridge.plist'
      const bridgeExists = await fs.access(bridgePlist).then(() => true).catch(() => false)
      const launchd = await checkLaunchdService('com.navisai.bridge')
      const installLog = await readInstallLogSnippet()
      await logEvent('info', 'Bridge install status', { bridgeExists, launchd })
      if (installLog.snippet) {
        await logEvent('info', 'Bridge install log snippet', { snippet: installLog.snippet })
      }

      if (bridgeExists && launchd.loaded && launchd.state === 'running') {
        await showAlert(
          'Enabled',
          'Navis Bridge is enabled. Start Navis with `navisai up` to begin onboarding at https://navis.local/welcome.'
        )
        return
      }

      const statusLines = [
        `Plist installed: ${bridgeExists ? 'yes' : 'no'} (${bridgePlist})`,
        launchd.loaded ? `launchd state: ${launchd.state ?? 'unknown'}` : 'launchd: not loaded',
      ]

      const logLines = installLog.snippet
        ? `\n\nLast install log lines:\n${installLog.snippet}`
        : ''
      await showAlert(
        'Setup incomplete',
        `Navis Bridge install finished but the service is not running.\n\n${statusLines.join('\n')}\n\nTry:\n- navisai setup --skip-ui\n- sudo launchctl kickstart -k system/com.navisai.bridge\n- navisai doctor\n\nLog: ${getLogPath()}\nInstall log: ${installLog.path}${logLines}\n\nRefs: navisai-45k`
      )
      return
    }

    if (choice === 'Disable') {
      await logEvent('info', 'Disable selected')
      await uninstallBridge('darwin')
      await showAlert(
        'Disabled',
        'Navis Bridge is disabled. https://navis.local will no longer be reachable without re-enabling. Your data was not removed.'
      )
      return
    }

    if (choice === 'Open onboarding') {
      await logEvent('info', 'Open onboarding selected')
      await openOnboarding()
      return
    }

    await logEvent('info', 'Setup canceled')
    await showAlert('Setup canceled', 'No changes were made.')
  } catch (error) {
    await logEvent('error', 'Setup failed', { error: error.message })
    await showAlert('Setup failed', error.message || 'See navisai doctor for details.')
    process.exit(1)
  }
}

main().catch(async (error) => {
  await logEvent('error', 'Setup app crashed', { error: error.message })
  console.error('Navis Setup app failed:', error)
  process.exit(1)
})
