#!/usr/bin/env node
/**
 * Navis Bridge
 * TCP passthrough 443 -> daemon (default 127.0.0.1:47621)
 *
 * This process is intended to be managed by the OS (e.g. launchd/systemd) and
 * may require admin privileges to bind to 443. It does not terminate TLS.
 */

import net from 'node:net'

const listenHost = process.env.NAVIS_BRIDGE_HOST || '0.0.0.0'
const listenPort = parseInt(process.env.NAVIS_BRIDGE_PORT || '443', 10)
const targetHost = process.env.NAVIS_DAEMON_HOST || '127.0.0.1'
const targetPort = parseInt(process.env.NAVIS_DAEMON_PORT || '47621', 10)

const server = net.createServer((clientSocket) => {
  const upstream = net.connect({ host: targetHost, port: targetPort })

  clientSocket.on('error', () => {})
  upstream.on('error', () => {
    try {
      clientSocket.destroy()
    } catch {}
  })

  clientSocket.pipe(upstream)
  upstream.pipe(clientSocket)
})

server.on('error', (err) => {
  console.error('Navis Bridge error:', err.message)
  process.exitCode = 1
})

server.listen({ host: listenHost, port: listenPort }, () => {
  console.log('Navis Bridge listening', {
    listenHost,
    listenPort,
    targetHost,
    targetPort,
  })
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})

