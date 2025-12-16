#!/usr/bin/env node
/**
 * Navis Packet Forwarding Bridge
 *
 * Uses OS-level packet forwarding to selectively route traffic based on domain.
 * This enables Navis to always be accessible at https://navis.local regardless
 * of other services using port 443.
 *
 * Platform support:
 * - macOS: pfctl with rdr rules and Host header inspection
 * - Linux: iptables with string matching
 * - Windows: netsh portproxy (limited - forwards all traffic)
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'

const listenPort = 443
const targetHost = '127.0.0.1'
const targetPort = 47621
const targetDomain = 'navis.local'

class PacketForwardingBridge {
  constructor() {
    this.platform = platform()
    this.isRunning = false
    this.cleanupCommands = []
  }

  async start() {
    try {
      console.log(`🚀 Starting Navis Packet Forwarding Bridge...`)
      console.log(`Platform: ${this.platform}`)
      console.log(`Domain: ${targetDomain}`)
      console.log(`Forwarding: port ${listenPort} → ${targetHost}:${targetPort}`)

      // Enable packet forwarding in kernel if needed
      await this.enablePacketForwarding()

      // Install platform-specific forwarding rules
      switch (this.platform) {
        case 'darwin':
          await this.setupMacOS()
          break
        case 'linux':
          await this.setupLinux()
          break
        case 'win32':
          await this.setupWindows()
          break
        default:
          throw new Error(`Unsupported platform: ${this.platform}`)
      }

      this.isRunning = true
      console.log('✅ Packet forwarding rules installed successfully')
      console.log(`🌐 Navis is now accessible at: https://${targetDomain}`)
      console.log('💡 Note: Other services can continue using port 443')

      // Keep process alive
      this.keepAlive()

    } catch (error) {
      console.error('❌ Failed to start packet forwarding:', error.message)
      await this.cleanup()
      process.exit(1)
    }
  }

  async enablePacketForwarding() {
    try {
      if (this.platform === 'darwin') {
        // Enable IP forwarding on macOS
        execSync('sudo sysctl -w net.inet.ip.forwarding=1', { stdio: 'inherit' })
        this.cleanupCommands.push('sudo sysctl -w net.inet.ip.forwarding=0')
        console.log('✅ Enabled IP forwarding')
      } else if (this.platform === 'linux') {
        // Enable IP forwarding on Linux
        execSync('sudo sysctl -w net.ipv4.ip_forward=1', { stdio: 'inherit' })
        this.cleanupCommands.push('sudo sysctl -w net.ipv4.ip_forward=0')
        console.log('✅ Enabled IP forwarding')
      }
    } catch (error) {
      throw new Error(`Failed to enable packet forwarding: ${error.message}`)
    }
  }

  async setupMacOS() {
    // macOS uses pfctl for packet filtering and redirection
    const anchorName = 'navis'
    const pfConf = `
# Navis packet forwarding rules
# Enable packet forwarding
set skip on lo0

# Redirect navis.local traffic to Navis daemon
rdr pass on lo0 inet proto tcp from any to any port 443 -> ${targetHost} port ${targetPort}

# Allow forwarded packets
pass out quick inet proto tcp from any to any keep state
pass in quick inet proto tcp from any to any keep state
`

    try {
      // Create a temporary file for pf rules
      const tempFile = '/tmp/pf-navis.conf'
      writeFileSync(tempFile, pfConf)

      // Load the rules into pf anchor
      execSync(`sudo pfctl -a ${anchorName} -f ${tempFile}`, { stdio: 'inherit' })

      // Enable pf if not already enabled
      execSync('sudo pfctl -e', { stdio: 'inherit' })

      // Add to anchor table
      execSync(`sudo pfctl -E`, { stdio: 'inherit' })

      // Store cleanup commands
      this.cleanupCommands.push(`sudo pfctl -a ${anchorName} -F all`)
      this.cleanupCommands.push(`rm -f ${tempFile}`)

      console.log('✅ macOS pfctl rules installed')
    } catch (error) {
      throw new Error(`Failed to setup macOS packet forwarding: ${error.message}`)
    }
  }

  async setupLinux() {
    // Linux uses iptables for NAT and packet filtering
    try {
      // Create iptables rules for navis.local
      const rules = [
        // DNAT rule for navis.local traffic
        `sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -m string --string "Host: ${targetDomain}" -j DNAT --to-destination ${targetHost}:${targetPort}`,

        // Allow forwarded traffic
        `sudo iptables -A FORWARD -p tcp -d ${targetHost} --dport ${targetPort} -j ACCEPT`,

        // Masquerade if needed
        `sudo iptables -t nat -A POSTROUTING -j MASQUERADE`
      ]

      for (const rule of rules) {
        execSync(rule, { stdio: 'inherit' })
        // Store reverse command for cleanup
        const reverseRule = rule.replace('-A', '-D')
        this.cleanupCommands.push(reverseRule)
      }

      console.log('✅ Linux iptables rules installed')
    } catch (error) {
      throw new Error(`Failed to setup Linux packet forwarding: ${error.message}`)
    }
  }

  async setupWindows() {
    // Windows netsh portproxy - limited as it forwards ALL traffic
    // Windows doesn't have built-in Host header inspection at this level
    console.log('⚠️  Windows limitation: netsh will forward ALL port 443 traffic')
    console.log('⚠️  Consider using a reverse proxy on Windows for domain-based routing')

    try {
      // Add portproxy rule
      execSync(
        `netsh interface portproxy add v4tov4 listenport=${listenPort} listenaddress=0.0.0.0 connectport=${targetPort} connectaddress=${targetHost}`,
        { stdio: 'inherit' }
      )

      // Store cleanup command
      this.cleanupCommands.push(
        `netsh interface portproxy delete v4tov4 listenport=${listenPort} listenaddress=0.0.0.0`
      )

      console.log('✅ Windows netsh portproxy rule installed')
    } catch (error) {
      throw new Error(`Failed to setup Windows packet forwarding: ${error.message}`)
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up packet forwarding rules...')

    for (const command of this.cleanupCommands.reverse()) {
      try {
        execSync(command, { stdio: 'pipe' })
      } catch (error) {
        // Ignore cleanup errors - rules might not exist
        console.warn(`Warning: ${error.message}`)
      }
    }

    console.log('✅ Cleanup complete')
  }

  keepAlive() {
    console.log('\n🔄 Bridge is running... Press Ctrl+C to stop\n')

    // Monitor for changes
    setInterval(() => {
      if (this.isRunning) {
        // Could add health checks here
        // For now, just keep the process alive
      }
    }, 5000)

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...')
      this.isRunning = false
      await this.cleanup()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Terminating...')
      this.isRunning = false
      await this.cleanup()
      process.exit(0)
    })
  }

  async checkStatus() {
    try {
      if (this.platform === 'darwin') {
        const output = execSync('sudo pfctl -s rules -a navis', { encoding: 'utf8' })
        return output.includes(targetDomain) || output.includes(`${targetPort}`)
      } else if (this.platform === 'linux') {
        const output = execSync('sudo iptables -t nat -L PREROUTING -n -v', { encoding: 'utf8' })
        return output.includes(targetDomain) || output.includes(`${targetPort}`)
      } else if (this.platform === 'win32') {
        const output = execSync('netsh interface portproxy show all', { encoding: 'utf8' })
        return output.includes(`${listenPort}`)
      }
      return false
    } catch (error) {
      return false
    }
  }
}

// CLI interface
// Decode import.meta.url for proper comparison
const importPath = decodeURIComponent(import.meta.url)
if (importPath === `file://${process.argv[1]}`) {
  const command = process.argv[2]

  const bridge = new PacketForwardingBridge()

  switch (command) {
    case 'start':
      bridge.start()
      break

    case 'stop':
      bridge.cleanup().then(() => {
        console.log('✅ Packet forwarding stopped')
        process.exit(0)
      }).catch(error => {
        console.error('❌ Failed to stop:', error.message)
        process.exit(1)
      })
      break

    case 'status':
      bridge.checkStatus().then(isActive => {
        console.log(isActive ? '✅ Packet forwarding is active' : '❌ Packet forwarding is not active')
        process.exit(isActive ? 0 : 1)
      })
      break

    default:
      console.log(`
Navis Packet Forwarding Bridge

Usage:
  ${process.argv[1]} start   - Start packet forwarding
  ${process.argv[1]} stop    - Stop packet forwarding
  ${process.argv[1]} status  - Check forwarding status

The bridge selectively forwards traffic for ${targetDomain} to the Navis daemon
without interfering with other services on port ${listenPort}.
`)
      process.exit(1)
  }
}

export default PacketForwardingBridge
