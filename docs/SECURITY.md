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
- The daemon binds to loopback by default (`127.0.0.1`) and is reached over LAN via a local bridge on 443.  
- Public Internet exposure is strictly prohibited.  
- All pairing attempts require explicit approval from the primary machine.

---

## 5. PWA Security

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
