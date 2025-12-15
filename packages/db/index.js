/**
 * Navis AI Database Layer
 * Drizzle ORM with SQLite support (optional native driver)
 */

import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'
import { logger } from '@navisai/logging'

class DatabaseManager {
  constructor() {
    this.db = null
    this.client = null
    this.nativeDB = null
    this.isAvailable = false
    this.dbPath = join(homedir(), '.navis', 'db.sqlite')
    this.isUsingNativeDriver = false
  }

  async initialize() {
    try {
      // Ensure .navis directory exists
      const dbDir = dirname(this.dbPath)
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }

      // Try to use native SQLite driver first
      try {
        const { drizzle } = await import('drizzle-orm/better-sqlite3')
        const BetterSqlite3 = await import('better-sqlite3').then(m => m.default)
        this.nativeDB = new BetterSqlite3(this.dbPath)
        this.db = drizzle(this.nativeDB, { schema })
        this.isUsingNativeDriver = true
        logger.info('Database initialized with native SQLite driver', {
          path: this.dbPath
        })
      } catch (nativeError) {
        logger.warn('Native SQLite driver failed, falling back to libsql', {
          error: nativeError.message
        })

        // Fallback to libsql (wasm-based)
        this.client = createClient({
          url: `file:${this.dbPath}`,
        })
        this.db = drizzleLibsql(this.client, { schema })
        this.isUsingNativeDriver = false
        logger.info('Database initialized with libsql driver', {
          path: this.dbPath
        })
      }

      // Run migrations
      await this.runMigrations()

      this.isAvailable = true
      return true
    } catch (error) {
      logger.error('Failed to initialize database', {
        error: error.message,
        path: this.dbPath
      })
      this.isAvailable = false
      return false
    }
  }

  async runMigrations() {
    try {
      const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
      const entries = await readdir(migrationsDir, { withFileTypes: true })
      const sqlFiles = entries
        .filter(e => e.isFile() && e.name.endsWith('.sql'))
        .map(e => e.name)
        .sort()

      for (const file of sqlFiles) {
        const sql = await readFile(join(migrationsDir, file), 'utf8')
        await this.applySql(sql)
      }

      await this.ensureLegacyColumns()
      logger.info('Database migrations completed', { count: sqlFiles.length })
    } catch (error) {
      logger.error('Failed to run migrations', { error: error.message })
      throw error
    }
  }

  async applySql(sql) {
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)

    for (const stmt of statements) {
      await this.execute(`${stmt};`)
    }
  }

  async ensureLegacyColumns() {
    try {
      await this.execute('ALTER TABLE devices ADD COLUMN secretHash TEXT;')
    } catch {
      // ignore: column exists or table missing (created by migrations)
    }
  }

  async execute(sql, params = []) {
    if (this.nativeDB) {
      const statement = this.nativeDB.prepare(sql)
      return statement.run(params)
    }

    if (this.client) {
      return this.client.execute({ sql, args: params })
    }

    throw new Error('Database not initialized')
  }

  async query(sql, params = []) {
    if (this.nativeDB) {
      const statement = this.nativeDB.prepare(sql)
      return statement.all(params)
    }

    if (this.client) {
      const result = await this.client.execute({ sql, args: params })
      return result.rows || []
    }

    throw new Error('Database not initialized')
  }

  async close() {
    try {
      if (this.nativeDB) {
        this.nativeDB.close()
      }
      if (this.client) {
        await this.client.close()
      }
      logger.info('Database connection closed')
    } catch (error) {
      logger.error('Failed to close database', { error: error.message })
    }
  }

  get isUsingNative() {
    return this.isUsingNativeDriver
  }

  async healthCheck() {
    if (!this.db) return { available: false }

    try {
      // Simple query to test connection
      await this.db.select().from(schema.settings).limit(1)
      return {
        available: true,
        nativeDriver: this.isUsingNativeDriver,
        path: this.dbPath
      }
    } catch (error) {
      return {
        available: false,
        error: error.message
      }
    }
  }
}

// Export singleton instance
export const dbManager = new DatabaseManager()
export { schema }

export const isAvailable = () => {
  return dbManager.db !== null || dbManager.client !== null
}

// Re-export some common things for convenience
export const db = () => dbManager.db

// Note: Removed auto-initialization to prevent premature DB init during import
// Database should be explicitly initialized by the daemon when needed

export default dbManager
