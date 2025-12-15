import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// Projects table - stores discovered and tracked projects
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  path: text('path').unique().notNull(),
  name: text('name'),
  createdAt: text('createdAt').default(new Date().toISOString()),
  updatedAt: text('updatedAt'),
})

// Project signals - raw discovery signals
export const projectSignals = sqliteTable('project_signals', {
  id: text('id').primaryKey(),
  projectId: text('projectId').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  path: text('path'),
  confidence: real('confidence').default(1.0),
})

// Project classification - ML/categorization results
export const projectClassification = sqliteTable('project_classification', {
  projectId: text('projectId').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  categories: text('categories'), // JSON array
  frameworks: text('frameworks'), // JSON array
  languages: text('languages'), // JSON array
  confidence: real('confidence'),
  metadata: text('metadata'), // JSON object
})

// Trusted devices - paired phones/tablets
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  name: text('name'),
  publicKey: text('publicKey'),
  pairedAt: text('pairedAt'),
  lastSeenAt: text('lastSeenAt'),
  isRevoked: integer('isRevoked', { mode: 'boolean' }).default(false),
})

// Approval requests - human-in-the-loop actions
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  projectId: text('projectId').references(() => projects.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  payload: text('payload'), // JSON object
  status: text('status').notNull(), // pending, approved, denied
  createdAt: text('createdAt').default(new Date().toISOString()),
  resolvedAt: text('resolvedAt'),
})

// Active sessions - terminal, ACP, etc.
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('projectId').references(() => projects.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // terminal, acp, etc.
  createdAt: text('createdAt').default(new Date().toISOString()),
  updatedAt: text('updatedAt'),
})

// System settings
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updatedAt').default(new Date().toISOString()),
})
