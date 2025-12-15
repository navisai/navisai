/**
 * Navis AI API Contracts (OSS)
 *
 * This package is the shared, canonical definition of:
 * - REST endpoint paths
 * - WebSocket endpoint path
 * - Event type names (minimal set)
 *
 * It is intentionally small and dependency-free.
 *
 * @typedef {typeof NAVIS_PATHS} NavisPaths
 */

export const NAVIS_PATHS = /** @type {const} */ ({
  welcome: '/welcome',
  status: '/status',
  ws: '/ws',
  pairing: {
    request: '/pairing/request',
    start: '/pairing/start',
  },
  projects: {
    list: '/projects',
    byId: (id) => `/projects/${encodeURIComponent(id)}`,
  },
  sessions: '/sessions',
  approvals: {
    approve: (id) => `/approvals/${encodeURIComponent(id)}/approve`,
    reject: (id) => `/approvals/${encodeURIComponent(id)}/reject`,
  },
})

export const NAVIS_WS_EVENTS = /** @type {const} */ ([
  'daemon.status',
  'project.updated',
  'discovery.progress',
  'terminal.output',
  'session.update',
  'approval.request',
  'approval.updated',
])

