# Navis AI — macOS Setup Experience (Apple-like)

Version: v0.2  
Status: Spec (preferred UX)

Canonical networking model: `NETWORKING.md`.

This document specifies the most user-friendly macOS setup for enabling the clean LAN origin:

- `https://navis.local` (no port)

It intentionally avoids terminal-first workflows for mainstream users.

---

## 1. UX Goal

Deliver a "double-click installer" experience:

1. User installs Navis like a normal Mac app.
2. macOS shows a standard authentication sheet **once** (administrator approval).
3. After install, daily usage requires **no password** and **no sudo**.
4. **Navis integrates seamlessly with existing development servers** on port 443.
5. User can uninstall cleanly.

---

## 2. Why one admin approval is unavoidable

Browsers interpret `https://navis.local` as TCP **443**.
On macOS, something must be authorized to bind 443 (directly or via launchd/system services).

The goal is not "no admin approval ever", but:

> Admin approval once during install/setup, never during daily use.

> **Seamless integration**: Navis should never disrupt the developer's existing workflow.

---

## 3. Preferred macOS Delivery: Installer + Intelligent Bridge

### 3.1 What gets installed (system-level)

Install a small "Navis Bridge" component that:

- Binds `0.0.0.0:443` (LAN) as an **intelligent reverse proxy**
- **Detects existing port 443 services** and routes accordingly
- Routes `/navis/*` paths to Navis daemon on `127.0.0.1:47621`
- Routes all other paths to the user's development app on port 443
- Terminates TLS for routing, re-encrypts when forwarding to daemon

Managed by:
- `launchd` LaunchDaemon (system domain)

### 3.2 What the user sees

- A standard macOS installer UI (signed `.pkg`) or a small macOS Setup app.
- A single macOS authentication sheet for admin approval.
- **Smart detection**: Setup app detects if port 443 is already in use.
- A final success screen that opens:
  - `https://navis.local/navis/welcome` (Navis UI)
  - Instructions that their app is available at `https://navis.local`

### 3.3 Setup app responsibilities

A "Navis Setup" app provides the Apple-like experience:

- Shows clear status: Bridge, mDNS, TLS, daemon, Port 443 detection
- **Port 443 intelligence**:
  - Shows "Port 443 is in use by [app name]"
  - Explains automatic routing setup
  - Warns if routing injection might fail
- Runs diagnostics equivalent to `navisai doctor`
- Offers "Enable" / "Disable" buttons
- Provides QR + pairing onboarding deep link

## 3.4 UX Plan (Install + Uninstall)

### Install (clean and intelligent)

Goal: one standard macOS admin sheet, seamless integration with existing apps.

1. User launches "Navis Setup".
2. Setup app runs preflight checks (no privilege required):
   - Detect whether bridge LaunchDaemon is installed/enabled
   - **Scan for port 443 usage** and identify the service
   - Detect whether `navis.local` resolves via mDNS
   - Check TLS material at `~/.navis/certs/`
3. User clicks **Enable**.
4. If port 443 is free:
   - Standard bridge installation
5. If port 443 is occupied:
   - Explain the automatic routing setup
   - Show how Navis will integrate with existing app
6. Setup app requests admin approval and installs the intelligent bridge.
7. Bridge automatically configures routing based on detected services.
8. Setup app shows success and opens:
   - `https://navis.local/navis/welcome`
   - Note about accessing their app at `https://navis.local`

### Uninstall / Disable (clean and safe)

Goal: clean removal without disrupting user's development setup.

1. User launches "Navis Setup".
2. If bridge is enabled, UI shows **Disable**.
3. User clicks **Disable**.
4. Setup app:
   - Warns if port 443 routing will affect Navis access
   - Preserves user's development app functionality
   - Removes only Navis routing rules
5. Confirms that their development app remains unaffected.

---

## 4. Intelligent Routing Behavior

### 4.1 When port 443 is free
- Navis owns port 443 directly
- `https://navis.local` → Navis (redirects to `/navis/welcome`)

### 4.2 When port 443 is occupied
- Bridge injects itself as a proxy
- `https://navis.local/navis/*` → Navis daemon
- `https://navis.local/*` → User's development app
- **Transparent to the user's app** - no configuration needed

### 4.3 Conflict resolution
- If routing injection fails:
  - Clear error message explaining the issue
  - Provides alternatives:
    - Stop the conflicting service temporarily
    - Use Navis on alternate port (for testing only)
    - Manual proxy configuration instructions

---

## 5. Relationship to NPM CLI

The NPM CLI remains the developer control surface:

- `navisai up` starts the daemon (unprivileged)
- `navisai doctor` validates routing and connectivity
- `navisai setup` launches the GUI Setup app (default on macOS)

---

## 6. Implementation Notes

### 6.1 Bridge Implementation Strategies
- **HTTP proxy module** (Node.js http-proxy or similar)
- **TLS termination** with certificate for `navis.local`
- **Path-based routing** with configurable rules
- **Service detection** via port scanning and process inspection

### 6.2 Safety Mechanisms
- **Never disrupt existing services** - bridge must fail safe
- **Automatic fallback** if proxy rules cause issues
- **Clear error reporting** with actionable guidance
- **Preserve original service behavior** - Navis should be invisible to the user's app

### 6.3 Non-goals
- Manual proxy configuration
- Editing `/etc/hosts`
- Requiring users to change their app's port
- Breaking existing development workflows

---

## 7. Implementation Checklist (Setup app v0.2)

### 7.1 Setup app behaviors
- **Port 443 detection** and service identification
- **Routing status display**: Shows what paths go where
- **Conflict warnings**: Clear messaging about potential issues
- **Preflight diagnostics**: Bridge, daemon, TLS, mDNS, port usage

### 7.2 Bridge requirements
- **Path-based routing**: `/navis/*` → daemon
- **Default routing**: `/*` → port 443 app
- **TLS handling**: Terminate and re-encrypt as needed
- **Service monitoring**: Detect and adapt to changes

### 7.3 CLI integration
- `navisai doctor` shows routing status
- `navisai setup` defaults to GUI on macOS
- Enhanced error messages for routing issues
