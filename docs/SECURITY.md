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

## 5. Platform Health Gates (Required)

Navis must refuse mutative actions unless the local platform passes:

- `mDNSResponder` is running
- `mDNSResponderHelper` is running
- `dns-sd` service queries succeed
- `dscacheutil` resolves external hosts
- `/var/run/mDNSResponder` socket exists
- A Navis-recorded local snapshot exists and is within the configured freshness window
- mDNS policy overrides are not disabling multicast advertisements
- OCLP/root-patched environments are detected and gated

Snapshot policy:
- Before any mutative action, delete the prior Navis-recorded snapshot only (never touch other snapshots), then create a new snapshot and record its ID.
- Snapshot freshness is configurable; only a Navis-recorded snapshot within the freshness window satisfies the gate.
- Bridge start must be explicitly approved (setup-only). Mutations are blocked without approval.

If any check fails, Navis must block setup/bridge mutations and provide guided repair steps. No automatic fixes.

### Prohibited Repair Actions

Navis must not attempt or recommend:

- Restoring or merging `SystemConfiguration` folders
- Copying legacy or broken plists into `/Library/Preferences/SystemConfiguration`
- Repair-by-replacement of system networking folders

### Debugging Tools Policy

- `lldb` is allowed only in developer builds or Doctor mode.
- `lldb` is forbidden for end-user flows.

### User-Space State Notes

User app state resets after network service regeneration are not rollback signals and do not imply corruption.

### Agent Safety Protocol

- Review incident context, recent commits, Beads status, and confirm snapshot state before proposing changes.

---

## 5. Packet Forwarding Security

Packet forwarding introduces specific security considerations:

### 5.1 Domain-Based Routing
- Only traffic for `navis.local` is forwarded to the daemon
- All other domains pass through unchanged to existing services
- Host header inspection prevents cross-domain attacks

### 5.1.1 TLS Coexistence and Trust Preservation

Navis must not degrade the trust posture of other local HTTPS services:
- For non‑Navis domains, the client must see the original server certificate (no MITM).
- If the bridge/proxy ever presents a Navis-signed certificate for a non‑Navis domain, browsers will flag those sites as insecure; this is a regression.

Refs: navisai-288, navisai-ms0

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
- If mDNS is policy-disabled (`NoMulticastAdvertisements = true`), Navis must refuse to enable LAN routing and explain the risk.

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
