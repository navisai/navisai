# Navis AI Bridge Implementation Plan
Version: v0.2 (Intelligent Reverse Proxy)
Status: Implementation Specification

This document specifies the implementation of the Navis Bridge as an intelligent reverse proxy that can handle port 443 conflicts gracefully.

---

## 1. Overview

The Navis Bridge transforms from a simple TCP passthrough to an intelligent HTTP reverse proxy that:
- Detects existing port 443 services
- Routes `/navis/*` paths to the Navis daemon
- Routes all other paths to the user's application
- Handles TLS termination and re-encryption
- Monitors for service changes and adapts

---

## 2. Core Architecture

### 2.1 Bridge Process Structure

```javascript
// apps/daemon/src/bridge.js (revised)
class NavisBridge {
  constructor(options) {
    this.listenPort = 443
    this.daemonHost = '127.0.0.1'
    this.daemonPort = process.env.NAVIS_DAEMON_PORT || 47621
    this.routingMode = null // 'direct' | 'proxy'
    this.existingService = null
  }
}
```

### 2.2 Service Detection Module

```javascript
class ServiceDetector {
  async detectPort443Usage() {
    // Check if port 443 is bound
    // Identify the process (name, PID)
    // Determine if it's an HTTP(S) service
    // Return service info or null
  }
  
  async probeService(service) {
    // Test if the service responds to HTTP requests
    // Identify server type (nginx, apache, node, etc.)
    // Check if we can safely proxy through it
  }
}
```

### 2.3 Routing Engine

```javascript
class RoutingEngine {
  constructor(mode, target) {
    this.mode = mode // 'direct' or 'proxy'
    this.target = target // where to route non-navis traffic
  }
  
  route(req, res) {
    if (req.url.startsWith('/navis/')) {
      // Route to daemon
      return this.proxyToDaemon(req, res)
    } else {
      // Route based on mode
      if (this.mode === 'direct') {
        // Serve Navis (redirect to /navis/welcome)
        return this.serveNavis(req, res)
      } else {
        // Proxy to existing service
        return this.proxyToService(req, res)
      }
    }
  }
}
```

---

## 3. Implementation Details

### 3.1 Port Detection Algorithm

1. **Attempt to bind port 443**
   - If successful: `routingMode = 'direct'`
   - If EADDRINUSE: proceed to step 2

2. **Identify existing service**
   ```bash
   # macOS
   lsof -i :443 | grep LISTEN
   
   # Linux
   ss -tulpn | grep :443
   
   # Cross-platform Node.js approach
   const exec = require('child_process').exec
   exec('netstat -anv | grep 443', (err, stdout) => {
     // Parse output to identify service
   })
   ```

3. **Probe service capabilities**
   - HTTP request to `https://127.0.0.1:443`
   - Check response headers
   - Identify if injectable proxy is possible

4. **Determine routing strategy**
   - If no service or service is Navis: direct mode
   - If service is HTTP(S): attempt proxy mode
   - If service is unknown/unsupported: error with guidance

### 3.2 TLS Handling

```javascript
const tls = require('tls')
const https = require('https')

class TLSManager {
  async loadCertificate() {
    // Load from ~/.navis/certs/navis.local.crt
    // Generate if not exists
  }
  
  createServer(options) {
    // TLS termination point
    // Extract SNI for routing decisions
    return https.createServer(options, (req, res) => {
      // Route based on path
    })
  }
}
```

### 3.3 Proxy Implementation

```javascript
const httpProxy = require('http-proxy')
const proxy = httpProxy.createProxyServer({
  secure: true, // For proxying to HTTPS daemon
  ssl: {
    // Cert for re-encrypting to daemon
  }
})

// Proxy to daemon
proxyToDaemon(req, res) {
  proxy.web(req, res, {
    target: `https://${this.daemonHost}:${this.daemonPort}`,
    // Rewrite path to remove /navis prefix if needed
  })
}

// Proxy to existing service
proxyToService(req, res) {
  // Forward raw request to detected service
  // Maintain original headers/cookies
}
```

---

## 4. Service Integration

### 4.1 LaunchDaemon Update (macOS)

```xml
<!-- com.navisai.bridge.plist -->
<key>ProgramArguments</key>
<array>
  <string>/usr/local/bin/node</string>
  <string>/path/to/navisai-bridge</string>
  <string>--mode=intelligent</string>
</array>

<key>EnvironmentVariables</key>
<dict>
  <key>NAVIS_BRIDGE_MODE</key>
  <string>intelligent</string>
  <key>NAVIS_DAEMON_HOST</key>
  <string>127.0.0.1</string>
  <key>NAVIS_DAEMON_PORT</key>
  <string>47621</string>
</dict>
```

### 4.2 systemd Service Update (Linux)

```ini
[Service]
Type=simple
Environment=NAVIS_BRIDGE_MODE=intelligent
Environment=NAVIS_DAEMON_HOST=127.0.0.1
Environment=NAVIS_DAEMON_PORT=47621
ExecStart=/usr/bin/node /path/to/navisai-bridge
Restart=always
```

### 4.3 Windows Service

```javascript
// Use node-windows or similar
const svc = require('node-windows').Service

svc.create({
  name: 'Navis AI Bridge',
  description: 'Intelligent reverse proxy for Navis AI',
  script: '/path/to/navisai-bridge',
  nodeOptions: ['--mode=intelligent'],
  env: [{
    name: 'NAVIS_BRIDGE_MODE',
    value: 'intelligent'
  }]
})
```

---

## 5. Error Handling and Recovery

### 5.1 Common Scenarios

1. **Service changes after bridge starts**
   - Monitor port 443 every 5 seconds
   - Reconfigure routing if service disappears/changes

2. **Proxy injection fails**
   - Log detailed error with service information
   - Provide clear manual configuration instructions
   - Offer to retry with different strategy

3. **Certificate conflicts**
   - Detect existing certs on port 443
   - Use SNI to route based on hostname
   - Fallback to different ports if necessary

### 5.2 Diagnostic Commands

```javascript
// Add to bridge for debugging
bridge.getRoutingStatus() // Returns current routing table
bridge.getServiceInfo() // Details about detected service
bridge.testRoute(path) // Test routing for specific path
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

- Service detection accuracy
- Path routing logic
- TLS handling
- Error conditions

### 6.2 Integration Tests

- With nginx on port 443
- With Apache on port 443
- With Node.js apps on port 443
- Port 443 free scenario
- Service start/stop after bridge

### 6.3 Manual Testing

```bash
# Setup scenarios
1. Clear port 443: ./navisai setup
2. nginx on 443: ./navisai setup
3. Apache on 443: ./navisai setup

# Verify routing
curl -k https://navis.local # Should hit app or Navis
curl -k https://navis.local/navis/welcome # Should hit Navis
```

---

## 7. Migration Path

1. **Phase 1**: Update bridge to detect port usage
2. **Phase 2**: Implement basic routing (/navis/* → daemon)
3. **Phase 3**: Add TLS termination and re-encryption
4. **Phase 4**: Implement service monitoring
5. **Phase 5**: Add advanced proxy features (WebSocket, etc.)

---

## 8. Dependencies

### Required Node Modules
- `http-proxy` - For proxying requests
- `selfsigned` or `node-forge` - Certificate generation
- `ps-list` - Process detection
- `portscanner` - Port checking
- Node.js built-in `https`, `tls`, `net`

### Optional Enhancements
- `http-proxy-middleware` - Advanced proxy features
- `network` - Network interface detection
- `bonjour-service` - Enhanced mDNS features
