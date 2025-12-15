import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { migrate as manualMigrate } from 'drizzle-orm/sqlite-core/migrator'
import * as schema from './schema.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Database path - in user's home directory by default
const DEFAULT_DB_PATH = join(process.env.HOME || process.env.USERPROFILE || '~/.navis', 'navis.db')

export class NavisDB {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath
    this.db = null
    this.client = null
    this.isConnected = false
  }

  /**
   * Initialize database connection
   * @param {Object} options - Configuration options
   * @param {boolean} options.migrate - Whether to run migrations (default: true)
   * @returns {Promise<void>}
   */
  async connect(options = { migrate: true }) {
    try {
      // Try to use better-sqlite3 if available
      try {
        this.db = new Database(this.dbPath)
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('foreign_keys = ON')
        this.client = drizzle(this.db, { schema })
      } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
          console.warn('better-sqlite3 not available, database features limited')
          throw new Error(
            'Native SQLite driver not available. Install with: npm install better-sqlite3'
          )
        }
        throw error
      }

      this.isConnected = true

      if (options.migrate) {
        await this.migrate()
      }
    } catch (error) {
      console.error('Failed to connect to database:', error.message)
      throw error
    }
  }

  /**
   * Run database migrations
   * @returns {Promise<void>}
   */
  async migrate() {
    if (!this.client) {
      throw new Error('Database not connected')
    }

    try {
      // Run manual migration since we don't have a proper migrations folder set up yet
      const migrationSQL = readFileSync(
        join(__dirname, 'migrations/001_initial_schema.sql'),
        'utf-8'
      )

      // Execute migration
      this.db.exec(migrationSQL)
      console.log('Database migration completed successfully')
    } catch (error) {
      console.error('Migration failed:', error.message)
      throw error
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close()
      this.db = null
      this.client = null
      this.isConnected = false
    }
  }

  /**
   * Get the Drizzle client
   * @returns {import('drizzle-orm').SQLiteDatabase}
   */
  getClient() {
    if (!this.client) {
      throw new Error('Database not connected. Call connect() first.')
    }
    return this.client
  }

  /**
   * Get raw SQLite database instance
   * @returns {Database}
   */
  getRawDB() {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.')
    }
    return this.db
  }
}

// Singleton instance
let instance = null

/**
 * Get singleton database instance
 * @param {string} dbPath - Optional custom database path
 * @returns {NavisDB}
 */
export function getDatabase(dbPath) {
  if (!instance || (dbPath && instance.dbPath !== dbPath)) {
    instance = new NavisDB(dbPath)
  }
  return instance
}

/**
 * Initialize and connect to database
 * @param {string} dbPath - Optional custom database path
 * @param {Object} options - Connection options
 * @returns {Promise<NavisDB>}
 */
export async function initDatabase(dbPath, options = {}) {
  const db = getDatabase(dbPath)
  await db.connect(options)
  return db
}
