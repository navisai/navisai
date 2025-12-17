# Navis AI — Security Policy

## 1. Philosophy

Navis is designed as a **local-first**, **developer-controlled**, and **privacy-focused** tool.

Security principles:
- User consent is mandatory for all mutative actions  
- No cloud dependencies in the OSS version  
- All data is stored locally using SQLite  
- Device pairing must be explicit and user-approved  
- BLE/mDNS/QR pairing exposes no secrets  
- All LAN access uses HTTPS at `https://navis.local` (no port)  

---

## 2. Supported Versions

All active releases receive patches.  
Nightly builds are not guaranteed secure.

---

## 3. Reporting Vulnerabilities

Please report security issues privately to:

security@navis.dev

Do NOT open GitHub issues for security concerns.

---

## 4. Local Daemon Rules

- The daemon is not a privileged process.  
- The daemon binds to loopback by default (`127.0.0.1`) and is reached over LAN via OS-level packet forwarding on 443.  
- Public Internet exposure is strictly prohibited.  
- All pairing attempts require explicit approval from the primary machine.

---

## 5. Packet Forwarding Security

Packet forwarding introduces specific security considerations:

### 5.1 Domain-Based Routing
- Only traffic for `navis.local` is forwarded to the daemon
- All other domains pass through unchanged to existing services
- Host header inspection prevents cross-domain attacks

### 5.2 OS-Level Security
- Packet forwarding rules require administrator privileges for installation
- Rules are installed in dedicated anchors/namespaces to avoid conflicts
- Cleanup on daemon removal ensures no persistent rules

### 5.3 Threat Mitigation
- **Port hijacking**: Not possible - rules are domain-specific
- **Traffic interception**: Limited to navis.local only
- **Privilege escalation**: Daemon remains unprivileged
- **Resource exhaustion**: Rules are minimal and efficient

## 6. mDNS Security Considerations

### 6.1 LAN Exposure
- mDNS advertisements are limited to the local network segment
- No personal data is included in mDNS records
- Service records follow Bonjour security best practices

### 6.2 Discovery Risks
- **Network enumeration**: mDNS reveals Navis presence on LAN
  - Mitigation: User can disable mDNS in sensitive environments
- **Spoofing attacks**: Possible on compromised networks
  - Mitigation: All traffic still uses HTTPS with certificate validation

### 6.3 Recommendations
- Use Navis on trusted networks only
- Consider VPN for public WiFi usage
- mDNS can be disabled for air-gapped environments

## 7. PWA Security

- PWA communicates only with the local daemon.  
- No external calls unless configured.  
- Service worker caches only static assets + minimal session metadata.

---

## 6. SQLite Data Protection

SQLite DB is stored at:

```
~/.navis/db.sqlite
```

Users may encrypt this using OS-level full disk encryption.

---
