#!/usr/bin/env node

/**
 * Dev Server Detector
 *
 * Automatically detects local development servers and creates domain mappings
 * for seamless access without port numbers.
 *
 * Refs: navisai-89o
 */

import { createConnection } from 'node:net'
import { execSync } from 'node:child_process'
import { watch, readFile } from 'node:fs/promises'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { EventEmitter } from 'node:events'
import { logger } from '@navisai/logging'

// Common dev server ports and their types
const COMMON_DEV_PORTS = {
  3000: { type: 'app', frameworks: ['React', 'Next.js', 'Vue', 'Angular'] },
  3001: { type: 'app', frameworks: ['React', 'Vue'] },
  4000: { type: 'app', frameworks: ['Next.js', 'Remix'] },
  5000: { type: 'app', frameworks: ['Create React App', 'Angular'] },
  5173: { type: 'app', frameworks: ['Vite'] },
  7070: { type: 'app', frameworks: ['Vite'] },
  8080: { type: 'api', frameworks: ['Express', 'Koa', 'FastAPI'] },
  8081: { type: 'api', frameworks: ['Spring Boot', 'Django'] },
  8787: { type: 'api', frameworks: ['Django'] },
  9000: { type: 'api', frameworks: ['Express', 'NestJS'] },
  9090: { type: 'admin', frameworks: ['Admin Panel', 'Grafana'] }
}

// Domain patterns for auto-mapping
const DOMAIN_PATTERNS = {
  app: ['app.localhost', 'app.local'],
  api: ['api.localhost', 'api.local'],
  admin: ['admin.localhost', 'admin.local']
}

