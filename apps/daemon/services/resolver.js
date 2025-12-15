/**
 * Local DNS Resolver Service
 * Handles navis.local resolution without requiring manual hosts file edits
 */

import { readFile, writeFile, access } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'

const execAsync = promisify(exec)

export class ResolverService {
  constructor() {
    this.hostsPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts'
    this.navisEntry = '127.0.0.1 navis.local'
    this.modified = false
  }

  async initialize() {
    console.log('🔍 Initializing resolver service...')

    // Try to ensure navis.local resolves
    await this.ensureNavisResolution()
  }

  async ensureNavisResolution() {
    try {
      // Check if navis.local already resolves
      const resolves = await this.checkResolution()
      if (resolves) {
        console.log('✅ navis.local already resolves')
        return true
      }

      // Try different approaches to make it resolve
      const methods = [
        () => this.checkAndModifyHosts(),
        () => this.setupLocalDNS(),
        () => this.configureDNSProxy()
      ]

      for (const method of methods) {
        try {
          const result = await method()
          if (result) {
            console.log('✅ navis.local resolution configured')
            this.modified = true
            return true
          }
        } catch (error) {
          console.log(`⚠️  Resolution method failed: ${error.message}`)
        }
      }

      console.log('⚠️  Could not configure navis.local resolution automatically')
      console.log('   Manual configuration may be required')
      return false

    } catch (error) {
      console.error('Failed to ensure navis.local resolution:', error.message)
      return false
    }
  }

  async checkResolution() {
    try {
      // Try to resolve navis.local using Node's DNS
      const { dns } = await import('node:dns')
      const { promisify } = await import('node:util')
      const resolve4 = promisify(dns.resolve4)

      const addresses = await resolve4('navis.local')
      return addresses.includes('127.0.0.1')
    } catch {
      return false
    }
  }

  async checkAndModifyHosts() {
    try {
      const hostsContent = await readFile(this.hostsPath, 'utf8')
      const lines = hostsContent.split('\n')

      // Check if entry already exists
      const hasEntry = lines.some(line =>
        line.includes('navis.local') && !line.trim().startsWith('#')
      )

      if (hasEntry) {
        console.log('✅ navis.local entry exists in hosts file')
        return true
      }

      // Try to add entry (may require sudo)
      if (process.platform !== 'win32') {
        // On Unix systems, try using sudo to modify hosts
        const tempFile = `${homedir()}/.navis_hosts_tmp`
        const newContent = hostsContent + `\n# Added by NavisAI\n${this.navisEntry}\n`
        await writeFile(tempFile, newContent)

        try {
          await execAsync(`sudo cp "${tempFile}" "${this.hostsPath}"`)
          await execAsync(`rm "${tempFile}"`)
          console.log('✅ Added navis.local to hosts file')
          return true
        } catch (error) {
          // Cleanup temp file
          await execAsync(`rm -f "${tempFile}"`)
          throw error
        }
      } else {
        // On Windows, suggest manual action
        console.log('⚠️  Please add to hosts file (run as Administrator):')
        console.log(`   ${this.navisEntry}`)
        return false
      }
    } catch (error) {
      throw new Error(`Failed to modify hosts file: ${error.message}`)
    }
  }

  async setupLocalDNS() {
    // On macOS, try to use resolver configuration
    if (process.platform === 'darwin') {
      try {
        const resolverFile = '/etc/resolver/navis.local'
        const resolverConfig = `
nameserver 127.0.0.1
port 5353
timeout 5
`

        // Check if resolver already exists
        try {
          await access(resolverFile)
          console.log('✅ Local DNS resolver already configured')
          return true
        } catch {
          // Try to create resolver (requires sudo)
          const tempFile = `${homedir()}/.navis_resolver_tmp`
          await writeFile(tempFile, resolverConfig)

          try {
            await execAsync(`sudo mkdir -p /etc/resolver`)
            await execAsync(`sudo cp "${tempFile}" "${resolverFile}"`)
            await execAsync(`rm "${tempFile}"`)
            console.log('✅ Local DNS resolver configured')
            return true
          } catch (error) {
            await execAsync(`rm -f "${tempFile}"`)
            throw error
          }
        }
      } catch (error) {
        throw new Error(`Failed to setup local DNS: ${error.message}`)
      }
    }

    return false
  }

  async configureDNSProxy() {
    // Try to start a local DNS server on port 5353 (mDNS port)
    // This would require additional implementation
    return false
  }

  async cleanup() {
    if (this.modified) {
      console.log('🧹 Cleaning up resolver configuration...')
      // In a full implementation, we might want to clean up
      // but for now, leave the configuration for persistence
    }
  }
}
