# Domain-Based Packet Forwarding Design for macOS

**Version**: 0.1  
**Status**: Design  
**Governing Architecture**: [NETWORKING.md v0.3](./NETWORKING.md)  

## Executive Summary

This design document outlines a transparent proxy approach for domain-based packet forwarding on macOS, enabling NavisAI to coexist seamlessly with other development tools while maintaining the clean `https://navis.local` experience. The solution intercepts HTTPS traffic, inspects TLS Server Name Indication (SNI), and routes traffic based on domain names without requiring manual port configuration.

## Problem Statement

The current packet forwarding implementation uses macOS `pfctl` to redirect ALL port 443 traffic to the NavisAI daemon, creating conflicts with:
- Other development servers (Vite, Next.js, etc.)
- Local HTTPS services
- Docker containers with HTTPS endpoints
- Third-party tools requiring port 443

This approach forces developers to choose between NavisAI and their existing tools, breaking the seamless local development experience.

## Solution Overview

We implement a transparent HTTPS proxy that:
1. Intercepts traffic destined for port 443
2. Inspects TLS SNI during handshake
3. Routes `navis.local` traffic to NavisAI daemon (127.0.0.1:47621)
4. Forwards other traffic to original destinations
5. Maintains end-to-end encryption with minimal overhead

## Architecture

### Component Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client        │    │  Transparent     │    │  Destination    │
│ (Browser/App)   │───▶│  HTTPS Proxy     │───▶│  Service        │
│                 │    │  (Port 443)      │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   NavisAI        │
                       │   Daemon         │
                       │ (127.0.0.1:47621)│
                       └──────────────────┘
```

### Data Flow

1. **Client Connection**: Client initiates HTTPS connection to any domain on port 443
2. **TLS Interception**: Proxy intercepts connection and performs TLS handshake
3. **SNI Inspection**: Proxy reads Server Name Indication (SNI) from Client Hello
4. **Routing Decision**:
   - If SNI == `navis.local` → Route to NavisAI daemon
   - Else → Route to original destination
5. **Connection Bridging**: Proxy establishes TLS connection to destination
6. **Data Relay**: Bidirectional relay of encrypted data

## Technical Implementation

### 1. Packet Filtering with pfctl

```bash
# Redirect all port 443 traffic to our proxy
rdr pass inet proto tcp from any to any port 443 -> 127.0.0.1 port 8443

# Allow loopback for proxy to destination
pass out quick inet proto tcp from 127.0.0.1 to any port 443 keep state
```

### 2. Transparent HTTPS Proxy Core

```javascript
// Core proxy logic
class TransparentHTTPSProxy {
  constructor(options) {
    this.navisPort = options.navisPort || 47621;
    this.proxyPort = options.proxyPort || 8443;
    this.server = null;
    this.cache = new Map(); // DNS + connection cache
  }

  async handleConnection(clientSocket) {
    // Parse destination from original packet
    const originalDst = this.getOriginalDestination(clientSocket);
    
    // Perform TLS handshake to read SNI
    const sni = await this.extractSNI(clientSocket);
    
    // Route based on domain
    if (sni === 'navis.local') {
      await this.routeToNavis(clientSocket);
    } else {
      await this.routeToDestination(clientSocket, originalDst);
    }
  }

  async extractSNI(socket) {
    // Parse TLS Client Hello to extract SNI
    // Implementation uses Node.js TLS parsing or native bindings
  }

  async routeToNavis(clientSocket) {
    // Connect to NavisAI daemon
    const navisSocket = net.connect({
      host: '127.0.0.1',
      port: this.navisPort
    });
    
    // Bidirectional relay
    this.relayData(clientSocket, navisSocket);
  }

  async routeToDestination(clientSocket, destination) {
    // Connect to original destination
    const targetSocket = net.connect(destination);
    
    // Bidirectional relay
    this.relayData(clientSocket, targetSocket);
  }
}
```

### 3. Dynamic Dev Server Detection

```javascript
class DevServerDetector {
  constructor() {
    this.servers = new Map();
    this.watcher = null;
  }

