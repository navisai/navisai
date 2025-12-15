# NavisAI Implementation Review

## Summary of Deviations from Documentation

### 1. **Port Configuration**
- **Documentation**: Default port 47621 (configurable via config.json or CLI flags)
- **Current Implementation**: Tries port 443 first, falls back to 8443
- **Impact**: Requires sudo privileges for port 443, conflicts with docs

### 2. **DNS/Service Discovery**
- **Documentation**: Uses mDNS/Bonjour for service discovery
- **Current Implementation**: Requires manual hosts file modification for navis.local
- **Impact**: Additional setup step, not automatic as intended

### 3. **Architecture Requirements**
- **Documentation**: Daemon serves at `https://navis.local` (no port)
- **Current Implementation**: Requires port number unless using port 443
- **Impact**: User experience mismatch with documented expectations

## Recommendations

### Immediate Actions

1. **Update Port Configuration**
   ```javascript
   // Use port 47621 by default (as per docs)
   const DEFAULT_PORT = 47621
   
   // Allow configuration via:
   // - ~/.navis/config.json
   // - CLI flags: --port=47621
   // - Environment: NAVIS_PORT=47621
   ```

2. **Implement mDNS/Bonjour**
   ```javascript
   // Install: pnpm add bonjour-service
   import bonjour from 'bonjour-service'
   
   // Announce service
   const service = bonjour().publish({
     name: 'NavisAI',
     type: 'https',
     port: config.daemon.port,
     txt: {
       path: '/welcome'
     }
   })
   ```

3. **Port Forwarding Solution**
   Since nginx is already on port 443:
   ```nginx
   # /etc/nginx/sites-available/navis
   server {
       listen 443 ssl;
       server_name navis.local;
       
       location / {
           proxy_pass https://127.0.0.1:47621;
           proxy_ssl_verify off;
           # ... other proxy settings
       }
   }
   ```

### Long-term Solutions

1. **Auto-configuration Setup Script**
   - Detect and configure nginx proxy automatically
   - Set up mDNS service discovery
   - Generate appropriate SSL certificates

2. **Zero-Configuration Discovery**
   - Use mDNS so navis.local resolves without hosts file
   - Client auto-discovers daemon port
   - No sudo required

3. **Follow Documentation Architecture**
   - Port 47621 by default
   - Configuration via `navis.config.json`
   - User-level operation (no sudo)

## Code Changes Needed

### 1. Update https-server.js
- Remove port 443 logic
- Use port from config (default 47621)
- Add mDNS announcement

### 2. Update CLI
- Add --port flag support
- Read from navis.config.json
- Auto-configure nginx if needed

### 3. Create setup wizard
```bash
navisai setup
# Detects nginx, offers to configure proxy
# Sets up mDNS
# Creates initial config
```

## Implementation Priority

1. **High**: Fix port configuration to match docs (47621)
2. **High**: Add nginx proxy configuration for navis.local without port
3. **Medium**: Implement mDNS service discovery
4. **Low**: Remove sudo requirement entirely
