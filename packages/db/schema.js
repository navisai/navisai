/**
 * Navis AI Database Schema
 * Drizzle ORM schema definitions for SQLite
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  primaryKey
} from 'drizzle-orm/sqlite-core'

// Helper function to generate unique IDs
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// Projects table - stores discovered development projects
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  path: text('path').unique().notNull(),
  name: text('name'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt')
})

// Project signals - raw detection signals from scanners
export const projectSignals = sqliteTable('project_signals', {
  id: text('id').primaryKey(),
  projectId: text('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  path: text('path'),
  confidence: real('confidence').default(1.0),
  metadata: text('metadata') // JSON string
})

// Project classification - processed classification data
export const projectClassification = sqliteTable('project_classification', {
  projectId: text('projectId').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  categories: text('categories'), // JSON array of category IDs
  frameworks: text('frameworks'), // JSON array of framework names
  languages: text('languages'), // JSON array of language names
  confidence: real('confidence'),
  metadata: text('metadata') // JSON string with additional classification data
})

// Devices table - stores paired mobile devices
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  name: text('name'),
  publicKey: text('publicKey'),
  pairedAt: text('pairedAt'),
  lastSeenAt: text('lastSeenAt'),
  isRevoked: integer('isRevoked', { mode: 'boolean' }).default(false)
})

// Approvals table - stores human approval requests for automated actions
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  projectId: text('projectId').references(() => projects.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  payload: text('payload').notNull(), // JSON string of action details
  status: text('status').notNull(), // pending, approved, denied
  createdAt: text('createdAt').notNull(),
  resolvedAt: text('resolvedAt')
})

// Sessions table - tracks active terminal and ACP sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('projectId').references(() => projects.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // terminal, acp, etc.
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull()
})

// Settings table - key-value configuration storage
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updatedAt').notNull()
})

// Export all schema tables
export const schema = {
  projects,
  projectSignals,
  projectClassification,
  devices,
  approvals,
  sessions,
  settings
}
