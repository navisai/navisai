/**
 * NavisAI Configuration Management
 * Handles loading and validating configuration from navis.config.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const DEFAULT_CONFIG = {
  daemon: {
    port: 47621,
    host: '0.0.0.0',
    ssl: {
      selfSigned: true,
      certPath: null,
      keyPath: null
    }
  },
  discovery: {
    enabled: true,
    mdns: true,
    scanDepth: 3,
    maxConcurrency: 5
  },
  logging: {
    level: 'info',
    pretty: true
  },
  api: {
    endpoints: {
      status: '/status',
      projects: '/projects',
      sessions: '/sessions',
      approvals: '/approvals',
      pairing: '/pairing',
      welcome: '/welcome',
      ws: '/ws'
    }
  }
}

export class Config {
  constructor() {
    this.configDir = path.join(homedir(), '.navis')
    this.configPath = path.join(this.configDir, 'config.json')
    this.config = { ...DEFAULT_CONFIG }
  }

  async load() {
    try {
      const configData = await readFile(this.configPath, 'utf8')
      const userConfig = JSON.parse(configData)

      // Deep merge with defaults
      this.config = this.mergeConfig(DEFAULT_CONFIG, userConfig)

      // Override with environment variables
      this.applyEnvOverrides()

      return this.config
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Config doesn't exist, create it
        await this.save()
        this.applyEnvOverrides()
        return this.config
      }
      throw error
    }
  }

  async save() {
    try {
      // Ensure config directory exists
      await mkdir(this.configDir, { recursive: true })
      await writeFile(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (error) {
      console.error('Failed to save config:', error.message)
    }
  }

  get(key) {
    return key.split('.').reduce((obj, k) => obj?.[k], this.config)
  }

  set(key, value) {
    const keys = key.split('.')
    const lastKey = keys.pop()
    const target = keys.reduce((obj, k) => obj[k] = obj[k] || {}, this.config)
    target[lastKey] = value
  }

  mergeConfig(target, source) {
    const result = { ...target }

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeConfig(target[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }

    return result
  }

  applyEnvOverrides() {
    // NAVIS_PORT=47621
    if (process.env.NAVIS_PORT) {
      this.config.daemon.port = parseInt(process.env.NAVIS_PORT)
    }

    // NAVIS_HOST=0.0.0.0
    if (process.env.NAVIS_HOST) {
      this.config.daemon.host = process.env.NAVIS_HOST
    }

    // NAVIS_LOG_LEVEL=debug
    if (process.env.NAVIS_LOG_LEVEL) {
      this.config.logging.level = process.env.NAVIS_LOG_LEVEL
    }
  }
}

// Singleton instance
export const config = new Config()
