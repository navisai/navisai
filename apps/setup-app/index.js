#!/usr/bin/env node

import { exec as execCb, execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { promisify } from 'node:util'
import { installBridge, uninstallBridge, runMacOSAdminShell } from './bridge.js'
import { detectOclp } from '@navisai/core/preflight'
import { getLogPath, logEvent } from './logging.js'

const execAsync = promisify(execCb)
const execFileAsync = promisify(execFileCb)

function escapeAppleScriptString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

async function runOsascript(script, options = {}) {
  const { command, args } = await getOsascriptCommand(['-e', script], options)
  const { stdout } = await execFileAsync(command, args)
  return stdout.trim()
}

let cachedConsoleUid = null

async function getConsoleUid() {
  if (cachedConsoleUid) return cachedConsoleUid
  try {
    const { stdout } = await execAsync('stat -f %u /dev/console', { encoding: 'utf8' })
    const uid = stdout.trim()
    if (uid) cachedConsoleUid = uid
  } catch {
    // Ignore lookup errors.
  }
  return cachedConsoleUid
}

async function getOsascriptCommand(args, options = {}) {
  const forceAsUser = options.forceAsUser || process.env.NAVIS_SETUP_FORCE_ASUSER === '1'
  if (!forceAsUser) {
    return { command: 'osascript', args }
  }

  const uid = await getConsoleUid()
  if (!uid) {
    return { command: 'osascript', args }
  }

  return { command: 'launchctl', args: ['asuser', String(uid), 'osascript', ...args] }
}

async function getFrontmostAppName() {
  try {
    return await runOsascript('tell application "System Events" to get name of first application process whose frontmost is true')
  } catch {
    return null
  }
}

async function displayDialog(message, buttons = ['Cancel', 'Install'], defaultButton = 'Install') {
  const defaultIndex = Math.max(1, buttons.indexOf(defaultButton) + 1)
  const frontmost = await getFrontmostAppName()
  const securitySessionId = process.env.SECURITYSESSIONID ?? null
  const start = Date.now()
  const script = `
tell application "System Events" to activate
set dialogText to "${escapeAppleScriptString(message)}"
set userChoice to button returned of (display dialog dialogText buttons {"${buttons.join('", "')}"} default button ${defaultIndex})
return userChoice
`
  await logEvent('info', 'Displaying dialog', {
    message,
    buttons,
    defaultButton,
    frontmost,
    securitySessionId
  })
  if (!securitySessionId) {
    await logEvent('warn', 'Dialog missing SECURITYSESSIONID; attempting GUI as user', {
      frontmost
    })
    try {
      const choice = await runOsascript(script, { forceAsUser: true })
      const elapsedMs = Date.now() - start
      const autoDefaultSuspected = choice === defaultButton && elapsedMs < 1000
      await logEvent('info', 'Dialog choice', {
        choice,
        elapsedMs,
        method: 'gui_asuser',
        defaultSelected: choice === defaultButton,
        autoDefaultSuspected
      })
      if (autoDefaultSuspected) {
        await logEvent('warn', 'Dialog default returned too quickly; possible auto-default', {
          elapsedMs,
          method: 'gui_asuser'
        })
      }
      return choice
    } catch (error) {
      await logEvent('warn', 'Dialog GUI attempt failed; falling back to CLI', {
        error: error.message,
        frontmost
      })
      const choice = await promptDialog(message, buttons, defaultButton)
      const elapsedMs = Date.now() - start
      await logEvent('info', 'Dialog choice', {
        choice,
        elapsedMs,
        method: 'cli',
        defaultSelected: choice === defaultButton,
        autoDefaultSuspected: false
      })
      return choice
    }
  }

  const choice = await runOsascript(script)
  const elapsedMs = Date.now() - start
  const autoDefaultSuspected = choice === defaultButton && elapsedMs < 1000
  await logEvent('info', 'Dialog choice', {
    choice,
    elapsedMs,
    method: 'gui',
    defaultSelected: choice === defaultButton,
    autoDefaultSuspected
  })
  if (autoDefaultSuspected) {
    await logEvent('warn', 'Dialog default returned too quickly; possible auto-default', {
      elapsedMs,
      method: 'gui'
    })
  }
  return choice
}

async function promptDialog(message, buttons, defaultButton) {
  const rl = createInterface({ input, output })
  try {
    console.log('\n' + message + '\n')
    buttons.forEach((label, index) => {
      console.log(`  ${index + 1}) ${label}`)
    })
    const defaultIndex = Math.max(1, buttons.indexOf(defaultButton) + 1)
    const answer = await rl.question(`Choose [1-${buttons.length}] (default ${defaultIndex}): `)
    const selection = Number.parseInt(answer.trim() || String(defaultIndex), 10)
    const index = Number.isFinite(selection) ? Math.min(Math.max(selection, 1), buttons.length) : defaultIndex
    return buttons[index - 1]
  } finally {
    rl.close()
  }
}

async function showAlert(title, message) {
  await logEvent('info', 'Showing alert', { title, message })
  const start = Date.now()
  const script = `
tell application "System Events" to activate
display dialog "${escapeAppleScriptString(message)}" buttons {"OK"} default button "OK"
`
  const securitySessionId = process.env.SECURITYSESSIONID ?? null
  if (!securitySessionId) {
    await logEvent('warn', 'Alert missing SECURITYSESSIONID; attempting GUI as user', { title })
    try {
      await runOsascript(script, { forceAsUser: true })
      await logEvent('info', 'Alert dismissed', {
        title,
        elapsedMs: Date.now() - start,
        method: 'gui_asuser'
      })
      return
    } catch (error) {
      await logEvent('warn', 'Alert GUI attempt failed; falling back to console', {
        title,
        error: error.message
      })
      console.log(`\n${title}\n${message}\n`)
      await logEvent('info', 'Alert dismissed', {
        title,
        elapsedMs: Date.now() - start,
        method: 'console'
      })
      return
    }
  }

  await runOsascript(script)
  await logEvent('info', 'Alert dismissed', { title, elapsedMs: Date.now() - start, method: 'gui' })
}

async function openOnboarding() {
  await logEvent('info', 'Opening onboarding', { url: 'https://navis.local/welcome' })
  await execAsync('open https://navis.local/welcome')
}

async function checkNavisCertTrust() {
  const certPath = join(homedir(), '.navis', 'certs', 'navis.local-ca.crt')
  try {
    await fs.access(certPath)
  } catch {
    await logEvent('warn', 'Navis cert missing', { certPath })
    return { ok: false, missing: true, certPath }
  }

  try {
    const [systemResult, loginResult, trustSettingsOk] = await Promise.all([
      execAsync('security find-certificate -c "NavisAI Local Development CA" -a -Z /Library/Keychains/System.keychain', { encoding: 'utf8' })
        .then((res) => res.stdout.trim())
        .catch(() => ''),
      execAsync(`security find-certificate -c "NavisAI Local Development CA" -a -Z "${homedir()}/Library/Keychains/login.keychain-db"`, { encoding: 'utf8' })
        .then((res) => res.stdout.trim())
        .catch(() => ''),
      hasAdminTrustSettings(certPath)
    ])

    const inSystemKeychain = Boolean(systemResult)
    const inLoginKeychain = Boolean(loginResult)
    if (!inSystemKeychain && !inLoginKeychain) {
      await logEvent('warn', 'Navis cert not trusted (missing from keychains)', { certPath })
      return { ok: false, certPath }
    }
    if (!trustSettingsOk) {
      await logEvent('warn', 'Navis cert trust settings missing', { certPath })
      return { ok: false, certPath }
    }

    await logEvent('info', 'Navis cert trust check passed', {
      certPath,
      inSystemKeychain,
      inLoginKeychain,
      trustSettingsOk
    })
    return { ok: true, certPath }
  } catch (error) {
    await logEvent('warn', 'Navis cert trust check failed', { certPath, error: error.message })
    return { ok: false, certPath, error: error.message }
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
  const sha1 = await getCertSha1(certPath)
  if (!sha1) return false
  const trustFile = join(homedir(), '.navis', 'trust-settings.plist')
  try {
    await execAsync(`security trust-settings-export -d "${trustFile}"`)
    const { stdout } = await execAsync(`plutil -p "${trustFile}"`, { encoding: 'utf8' })
    const keyMarker = `"${sha1}" => {`
    const startIndex = stdout.indexOf(keyMarker)
    if (startIndex === -1) return false
    const snippet = stdout.slice(startIndex, startIndex + 800)
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

async function ensureDesktopCertTrust() {
  const trust = await checkNavisCertTrust()
  if (trust.ok) return true

  if (trust.missing) {
    await showAlert(
      'Certificate not found',
      'Navis has not generated a local CA certificate yet. Start Navis with `navisai up`, then reopen setup to trust https://navis.local.'
    )
    return false
  }

  const message = [
    'Navis uses a local CA certificate for navis.local.',
    'Browsers will show “Not Secure” until this CA certificate is trusted on this Mac.',
    '',
    `Certificate: ${trust.certPath}`,
    '',
    'Choose “Trust automatically” to install it in Keychain without searching.'
  ].join('\n')
  const choice = await displayDialog(message, ['Not now', 'Open CA certificate', 'Trust automatically'], 'Trust automatically')
  if (choice === 'Trust automatically') {
    const shellCommand = [
      'set -euo pipefail',
      `CERT_PATH="${trust.certPath}"`,
      `USER_HOME="${homedir()}"`,
      'SYSTEM_KEYCHAIN="/Library/Keychains/System.keychain"',
      'LOGIN_KEYCHAIN="$USER_HOME/Library/Keychains/login.keychain-db"',
      'security delete-certificate -c "NavisAI Local Development CA" "$SYSTEM_KEYCHAIN" 2>/dev/null || true',
      'security delete-certificate -c "NavisAI Local Development CA" "$LOGIN_KEYCHAIN" 2>/dev/null || true',
      'security delete-certificate -c "navis.local" "$SYSTEM_KEYCHAIN" 2>/dev/null || true',
      'security delete-certificate -c "navis.local" "$LOGIN_KEYCHAIN" 2>/dev/null || true',
      'security add-trusted-cert -d -r trustRoot -p ssl -k "$SYSTEM_KEYCHAIN" "$CERT_PATH"',
      'security add-trusted-cert -d -r trustRoot -p ssl -k "$LOGIN_KEYCHAIN" "$CERT_PATH" || true',
    ].join('\n')
    try {
      await runMacOSAdminShell(shellCommand)
    } catch (error) {
      const message = String(error?.message || '')
      let detail = 'Trust installation failed. You can trust the CA manually in Keychain Access and then retry setup.'
      if (message.includes('User interaction is not allowed')) {
        detail = 'macOS blocked the trust prompt. Check that the setup app is allowed to show admin prompts and try again.'
      } else if (message.toLowerCase().includes('not permitted') || message.toLowerCase().includes('authorization')) {
        detail = 'Your Mac security policy or MDM may block certificate trust changes. Ask your admin or use manual Keychain trust.'
      } else if (message.toLowerCase().includes('timed out')) {
        detail = 'The admin approval timed out. Keep the macOS sheet visible and approve it, then retry.'
      }
      await showAlert('Trust failed', detail)
    }
  }
  if (choice === 'Open CA certificate') {
    await execAsync(`open "${trust.certPath}"`)
    await showAlert(
      'Trust NavisAI Local Development CA',
      'In Keychain Access: add the CA certificate to the System keychain, then set “When using this certificate” to “Always Trust”. Reload https://navis.local/welcome afterwards.'
    )
  }

  const recheck = await checkNavisCertTrust()
  if (recheck.ok) return true

  await showAlert(
    'Setup incomplete',
    'Navis requires the local CA certificate to be trusted before setup can complete. Trust the CA certificate in Keychain Access, then run setup again.'
  )
  return false
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
    let state = stdout.match(/\\bstate = (\\w+)/)?.[1] ?? null
    let pid = stdout.match(/\\bpid = (\\d+)/)?.[1] ?? null
    const lastExitCode = stdout.match(/\\blast exit code = (\\d+)/)?.[1] ?? null
    if (!state && stdout.includes('state = running')) state = 'running'
    const mayBePermissionLimited = !stdout.includes('state =') && !stdout.includes('pid =')

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

    return { loaded: true, state, pid, lastExitCode, mayBePermissionLimited }
  } catch (error) {
    return { loaded: null, error: error.message }
  }
}

async function isNavisReachable() {
  const controller = new AbortController()
  const timeoutMs = 1500
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://navis.local/status', { signal: controller.signal })
    await logEvent('info', 'Navis reachability checked', { ok: response.ok })
    return response.ok
  } catch {
    await logEvent('warn', 'Navis reachability check failed', { timeoutMs })
    return false
  } finally {
    clearTimeout(timeout)
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
      ? 'Choose Disable to remove the bridge and remove the trusted Navis CA certificate from Keychain. This does NOT delete your local data.'
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

      const launchdRunning = launchd.state === 'running' || Boolean(launchd.pid)
      const launchdSuccessMarker = installLog.snippet?.includes('SUCCESS: Bridge service installed and started via launchd')

      if (bridgeExists && launchd.loaded && (launchdRunning || launchdSuccessMarker)) {
        const trustOk = await ensureDesktopCertTrust()
        if (!trustOk) {
          await logEvent('warn', 'Setup blocked: desktop trust incomplete')
          process.exitCode = 1
          return
        }
        await showAlert(
          'Enabled',
          'Navis Bridge is enabled. Start Navis with `navisai up` to begin onboarding at https://navis.local/welcome.\n\nIf a Chromium-based browser (Brave/Chrome) still shows “Not Secure”, restart the browser and clear HSTS for navis.local (brave://net-internals/#hsts).'
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
      await uninstallBridge({ platformOverride: 'darwin', removeTrustedCerts: true, userHome: homedir() })
      await showAlert(
        'Disabled',
        'Navis Bridge is disabled. https://navis.local will no longer be reachable without re-enabling. Your data was not removed.'
      )
      return
    }

    if (choice === 'Open onboarding') {
      await logEvent('info', 'Open onboarding selected')
      const trustOk = await ensureDesktopCertTrust()
      if (!trustOk) {
        await logEvent('warn', 'Open onboarding blocked: desktop trust incomplete')
        process.exitCode = 1
        return
      }
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
