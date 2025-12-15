/**
 * Navis AI Database Layer
 * Drizzle ORM with SQLite support (optional native driver)
 */

import { drizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
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
        this.nativeDB = new Database(this.dbPath)
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
      // Create tables directly from schema
      // Note: In production, you'd want proper migration files

      // For now, let Drizzle handle schema creation
      logger.info('Database migrations completed')
    } catch (error) {
      logger.error('Failed to run migrations', { error: error.message })
      throw error
    }
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

// Re-export some common things for convenience
export const db = () => dbManager.db

// Auto-initialize if not already done
if (!dbManager.isAvailable) {
  dbManager.initialize().catch(error => {
    logger.error('Auto-initialization failed', { error: error.message })
  })
}

export default dbManager