  async startDetection() {
    // Monitor common dev server ports
    const commonPorts = [3000, 3001, 3010, 4000, 5000, 5173, 8080, 8787];
    
    for (const port of commonPorts) {
      this.checkPort(port);
    }
    
    // Monitor process creation/destruction
    this.watchProcesses();
    
    // Monitor file changes in common directories
    this.watchWorkspace();
  }

  async checkPort(port) {
    try {
      const response = await fetch(`https://localhost:${port}/health`, {
        signal: AbortSignal.timeout(100)
      });
      
      if (response.ok) {
        this.servers.set(port, {
          process: await this.getProcessForPort(port),
          type: await this.detectServerType(port),
          lastSeen: Date.now()
        });
      }
    } catch {
      // Port not in use or not HTTPS
    }
  }

  getServerMapping() {
    // Return domain mappings for auto-detected servers
    // e.g., { 'app.localhost': 3000, 'api.localhost': 8080 }
  }
}
```

### 4. Certificate Management

```javascript
class CertificateManager {
  constructor() {
    this.certStore = new Map();
    this.rootCA = null;
  }

  async initialize() {
    // Generate or load root CA
    this.rootCA = await this.loadOrCreateCA();
    
    // Trust the CA in system keychain (requires admin once)
    await this.ensureCATrust();
  }

  async getCertificateForDomain(domain) {
    if (this.certStore.has(domain)) {
      return this.certStore.get(domain);
    }
    
    // Generate certificate on-demand
    const cert = await this.generateCertificate(domain);
    this.certStore.set(domain, cert);
    
    return cert;
  }

  async generateCertificate(domain) {
    // Generate certificate signed by our CA
    // Valid for localhost, *.localhost, and specific domains
  }
}
```

## Performance Considerations

### Optimization Strategies

1. **Connection Pooling**
   - Reuse connections to destinations
   - Implement keep-alive for frequently accessed services

2. **Caching**
   - DNS resolution cache with TTL
   - SNI-based routing cache
   - Certificate cache for repeated domains

3. **Zero-Copy Data Relay**
   - Use Node.js streams for efficient data transfer
   - Avoid buffering when possible

4. **Selective Interception**
   - Only intercept HTTPS traffic (detect via ALPN)
   - Pass-through HTTP/1.1 upgrades directly

### Benchmarks (Target)

| Metric | Target | Current (Baseline) |
|--------|--------|--------------------|
| Latency overhead | < 5ms | N/A |
| Throughput | > 500 Mbps | N/A |
| Memory usage | < 50MB | N/A |
| CPU usage | < 2% idle | N/A |

## Security Considerations

### TLS Interception Security

1. **Certificate Authority**
   - Generate unique CA per installation
   - Store CA private key securely in Keychain
   - Provide clear UI for CA trust management

2. **Certificate Validation**
   - Validate destination certificates during bridging
   - Pin NavisAI daemon certificate
   - Implement certificate revocation checking

3. **Data Privacy**
   - Never log sensitive data
   - Minimize TLS metadata retention
   - Clear buffers immediately after use

### Network Isolation

```javascript
// Security boundaries
const securityConfig = {
  allowedNetworks: ['127.0.0.1/8', '::1/128', '192.168.0.0/16', '10.0.0.0/8'],
  blockedPorts: [22, 23, 25, 53, 110, 143],  // Never proxy these
  maxConnections: 1000,
  connectionTimeout: 30000
};
```

## Integration with Existing Components

### Daemon Integration

The proxy runs as a module within the NavisAI daemon:

```javascript
// In daemon.js
import { TransparentHTTPSProxy } from './proxy/https-proxy.js';
import { DevServerDetector } from './proxy/dev-detector.js';

class NavisAIDaemon {
  async start() {
    // Start HTTPS proxy
    this.proxy = new TransparentHTTPSProxy({
      navisPort: 47621,
      proxyPort: 8443
    });
    
    await this.proxy.start();
    
    // Start dev server detection
    this.detector = new DevServerDetector();
    await this.detector.startDetection();
  }
}
```

### CLI Commands

```bash
# Enhanced setup with proxy configuration
./navisai setup --proxy-mode

