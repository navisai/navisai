# Navis AI SQLite Schema (MVP)

Version: v0.1  
Location: `~/.navis/db.sqlite`

---

# 1. Tables Overview

- `projects`
- `project_signals`
- `project_classification`
- `devices`
- `approvals`
- `sessions`
- `settings`

---

# 2. DDL Specification

## 2.1 projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME
);
```

## 2.2 project_signals
```sql
CREATE TABLE project_signals (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  confidence REAL DEFAULT 1.0,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
```

## 2.3 project_classification
```sql
CREATE TABLE project_classification (
  projectId TEXT PRIMARY KEY,
  categories TEXT,
  frameworks TEXT,
  languages TEXT,
  confidence REAL,
  metadata TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
```

## 2.4 devices
```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  publicKey TEXT,
  pairedAt DATETIME,
  lastSeenAt DATETIME,
  isRevoked INTEGER DEFAULT 0
);
```

## 2.5 approvals
```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolvedAt DATETIME,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
);
```

## 2.6 sessions
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
);
```

## 2.7 settings
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

# 3. Migrations Policy

- Migrations stored in `/packages/db/migrations/*.sql`
- Daemon runs migrations at startup.
- Versioned using incremental integers (001, 002, ...).

---
