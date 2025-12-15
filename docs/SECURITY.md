# Navis AI — Security Policy

## 1. Philosophy

Navis is designed as a **local-first**, **developer-controlled**, and **privacy-focused** tool.

Security principles:
- User consent is mandatory for all mutative actions  
- No cloud dependencies in the OSS version  
- All data is stored locally using SQLite  
- Device pairing must be explicit and user-approved  
- BLE/mDNS/QR pairing exposes no secrets  
- All network activity uses HTTPS on localhost  

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

- The daemon binds only to local network interfaces.  
- Public access is strictly prohibited.  
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
