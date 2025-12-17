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
import { logger } from '@navisai/logging'

export class TransparentHTTPSProxy {
  constructor(options = {}) {
    this.options = {
      proxyPort: options.proxyPort || 8443,
      daemonHost: options.daemonHost || '127.0.0.1',
      daemonPort: options.daemonPort || 47621,
      ...options
    }

    this.server = null
    this.isRunning = false
    this.connections = new Set()
  }

  /**
   * Extract SNI from TLS Client Hello message
   * @param {Buffer} data - First packet of TLS handshake
   * @returns {string|null} - SNI hostname or null if not found
   */
  extractSNI(data) {
    // TLS Client Hello structure:
    // 0-1: Content type (0x16 = handshake)
    // 2-4: TLS version (0x0301 = TLS 1.0)
    // 5-8: Length of handshake message
    // 9: Handshake type (0x01 = Client Hello)
    // 10-12: Length of Client Hello
    // 43-45: Session ID length
    // 46-47: Cipher suites length
    // Then cipher suites, compression methods, and extensions

    try {
      // Verify this is a TLS Client Hello
      if (data.length < 100 || data[0] !== 0x16 || data[1] !== 0x03) {
        return null
      }

      // Parse extensions length (last 2 bytes of handshake header)
      const extensionsLength = data.readUInt16BE(data.length - 2)
      let offset = data.length - 2 - extensionsLength

      // Parse extensions
      while (offset < data.length - 2) {
        if (offset + 4 > data.length) break

        const extType = data.readUInt16BE(offset)
        const extLen = data.readUInt16BE(offset + 2)
        offset += 4

        if (extType === 0x0000) { // SNI extension
          if (offset + 5 > data.length) break

          // Skip SNI list length (2 bytes) and entry type (1 byte)
          // Skip name length (2 bytes) and get name
          const nameLen = data.readUInt16BE(offset + 3)
          offset += 5

          if (offset + nameLen > data.length) break

          return data.toString('utf8', offset, offset + nameLen)
        }

        offset += extLen
      }
    } catch (error) {
      logger.debug('SNI extraction error:', error.message)
    }

    return null
  }

  /**
   * Create pfctl rules for redirecting port 443 to our proxy
   */
  async createPfRules() {
    const rules = [
      `rdr pass inet proto tcp from any to any port 443 -> 127.0.0.1 port ${this.options.proxyPort}`,
      `pass out quick inet proto tcp from any to any port 443 keep state`
    ]

    const pfConfig = rules.join('\n')

    try {
      // Create temporary anchor file
      const tmpFile = '/tmp/navisai-proxy-rules.txt'
      await this.writeFile(tmpFile, pfConfig)

      // Load rules into pf
      await this.execCommand(`sudo pfctl -a navisai/proxy -f ${tmpFile}`)

      // Clean up temp file
      await this.execCommand(`rm ${tmpFile}`)

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
      await this.execCommand('sudo pfctl -a navisai/proxy -F rules')
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

      // Create proxy server
      this.server = createServer((clientSocket) => {
        this.handleConnection(clientSocket)
      })

      // Start listening
      this.server.listen(this.options.proxyPort, () => {
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

    // Buffer to capture first packet for SNI extraction
    let firstPacket = null
    let targetSocket = null

    clientSocket.on('data', async (data) => {
      if (!firstPacket) {
        firstPacket = data
        const sni = this.extractSNI(data)

        if (sni === 'navis.local') {
          // Route to NavisAI daemon
          logger.debug(`Routing navis.local to daemon at ${this.options.daemonHost}:${this.options.daemonPort}`)
          targetSocket = createConnection({
            host: this.options.daemonHost,
            port: this.options.daemonPort
          })
        } else if (sni) {
          // Route to original destination (resolve the hostname)
          logger.debug(`Routing ${sni} to original destination`)

          // For now, we'll forward to the actual IP
          // In a full implementation, we'd resolve the hostname
          // and forward to port 443 of the original destination
          targetSocket = createConnection({
            host: sni,
            port: 443
          })
        } else {
          // No SNI found, close connection
          logger.warn('No SNI found in TLS handshake')
          clientSocket.destroy()
          return
        }

        // Set up error handling
        targetSocket.on('error', (error) => {
          logger.error('Target socket error:', error)
          clientSocket.destroy()
        })

        // Relay first packet
        targetSocket.write(data)

        // Set up bidirectional data relay
        clientSocket.on('data', (data) => {
          if (targetSocket && !targetSocket.destroyed) {
            targetSocket.write(data)
          }
        })

        targetSocket.on('data', (data) => {
          if (clientSocket && !clientSocket.destroyed) {
            clientSocket.write(data)
          }
        })

        targetSocket.on('close', () => {
          if (!clientSocket.destroyed) {
            clientSocket.destroy()
          }
        })

        targetSocket.on('error', (error) => {
          logger.error('Target socket error:', error)
          if (!clientSocket.destroyed) {
            clientSocket.destroy()
          }
        })
      }
    })

    // Handle connection close
    clientSocket.on('close', () => {
      this.connections.delete(clientSocket)
      if (targetSocket && !targetSocket.destroyed) {
        targetSocket.destroy()
      }
    })

    clientSocket.on('error', (error) => {
      logger.error('Client socket error:', error)
      this.connections.delete(clientSocket)
      if (targetSocket && !targetSocket.destroyed) {
        targetSocket.destroy()
      }
    })
  }

  /**
   * Stop the transparent proxy
   */
  async stop() {
    if (!this.isRunning) {
      return
    }

    logger.info('Stopping transparent proxy...')

    // Close all connections
    for (const socket of this.connections) {
      if (!socket.destroyed) {
        socket.destroy()
      }
    }
    this.connections.clear()

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
      spawn(command, [], { shell: true, stdio: 'pipe' })
        .on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`Command failed with exit code ${code}: ${command}`))
          }
        })
        .on('error', reject)
    })
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
