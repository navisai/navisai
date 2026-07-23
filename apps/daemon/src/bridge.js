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
import { runPreflightChecks } from '@navisai/core/preflight'
import { readSnapshotState, isSnapshotFresh, navisSnapshotExists } from '@navisai/core/snapshot'

const listenPort = 443
const targetHost = '127.0.0.1'
const targetPort = 47621
const targetDomain = 'navis.local'
const mdnsServiceType = '_navisai._tcp.local'
const mdnsServiceInstance = 'NavisAI._navisai._tcp.local'

const isRootUser = typeof process.getuid === 'function' && process.getuid() === 0

function normalizePrivilegedCommand(command) {
  if (isRootUser) {
    return command.replace(/\bsudo\s+-n\s+/g, '').replace(/\bsudo\s+/g, '')
  }
  return command
}

function execPrivileged(command, options) {
  return execSync(normalizePrivilegedCommand(command), options)
}

function isSetupApproved() {
  return process.argv.includes('--setup-approved') || process.env.NAVIS_SETUP_APPROVED === '1'
}

class PacketForwardingBridge {
  constructor() {
    this.platform = platform()
    this.isRunning = false
    this.cleanupCommands = []
    this.mdns = null
    this.lanInterface = null
    this.lanIp = null
    this.lanNetmask = null
    this.lanIpv6 = null
    this.navisAliasIp = null
    this.navisAliasInterface = null
    this.ipMonitorInterval = null
    this.aliasRetryInterval = null
    this.aliasRetryMs = 20000
    this.aliasUnavailableWarned = false
    this.wildcard443ConflictWarned = false
    this.aliasPortConflictWarned = false
    this.aliasConflictRetryCount = 0
    this.aliasConflictRetryThreshold = 6
    this.aliasListenerDisabled = false
    this.aliasListenerReason = null
    this.lastAliasFailure = null
    this.transparentProxy = new TransparentHTTPSProxy({
      proxyPort: 8443,
      daemonHost: targetHost,
      daemonPort: targetPort
    })
  }