# Enable/disable proxy
./navisai proxy enable
./navisai proxy disable

# View proxy status and routes
./navisai proxy status

# Add manual domain mapping
./navisai proxy map add myapp.localhost 3000

# List auto-detected servers
./navisai proxy list
```

## Migration Path

### Phase 1: Core Proxy (Week 1)
- Implement basic transparent HTTPS proxy
- Add SNI-based routing for navis.local
- Certificate generation and management

### Phase 2: Dev Server Detection (Week 2)
- Auto-detection of common dev servers
- Dynamic domain mapping
- Integration with daemon configuration

### Phase 3: Performance & Polish (Week 3)
- Connection pooling and caching
- Performance optimization
- Security hardening
- CLI integration

### Phase 4: Testing & Documentation (Week 4)
- Comprehensive test suite
- Performance benchmarks
- User documentation
- Migration guide

## Compatibility Matrix

| Feature | macOS 13+ | macOS 12 | macOS 11 | Linux | Windows |
|---------|-----------|----------|----------|-------|---------|
| pfctl redirection | ✅ | ✅ | ✅ | ❌ | ❌ |
| Transparent proxy | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dev server detection | ✅ | ✅ | ✅ | ✅ | ✅ |
| Performance optimization | ✅ | ✅ | ⚠️ | ✅ | ✅ |

## Testing Strategy

### Unit Tests
- SNI extraction accuracy
- Routing logic correctness
- Certificate generation
- Connection pooling

### Integration Tests
- End-to-end proxy flow
- Multiple concurrent connections
- Dev server detection
- TLS handshake scenarios

### Performance Tests
- Latency measurement
- Throughput benchmarks
- Memory leak detection
- CPU usage profiling

### Security Tests
- Certificate validation
- MITR (Man-in-the-Relay) security
- Data privacy verification
- CA trust management

## Monitoring and Observability

### Metrics Collection

```javascript
const proxyMetrics = {
  connectionsActive: 0,
  connectionsTotal: 0,
  bytesTransferred: 0,
  latencyHistogram: new Histogram(),
  errorsByType: new Counter(),
  routesByDomain: new Map()
};
```

### Health Checks

```javascript
class ProxyHealthChecker {
  async checkHealth() {
    return {
      proxy: await this.checkProxyStatus(),
      certificates: await this.checkCertificates(),
      pfRules: await this.checkPfRules(),
      devServers: await this.checkDevServers()
    };
  }
}
```

## Troubleshooting Guide

### Common Issues

1. **"Certificate not trusted"**
   - Run `./navisai setup --trust-ca`
   - Check Keychain access permissions

2. **"Connection refused"**
   - Verify pf rules: `sudo pfctl -a navisai -s rules`
   - Check proxy status: `./navisai proxy status`

3. **"High latency"**
   - Disable proxy temporarily: `./navisai proxy disable`
   - Check for connection leaks: `./navisai doctor`

4. **"Dev server not detected"**
   - Verify server is running on HTTPS
   - Check process monitoring: `./navisai proxy list --verbose`

## Conclusion

This domain-based packet forwarding design provides a robust foundation for NavisAI to coexist with other development tools while maintaining the seamless `https://navis.local` experience. The transparent proxy approach offers flexibility, performance, and security without requiring developers to modify their existing workflows.

The implementation phases ensure incremental delivery of value while maintaining system stability and providing clear migration paths for existing users.

## References

- [NETWORKING.md - Core Networking Architecture](./NETWORKING.md)
- [SECURITY.md - Security Model](./SECURITY.md)
- [SETUP.md - Installation and Setup](./SETUP.md)
- [macOS pfctl documentation](https://www.openbsd.org/faq/pf/)
- [TLS 1.3 Specification](https://tools.ietf.org/html/rfc8446)
- [Node.js TLS/HTTPS modules](https://nodejs.org/api/tls.html)
