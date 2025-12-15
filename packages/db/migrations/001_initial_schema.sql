-- NavisAI Initial Schema
-- Creates all tables for MVP functionality

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT
);

-- Project signals table
CREATE TABLE IF NOT EXISTS project_signals (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  confidence REAL DEFAULT 1.0,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);

-- Project classification table
CREATE TABLE IF NOT EXISTS project_classification (
  projectId TEXT PRIMARY KEY,
  categories TEXT,
  frameworks TEXT,
  languages TEXT,
  confidence REAL,
  metadata TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  publicKey TEXT,
  pairedAt TEXT,
  lastSeenAt TEXT,
  isRevoked INTEGER DEFAULT 0
);

-- Approvals table
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  resolvedAt TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_project_signals_project ON project_signals(projectId);
CREATE INDEX IF NOT EXISTS idx_approvals_project_status ON approvals(projectId, status);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(projectId, type);
