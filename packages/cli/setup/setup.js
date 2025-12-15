#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'

const execAsync = promisify(exec)

const NAVIS_LOCAL_ENTRY = '127.0.0.1 navis.local'

export async function ensureNavisLocal() {
  const platform = os.platform()

  if (platform === 'darwin' || platform === 'linux') {
    await setupUnixHosts()
  } else if (platform === 'win32') {
    await setupWindowsHosts()
  } else {
    console.log(`⚠️  Platform ${platform} not supported for automatic DNS setup`)
    console.log('   Please manually add navis.local to your hosts file')
  }
}

async function setupUnixHosts() {
  const hostsPath = '/etc/hosts'

  try {
    // Check if navis.local already exists
    const { stdout } = await execAsync(`grep navis.local ${hostsPath}`)
    console.log('✅ navis.local already configured in hosts file')
    return
  } catch {
    // Not found, need to add it
    console.log('🔧 Adding navis.local to hosts file...')

    try {
      // Try to append to hosts file
      await execAsync(`echo "${NAVIS_LOCAL_ENTRY}" | sudo tee -a ${hostsPath}`)
      console.log('✅ Added navis.local to hosts file')
    } catch (error) {
      if (error.code === 130) {
        // User cancelled sudo
        console.log('\n❌ Setup cancelled: sudo access required')
        console.log('\nTo manually configure, run:')
        console.log(`  sudo echo "${NAVIS_LOCAL_ENTRY}" >> ${hostsPath}`)
      } else {
        console.error('Failed to update hosts file:', error.message)
      }
      process.exit(1)
    }
  }
}

async function setupWindowsHosts() {
  const hostsPath = path.join(os.homedir(), 'System32', 'drivers', 'etc', 'hosts')

  try {
    const content = await readFile(hostsPath, 'utf8')

    if (content.includes('navis.local')) {
      console.log('✅ navis.local already configured in hosts file')
      return
    }

    console.log('🔧 Adding navis.local to hosts file...')
    console.log('\n⚠️  Please run as Administrator and add this line to:')
    console.log(`   ${hostsPath}`)
    console.log(`   ${NAVIS_LOCAL_ENTRY}`)

  } catch (error) {
    console.error('Failed to read hosts file:', error.message)
    console.log('\nPlease manually add this line to your hosts file:')
    console.log(`${NAVIS_LOCAL_ENTRY}`)
  }
}

// Check if we can resolve navis.local
export async function checkNavisLocalResolution() {
  try {
    await execAsync('ping -c 1 navis.local')
    return true
  } catch {
    return false
  }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('NavisAI DNS Setup')
  console.log('================\n')

  const canResolve = await checkNavisLocalResolution()
  if (canResolve) {
    console.log('✅ navis.local resolves correctly')
  } else {
    console.log('❌ navis.local does not resolve')
    await ensureNavisLocal()
  }
}
