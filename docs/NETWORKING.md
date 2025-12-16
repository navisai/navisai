# Navis AI — Canonical Networking Model
Version: v0.2  
Status: Canonical (Doc-of-record)

This document defines the single source of truth for how Navis is reached over LAN.
If another document conflicts with this one, update the other document.

Setup details: see `SETUP.md`.

---

## 1. Goal (Apple-like UX)

- One clean LAN URL: `https://navis.local` (no port).
- **Intelligent routing**: Navis integrates seamlessly with existing development apps.
- No `sudo` during normal daily usage (`navisai up`).
- Daemon is not a privileged process.
- Works from phones and browsers on the same LAN.
- **Zero conflict with development servers** on port 443.

---

## 2. Key Constraints (Why this design exists)

- In every browser, `https://navis.local` with no port implies TCP port **443**.
- Development apps commonly need port 443 for HTTPS testing.
- Navis must **defer to existing port 443 services** while providing its functionality.
- mDNS/Bonjour enables **LAN name resolution and discovery**; it does not change the browser's default port behavior.
- Users should not have to configure routing manually.

---

## 3. Components

### 3.1 Navis Daemon (unprivileged)

- Listens on **loopback**: `127.0.0.1:47621` by default.
- Serves:
  - PWA assets (SvelteKit build output)
  - Onboarding at `/welcome` (a PWA route)
  - REST API (see `IPC_TRANSPORT.md`)
  - WebSocket at `/ws`
- Uses HTTPS + WSS with a certificate valid for `navis.local`.
- **Always accessible at the root origin** (`https://navis.local/`) - no subdirectory routing.

### 3.2 Navis Bridge (packet forwarding)

- Uses **OS-level packet forwarding** to selectively route traffic based on domain.
- **Domain-based forwarding**:
  - Traffic for `navis.local` → forwarded to daemon on `127.0.0.1:47621`
  - Traffic for all other domains → passes through to existing services
- **No TLS termination** - packets are forwarded transparently at network level.
- **Always available**: Navis is accessible at `https://navis.local` regardless of other services.
- **Packet-level routing**:
  - macOS: pfctl with rdr rules based on Host header
  - Linux: iptables with string matching
  - Windows: netsh portproxy (limited to all traffic)
- **No port conflicts**: Multiple services can share port 443 without conflicts.

OS integration:
- macOS: launchd LaunchDaemon (installed via `navisai setup`)
- Linux: systemd service
- Windows: service

Implementation note:
- Packet forwarding rules are installed with OS-specific tools (pfctl, iptables, netsh).
- Rules are added with priority based on packet inspection (Host header matching).
- No service needs to "bind" port 443 exclusively - the OS handles routing at packet layer.

### 3.3 mDNS/Bonjour (LAN name resolution + discovery)

- Ensures `navis.local` resolves on the LAN to the host machine's LAN IP.
- Advertises the Navis service for discovery/diagnostics.
- Clients use the canonical URL:
  - `https://navis.local` (always Navis - packet forwarded)
  - `https://navis.local/welcome` (Navis onboarding)
  - `https://navis.local/*` (all Navis API/UI paths)
  - `wss://navis.local/ws` (Navis WebSocket)

---

## 4. Setup vs Daily Use (Human-in-the-loop)

### 4.1 One-time setup (explicit user consent)

`navisai setup` performs OS-level configuration:

- Installs packet forwarding rules for domain-based routing.
- Enables mDNS advertisement for `navis.local`.
- Generates/refreshes the `navis.local` certificate.
- Detects existing port 443 usage but proceeds regardless (no conflicts).
- Installs OS service for managing packet forwarding rules.

This step may require admin privileges once. It's explicit, reversible, and never silent.

### 4.2 Daily use (no sudo)

`navisai up`:
- Starts the daemon unprivileged.
- Packet forwarding routes `navis.local` to daemon.
- Prints (and optionally offers to open) `https://navis.local/welcome`.

### 4.3 Development workflow

1. Start your development app (any port, even 443)
2. Run `navisai up`
3. Navis is always accessible at: `https://navis.local`
   - No conflict with other apps due to domain-based forwarding

---

## 5. Packet Forwarding Details

### 5.1 No Conflicts by Design

Since packet forwarding operates at the network layer:
- Multiple services can appear to use port 443 simultaneously
- Domain (`navis.local`) determines routing, not port exclusivity
- No need for port number juggling or complex conflict resolution

### 5.2 Implementation by Platform

**macOS**:
```bash
# Enable forwarding
sudo sysctl -w net.inet.ip.forwarding=1

# Add rule for navis.local
echo "rdr pass on lo0 inet proto tcp from any to any port 443 -> 127.0.0.1 port 47621" | sudo pfctl -a navis -f -
```

**Linux**:
```bash
# Forward navis.local traffic
sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -m string --string "Host: navis.local" -j DNAT --to-destination 127.0.0.1:47621
```

**Windows**:
```cmd
# Forward all 443 traffic (limited by Windows)
netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=47621 connectaddress=127.0.0.1
```

---

## 6. Optional “debug mode” (not the default)

For development/debugging, the daemon may optionally be reachable directly at:

- `https://127.0.0.1:47621` or `https://localhost:47621`

This bypasses the bridge and is not the canonical user experience.
