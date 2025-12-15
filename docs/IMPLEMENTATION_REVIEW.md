# NavisAI Implementation Review

Canonical networking model: see `NETWORKING.md`.

## Summary of Deviations from Canonical Model

### 1. **Port Configuration**
- **Canonical**: Clean LAN URL is always `https://navis.local` (443 via Navis Bridge), daemon stays unprivileged on an internal port (default 47621).
- **Current Implementation**: Mixes ported URLs and attempts to bind privileged ports directly.
- **Impact**: Breaks the “no sudo during daily use” goal and creates inconsistent client behavior.

### 2. **DNS/Service Discovery**
- **Canonical**: Use mDNS/Bonjour so phones resolve `navis.local` to the host machine’s LAN IP. Never rely on `127.0.0.1 navis.local` for LAN clients.
- **Current Implementation**: Includes hosts-file based strategies.
- **Impact**: Hosts-based resolution breaks phone access and violates the desired seamless onboarding.

### 3. **Architecture Requirements**
- **Canonical**: Everything is reachable at `https://navis.local` (no port). A local bridge owns 443; the daemon does not.
- **Current Implementation**: Users must guess ports or run privileged commands.
- **Impact**: Non-Apple-like UX and documentation drift.

## Recommendations

### Immediate Actions

1. **Introduce Navis Bridge**
   - Provide a one-time `navisai setup` that installs an OS-integrated 443 → 47621 TCP forwarder.
   - Daily usage (`navisai up`) must not require sudo.

2. **Implement mDNS/Bonjour for `navis.local`**
   - Advertise `navis.local` to the host machine’s LAN IP so phones resolve it automatically.

3. **Make onboarding a first-class PWA route**
   - Serve the PWA from the daemon and make `/welcome` a PWA route (no inline HTML; no CDN dependencies).

### Long-term Solutions

1. **Polished setup experience**
   - Guided trust/cert flow for mobile
   - Clear diagnostics when `navis.local` is not resolving or 443 is not reachable

2. **Strict shared contracts**
   - Define API/WS schema in `api-contracts` and generate/validate across daemon/CLI/PWA

## Code Changes Needed

### 1. Add Navis Bridge
- Provide an OS-integrated 443 → 47621 TCP forwarder (launchd/systemd) so the daemon remains unprivileged.

### 2. Update daemon networking
- Bind daemon to `127.0.0.1:47621` by default (internal listener).
- Ensure the daemon serves HTTPS + WSS with a cert valid for `navis.local`.

### 3. Update CLI
- Add a first-class setup command for the one-time OS integration.
- Keep `--port` as an advanced/debug option (not required for the canonical UX).

### 4. Create setup wizard
```bash
navisai setup
# Enables Navis Bridge (443 → 47621)
# Enables mDNS for navis.local on LAN
# Generates/refreshes local certs
```

## Implementation Priority

1. **High**: Land `NETWORKING.md` as doc-of-record and align all docs
2. **High**: Add Navis Bridge and mDNS resolution (enables clean URL)
3. **Medium**: Align daemon + PWA to a single-origin API/WSS model
