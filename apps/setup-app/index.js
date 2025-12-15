#!/usr/bin/env node

import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { installBridge } from './bridge.js'

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

async function main() {
  const message = [
    'Navis needs to install a small system helper to own port 443 and forward traffic to the local daemon.',
    '',
    'This is a one-time action. After the bridge is active, you can start Navis via `navisai up` and visit https://navis.local/welcome without needing a password.'
  ].join('\\n')

  const choice = await displayDialog(message)
  if (choice !== 'Install') {
    await showAlert('Setup canceled', 'No changes were made.')
    process.exit(0)
  }

  try {
    await installBridge('darwin')
    await showAlert('Success', 'Navis is now accessible at https://navis.local. Open it to continue onboarding.')
    await openOnboarding()
  } catch (error) {
    await showAlert('Installation failed', error.message || 'See navisai doctor for details.')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Navis Setup app failed:', error)
  process.exit(1)
})