export class DevServerDetector extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = {
      scanInterval: options.scanInterval || 5000, // 5 seconds
      workspacePaths: options.workspacePaths || [process.cwd()],
      watchFileChanges: options.watchFileChanges !== false,
      autoMapDomains: options.autoMapDomains !== false,
      ...options
    }

    this.activeServers = new Map() // port -> server info
    this.domainMappings = new Map() // domain -> port
    this.watchers = new Set()
    this.isScanning = false
    this.scanTimer = null
  }

  /**
   * Start the detector
   */
  async start() {
    if (this.isScanning) {
      logger.warn('Dev server detector is already running')
      return
    }

    logger.info('Starting dev server detector...')
    this.isScanning = true

    // Initial scan
    await this.scanForServers()

    // Start periodic scanning
    this.scanTimer = setInterval(() => {
      this.scanForServers()
    }, this.options.scanInterval)

    // Watch for file changes if enabled
    if (this.options.watchFileChanges) {
      await this.setupFileWatching()
    }

    logger.info(`Dev server detector started (scan interval: ${this.options.scanInterval}ms)`)
  }

  /**
   * Stop the detector
   */
  async stop() {
    logger.info('Stopping dev server detector...')
    this.isScanning = false

    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }

    // Close file watchers
    for (const watcher of this.watchers) {
      try {
        await watcher.close()
      } catch (error) {
        logger.warn('Error closing file watcher:', error)
      }
    }
    this.watchers.clear()

    logger.info('Dev server detector stopped')
  }

  /**
   * Scan for active development servers
   */
  async scanForServers() {
    const detectedServers = new Map()

    // Scan common ports
    for (const [port, config] of Object.entries(COMMON_DEV_PORTS)) {
      const serverInfo = await this.checkPort(parseInt(port), config)
      if (serverInfo) {
        detectedServers.set(parseInt(port), serverInfo)
      }
    }

    // Check for servers that are no longer running
    for (const [port, server] of this.activeServers) {
      if (!detectedServers.has(port)) {
        this.onServerStopped(port, server)
      }
    }

    // Check for new servers
    for (const [port, server] of detectedServers) {
      if (!this.activeServers.has(port)) {
        await this.onServerStarted(port, server)
      }
    }

    this.activeServers = detectedServers
  }

  /**
   * Check if a port has an active dev server
   */
  async checkPort(port, config) {
    return new Promise((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' })

      socket.on('connect', async () => {
        try {
          // Try to identify the server
          const serverInfo = await this.identifyServer(port, config)
          socket.destroy()
          resolve(serverInfo)
        } catch (error) {
          socket.destroy()
          resolve(null)
        }
      })

      socket.on('error', () => {
        resolve(null)
      })

      // Timeout after 1 second
      setTimeout(() => {
        socket.destroy()
        resolve(null)
      }, 1000)
    })
  }

  /**
   * Identify the server type and framework
   */
  async identifyServer(port, config) {
    const serverInfo = {
      port,
      type: config.type,
      frameworks: [...config.frameworks],
      detectedAt: new Date().toISOString(),
      processes: []
    }

    // Try to get process information
    try {
      const lsofOutput = execSync(`lsof -i :${port} -P -n`, { encoding: 'utf8' })
      const lines = lsofOutput.split('\n')

      for (const line of lines) {
        if (line.includes('LISTEN')) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 2) {
            const pid = parseInt(parts[1])
            const command = parts[0]

            serverInfo.processes.push({
              pid,
              command,
              details: this.getProcessDetails(command, pid)
            })
          }
        }
      }
    } catch (error) {
      // lsof might fail due to permissions
    }

    // Try to make an HTTP request to get more info
    try {
      const response = await this.makeHttpRequest(port)
      if (response) {
        serverInfo.httpResponse = response
        serverInfo.frameworks = this.detectFrameworkFromResponse(response) || serverInfo.frameworks
      }
    } catch (error) {
      // HTTP request failed
    }

    return serverInfo
  }

  /**
   * Get process details
   */
  getProcessDetails(command, pid) {
    try {
      const psOutput = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' })
      const cmdLine = psOutput.trim()

      // Check for framework-specific flags
      if (cmdLine.includes('vite')) return 'Vite'
      if (cmdLine.includes('next')) return 'Next.js'
      if (cmdLine.includes('react-scripts')) return 'Create React App'
      if (cmdLine.includes('ng serve')) return 'Angular'
      if (cmdLine.includes('npm start') || cmdLine.includes('yarn start')) return 'npm/yarn start'

      return cmdLine
    } catch (error) {
      return command
    }
  }

  /**
   * Make a simple HTTP request to get server info
   */
  async makeHttpRequest(port) {
    return new Promise((resolve) => {
      const http = require('http')
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout: 1000,
        headers: {
          'User-Agent': 'NavisAI-DevServerDetector/1.0'
        }
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data.substring(0, 1000) // First 1KB
          })
        })
      })

      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })

      req.end()
    })
  }

  /**
   * Detect framework from HTTP response
   */
  detectFrameworkFromResponse(response) {
    if (!response || !response.body) return null

    const { body, headers } = response
    const frameworks = []

    // Check response body for framework signatures
    if (body.includes('__vite_hmr')) frameworks.push('Vite')
    if (body.includes('__next')) frameworks.push('Next.js')
    if (body.includes('react-app')) frameworks.push('Create React App')
    if (body.includes('ng-version')) frameworks.push('Angular')

    // Check headers
    if (headers['x-powered-by']) {
      frameworks.push(headers['x-powered-by'])
    }

    return frameworks.length > 0 ? frameworks : null
  }

  /**
   * Handle server start event
   */
  async onServerStarted(port, serverInfo) {
    logger.info(`Dev server detected on port ${port}`, serverInfo)
    this.emit('serverStarted', { port, serverInfo })

    // Auto-map domain if enabled
    if (this.options.autoMapDomains) {
      await this.createDomainMapping(port, serverInfo)
    }
  }

  /**
   * Handle server stop event
   */
  onServerStopped(port, serverInfo) {
    logger.info(`Dev server stopped on port ${port}`)
    this.emit('serverStopped', { port, serverInfo })

    // Remove domain mappings
    for (const [domain, mappedPort] of this.domainMappings) {
      if (mappedPort === port) {
        this.domainMappings.delete(domain)
        this.emit('domainUnmapped', { domain, port })
      }
    }
  }

  /**
   * Create automatic domain mapping
   */
  async createDomainMapping(port, serverInfo) {
    const { type } = serverInfo
    const domains = DOMAIN_PATTERNS[type] || []

    // Find first available domain
    for (const domain of domains) {
      if (!this.domainMappings.has(domain)) {
        this.domainMappings.set(domain, port)

        // Create project-specific mapping if we can detect project name
        const projectName = await this.detectProjectName(port, serverInfo)
        if (projectName) {
          const projectDomain = `${projectName}.localhost`
          if (!this.domainMappings.has(projectDomain)) {
            this.domainMappings.set(projectDomain, port)
            this.emit('domainMapped', { domain: projectDomain, port, serverInfo, auto: true })
          }
        }

        this.emit('domainMapped', { domain, port, serverInfo, auto: true })
        logger.info(`Auto-mapped ${domain} -> port ${port}`)
        break
      }
    }
  }

  /**
   * Try to detect project name from package.json
   */
  async detectProjectName(port, serverInfo) {
    // Check each workspace path
    for (const workspacePath of this.options.workspacePaths) {
      const packageJsonPath = join(workspacePath, 'package.json')

      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
          return packageJson.name || null
        } catch (error) {
          // Invalid package.json
        }
      }
    }

    return null
  }

  /**
   * Set up file system watching for configuration changes
   */
  async setupFileWatching() {
    for (const workspacePath of this.options.workspacePaths) {
      if (existsSync(workspacePath)) {
        try {
          const watcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
            if (filename && filename.includes('package.json')) {
              // Package.json changed, might indicate a new dev server
              setTimeout(() => this.scanForServers(), 1000)
            }
          })

          this.watchers.add(watcher)
          logger.debug(`Watching ${workspacePath} for dev server changes`)
        } catch (error) {
          logger.warn(`Failed to watch ${workspacePath}:`, error)
        }
      }
    }
  }

  /**
   * Get current domain mappings
   */
  getDomainMappings() {
    return new Map(this.domainMappings)
  }

  /**
   * Get active servers
   */
  getActiveServers() {
    return new Map(this.activeServers)
  }

  /**
   * Manually add a domain mapping
   */
  addDomainMapping(domain, port) {
    if (this.activeServers.has(port)) {
      this.domainMappings.set(domain, port)
      this.emit('domainMapped', { domain, port, serverInfo: this.activeServers.get(port), auto: false })
      return true
    }
    return false
  }

  /**
   * Remove a domain mapping
   */
  removeDomainMapping(domain) {
    if (this.domainMappings.has(domain)) {
      const port = this.domainMappings.get(domain)
      this.domainMappings.delete(domain)
      this.emit('domainUnmapped', { domain, port })
      return true
    }
    return false
  }
}

export default DevServerDetector
