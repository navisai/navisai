export type NavisPaths = typeof NAVIS_PATHS

export const NAVIS_PATHS: {
  welcome: '/welcome'
  status: '/status'
  ws: '/ws'
  certs: {
    navisLocalCrt: '/certs/navis.local.crt'
  }
  pairing: {
    request: '/pairing/request'
    start: '/pairing/start'
    qr: '/pairing/qr'
  }
  projects: {
    list: '/projects'
    byId: (id: string) => string
  }
  sessions: '/sessions'
  approvals: {
    list: '/approvals'
    pending: '/approvals/pending'
    approve: (id: string) => string
    reject: (id: string) => string
  }
  devices: {
    list: '/devices'
    revoke: (id: string) => string
  }
  discovery: {
    scan: '/discovery/scan'
    index: '/discovery/index'
  }
}

export const NAVIS_WS_EVENTS: readonly string[]
