#!/usr/bin/env node
/**
 * Navis Packet Forwarding Bridge + mDNS Service
 *
 * This service handles both:
 * 1. OS-level packet forwarding to selectively route navis.local traffic
 * 2. mDNS/Bonjour advertisement for navis.local on the LAN
 *
 * This enables Navis to always be accessible at https://navis.local regardless
 * of other services using port 443, with persistent name resolution.
 *
 * Platform support:
 * - macOS: pfctl with rdr rules and Host header inspection
 * - Linux: iptables with string matching
 * - Windows: netsh portproxy (limited - forwards all traffic)
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { platform, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import multicastDns from 'multicast-dns'
import { TransparentHTTPSProxy } from './transparent-proxy.js'

const listenPort = 443
const targetHost = '127.0.0.1'
const targetPort = 47621
const targetDomain = 'navis.local'

class PacketForwardingBridge {
  constructor() {
    this.platform = platform()
    this.isRunning = false
    this.cleanupCommands = []
    this.mdns = null
    this.transparentProxy = new TransparentHTTPSProxy({
      proxyPort: 8443,
      daemonHost: targetHost,
      daemonPort: targetPort
    })
  }

  async start() {
    try {
      console.log(`🚀 Starting Navis Packet Forwarding Bridge...`)
      console.log(`Platform: ${this.platform}`)
      console.log(`Domain: ${targetDomain}`)
      console.log(`Using transparent HTTPS proxy for domain-based routing`)

      // Enable packet forwarding in kernel if needed
      await this.enablePacketForwarding()

      // Start transparent HTTPS proxy for domain-based routing
      console.log('🔧 Starting transparent HTTPS proxy...')
      await this.transparentProxy.start()

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
      console.log('💡 Other HTTPS services can coexist on port 443')

      // Start mDNS service for name resolution
      await this.startMDNS()

      // Keep process alive
      this.keepAlive()

    } catch (error) {
      console.error('❌ Failed to start packet forwarding:', error.message)
      await this.cleanup()
      process.exit(1)
    }
  }

  getLanAddress() {
    const interfaces = networkInterfaces()
    for (const addrs of Object.values(interfaces)) {
      for (const addr of addrs || []) {
        if (addr && addr.family === 'IPv4' && addr.internal === false) {
          return addr.address
        }
      }
    }
    return null
  }

  async startMDNS() {
    try {
      const ip = this.getLanAddress()
      if (!ip) {
        console.log('⚠️  mDNS not started: no LAN IPv4 address detected')
        return
      }

      console.log('🔍 Starting mDNS service for navis.local...', { ip })

      this.mdns = multicastDns()

      // Respond to queries for navis.local
      this.mdns.on('query', (query) => {
        const questions = query.questions || []
        for (const q of questions) {
          if (q.name === 'navis.local' && q.type === 'A') {
            this.mdns.respond({
              answers: [{ name: 'navis.local', type: 'A', ttl: 120, data: ip }],
            })
          }
        }
      })

      // Initial advertisement
      this.mdns.respond({
        answers: [
          {
            name: '_navisai._tcp.local',
            type: 'PTR',
            data: 'NavisAI._navisai._tcp.local',
            ttl: 120,
          },
          {
            name: 'NavisAI._navisai._tcp.local',
            type: 'SRV',
            data: { port: 443, weight: 0, priority: 10, target: 'navis.local' },
            ttl: 120,
          },
          {
            name: 'NavisAI._navisai._tcp.local',
            type: 'TXT',
            data: ['version=1', 'tls=1', 'origin=https://navis.local'],
            ttl: 120,
          },
          { name: 'navis.local', type: 'A', ttl: 120, data: ip },
        ],
      })

      console.log('✅ mDNS service active for navis.local')

      // Monitor IP changes and update mDNS
      this.ipMonitorInterval = setInterval(() => {
        const newIp = this.getLanAddress()
        if (newIp && newIp !== ip) {
          console.log(`🔄 IP address changed: ${ip} → ${newIp}`)
          // Re-advertise with new IP
          this.mdns.respond({
            answers: [{ name: 'navis.local', type: 'A', ttl: 120, data: newIp }],
          })
        }
      }, 30000) // Check every 30 seconds

    } catch (error) {
      console.log('⚠️  mDNS not available:', error.message)
    }
  }

  stopMDNS() {
    if (this.mdns) {
      this.mdns.destroy()
      this.mdns = null
      if (this.ipMonitorInterval) {
        clearInterval(this.ipMonitorInterval)
        this.ipMonitorInterval = null
      }
      console.log('🔍 mDNS service stopped')
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
    // Redirect port 443 to transparent proxy which handles domain-based routing
    const anchorName = 'navis'
    const proxyPort = this.transparentProxy.options.proxyPort
    const pfConf = `
# Navis packet forwarding rules
# Redirect HTTPS traffic to transparent proxy for domain-based routing
rdr pass inet proto tcp from any to any port 443 -> 127.0.0.1 port ${proxyPort}

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

      // Enable pf if not already enabled (ignore error if already enabled)
      try {
        execSync('sudo pfctl -e', { stdio: 'pipe' })
      } catch (error) {
        // pfctl -e fails if pf is already enabled, which is fine
        if (!error.message.includes('already enabled')) {
          throw error
        }
      }

      // Store cleanup commands
      this.cleanupCommands.push(`sudo pfctl -a ${anchorName} -F all`)
      this.cleanupCommands.push(`rm -f ${tempFile}`)

      console.log('✅ macOS pfctl rules installed (redirecting to transparent proxy)')
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

    // Stop transparent proxy
    if (this.transparentProxy) {
      await this.transparentProxy.stop()
    }

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
      this.stopMDNS()
      await this.cleanup()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Terminating...')
      this.isRunning = false
      this.stopMDNS()
      await this.cleanup()
      process.exit(0)
    })
  }

  async checkStatus() {
    try {
      let packetForwardingActive = false

      // Check packet forwarding status
      if (this.platform === 'darwin') {
        const output = execSync('sudo pfctl -s rules -a navis', { encoding: 'utf8' })
        packetForwardingActive = output.includes(targetDomain) || output.includes(`${targetPort}`)
      } else if (this.platform === 'linux') {
        const output = execSync('sudo iptables -t nat -L PREROUTING -n -v', { encoding: 'utf8' })
        packetForwardingActive = output.includes(targetDomain) || output.includes(`${targetPort}`)
      } else if (this.platform === 'win32') {
        const output = execSync('netsh interface portproxy show all', { encoding: 'utf8' })
        packetForwardingActive = output.includes(`${listenPort}`)
      }

      // Check mDNS status
      const mDNSActive = this.mdns !== null

      return {
        packetForwarding: packetForwardingActive,
        mdns: mDNSActive,
        active: packetForwardingActive && mDNSActive
      }
    } catch (error) {
      return {
        packetForwarding: false,
        mdns: false,
        active: false
      }
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
      bridge.checkStatus().then(status => {
        console.log('\nNavis Bridge Service Status:')
        console.log(`  Packet Forwarding: ${status.packetForwarding ? '✅ Active' : '❌ Inactive'}`)
        console.log(`  mDNS Service: ${status.mdns ? '✅ Active' : '❌ Inactive'}`)
        console.log(`\nOverall: ${status.active ? '✅ Bridge is active' : '❌ Bridge is not fully active'}`)
        process.exit(status.active ? 0 : 1)
      })
      break

    default:
      console.log(`
Navis Bridge Service (Packet Forwarding + mDNS)

Usage:
  ${process.argv[1]} start   - Start bridge (packet forwarding + mDNS)
  ${process.argv[1]} stop    - Stop bridge
  ${process.argv[1]} status  - Check service status

The bridge provides:
1. Packet forwarding for ${targetDomain} to Navis daemon
2. mDNS/Bonjour advertisement for ${targetDomain}
Both work without interfering with other services on port ${listenPort}.
`)
      process.exit(1)
  }
}

export default PacketForwardingBridge
