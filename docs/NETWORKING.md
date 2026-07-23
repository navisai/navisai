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
- **Zero conflict with development servers** on port 443; the bridge must never block an existing 443 listener owned by a dev tool (Refs: navisai-dool).

### Recommendation Scope (Non-Negotiable)

- All guidance must align to documented requirements in `docs/`.
- If a suggestion is outside documented scope, explicitly label it as such and explain why it is being raised.
- Never recommend changes to user development tools or services to resolve Navis conflicts.

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
- TLS must be a local Navis CA + leaf chain with explicit DNS SANs (at minimum `navis.local`) and EKU `serverAuth`.
- The daemon must serve the full chain (leaf + CA).
- **Always accessible at the root origin** (`https://navis.local/`) - no subdirectory routing.

### 3.2 Navis Bridge (packet forwarding)

- Uses **OS-level packet forwarding** to selectively route traffic based on domain.
- **Domain-based forwarding**:
  - Traffic for `navis.local` → forwarded to daemon on `127.0.0.1:47621`
  - Traffic for all other domains → passes through to existing services
- **Coexistence contract (dev-friendly)**:
- The bridge may redirect all `:443` traffic into a local transparent proxy for inspection.
- The proxy **MUST NOT** break other HTTPS services (e.g., ServBay).
- The proxy **MUST NOT** terminate TLS for non‑Navis domains; it must pass through bytes to the original destination so the client sees the original peer certificate.
- Only `navis.local` (and any explicitly configured Navis-owned domains) may be terminated/served by Navis.
- Refs: navisai-288, navisai-ms0
- The bridge must confirm the alias IP is unused before binding; Navis should treat conflicting listeners as out-of-scope, keep searching for another unused alias (within reason), and fail with Navis-scoped remediation if none is available. It must not ask users to change unrelated development services (Refs: navisai-dool).
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
- See [DOMAIN_BASED_FORWARDING_DESIGN.md](./DOMAIN_BASED_FORWARDING_DESIGN.md) for detailed technical implementation.

### 3.3 mDNS/Bonjour (LAN name resolution + discovery)

- Ensures `navis.local` resolves on the LAN to the host machine's LAN IP.
- Advertises the Navis service for discovery/diagnostics.
- Clients use the canonical URL:
  - `https://navis.local` (always Navis - packet forwarded)
  - `https://navis.local/welcome` (Navis onboarding)
  - `https://navis.local/*` (all Navis API/UI paths)
  - `wss://navis.local/ws` (Navis WebSocket)

**Mobile LAN reachability (common failure modes)**:
- **Client isolation / guest network**: Many routers block mDNS or peer-to-peer traffic between Wi‑Fi clients. Disable client isolation or test on the main LAN SSID.
- **mDNS filtering**: Some networks allow TCP but block UDP/5353 multicast. Use `dns-sd -B _services._dns-sd._udp local` on host and confirm the phone sees `navis.local` after setup.
- **Split LANs**: Ensure phone and host are on the same subnet/VLAN.
- If mobile cannot resolve `navis.local`, test LAN IP reachability to confirm bridge forwarding:
  - `https://<LAN_IP>/status` (expect a cert warning; bypass to confirm connectivity)

---

## 4. Setup vs Daily Use (Human-in-the-loop)

### 4.0 Preflight + snapshot gate (blocker)

Navis must refuse mutative setup actions unless all preflight checks pass and a Navis-created snapshot is recorded:

- `ps aux | grep mDNSResponder`
- `ps aux | grep mDNSResponderHelper`
- `dns-sd -Q _services._dns-sd._udp local`
- `dscacheutil -q host -a name apple.com`
- `ls /var/run/mDNSResponder` (socket must exist)
- `tmutil listlocalsnapshots /` (must include a Navis-recorded snapshot)
- `defaults read /Library/Preferences/com.apple.mDNSResponder.plist` (block if `NoMulticastAdvertisements = true`)
- Detect OCLP/root-patched environments and apply stricter safeguards

Snapshot policy:
- Before any mutative action, delete the prior Navis-recorded snapshot only (never touch other snapshots), then create a new snapshot and record its ID.
- Snapshot freshness is configurable; only a Navis-recorded snapshot within the freshness window satisfies the gate.
- Bridge start must be explicitly approved (setup-only). Mutations are blocked without approval.

If any check fails, Navis must block setup/bridge mutations and provide guided repair steps. No automatic fixes.

Prohibited actions:
- Do not restore/merge `SystemConfiguration` folders or copy old plists into `/Library/Preferences/SystemConfiguration`.

### 4.1 One-time setup (explicit user consent)

`navisai setup` performs OS-level configuration:

- Installs packet forwarding rules for domain-based routing.
- Enables mDNS advertisement for `navis.local`.
- Generates/refreshes the `navis.local` certificate.
- Requires desktop trust for `navis.local` before setup completes and guides mobile trust before pairing.
- Detects existing port 443 usage, selects an unused alias, and refuses setup if no safe Navis-owned binding is available.
- Installs OS service for managing packet forwarding rules.
- On macOS, installs `pf` anchor points into `/etc/pf.conf` (high-risk) so the `navisai/*` anchors are reachable by `pfctl` (Refs: navisai-7yr).
- Requires a verified local APFS snapshot before mutating PF, mDNS, or TLS state.

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

