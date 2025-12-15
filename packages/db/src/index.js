/**
 * NavisAI Database Manager
 * SQLite + Drizzle ORM with optional native driver
 */

import { drizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { migrate as migrateLibsql } from 'drizzle-orm/libsql/migrator'
import * as schema from '../schema.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'

class DatabaseManager {
  constructor() {
    this.db = null
    this.client = null
    this.isNative = false
    this.dbPath = join(homedir(), '.navis', 'db.sqlite')
    this.migrationsPath = join(process.cwd(), 'packages/db/migrations')
  }

  async initialize() {
    try {
      // Ensure .navis directory exists
      const navisDir = join(homedir(), '.navis')
      try {
        await mkdir(navisDir, { recursive: true })
      } catch { }

      // Try to use better-sqlite3 first (native driver)
      try {
        const Database = await import('better-sqlite3').then(m => m.default)
        const sqlite = new Database(this.dbPath)

        // Configure SQLite for performance
        sqlite.pragma('journal_mode = WAL')
        sqlite.pragma('synchronous = NORMAL')
        sqlite.pragma('cache_size = 1000000')
        sqlite.pragma('temp_store = memory')

        this.db = drizzle(sqlite, { schema })
        this.client = sqlite
        this.isNative = true
        console.log('Using native SQLite driver (better-sqlite3)')
      } catch (nativeError) {
        console.warn('Native SQLite driver not available, falling back to libsql:', nativeError.message)

        // Fallback to libsql (pure JS)
        this.client = createClient({
          url: `file:${this.dbPath}`,
        })
        this.db = drizzleLibsql(this.client, { schema })
        this.isNative = false
        console.log('Using libsql (JavaScript SQLite driver)')
      }

      // Run migrations
      await this.runMigrations()

      // Initialize default settings
      await this.initializeSettings()

      console.log(`Database initialized: ${this.dbPath}`)
      return true
    } catch (error) {
      console.error('Failed to initialize database:', error)
      // Continue without database - features will be limited
      this.db = null
      this.client = null
      return false
    }
  }

  async runMigrations() {
    if (!this.db) return

    try {
      if (this.isNative) {
        // For better-sqlite3, we need to ensure migrations folder exists
        const migrationsFolder = join(process.cwd(), 'packages/db/migrations')
        try {
          // Create a basic migration if it doesn't exist
          const migrationFile = join(migrationsFolder, '0001_initial.sql')
          if (!existsSync(migrationFile)) {
            await mkdir(migrationsFolder, { recursive: true })
            await writeFile(migrationFile, this.getInitialMigrationSQL())
          }

          await migrate(this.db, { migrationsFolder: join(process.cwd(), 'packages/db/migrations') })
        } catch (migrationError) {
          console.warn('Migration system not available, creating tables manually')
          await this.createTablesManually()
        }
      } else {
        // For libsql, use manual table creation
        await this.createTablesManually()
      }
    } catch (error) {
      console.error('Migration failed:', error)
      throw error
    }
  }

  async createTablesManually() {
    if (!this.db) return

    // Create tables manually based on schema
    const tables = [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        name TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME
      )`,

      `CREATE TABLE IF NOT EXISTS project_signals (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT,
        confidence REAL DEFAULT 1.0,
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS project_classification (
        projectId TEXT PRIMARY KEY,
        categories TEXT,
        frameworks TEXT,
        languages TEXT,
        confidence REAL,
        metadata TEXT,
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT,
        publicKey TEXT,
        pairedAt DATETIME,
        lastSeenAt DATETIME,
        isRevoked INTEGER DEFAULT 0
      )`,

      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolvedAt DATETIME,
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        type TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME,
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
      )`,

      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ]

    for (const sql of tables) {
      try {
        if (this.isNative) {
          this.client.exec(sql)
        } else {
          await this.client.execute(sql)
        }
      } catch (error) {
        console.warn('Failed to create table:', sql.split('\n')[0], error.message)
      }
    }
  }

  getInitialMigrationSQL() {
    return `-- Migration: 0001_initial
-- Create all NavisAI tables

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME
);

CREATE TABLE IF NOT EXISTS project_signals (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  confidence REAL DEFAULT 1.0,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_classification (
  projectId TEXT PRIMARY KEY,
  categories TEXT,
  frameworks TEXT,
  languages TEXT,
  confidence REAL,
  metadata TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  publicKey TEXT,
  pairedAt DATETIME,
  lastSeenAt DATETIME,
  isRevoked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolvedAt DATETIME,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
`
  }

  async initializeSettings() {
    if (!this.db) return

    const defaultSettings = [
      { key: 'daemon.version', value: '0.1.0' },
      { key: 'pairing.requireApproval', value: 'true' },
      { key: 'discovery.scanDepth', value: '3' },
      { key: 'discovery.autoScan', value: 'true' }
    ]

    for (const setting of defaultSettings) {
      try {
        await this.db.insert(schema.settings).values(setting).onConflictDoNothing()
      } catch (error) {
        // Ignore if setting already exists
      }
    }
  }

  isAvailable() {
    return this.db !== null
  }

  getNativeDriver() {
    return this.isNative ? this.client : null
  }

  async close() {
    if (this.client) {
      try {
        if (this.isNative) {
          this.client.close()
        } else {
          await this.client.close()
        }
      } catch (error) {
        console.error('Error closing database:', error)
      }
    }
    this.db = null
    this.client = null
  }
}

// Create singleton instance
const dbManager = new DatabaseManager()

export default dbManager
export { DatabaseManager }

// Also export the schema for convenience
export * from '../schema.js'
