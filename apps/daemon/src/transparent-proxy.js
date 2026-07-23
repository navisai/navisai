#!/usr/bin/env node

/**
 * Transparent HTTPS Proxy for NavisAI
 *
 * Implements domain-based packet forwarding by intercepting port 443 traffic,
 * inspecting TLS SNI, and routing based on domain names.
 *
 * Refs: navisai-1bl
 */

import { createConnection, createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { logger } from '@navisai/logging'
import { DevServerDetector } from './dev-server-detector.js'

export class TransparentHTTPSProxy {
  constructor(options = {}) {
    this.options = {
      proxyPort: options.proxyPort || 8443,
      daemonHost: options.daemonHost || '127.0.0.1',
      daemonPort: options.daemonPort || 47621,
      passthroughHost: options.passthroughHost || '127.0.0.1',
      passthroughPort: options.passthroughPort || 443,
      enableLoopbackRdr: options.enableLoopbackRdr === true,
      enableDevServerDetection: options.enableDevServerDetection !== false,
      redirectIps: options.redirectIps || null,
      ...options
    }

    this.server = null
    this.isRunning = false
    this.aliasListener = null
    this.aliasListenerAddress = null
    this.aliasListenerRestartTimer = null
    this.connections = new Set()
    this.devServerDetector = null
    this.httpsServers = new Map()
    this.metrics = {
      connectionsActive: 0,
      connectionsTotal: 0,
      bytesIn: 0,
      bytesOut: 0,
    }
  }

  getLocalIPv4Addresses() {
    if (Array.isArray(this.options.redirectIps) && this.options.redirectIps.length > 0) {
      return this.options.redirectIps
    }

    const addresses = new Set()
    const interfaces = networkInterfaces()

    for (const addrs of Object.values(interfaces)) {
      for (const addr of addrs || []) {
        if (!addr || addr.family !== 'IPv4' || addr.internal) continue
        addresses.add(addr.address)
      }
    }

    return [...addresses]
  }

  setRedirectIps(redirectIps) {
    this.options.redirectIps = redirectIps
  }

  setPassthroughHost(host) {
    if (host) {
      this.options.passthroughHost = host
    }
  }

  setEnableLoopbackRdr(enabled) {
    this.options.enableLoopbackRdr = Boolean(enabled)
  }

  async canBindPort(host, port) {
    return new Promise((resolve) => {
      const server = createServer()
      let resolved = false
      const finish = (result) => {
        if (resolved) return
        resolved = true
        resolve(result)
      }

      server.once('error', (error) => {
        finish({ available: false, errorCode: error.code || 'UNKNOWN' })
      })

      server.listen(port, host, () => {
        server.close(() => finish({ available: true }))
      })
    })
  }

  async waitForProxyReady({ timeoutMs = 3000, intervalMs = 150 } = {}) {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const ready = await new Promise((resolve) => {
        const socket = createConnection({ host: '127.0.0.1', port: this.options.proxyPort })
        const done = (ok) => {
          socket.destroy()
          resolve(ok)
        }
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
      })

      if (ready) return true
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    return false
  }

  async startAliasListener(aliasIp) {
    if (!aliasIp) return false

    if (this.aliasListener && this.aliasListenerAddress === aliasIp) {
      return true
    }

    await this.stopAliasListener()

    const proxyReady = await this.waitForProxyReady()
    if (!proxyReady) {
      logger.warn({ aliasIp }, 'Alias listener skipped: proxy not ready')
      return false
    }

    return new Promise((resolve) => {
      const server = createServer((clientSocket) => {
        const targetSocket = createConnection({ host: '127.0.0.1', port: this.options.proxyPort })
        clientSocket.pipe(targetSocket)
        targetSocket.pipe(clientSocket)

        const closeBoth = () => {
          if (!clientSocket.destroyed) clientSocket.destroy()
          if (!targetSocket.destroyed) targetSocket.destroy()
        }
        clientSocket.on('error', closeBoth)
        targetSocket.on('error', closeBoth)
      })

      const onError = (error) => {
        logger.error({ error: error.message, aliasIp }, 'Alias listener error')
        server.close()
        if (!this.aliasListenerRestartTimer) {
          this.aliasListenerRestartTimer = setTimeout(() => {
            this.aliasListenerRestartTimer = null
            this.startAliasListener(aliasIp).catch(() => {})
          }, 2000)
        }
        resolve(false)
      }

      server.once('error', onError)

      server.listen(443, aliasIp, async () => {
        this.aliasListener = server
        this.aliasListenerAddress = aliasIp
        logger.info({ aliasIp }, 'Alias listener active on port 443')

        const healthy = await this.verifyAliasListener(aliasIp)
        if (!healthy) {
          logger.warn({ aliasIp }, 'Alias listener health check failed; keeping listener active')
        }

        resolve(true)
      })
    })
  }

  async verifyAliasListener(aliasIp) {
    return new Promise((resolve) => {
      const socket = createConnection({ host: aliasIp, port: 443 })
      const done = (ok) => {
        socket.destroy()
        resolve(ok)
      }
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.setTimeout(1500, () => done(false))
    })
  }

  async stopAliasListener() {
    if (this.aliasListenerRestartTimer) {
      clearTimeout(this.aliasListenerRestartTimer)
      this.aliasListenerRestartTimer = null
    }

    if (!this.aliasListener) return

    const address = this.aliasListenerAddress
    await new Promise((resolve) => {
      this.aliasListener.close(() => resolve())
    })
    this.aliasListener = null
    this.aliasListenerAddress = null
    logger.info({ aliasIp: address }, 'Alias listener stopped')
  }

  async reloadPfRules() {
    if (!this.isRunning) return
    await this.removePfRules()
    await this.createPfRules()
  }

  getPassthroughTarget() {
    return {
      host: this.options.passthroughHost,
      port: this.options.passthroughPort
    }
  }

  /**
   * Extract SNI from TLS Client Hello message
   * @param {Buffer} data - TLS handshake bytes
   * @returns {{sni: string|null, needsMore: boolean}}
   */
  extractSNI(data) {
    try {
      // TLS record header: type(1) + version(2) + length(2)
      if (data.length < 5) {
        return { sni: null, needsMore: true }
      }

      // Verify this is a TLS handshake record (0x16) and a TLSv1.x record (0x03xx)
      if (data[0] !== 0x16 || data[1] !== 0x03) {
        return { sni: null, needsMore: false }
      }

      const recordLength = data.readUInt16BE(3)
      if (recordLength <= 0 || 5 + recordLength > data.length) {
        return { sni: null, needsMore: true }
      }

      // Handshake header: msg_type(1) + length(3)
      const handshakeOffset = 5
      if (handshakeOffset + 4 > data.length) {
        return { sni: null, needsMore: true }
      }

      const handshakeType = data[handshakeOffset]
      if (handshakeType !== 0x01) {
        return { sni: null, needsMore: false }
      }

      const clientHelloOffset = handshakeOffset + 4
      let offset = clientHelloOffset

      // client_version(2) + random(32)
      if (offset + 2 + 32 > data.length) {
        return { sni: null, needsMore: true }
      }
      offset += 2 + 32

      // session_id
      if (offset + 1 > data.length) return { sni: null, needsMore: true }
      const sessionIdLen = data.readUInt8(offset)
      offset += 1
      if (offset + sessionIdLen > data.length) return { sni: null, needsMore: true }
      offset += sessionIdLen

      // cipher_suites
      if (offset + 2 > data.length) return { sni: null, needsMore: true }
      const cipherSuitesLen = data.readUInt16BE(offset)
      offset += 2
      if (offset + cipherSuitesLen > data.length) return { sni: null, needsMore: true }
      offset += cipherSuitesLen

      // compression_methods
      if (offset + 1 > data.length) return { sni: null, needsMore: true }
      const compressionMethodsLen = data.readUInt8(offset)
      offset += 1
      if (offset + compressionMethodsLen > data.length) return { sni: null, needsMore: true }
      offset += compressionMethodsLen

      // extensions
      if (offset === data.length) {
        return { sni: null, needsMore: false }
      }

      if (offset + 2 > data.length) return { sni: null, needsMore: true }
      const extensionsLen = data.readUInt16BE(offset)
      offset += 2
      const extensionsEnd = offset + extensionsLen
      if (extensionsEnd > data.length) return { sni: null, needsMore: true }

      // Parse extensions
      while (offset + 4 <= extensionsEnd) {
        const extType = data.readUInt16BE(offset)
        const extLen = data.readUInt16BE(offset + 2)
        offset += 4
        if (offset + extLen > extensionsEnd) return { sni: null, needsMore: true }

        if (extType === 0x0000) { // SNI extension
          if (extLen < 2 || offset + 2 > extensionsEnd) return { sni: null, needsMore: true }
          const listLen = data.readUInt16BE(offset)
          let listOffset = offset + 2
          const listEnd = Math.min(listOffset + listLen, offset + extLen, extensionsEnd)

          while (listOffset + 3 <= listEnd) {
            const nameType = data.readUInt8(listOffset)
            const nameLen = data.readUInt16BE(listOffset + 1)
            listOffset += 3
            if (listOffset + nameLen > listEnd) return { sni: null, needsMore: true }

            if (nameType === 0x00) {
              return { sni: data.toString('utf8', listOffset, listOffset + nameLen), needsMore: false }
            }
            listOffset += nameLen
          }
          return { sni: null, needsMore: false }
        }

        offset += extLen
      }
    } catch (error) {
      logger.debug('SNI extraction error:', error.message)
    }

    return { sni: null, needsMore: false }
  }

  /**
   * Create pfctl rules for redirecting port 443 to our proxy
   */
  async createPfRules() {
    if (process.platform === 'darwin' && !Array.isArray(this.options.redirectIps)) {
      throw new Error('macOS redirect requires explicit alias IPs; refusing to load pf rules')
    }
    const localIps = this.getLocalIPv4Addresses()

    if (localIps.length === 0) {
      throw new Error('No non-loopback IPv4 addresses found; refusing to redirect all :443 traffic')
    }

    const natRules = localIps.map(
      (ip) =>
        `rdr pass inet proto tcp from any to ${ip} port 443 -> 127.0.0.1 port ${this.options.proxyPort}`
    )

    const filterRules = localIps.map(
      (ip) => `pass in quick inet proto tcp from any to ${ip} port 443 keep state`
    )

    if (this.options.enableLoopbackRdr) {
      for (const ip of localIps) {
        natRules.push(
          `rdr pass on lo0 inet proto tcp from any to ${ip} port 443 -> 127.0.0.1 port ${this.options.proxyPort}`
        )
        filterRules.push(
          `pass in quick on lo0 inet proto tcp from any to ${ip} port 443 keep state`
        )
      }
    }

    filterRules.push(
      `pass in quick on lo0 inet proto tcp from any to 127.0.0.1 port ${this.options.proxyPort} keep state`
    )

    const natConfig = natRules.join('\n')
    const filterConfig = filterRules.join('\n')

    try {
      // Load NAT rules into navisai/proxy anchor
      await this.execCommand(`echo '${natConfig}' | sudo pfctl -a navisai/proxy -f -`)

      // Load filter rules into navisai/filter anchor
      await this.execCommand(`echo '${filterConfig}' | sudo pfctl -a navisai/filter -f -`)

      logger.info('pf rules loaded for transparent proxy')
    } catch (error) {
      logger.error('Failed to load pf rules:', error)
      throw error
    }
  }

  /**
   * Remove pfctl rules
   */
  async removePfRules() {
    try {
      // Remove NAT rules
      await this.execCommand('sudo pfctl -a navisai/proxy -F nat 2>/dev/null || true')

      // Remove filter rules
      await this.execCommand('sudo pfctl -a navisai/filter -F rules 2>/dev/null || true')

      logger.info('pf rules removed for transparent proxy')
    } catch (error) {
      logger.warn('Failed to remove pf rules:', error)
    }
  }

  /**
   * Start the transparent proxy
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Transparent proxy is already running')
      return
    }

    try {
      if (process.platform === 'darwin') {
        if (!Array.isArray(this.options.redirectIps) || this.options.redirectIps.length === 0) {
          throw new Error('macOS redirect requires reserved alias IPs; refusing to start transparent proxy')
        }
        const redirectIps = this.getLocalIPv4Addresses()
        if (!Array.isArray(redirectIps) || redirectIps.length === 0) {
          throw new Error('macOS redirect requires reserved alias IPs; refusing to start transparent proxy')
        }
      }

      // Ensure pf is enabled
      try {
        await this.execCommand('sudo pfctl -e')
      } catch (error) {
        if (!error.message.includes('already enabled')) {
          throw error
        }
      }

      // Load pf rules to redirect port 443
      await this.createPfRules()

      // Initialize dev server detector if enabled
      if (this.options.enableDevServerDetection) {
        this.devServerDetector = new DevServerDetector({
          scanInterval: 5000,
          workspacePaths: [process.cwd()],
          autoMapDomains: true
        })

        // Listen for domain mapping events
        this.devServerDetector.on('domainMapped', ({ domain, port }) => {
          logger.info(`Auto-mapped domain: ${domain} -> localhost:${port}`)
        })

        this.devServerDetector.on('domainUnmapped', ({ domain }) => {
          logger.info(`Unmapped domain: ${domain}`)
        })

        // Start detection
        await this.devServerDetector.start()
      }

      // Create proxy server
      this.server = createServer((clientSocket) => {
        this.handleConnection(clientSocket)
      })

      // Start listening
      this.server.listen(this.options.proxyPort, '127.0.0.1', () => {
        logger.info(`Transparent HTTPS proxy listening on port ${this.options.proxyPort}`)
        this.isRunning = true
      })

      // Handle server errors
      this.server.on('error', (error) => {
        logger.error('Proxy server error:', error)
        this.stop()
      })

    } catch (error) {
      logger.error('Failed to start transparent proxy:', error)
      await this.stop()
      throw error
    }
  }

  /**
   * Handle incoming connection
   */
  handleConnection(clientSocket) {
    this.connections.add(clientSocket)
    this.metrics.connectionsActive += 1
    this.metrics.connectionsTotal += 1

    // Buffer to capture TLS handshake for SNI extraction
    let targetSocket = null

    const buffered = []
    let bufferedBytes = 0
    let decided = false
    const maxBufferedBytes = 8192

    const decideRouting = async (sni, firstPacket) => {
      if (decided) return
      decided = true
      clientSocket.removeListener('data', onData)

      if (!sni) {
        // Clients connecting by raw IP often omit SNI. For safety, do not MITM.
        // Default to routing to the Navis daemon since this proxy only sees
        // traffic already redirected to this host's :443 (Refs: navisai-ms0).
        logger.warn(
          {
            event: 'tls_no_sni',
            remoteAddress: clientSocket.remoteAddress ?? null,
            remotePort: clientSocket.remotePort ?? null,
          },
          'No SNI found in TLS handshake; routing to daemon'
        )

        targetSocket = createConnection({ host: this.options.daemonHost, port: this.options.daemonPort })

        targetSocket.on('data', (chunk) => {
          this.metrics.bytesOut += chunk.length
        })

        targetSocket.on('error', (error) => {
          logger.error('Target socket error:', error)
          clientSocket.destroy()
        })

        targetSocket.write(firstPacket)
        clientSocket.pipe(targetSocket)
        targetSocket.pipe(clientSocket)

        targetSocket.on('close', () => {
          if (!clientSocket.destroyed) clientSocket.destroy()
        })
        return
      }

      if (sni === 'navis.local') {
        logger.info(
          {
            event: 'navis_tls_connection',
            sni,
            remoteAddress: clientSocket.remoteAddress ?? null,
            remotePort: clientSocket.remotePort ?? null,
          },
          'Inbound TLS connection for navis.local'
        )
        logger.debug(`Routing navis.local to daemon at ${this.options.daemonHost}:${this.options.daemonPort}`)
        targetSocket = createConnection({ host: this.options.daemonHost, port: this.options.daemonPort })
      } else {
        const passthroughTarget = this.getPassthroughTarget()
        logger.debug(
          `Passthrough TLS for ${sni} to ${passthroughTarget.host}:${passthroughTarget.port}`
        )
      targetSocket = createConnection(passthroughTarget)
    }

    targetSocket.on('data', (chunk) => {
      this.metrics.bytesOut += chunk.length
    })

    targetSocket.on('error', (error) => {
      logger.error('Target socket error:', error)
      clientSocket.destroy()
    })

      // Forward the first bytes we already consumed, then pipe the rest.
      targetSocket.write(firstPacket)
      clientSocket.pipe(targetSocket)
      targetSocket.pipe(clientSocket)

      targetSocket.on('close', () => {
        if (!clientSocket.destroyed) clientSocket.destroy()
      })
    }

    const onData = (chunk) => {
      if (decided) return
      this.metrics.bytesIn += chunk.length
      buffered.push(chunk)
      bufferedBytes += chunk.length

      const data = buffered.length === 1 ? buffered[0] : Buffer.concat(buffered, bufferedBytes)
      const { sni, needsMore } = this.extractSNI(data)
      if (needsMore && bufferedBytes < maxBufferedBytes) {
        return
      }

      decideRouting(sni, data)
    }

    clientSocket.on('data', onData)

    // Handle connection close
    clientSocket.on('close', () => {
      this.connections.delete(clientSocket)
      this.metrics.connectionsActive = Math.max(0, this.metrics.connectionsActive - 1)
      if (targetSocket && !targetSocket.destroyed) {
        targetSocket.destroy()
      }
    })

    clientSocket.on('error', (error) => {
      logger.error('Client socket error:', error)
      this.connections.delete(clientSocket)
      this.metrics.connectionsActive = Math.max(0, this.metrics.connectionsActive - 1)
      if (targetSocket && !targetSocket.destroyed) {
        targetSocket.destroy()
      }
    })
  }

  getMetrics() {
    return { ...this.metrics }
  }

  /**
   * Try to detect a server for a specific domain
   */
  async tryDetectServerForDomain(domain) {
    // Extract project name from domain (e.g., myapp.localhost -> myapp)
    const projectName = domain.replace(/\.(localhost|local)$/, '')

    // Check if we have any active servers that might match
    if (this.devServerDetector) {
      const activeServers = this.devServerDetector.getActiveServers()

      // Simple heuristic: return the first server that might match
      for (const [port, serverInfo] of activeServers) {
        // Check if server info contains project name
        if (serverInfo.processes.some(p =>
          p.details.toLowerCase().includes(projectName.toLowerCase())
        )) {
          return port
        }
      }
    }

    return null
  }

  /**
   * Stop the transparent proxy
   */
  async stop() {
    if (!this.isRunning) {
      return
    }

    logger.info('Stopping transparent proxy...')

    await this.stopAliasListener()

    // Close all connections
    for (const socket of this.connections) {
      if (!socket.destroyed) {
        socket.destroy()
      }
    }
    this.connections.clear()

    // Stop dev server detector
    if (this.devServerDetector) {
      await this.devServerDetector.stop()
      this.devServerDetector = null
    }

    // Close server
    if (this.server) {
      this.server.close()
      this.server = null
    }

    // Remove pf rules
    await this.removePfRules()

    this.isRunning = false
    logger.info('Transparent proxy stopped')
  }

  /**
   * Execute a shell command and return promise
   */
  execCommand(command) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.normalizeCommand(command), [], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stderr = ''

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else if (command.includes('pfctl -e') && stderr.includes('already enabled')) {
          // pfctl -e returns 1 when pf is already enabled, which is fine
          resolve()
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${command}`))
        }
      })
      child.on('error', reject)
    })
  }

  normalizeCommand(command) {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return command.replace(/\bsudo\s+-n\s+/g, '').replace(/\bsudo\s+/g, '')
    }
    return command
  }

  /**
   * Get current domain mappings
   */
  getDomainMappings() {
    return this.devServerDetector ? this.devServerDetector.getDomainMappings() : new Map()
  }

  /**
   * Get active servers
   */
  getActiveServers() {
    return this.devServerDetector ? this.devServerDetector.getActiveServers() : new Map()
  }

  /**
   * Write file using Node.js API
   */
  async writeFile(path, content) {
    const fs = await import('node:fs/promises')
    await fs.writeFile(path, content)
  }
}

// Export for use in bridge
export default TransparentHTTPSProxy
