#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { platform } from 'node:os'

const os = platform()

function run(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options })
    return true
  } catch (error) {
    console.error(`⚠️  Command failed: ${command}`)
    if (error?.message) {
      console.error(`   ${error.message}`)
    }
    return false
  }
}

console.log('🛑 Navis Bridge emergency stop')

if (os === 'darwin') {
  run('sudo pfctl -a navisai/proxy -F nat 2>/dev/null || true')
  run('sudo pfctl -a navisai/filter -F rules 2>/dev/null || true')
  run('sudo launchctl bootout system /Library/LaunchDaemons/com.navisai.bridge.plist >/dev/null 2>&1 || true')
  run('sudo pkill -f "bridge.js start" >/dev/null 2>&1 || true')
  console.log('✅ Emergency stop completed (macOS)')
} else if (os === 'linux') {
  run('sudo iptables -t nat -D PREROUTING -p tcp --dport 443 -m string --string "Host: navis.local" -j DNAT --to-destination 127.0.0.1:47621 || true')
  run('sudo iptables -D FORWARD -p tcp -d 127.0.0.1 --dport 47621 -j ACCEPT || true')
  run('sudo iptables -t nat -D POSTROUTING -j MASQUERADE || true')
  run('sudo systemctl disable --now navisai-bridge.service >/dev/null 2>&1 || true')
  console.log('✅ Emergency stop completed (Linux)')
} else if (os === 'win32') {
  run('powershell -NoProfile -ExecutionPolicy Bypass -Command "sc stop navisai-bridge 2>$null; sc delete navisai-bridge 2>$null"')
  console.log('✅ Emergency stop completed (Windows)')
} else {
  console.error(`Unsupported platform: ${os}`)
  process.exit(1)
}
