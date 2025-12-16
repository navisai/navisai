#!/usr/bin/env node

import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { installBridge, uninstallBridge } from './bridge.js'

const execAsync = promisify(execCb)

async function displayDialog(message, buttons = ['Cancel', 'Install'], defaultButton = 'Install') {
  const buttonList = buttons.map(b => `"${b}"`).join(', ')
  const script = `
    display dialog "${escapeAppleScriptString(message)}"
    buttons {${buttonList}}
    default button "${defaultButton}"
    with title "Navis Setup"
    with icon note
  `
  const { stdout } = await execAsync(`osascript -e ${escapeAppleScriptString(script)}`)
  return stdout.trim()
}

async function showAlert(title, message) {
  const script = `
    display dialog "${escapeAppleScriptString(message)}" buttons {"OK"} default button "OK" with title "${title}" with icon caution
  `
  await execAsync(`osascript -e ${escapeAppleScriptString(script)}`)
}

function escapeAppleScriptString(value) {
  return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

async function openOnboarding() {
  await execAsync('open https://navis.local/welcome')
}

async function isBridgeInstalled() {
  try {
    await execAsync('launchctl print system/com.navisai.bridge >/dev/null 2>&1')
    return true
  } catch {
    return false
  }
}

async function isNavisReachable() {
  try {
    const response = await fetch('https://navis.local/status')
    return response.ok
  } catch {
    return false
  }
}

async function main() {
  const bridgeInstalled = await isBridgeInstalled()
  const reachable = await isNavisReachable()

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
  ].join('\\n')

  const buttons = bridgeInstalled ? ['Cancel', 'Disable', 'Open onboarding'] : ['Cancel', 'Enable']
  const defaultButton = bridgeInstalled ? 'Open onboarding' : 'Enable'

  const choice = await displayDialog(message, buttons, defaultButton)

  try {
    if (choice === 'Enable') {
      await installBridge('darwin')
      await showAlert(
        'Enabled',
        'Navis Bridge is enabled. Start Navis with `navisai up`, then open https://navis.local/welcome.'
      )
      await openOnboarding()
      return
    }

    if (choice === 'Disable') {
      await uninstallBridge('darwin')
      await showAlert(
        'Disabled',
        'Navis Bridge is disabled. https://navis.local will no longer be reachable without re-enabling. Your data was not removed.'
      )
      return
    }

    if (choice === 'Open onboarding') {
      await openOnboarding()
      return
    }

    await showAlert('Setup canceled', 'No changes were made.')
  } catch (error) {
    await showAlert('Setup failed', error.message || 'See navisai doctor for details.')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Navis Setup app failed:', error)
  process.exit(1)
})
