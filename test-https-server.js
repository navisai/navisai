#!/usr/bin/env node

import { createServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import pkg from 'selfsigned'
const { generate } = pkg

// Generate self-signed certificate
const { cert, key } = generate(
  [
    { name: 'commonName', value: 'navis.local' },
    { name: 'countryName', value: 'US' },
    { name: 'stateOrProvinceName', value: 'CA' },
    { name: 'localityName', value: 'San Francisco' },
    { name: 'organizationName', value: 'NavisAI' },
    { name: 'organizationalUnitName', value: 'Dev' }
  ],
  { days: 365, keySize: 2048, algorithm: 'sha256' }
)

// Create HTTPS server
const server = createServer({ cert, key }, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>NavisAI - Welcome</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; background: #f5f5f5; }
        .container { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .logo { font-size: 3rem; margin-bottom: 1rem; }
        .status { padding: 1rem; background: #e8f5e9; border-radius: 8px; margin: 1rem 0; }
        .actions { margin-top: 2rem; }
        .btn { display: inline-block; padding: 0.75rem 1.5rem; background: #1976d2; color: white; text-decoration: none; border-radius: 4px; margin-right: 1rem; }
        .info { background: #e3f2fd; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="logo">🧭 NavisAI</h1>
        <div class="status">
            <h2>✅ Daemon is Running</h2>
            <p>Your local AI control plane is ready</p>
        </div>
        <div class="info">
            <h3>🌐 Access Information</h3>
            <p><strong>URL:</strong> https://navis.local:${process.env.NAVIS_PORT || 47621}</p>
            <p><strong>Status:</strong> <a href="/api/status">Check API Status</a></p>
            <p><strong>Pairing:</strong> <a href="/pairing/qr">Scan QR Code</a></p>
        </div>
        <div class="actions">
            <a href="/api/status" class="btn">View Status</a>
            <a href="/pairing/qr" class="btn">Pair Device</a>
        </div>
        <p style="margin-top: 2rem; color: #666; font-size: 0.9rem;">
            NavisAI v0.1.0 | Port: ${process.env.NAVIS_PORT || 47621}
        </p>
    </div>
</body>
</html>`)
})

// API routes
server.on('request', (req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'running',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      port: process.env.NAVIS_PORT || 47621
    }))
  }
})

// Start server
const port = process.env.NAVIS_PORT || 47621
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 NavisAI daemon running on port ${port}`)
  console.log(`📱 Access at: https://navis.local:${port}`)
  console.log(`🎯 Onboarding: https://navis.local:${port}/welcome`)
  console.log(`\n📊 API Status: https://navis.local:${port}/api/status`)
  console.log(`🔗 Pairing QR: https://navis.local:${port}/pairing/qr`)
})

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close(() => {
    console.log('✅ Server stopped')
    process.exit(0)
  })
})