If a non‑Navis local HTTPS service starts showing “Not secure” after setup, treat it as a regression: Navis is likely presenting an untrusted certificate for a non‑Navis domain, which violates the coexistence contract (Refs: navisai-288).

**Important macOS dev-tool coexistence notes (ServBay/nginx, etc.)**
- ServBay and similar tools commonly bind `0.0.0.0:443` and serve multiple local domains via nginx virtual hosts.
- Navis must be “invisible” to those tools: no TLS MITM, no certificate generation for non‑Navis domains, and no breaking existing nginx routing (Refs: navisai-288, navisai-ms0).
- macOS pf has a known limitation: traffic originating on the same machine can bypass `rdr` (localhost-origin) rules, so on-host requests to `https://navis.local` may land in the existing `:443` listener (e.g., ServBay’s default vhost) instead of Navis (Refs: navisai-5zu).
- The long-term fix for true encapsulation is to give `navis.local` a dedicated IP (IP alias) and redirect only that IP, so other `:443` services are never intercepted at all (Refs: navisai-i3s).
  - On macOS, the bridge also binds a local listener on the dedicated alias IP:443 and forwards to the transparent proxy so on-host `https://navis.local` works (Refs: navisai-8jps).
  - This dedicated IP is auto-chosen from the current LAN subnet and is **per-network** (it can change when you switch networks/SSIDs) (Refs: navisai-2bn).
  - The bridge must detect alias conflicts (already-assigned IPs, wildcard `0.0.0.0:443` bindings) and select an unused alias IP before mutating pf rules; never hijack an active dev tool IP (Refs: navisai-bpqd, navisai-o52f).
  - If no safe alias IP is available, setup must refuse to proceed and surface a remediation path (Refs: navisai-bpqd).
  - The bridge re-evaluates the alias on LAN changes and reloads pf rules to keep routing bound to the current subnet (Refs: navisai-2bn).
  - Before binding the alias, the bridge must scan for any existing listener on the candidate alias IP:443 and reject it if another process already owns the port; Navis must choose another alias or refuse setup rather than changing or taking over the conflicting service (Refs: navisai-dool).
  - PF rules must live exclusively under the `navisai/*` anchors; never touch Apple default anchors.
  - PF rule installs must support a dry-run mode and require a snapshot before enabling.

### 5.2 Implementation by Platform

**macOS**:
```bash
# Enable forwarding
sudo sysctl -w net.inet.ip.forwarding=1

# Domain-based forwarding with transparent HTTPS proxy (LAN inbound only)
# Redirect inbound :443 destined to this host's LAN IP into the proxy (8443).
# This avoids intercepting outbound HTTPS traffic and avoids creating a loopback-only redirect.
LAN_IP="192.168.1.71" # example; compute dynamically in setup
echo "rdr pass inet proto tcp from any to ${LAN_IP} port 443 -> 127.0.0.1 port 8443" | sudo pfctl -a navisai/proxy -f -

# Local access on macOS (on-host navis.local)
# If a dedicated alias IP is reserved, bind a local listener on ALIAS_IP:443 and
# forward to the transparent proxy (8443) so localhost-origin traffic works.
# This listener must bind only to ALIAS_IP to avoid interfering with other 443 services.
ALIAS_IP="192.168.1.162" # example alias; compute dynamically

# The transparent proxy inspects TLS SNI and routes:
# - navis.local → 127.0.0.1:47621 (NavisAI daemon)
# - other domains → original destinations (passthrough, no MITM)
# If SNI is missing (common when accessing by raw IP), the proxy must not drop;
# it should route to the daemon as a debug fallback (expect a cert warning on IP access).
```

**Linux**:
```bash
# Forward navis.local traffic (proper domain-based filtering)
sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -m string --string "Host: navis.local" -j DNAT --to-destination 127.0.0.1:47621
```

**Windows**:
```cmd
# Forward all 443 traffic (Windows limitation - cannot filter by domain)
netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=47621 connectaddress=127.0.0.1
```

**Implementation Status**:
- **macOS**: ✅ Solved with transparent HTTPS proxy (see navisai-a1p). The proxy inspects TLS SNI to achieve true domain-based forwarding without conflicts.
- **Linux**: Properly implements domain-based forwarding using string matching on the Host header.
- **Windows**: netsh portproxy cannot filter by domain and forwards all port 443 traffic - this is a known Windows limitation.

---

## 6. Optional “debug mode” (not the default)

---

## 7. Non-mutative mDNS Verification Runbook (Safe Diagnostics)

Use these steps to verify mDNS health **without** changing system state. These are safe to run before setup
and do not require a snapshot.

1. Confirm mDNSResponder is running:
   - `ps aux | grep mDNSResponder`
   - `ps aux | grep mDNSResponderHelper`

2. Verify DNS-SD responses:
   - `dns-sd -Q _services._dns-sd._udp local`
   - `dns-sd -B _services._dns-sd._udp local`

3. Verify multicast reachability directly:
   - `dig @224.0.0.251 -p 5353 _services._dns-sd._udp.local`

4. Verify general resolver health:
   - `dscacheutil -q host -a name apple.com`

If any of the above fail, **do not** attempt mutative fixes without a fresh Navis snapshot and explicit
user opt-in (see `docs/SECURITY.md`).

For development/debugging, the daemon may optionally be reachable directly at:

- `https://127.0.0.1:47621` or `https://localhost:47621`

This bypasses the bridge and is not the canonical user experience.
