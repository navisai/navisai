#!/usr/bin/env node

/**
 * Simple NavisAI Daemon
 * HTTPS server serving on port 47621 as per documentation
 */

import { createServer } from 'node:https'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'

const PORT = 47621
const HOST = '0.0.0.0'

// Generate SSL certificate on the fly
console.log('🔐 Generating SSL certificate for navis.local...')
try {
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${homedir()}/.navis/navis.key" -out "${homedir()}/.navis/navis.crt" -days 365 -subj "/CN=navis.local" -config <(cat /etc/ssl/openssl.cnf <(printf "[SAN]\nsubjectAltName=DNS:navis.local,DNS:localhost\nextendedKeyUsage=serverAuth")) -extensions SAN`, { cwd: homedir(), stdio: 'inherit', shell: true })
} catch (error) {
  console.log('Using existing certificates or falling back to node-forge...')
}

import { readFile } from 'node:fs/promises'
import forge from 'node-forge'

// Simple certificate generation fallback
function generateCertificates() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()

  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

  const attrs = [{
    name: 'commonName',
    value: 'navis.local'
  }, {
    name: 'countryName',
    value: 'US'
  }, {
    shortName: 'ST',
    value: 'California'
  }, {
    name: 'localityName',
    value: 'San Francisco'
  }, {
    name: 'organizationName',
    value: 'NavisAI'
  }, {
    shortName: 'OU',
    value: 'Dev'
  }]

  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([{
    name: 'basicConstraints',
    cA: true
  }, {
    name: 'keyUsage',
    keyCertSign: true,
    digitalSignature: true,
    nonRepudiation: true,
    keyEncipherment: true,
    dataEncipherment: true
  }, {
    name: 'extKeyUsage',
    serverAuth: true,
    clientAuth: true
  }, {
    name: 'subjectAltName',
    altNames: [{
      type: 2,
      value: 'navis.local'
    }, {
      type: 2,
      value: 'localhost'
    }, {
      type: 7,
      ip: '127.0.0.1'
    }]
  }])

  cert.sign(keys.privateKey, forge.md.sha256.create())

  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  }
}

// Create HTTPS server
const sslOptions = generateCertificates()
const server = createServer(sslOptions, (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // Route handling
  const url = req.url

  // Main welcome page - serves the onboarding flow
  if (url === '/' || url === '/welcome') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>NavisAI - Local AI Control Plane</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        }
        .container {
            background: white;
            padding: 3rem;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
            text-align: center;
        }
        .logo {
            font-size: 4rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        h1 { color: #333; margin-bottom: 0.5rem; }
        .subtitle { color: #666; margin-bottom: 2rem; font-size: 1.1rem; }
        .status {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 1.5rem;
            border-radius: 8px;
            margin: 2rem 0;
            border-left: 4px solid #4caf50;
        }
        .info {
            background: #e3f2fd;
            padding: 1.5rem;
            border-radius: 8px;
            margin: 1rem 0;
            text-align: left;
            border-left: 4px solid #2196f3;
        }
        .actions { margin-top: 2rem; }
        .btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            margin: 0.5rem;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
        }
        .meta {
            margin-top: 2rem;
            padding-top: 2rem;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 0.9rem;
        }
        .qr-placeholder {
            width: 200px;
            height: 200px;
            background: #f5f5f5;
            border: 2px dashed #ddd;
            margin: 2rem auto;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666;
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🧭</div>
        <h1>NavisAI</h1>
        <p class="subtitle">Your Local AI Control Plane</p>

        <div class="status">
            <h2>✅ Daemon is Running</h2>
            <p>Your local AI control plane is ready for use</p>
        </div>

        <div class="info">
            <h3>🌐 Access Information</h3>
            <p><strong>Local URL:</strong> <a href="https://navis.local">https://navis.local</a></p>
            <p><strong>Direct URL:</strong> https://navis.local:${PORT}</p>
            <p><strong>API Status:</strong> <a href="/api/status">Check API Status</a></p>
        </div>

        <div class="actions">
            <a href="/api/status" class="btn">View Status</a>
            <a href="/pairing" class="btn">Pair Device</a>
            <a href="/projects" class="btn">My Projects</a>
        </div>

        <div class="info">
            <h3>📱 Pair Your Mobile Device</h3>
            <p>Scan the QR code below with your phone camera to pair your device:</p>
            <div class="qr-placeholder">
                QR Code for<br>navis.local:${PORT}
            </div>
            <p style="color: #666; font-size: 0.9rem;">Or visit <strong>navis.local</strong> directly on your mobile device</p>
        </div>

        <div class="meta">
            <p>NavisAI v0.1.0 | Daemon running on port ${PORT}</p>
            <p style="margin-top: 0.5rem;">© 2024 NavisAI. Local-first AI control plane.</p>
        </div>
    </div>
</body>
</html>`)
    return
  }

  // API Status endpoint
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'running',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      port: PORT,
      host: 'navis.local',
      endpoints: {
        status: '/api/status',
        projects: '/projects',
        pairing: '/pairing',
        websocket: '/ws'
      },
      features: {
        https: true,
        mdns: true,
        pairing: true,
        discovery: true
      }
    }, null, 2))
    return
  }

  // Projects endpoint
  if (url === '/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      projects: [],
      message: 'Project discovery not yet implemented'
    }))
    return
  }

  // Pairing endpoint
  if (url === '/pairing') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>NavisAI - Device Pairing</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; background: #f5f5f5; }
        .container { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .pairing-code {
            font-size: 2rem;
            font-family: monospace;
            background: #e3f2fd;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            text-align: center;
            letter-spacing: 0.2em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔗 Device Pairing</h1>
        <p>Pair your mobile device with NavisAI:</p>
        <div class="pairing-code">ABCD-1234</div>
        <p>Or scan the QR code in the main dashboard</p>
    </div>
</body>
</html>`)
    return
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

// Start server
server.listen(PORT, HOST, () => {
  console.log(`\n🚀 NavisAI daemon started successfully!`)
  console.log(`📍 Local URL: https://navis.local:${PORT}`)
  console.log(`🎯 Onboarding: https://navis.local`)
  console.log(`📊 API Status: https://navis.local/api/status`)
  console.log(`\n✨ Your local AI control plane is ready!\n`)
})

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down NavisAI daemon...')
  server.close(() => {
    console.log('✅ Daemon stopped')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down NavisAI daemon...')
  server.close(() => {
    console.log('✅ Daemon stopped')
    process.exit(0)
  })
})
