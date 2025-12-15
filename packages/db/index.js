import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class DatabaseManager {
  constructor() {
    this.db = null
    this.client = null
    this.initialized = false
  }

  async initialize(dbPath = null) {
    if (this.initialized) {
      return this.client
    }

    try {
      // Try to load better-sqlite3
      const sqliteModule = await import('better-sqlite3').catch(() => null)

      if (sqliteModule?.default && !dbPath) {
        // Default to ~/.navis/db.sqlite
        const os = await import('node:os')
        const homedir = os.homedir()
        dbPath = path.join(homedir, '.navis', 'db.sqlite')

        // Ensure directory exists
        const fs = await import('node:fs')
        await fs.promises.mkdir(path.dirname(dbPath), { recursive: true })
      }

      if (sqliteModule?.default) {
        // Load Drizzle dynamically when SQLite is available
        const { drizzle } = await import('drizzle-orm/better-sqlite3')

        this.db = new sqliteModule.default(dbPath || ':memory:')
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('foreign_keys = ON')
        this.client = drizzle(this.db, { schema })
      } else {
        // Graceful fallback - database operations will be unavailable
        console.warn('SQLite driver not available. Database features will be disabled.')
        this.client = null
        this.initialized = true
        return null
      }

      await this.runMigrations()
      this.initialized = true

      return this.client
    } catch (error) {
      console.warn('Failed to initialize database, continuing without persistence:', error.message)
      this.client = null
      this.initialized = true
      return null
    }
  }

  async runMigrations() {
    if (!this.db) return

    const migrationFiles = [
      '001_initial_schema.sql'
    ]

    for (const file of migrationFiles) {
      try {
        const fs = await import('node:fs')
        const migrationPath = path.join(__dirname, 'migrations', file)
        const migrationSQL = await fs.promises.readFile(migrationPath, 'utf-8')

        // Split by semicolon and execute each statement
        const statements = migrationSQL
          .split(';')
          .map(s => s.trim())
          .filter(s => s && !s.startsWith('--'))

        for (const statement of statements) {
          this.db.exec(statement)
        }
      } catch (error) {
        console.error(`Failed to run migration ${file}:`, error)
        throw error
      }
    }
  }

  async close() {
    if (this.db) {
      this.db.close()
      this.db = null
      this.client = null
      this.initialized = false
    }
  }

  getClient() {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.')
    }
    if (!this.client) {
      throw new Error('Database not available. SQLite driver may be missing.')
    }
    return this.client
  }

  // Repository accessors - return null if no database
  get projects() {
    return this.client?.query.projects
  }

  get projectSignals() {
    return this.client?.query.projectSignals
  }

  get projectClassification() {
    return this.client?.query.projectClassification
  }

  get devices() {
    return this.client?.query.devices
  }

  get approvals() {
    return this.client?.query.approvals
  }

  get sessions() {
    return this.client?.query.sessions
  }

  get settings() {
    return this.client?.query.settings
  }

  // Helper to check if database is available
  isAvailable() {
    return this.initialized && this.client !== null
  }
}

// Singleton instance
const dbManager = new DatabaseManager()

export default dbManager
export { schema }