  getLanInterfaceIPv4() {
    const interfaces = networkInterfaces()
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs || []) {
        if (!addr || addr.family !== 'IPv4' || addr.internal) continue
        return { name, ip: addr.address, netmask: addr.netmask }
      }
    }
    return null
  }

  getLanInterfaceIPv6() {
    const interfaces = networkInterfaces()
    for (const addrs of Object.values(interfaces)) {
      for (const addr of addrs || []) {
        if (!addr || addr.internal || addr.family !== 'IPv6') continue
        if (addr.address.startsWith('fe80') || addr.address === '::1') continue
        return addr.address
      }
    }
    return null
  }

  ipToInt(ip) {
    return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
  }

  intToIp(int) {
    return [24, 16, 8, 0].map((shift) => (int >>> shift) & 255).join('.')
  }

  getSubnetInfo(ip, netmask) {
    const base = this.ipToInt(ip)
    const mask = this.ipToInt(netmask)
    const network = base & mask
    const broadcast = network | (~mask >>> 0)
    const hostMin = network + 1
    const hostMax = broadcast - 1
    if (hostMax <= hostMin) return null
    return {
      network,
      broadcast,
      hostMin,
      hostMax,
      hostCount: hostMax - hostMin + 1,
    }
  }

  getAliasCandidates(lan) {
    const subnet = this.getSubnetInfo(lan.ip, lan.netmask)
    if (!subnet) return []

    const base = this.ipToInt(lan.ip)
    const seed = (base ^ this.ipToInt(lan.netmask)) >>> 0
    const startIndex = seed % subnet.hostCount
    const step = 17
    const attempts = Math.min(subnet.hostCount, 48)
    const candidates = []

    for (let i = 0; i < attempts; i++) {
      const index = (startIndex + i * step) % subnet.hostCount
      const candidate = subnet.hostMin + index
      if (candidate === base) continue
      candidates.push(this.intToIp(candidate))
    }

    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = candidates[i]
      candidates[i] = candidates[j]
      candidates[j] = temp
    }

    return candidates
  }

  isAliasIpInUse(candidate) {
    try {
      execSync(`ping -c 1 -W 1000 ${candidate} >/dev/null 2>&1`)
      return true
    } catch {
      // No response; continue.
    }

    try {
      execSync('command -v arping >/dev/null 2>&1')
      execSync(`arping -c 1 -w 1000 ${candidate} >/dev/null 2>&1`)
      return true
    } catch {
      // arping unavailable or no response.
    }

    return false
  }

  verifyAliasRoute(interfaceName, aliasIp) {
    try {
      const output = execSync(`route -n get ${aliasIp} 2>/dev/null || true`, { encoding: 'utf8' })
      const match = output.match(/interface:\s*(\S+)/)
      return match ? match[1] === interfaceName : false
    } catch {
      return false
    }
  }

  async releaseNavisAliasIp() {
    if (!this.navisAliasIp || !this.navisAliasInterface) return
    try {
      execPrivileged(`sudo ifconfig ${this.navisAliasInterface} -alias ${this.navisAliasIp} || true`, { stdio: 'pipe' })
      console.log(`🧹 Released navis.local alias: ${this.navisAliasIp} (${this.navisAliasInterface})`)
    } catch {
      // Ignore cleanup errors.
    } finally {
      this.navisAliasIp = null
      this.navisAliasInterface = null
      this.aliasListenerDisabled = false
      this.aliasListenerReason = null
      this.aliasConflictRetryCount = 0
    }
  }

  async ensureNavisAliasIp(lanOverride = null) {
    this.lastAliasFailure = null
    if (this.platform !== 'darwin') return null

    const lan = lanOverride || this.getLanInterfaceIPv4()
    if (!lan) {
      this.lastAliasFailure = 'no-lan-interface'
      return null
    }

    this.lanInterface = lan.name
    this.lanIp = lan.ip
    this.lanNetmask = lan.netmask

    if (this.navisAliasIp && this.navisAliasInterface === lan.name) {
      return this.navisAliasIp
    }

    const wildcardConflict = this.hasWildcard443Conflict()
    const failureStats = {
      attempted: 0,
      inUse: 0,
      routeFailed: 0,
      bindInUse: 0,
      bindOther: 0,
      execFailed: 0
    }

    const candidates = this.getAliasCandidates(lan)
    for (const candidate of candidates) {
      failureStats.attempted += 1
      if (this.isAliasIpInUse(candidate)) {
        failureStats.inUse += 1
        continue
      }
      try {
        execPrivileged(`sudo ifconfig ${lan.name} alias ${candidate} ${lan.netmask}`, { stdio: 'pipe' })
        if (!this.verifyAliasRoute(lan.name, candidate)) {
          failureStats.routeFailed += 1
          execPrivileged(`sudo ifconfig ${lan.name} -alias ${candidate} || true`, { stdio: 'pipe' })
          continue
        }
        if (this.transparentProxy) {
          const bindResult = await this.transparentProxy.canBindPort(candidate, listenPort)
          if (!bindResult.available) {
            if (bindResult.errorCode === 'EADDRINUSE') {
              failureStats.bindInUse += 1
              await this.warnWildcard443ConflictOnce()
              if (wildcardConflict) {
                this.navisAliasIp = candidate
                this.navisAliasInterface = lan.name
                this.aliasListenerDisabled = true
                this.aliasListenerReason = 'wildcard-443'
                this.cleanupCommands.push(`sudo ifconfig ${lan.name} -alias ${candidate} || true`)
                console.log(
                  `✅ Reserved dedicated IP for navis.local: ${candidate} (${lan.name}) (alias listener disabled due to wildcard 443)`
                )
                return candidate
              }
              execPrivileged(`sudo ifconfig ${lan.name} -alias ${candidate} || true`, { stdio: 'pipe' })
              console.log(`⚠️  Alias ${candidate}:443 already in use; selecting another`)
            } else {
              failureStats.bindOther += 1
              execPrivileged(`sudo ifconfig ${lan.name} -alias ${candidate} || true`, { stdio: 'pipe' })
              console.log(`⚠️  Alias ${candidate}:443 unavailable (${bindResult.errorCode}); selecting another`)
            }
            continue
          }
        }
        this.navisAliasIp = candidate
        this.navisAliasInterface = lan.name
        this.wildcard443ConflictWarned = false
        this.aliasListenerDisabled = false
        this.aliasListenerReason = null
        this.aliasConflictRetryCount = 0
        this.cleanupCommands.push(`sudo ifconfig ${lan.name} -alias ${candidate} || true`)
        try {
          execPrivileged(`sudo route -n add -host ${candidate} -iface lo0 2>/dev/null || true`, { stdio: 'pipe' })
          this.cleanupCommands.push(`sudo route -n delete -host ${candidate} -iface lo0 2>/dev/null || true`)
          console.log(`✅ Added loopback route for navis.local alias: ${candidate}`)
        } catch {
          // Ignore route errors; alias may still be reachable on LAN.
        }
        console.log(`✅ Reserved dedicated IP for navis.local: ${candidate} (${lan.name})`)
        return candidate
      } catch {
        failureStats.execFailed += 1
        // Try next candidate.
      }
    }

    this.lastAliasFailure =
      `attempted=${failureStats.attempted}, ` +
      `inUse=${failureStats.inUse}, ` +
      `routeFailed=${failureStats.routeFailed}, ` +
      `bindInUse=${failureStats.bindInUse}, ` +
      `bindOther=${failureStats.bindOther}, ` +
      `execFailed=${failureStats.execFailed}`
    if (failureStats.bindInUse > 0) {
      this.aliasListenerReason = 'port-conflict'
      this.handleAliasConflictRetry(failureStats)
      console.log('⚠️  Alias candidates remain blocked by another 443 listener; continuing to search without interrupting other tools.')
    } else {
      this.aliasListenerReason = 'no-alias'
      console.log('⚠️  Unable to reserve a dedicated IP alias for navis.local; continuing with primary LAN IP')
    }
    console.log(`ℹ️  Alias reservation summary: ${this.lastAliasFailure}`)
    return null
  }

  async warnWildcard443ConflictOnce() {
    if (this.wildcard443ConflictWarned || this.aliasPortConflictWarned) return
    const listeners = this.getPortListeners(listenPort)
    if (!listeners || listeners.length === 0) return

    const sample = listeners.slice(0, 3).join(' | ')
    const hasWildcard = listeners.some((line) => /\*:443\b/.test(line) || /0\.0\.0\.0:443\b/.test(line))

    if (hasWildcard) {
      console.log(
        '⚠️  Port 443 is already bound on 0.0.0.0 (wildcard). ' +
          'The dedicated alias listener for on-host navis.local is disabled, but LAN routing still works. ' +
          'Stop the wildcard service only if you need on-host navis.local without relying on pf redirect.'
      )
      console.log(`ℹ️  443 listeners (sample): ${sample}`)
      this.wildcard443ConflictWarned = true
      this.aliasPortConflictWarned = true
      return
    }

    console.log(`ℹ️  443 listeners detected (sample): ${sample}`)
    this.aliasPortConflictWarned = true
  }

  handleAliasConflictRetry(failureStats) {
    if (failureStats.bindInUse === 0) return
    this.aliasConflictRetryCount += 1
    if (this.aliasConflictRetryCount < this.aliasConflictRetryThreshold) {
      console.log(
        `ℹ️  Alias collision detected (${this.aliasConflictRetryCount}/${this.aliasConflictRetryThreshold}); continuing to scan for another safe alias.`
      )
    } else {
      console.log(
        '⚠️  navis.local alias still blocked after repeated attempts; continuing to scan but please stop the conflicting 443 service if you need the dedicated alias listener.'
      )
    }
  }

  getPortListeners(port) {
    try {
      const output = execSync(`/usr/sbin/lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, {
        encoding: 'utf8'
      }).trim()
      if (!output) return null
      return output.split('\n').slice(1).filter(Boolean)
    } catch {
      return null
    }
  }

  hasWildcard443Conflict() {
    if (this.wildcard443ConflictWarned) return true
    const listeners = this.getPortListeners(listenPort)
    if (!listeners || listeners.length === 0) return false

    const hasWildcard = listeners.some((line) => /\*:443\b/.test(line) || /0\.0\.0\.0:443\b/.test(line))
    if (!hasWildcard) return false

    const sample = listeners.slice(0, 3).join(' | ')
    console.log(
      '⚠️  Port 443 is already bound on 0.0.0.0 (wildcard). ' +
        'The dedicated alias listener for on-host navis.local is disabled, but LAN routing still works. ' +
        'Stop the wildcard service only if you need on-host navis.local without relying on pf redirect.'
    )
    console.log(`ℹ️  443 listeners (sample): ${sample}`)
    this.wildcard443ConflictWarned = true
    this.aliasPortConflictWarned = true
    return true
  }

  scheduleAliasRetry() {
    if (this.aliasRetryInterval) return
    this.aliasRetryInterval = setInterval(() => {
      this.tryEnableMacosRouting().catch(() => {})
    }, this.aliasRetryMs)
  }

  clearAliasRetry() {
    if (!this.aliasRetryInterval) return
    clearInterval(this.aliasRetryInterval)
    this.aliasRetryInterval = null
  }

  async disableMacosRouting() {
    if (this.transparentProxy) {
      await this.transparentProxy.stopAliasListener()
      await this.transparentProxy.stop()
    }
    this.stopMDNS()
  }

  async tryEnableMacosRouting() {
    if (this.platform !== 'darwin') return false
    const aliasIp = await this.ensureNavisAliasIp()
    if (!aliasIp) {
      await this.disableMacosRouting()
      if (!this.aliasUnavailableWarned) {
        console.log('⚠️  navis.local inactive: no safe alias IP available; avoiding conflicts with local 443 services')
      }
      this.aliasUnavailableWarned = true
      this.scheduleAliasRetry()
      return false
    }

    this.aliasUnavailableWarned = false
    this.clearAliasRetry()

    this.transparentProxy.setRedirectIps([aliasIp])
    if (this.lanIp) {
      this.transparentProxy.setPassthroughHost(this.lanIp)
    }
    this.transparentProxy.setEnableLoopbackRdr(true)

    console.log('🔧 Starting transparent HTTPS proxy...')
    await this.transparentProxy.start()
    this.logPfRuleStatus()
    await this.startAliasListener()
    await this.startMDNS()

    return true
  }

  logPfRuleStatus() {
    if (this.platform !== 'darwin') return
    try {
      const natRules = execSync('pfctl -a navisai/proxy -s nat 2>/dev/null || true', {
        encoding: 'utf8'
      }).trim()
      const filterRules = execSync('pfctl -a navisai/filter -s rules 2>/dev/null || true', {
        encoding: 'utf8'
      }).trim()
      if (!natRules) {
        console.log('⚠️  pf NAT rules not visible in navisai/proxy anchor')
      } else {
        console.log('✅ pf NAT rules active')
      }
      if (!filterRules) {
        console.log('⚠️  pf filter rules not visible in navisai/filter anchor')
      } else {
        console.log('✅ pf filter rules active')
      }
    } catch {
      console.log('⚠️  pf rule status check failed')
    }
  }

  async startAliasListener() {
    if (this.platform !== 'darwin') return
    if (!this.navisAliasIp) return
    if (!this.transparentProxy) return
    if (this.aliasListenerDisabled) {
      const reason = this.aliasListenerReason || 'disabled'
      console.log(`⚠️  Alias listener disabled (${reason}); relying on pf redirect only`)
      return
    }

    const started = await this.transparentProxy.startAliasListener(this.navisAliasIp)
    if (!started) {
      console.log(`⚠️  Alias listener inactive for ${this.navisAliasIp}:443`)
    }
  }

  async start() {
    try {
      if (!isSetupApproved()) {
        console.error('❌ Bridge start blocked: setup approval missing.')
        console.error('   Run: navisai setup (or use --setup-approved for explicit admin runs).')
        process.exit(1)
      }

      const preflight = await runPreflightChecks()
      if (!preflight.ok) {
        console.error('❌ Preflight checks failed:')
        preflight.checks.forEach((check) => {
          const status = check.ok ? 'ok' : 'fail'
          console.error(`   - ${check.name}: ${status}${check.error ? ` (${check.error})` : ''}`)
        })
        console.error('   Fix system health issues and retry.')
        process.exit(1)
      }

      if (this.platform === 'darwin') {
        const snapshotState = await readSnapshotState()
        const exists = await navisSnapshotExists(snapshotState)
        const fresh = isSnapshotFresh(snapshotState)
        if (!exists || !fresh) {
          console.error('❌ Snapshot gate blocked: Navis snapshot missing or stale.')
          if (snapshotState?.id) {
            console.error(`   Last recorded snapshot: ${snapshotState.id}`)
          }
          console.error('   Run: navisai setup (or the setup app) to create a fresh snapshot before mutations.')
          this.keepAlive()
          return
        }
      }

      console.log(`🚀 Starting Navis Packet Forwarding Bridge...`)
      console.log(`Platform: ${this.platform}`)
      console.log(`Domain: ${targetDomain}`)
      console.log(`Using transparent HTTPS proxy for domain-based routing`)

      // Enable packet forwarding in kernel if needed
      await this.enablePacketForwarding()

      if (this.platform === 'darwin') {
        const routingEnabled = await this.tryEnableMacosRouting()
        if (!routingEnabled) {
          this.keepAlive()
          return
        }
      } else {
        // Start transparent HTTPS proxy for domain-based routing
        console.log('🔧 Starting transparent HTTPS proxy...')
        await this.transparentProxy.start()

        // Install platform-specific forwarding rules
        switch (this.platform) {
          case 'linux':
            await this.setupLinux()
            break
          case 'win32':
            await this.setupWindows()
            break
          default:
            throw new Error(`Unsupported platform: ${this.platform}`)
        }
      }

      this.isRunning = true
      console.log('✅ Packet forwarding rules installed successfully')
      console.log(`🌐 Navis is now accessible at: https://${targetDomain}`)
      console.log('💡 Other HTTPS services can coexist on port 443')

      // Show dev server mappings
      if (this.transparentProxy) {
        setTimeout(async () => {
          const mappings = this.transparentProxy.getDomainMappings()
          if (mappings.size > 0) {
            console.log('\n🔗 Auto-detected dev servers:')
            for (const [domain, port] of mappings) {
              console.log(`   https://${domain} → localhost:${port}`)
            }
          }
        }, 2000) // Wait a moment for detection
      }

      if (this.platform !== 'darwin') {
        // Start mDNS service for name resolution
        await this.startMDNS()
      }

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
      if (this.platform === 'darwin' && !this.navisAliasIp) {
        console.log('⚠️  mDNS not started: no safe alias IP for navis.local')
        if (this.lastAliasFailure) {
          console.log(`ℹ️  Alias reservation summary: ${this.lastAliasFailure}`)
        }
        return
      }
      if (this.mdns) return
      const ip = this.navisAliasIp || this.getLanAddress()
      const ipv6 = this.getLanInterfaceIPv6()
      if (!ip) {
        console.log('⚠️  mDNS not started: no LAN IPv4 address detected')
        return
      }

      this.lanIpv6 = ipv6
      console.log('🔍 Starting mDNS service for navis.local...', { ip })

      this.mdns = multicastDns()

      const buildMdnsRecords = (address, ipv6Address) => ([
        {
          name: mdnsServiceType,
          type: 'PTR',
          data: mdnsServiceInstance,
          ttl: 120,
        },
        {
          name: mdnsServiceInstance,
          type: 'SRV',
          data: { port: 443, weight: 0, priority: 10, target: targetDomain },
          ttl: 120,
        },
        {
          name: mdnsServiceInstance,
          type: 'TXT',
          data: ['version=1', 'tls=1', 'origin=https://navis.local'],
          ttl: 120,
        },
        { name: targetDomain, type: 'A', ttl: 120, data: address },
        ...(ipv6Address ? [{ name: targetDomain, type: 'AAAA', ttl: 120, data: ipv6Address }] : []),
      ])

      // Respond to queries for navis.local
      this.mdns.on('query', (query) => {
        const questions = query.questions || []
        const advertised = this.navisAliasIp || this.lanIp || ip
        if (!advertised) return

        const wantsNavis =
          questions.some((q) => q.name === targetDomain && (q.type === 'A' || q.type === 'AAAA' || q.type === 'ANY')) ||
          questions.some((q) => q.name === mdnsServiceType && (q.type === 'PTR' || q.type === 'ANY')) ||
          questions.some((q) => q.name === mdnsServiceInstance && (q.type === 'SRV' || q.type === 'TXT' || q.type === 'ANY'))

        if (wantsNavis) {
          this.mdns.respond({ answers: buildMdnsRecords(advertised, this.lanIpv6) })
        }
      })

      // Initial advertisement
      this.mdns.respond({ answers: buildMdnsRecords(ip, this.lanIpv6) })

      console.log('✅ mDNS service active for navis.local')

      // Monitor IP changes and re-announce mDNS records
      this.ipMonitorInterval = setInterval(async () => {
        const newLan = this.getLanInterfaceIPv4()
        if (!newLan || !newLan.ip) return

        const lanChanged = newLan.ip !== this.lanIp || newLan.netmask !== this.lanNetmask || newLan.name !== this.lanInterface
        if (lanChanged) {
          console.log(`🔄 LAN IP changed: ${this.lanIp} → ${newLan.ip}`)
          this.lanInterface = newLan.name
          this.lanIp = newLan.ip
          this.lanNetmask = newLan.netmask
          this.lanIpv6 = this.getLanInterfaceIPv6()

          if (this.platform === 'darwin') {
            await this.releaseNavisAliasIp()
            const aliasIp = await this.ensureNavisAliasIp(newLan)
            if (aliasIp) {
              this.transparentProxy.setRedirectIps([aliasIp])
              this.transparentProxy.setEnableLoopbackRdr(true)
            } else {
              await this.disableMacosRouting()
              if (!this.aliasUnavailableWarned) {
                console.log('⚠️  navis.local inactive: no safe alias IP available after LAN change')
              }
              this.aliasUnavailableWarned = true
              this.scheduleAliasRetry()
              return
            }

            if (this.lanIp) {
              this.transparentProxy.setPassthroughHost(this.lanIp)
            }

            await this.transparentProxy.reloadPfRules()
            await this.startAliasListener()
          }
        }

        // Re-advertise current target (alias if present, else LAN IP).
        const advertised = this.navisAliasIp || this.lanIp
        if (advertised) {
          this.mdns.respond({ answers: buildMdnsRecords(advertised, this.lanIpv6) })
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
        execPrivileged('sudo sysctl -w net.inet.ip.forwarding=1', { stdio: 'inherit' })
        this.cleanupCommands.push('sudo sysctl -w net.inet.ip.forwarding=0')
        console.log('✅ Enabled IP forwarding')
      } else if (this.platform === 'linux') {
        // Enable IP forwarding on Linux
        execPrivileged('sudo sysctl -w net.ipv4.ip_forward=1', { stdio: 'inherit' })
        this.cleanupCommands.push('sudo sysctl -w net.ipv4.ip_forward=0')
        console.log('✅ Enabled IP forwarding')
      }
    } catch (error) {
      throw new Error(`Failed to enable packet forwarding: ${error.message}`)
    }
  }

  async setupMacOS() {
    // macOS packet forwarding is managed by TransparentHTTPSProxy.createPfRules(),
    // which installs scoped rules into the navisai/* anchors.
    // Avoid loading a second, broad ruleset into a separate anchor (navis),
    // which can break coexistence with other HTTPS dev tools (Refs: navisai-46m).
    console.log('✅ macOS pfctl rules managed by transparent proxy (navisai/* anchors)')
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
      await this.transparentProxy.stopAliasListener()
      await this.transparentProxy.stop()
    }

    for (const command of this.cleanupCommands.reverse()) {
      try {
        execPrivileged(command, { stdio: 'pipe' })
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
        const proxyNat = execPrivileged('sudo pfctl -a navisai/proxy -s nat 2>/dev/null || true', { encoding: 'utf8' })
        const filterRules = execPrivileged('sudo pfctl -a navisai/filter -s rules 2>/dev/null || true', { encoding: 'utf8' })
        packetForwardingActive =
          (proxyNat.includes('rdr') && proxyNat.includes('8443')) ||
          filterRules.includes('keep state')
      } else if (this.platform === 'linux') {
        const output = execPrivileged('sudo iptables -t nat -L PREROUTING -n -v', { encoding: 'utf8' })
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
        active: packetForwardingActive && mDNSActive,
        aliasIp: this.navisAliasIp,
        aliasListenerDisabled: this.aliasListenerDisabled,
        aliasFailure: this.lastAliasFailure
      }
    } catch (error) {
      return {
        packetForwarding: false,
        mdns: false,
        active: false,
        aliasIp: this.navisAliasIp,
        aliasListenerDisabled: this.aliasListenerDisabled,
        aliasFailure: this.lastAliasFailure
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
