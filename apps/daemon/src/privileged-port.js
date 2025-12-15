/**
 * Privileged Port Handler
 * Handles binding to port 443 (HTTPS) with proper privileges
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { platform } from 'node:os'
import { logger } from '@navisai/logging'

const execAsync = promisify(exec)
const require = createRequire(import.meta.url)

export class PrivilegedPortHandler {
  constructor() {
    this.isUsingAuthBind = false
    this.platform = platform()
  }

  /**
   * Check if running with sufficient privileges for port 443
   */
  async checkPrivileges() {
    // On Unix-like systems, check if running as root
    if (this.platform === 'darwin' || this.platform === 'linux') {
      try {
        // Check if we can bind to port 443
        const net = await import('node:net')
        const server = net.default.createServer()

        return new Promise((resolve) => {
          server.listen(443, '0.0.0.0', () => {
            server.close(() => {
              resolve(true) // We can bind to 443
            })
          })

          server.on('error', (err) => {
            if (err.code === 'EACCES') {
              resolve(false) // Need privileges
            } else {
              resolve(false) // Other error
            }
          })
        })
      } catch (error) {
        logger.warn('Failed to check port 443 privileges', { error: error.message })
        return false
      }
    }

    // On Windows, any user can bind to any port
    return true
  }

  /**
   * Try to enable binding to port 443 without root
   */
  async enablePortBinding() {
    if (await this.checkPrivileges()) {
      logger.info('Sufficient privileges for port 443')
      return true
    }

    logger.warn('Insufficient privileges for port 443, attempting workarounds')

    // Try authbind on Linux
    if (this.platform === 'linux') {
      try {
        // Check if authbind is available
        await execAsync('which authbind')
        logger.info('authbind found, enabling port 443 binding')

        // Create authbind configuration for port 443
        try {
          await execAsync('mkdir -p ~/.authbind && touch ~/.authbind/byport/443 && chmod 755 ~/.authbind/byport/443')
          this.isUsingAuthBind = true
          return true
        } catch (error) {
          logger.warn('Failed to configure authbind', { error: error.message })
        }
      } catch {
        logger.info('authbind not available')
      }
    }

    // Try to use setcap on Linux (allow binding to privileged ports)
    if (this.platform === 'linux') {
      try {
        // Check if node binary has CAP_NET_BIND_SERVICE capability
        const { stdout } = await execAsync('getcap $(which node)')
        if (stdout.includes('cap_net_bind_service')) {
          logger.info('Node has CAP_NET_BIND_SERVICE capability')
          return true
        }

        // Try to add the capability (requires sudo)
        logger.info('Attempting to add CAP_NET_BIND_SERVICE to node...')
        await execAsync('sudo setcap cap_net_bind_service=+eip $(which node)')
        logger.info('Successfully added CAP_NET_BIND_SERVICE to node')
        return true
      } catch (error) {
        logger.warn('Failed to set CAP_NET_BIND_SERVICE', { error: error.message })
      }
    }

    // On macOS, try to use ports > 1024 and suggest port forwarding
    if (this.platform === 'darwin') {
      logger.info('On macOS, consider using port forwarding:')
      logger.info('  sudo ipfw add 100 fwd 127.0.0.1,8443 tcp from any to any 443 in')
      logger.info('  Or run with sudo for direct port 443 binding')
    }

    return false
  }

  /**
   * Get the command prefix needed for privileged port binding
   */
  getCommandPrefix() {
    if (this.isUsingAuthBind && this.platform === 'linux') {
      return 'authbind --deep'
    }

    // Otherwise, need sudo for Unix systems
    if ((this.platform === 'darwin' || this.platform === 'linux') && !process.getuid) {
      return 'sudo'
    }

    return ''
  }

  /**
   * Get alternative port if port 443 cannot be bound
   */
  getAlternativePort() {
    return 8443 // Common alternative HTTPS port
  }

  /**
   * Show instructions for enabling port 443 access
   */
  showInstructions() {
    console.log('\n📋 Port 443 Setup Instructions:')
    console.log('=====================================\n')

    if (this.platform === 'darwin') {
      console.log('macOS Options:')
      console.log('1. Run with sudo: sudo navisai up')
      console.log('2. Use port forwarding:')
      console.log('   sudo echo "rdr pass inet proto tcp from any to any port 443 -> 127.0.0.1 port 8443" | pfctl -ef -')
      console.log('3. Create a launchd service with proper privileges\n')
    } else if (this.platform === 'linux') {
      console.log('Linux Options:')
      console.log('1. Run with sudo: sudo navisai up')
      console.log('2. Use authbind (if installed):')
      console.log('   touch ~/.authbind/byport/443 && chmod 755 ~/.authbind/byport/443')
      console.log('3. Give node capability:')
      console.log('   sudo setcap cap_net_bind_service=+eip $(which node)\n')
    } else {
      console.log('Windows: No special privileges needed for port 443\n')
    }

    console.log('Alternatively, Navis will automatically use port 8443')
    console.log('and you can access it at: https://navis.local:8443\n')
  }
}

export default PrivilegedPortHandler
