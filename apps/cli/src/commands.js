import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { discoveryService } from '../../../packages/discovery/service.js'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function upCommand() {
  try {
    console.log('Starting Navis daemon...')

    // Check if daemon is already running
    const daemonProcess = await findDaemonProcess()
    if (daemonProcess) {
      console.log('Navis daemon is already running (PID:', daemonProcess.pid, ')')
      return
    }

    // Start daemon in background
    const daemonPath = path.join(__dirname, '..', 'daemon', 'src', 'index.js')
    const { stdout, stderr } = await execAsync(`node ${daemonPath}`, {
      detached: true,
      stdio: 'ignore',
    })

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Verify it started successfully
    const startedProcess = await findDaemonProcess()
    if (startedProcess) {
      console.log('✅ Navis daemon started successfully')
      console.log('🌐 Access at: http://127.0.0.1:3415')
    } else {
      console.log('❌ Failed to start daemon')
      if (stderr) console.error(stderr)
    }
  } catch (error) {
    console.error('Failed to start daemon:', error.message)
    process.exit(1)
  }
}

export async function downCommand() {
  try {
    console.log('Stopping Navis daemon...')

    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('Navis daemon is not running')
      return
    }

    // Graceful shutdown
    process.kill(daemonProcess.pid, 'SIGTERM')

    // Give it a moment to shut down
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Check if it's still running
    const stillRunning = await findDaemonProcess()
    if (stillRunning) {
      console.log('Force killing daemon...')
      process.kill(daemonProcess.pid, 'SIGKILL')
    }

    console.log('✅ Navis daemon stopped')
  } catch (error) {
    console.error('Failed to stop daemon:', error.message)
    process.exit(1)
  }
}

export async function statusCommand() {
  try {
    const daemonProcess = await findDaemonProcess()

    if (daemonProcess) {
      console.log('✅ Navis daemon is running')
      console.log('   PID:', daemonProcess.pid)
      console.log('   Command:', daemonProcess.cmd)

      // Try to get status from API
      try {
        const response = await fetch('http://127.0.0.1:3415/status')
        if (response.ok) {
          const status = await response.json()
          console.log('\nDaemon Status:')
          console.log('  Version:', status.version)
          console.log('  Database:', status.database ? '✅ Connected' : '❌ Disconnected')
          console.log('  Uptime:', new Date(status.timestamp).toLocaleString())
        }
      } catch {
        console.log('\n⚠️  Daemon appears to be running but API is not responding')
      }
    } else {
      console.log('❌ Navis daemon is not running')
      process.exit(1)
    }
  } catch (error) {
    console.error('Failed to check daemon status:', error.message)
    process.exit(1)
  }
}

export async function doctorCommand() {
  console.log('Running Navis diagnostics...\n')

  let allGood = true

  // Check Node.js version
  const nodeVersion = process.version
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])
  if (majorVersion >= 18) {
    console.log('✅ Node.js version:', nodeVersion)
  } else {
    console.log('❌ Node.js version too old:', nodeVersion, '(requires 18+)')
    allGood = false
  }

  // Check if daemon can be found
  const daemonPath = path.join(__dirname, '..', '..', 'apps', 'daemon', 'src', 'index.js')
  try {
    await fs.access(daemonPath)
    console.log('✅ Daemon binary found')
  } catch {
    console.log('❌ Daemon binary not found at:', daemonPath)
    allGood = false
  }

  // Check database availability
  try {
    // Import from relative path since we're in monorepo
    const dbManager = await import('../../../packages/db/index.js')
    await dbManager.default.initialize(':memory:')
    if (dbManager.default.isAvailable()) {
      console.log('✅ Database accessible')
    } else {
      console.log('⚠️  Database native driver not available (will run without persistence)')
    }
    await dbManager.default.close()
  } catch (error) {
    console.log('❌ Database initialization failed:', error.message)
    allGood = false
  }

  // Check if port is available
  const port = 3415
  try {
    const net = await import('node:net')
    const server = net.default.createServer()
    server.listen(port, '127.0.0.1', () => {
      server.close()
      console.log('✅ Port', port, 'is available')
    })
    server.on('error', () => {
      console.log('⚠️  Port', port, 'is already in use (daemon may be running)')
    })
  } catch (error) {
    console.log('❌ Port check failed:', error.message)
    allGood = false
  }

  if (allGood) {
    console.log('\n🎉 All systems ready!')
  } else {
    console.log('\n⚠️  Some issues found. See above for details.')
    process.exit(1)
  }
}

export async function logsCommand() {
  try {
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('Daemon is not running')
      return
    }

    console.log('Following daemon logs (Ctrl+C to stop)...\n')

    // In a real implementation, this would connect to daemon's log stream
    // For now, just show that daemon is running
    console.log('Daemon is running with PID:', daemonProcess.pid)
    console.log('Note: Log streaming not yet implemented')
  } catch (error) {
    console.error('Failed to fetch logs:', error.message)
  }
}

export async function scanCommand(path, options = {}) {
  try {
    console.log('🔍 Scanning for projects...')

    const scanPath = path || homedir()
    console.log('Scanning path:', scanPath)

    // First check if daemon is running
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('❌ Navis daemon is not running. Please run `navisai up` first.')
      process.exit(1)
    }

    // Call daemon API to scan
    const response = await fetch('http://127.0.0.1:3415/api/discovery/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: scanPath,
        options: {
          depth: options.depth || 3,
          concurrency: options.concurrency || 5,
          ...options
        }
      })
    })

    if (!response.ok) {
      const error = await response.json()
      console.log('❌ Scan failed:', error.error || 'Unknown error')
      if (error.details) console.log('Details:', error.details)
      process.exit(1)
    }

    const result = await response.json()

    console.log(`\n✅ Scan completed! Found ${result.count} projects in "${result.scannedPath}"\n`)

    // Display discovered projects
    if (result.projects && result.projects.length > 0) {
      console.log('Discovered Projects:')
      console.log('===================\n')

      result.projects.forEach((project, index) => {
        console.log(`${index + 1}. ${project.name}`)
        console.log(`   Path: ${project.path}`)
        console.log(`   Type: ${project.classification?.primary?.name || 'Unknown'}`)
        if (project.detection?.primary?.framework) {
          console.log(`   Framework: ${project.detection.primary.framework}`)
        }
        if (project.classification?.language) {
          console.log(`   Language: ${project.classification.language}`)
        }
        console.log(`   Confidence: ${(project.detection.confidence * 100).toFixed(1)}%`)
        console.log(`   Detected: ${new Date(project.detectedAt).toLocaleString()}`)
        console.log('')
      })
    } else {
      console.log('No projects found. Try scanning a different directory.')
    }

    return result
  } catch (error) {
    console.error('❌ Scan failed:', error.message)
    process.exit(1)
  }
}

export async function indexCommand(paths, options = {}) {
  try {
    if (!paths || paths.length === 0) {
      console.log('❌ No paths provided')
      console.log('Usage: navisai index <path1> <path2> ...')
      process.exit(1)
    }

    console.log(`📁 Indexing ${paths.length} path(s)...`)

    // Check if daemon is running
    const daemonProcess = await findDaemonProcess()
    if (!daemonProcess) {
      console.log('❌ Navis daemon is not running. Please run `navisai up` first.')
      process.exit(1)
    }

    // Call daemon API to index
    const response = await fetch('http://127.0.0.1:3415/api/discovery/index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paths })
    })

    if (!response.ok) {
      const error = await response.json()
      console.log('❌ Index failed:', error.error || 'Unknown error')
      if (error.details) console.log('Details:', error.details)
      process.exit(1)
    }

    const result = await response.json()

    console.log(`\n✅ Index completed! ${result.discovered}/${result.total} paths contained projects\n`)

    // Display results
    result.results.forEach((item, index) => {
      if (item.success && item.project.detected) {
        const p = item.project
        console.log(`✅ ${item.path}`)
        console.log(`   Name: ${p.name}`)
        console.log(`   Type: ${p.classification?.primary?.name || 'Unknown'}\n`)
      } else {
        console.log(`❌ ${item.path}`)
        if (item.error) console.log(`   Error: ${item.error}\n`)
      }
    })

    return result
  } catch (error) {
    console.error('❌ Index failed:', error.message)
    process.exit(1)
  }
}

// Helper function to find daemon process
async function findDaemonProcess() {
  try {
    const platform = process.platform
    let cmd

    if (platform === 'darwin' || platform === 'linux') {
      cmd = 'ps ax | grep "[n]ode.*index.js" | grep -v grep'
    } else if (platform === 'win32') {
      cmd = 'tasklist /fi "imagename eq node.exe" /fo csv | findstr index.js'
    } else {
      console.log('Unsupported platform for process detection')
      return null
    }

    const { stdout } = await execAsync(cmd)
    if (stdout.trim()) {
      const lines = stdout.trim().split('\n')
      const firstLine = lines[0]

      if (platform === 'darwin' || platform === 'linux') {
        const parts = firstLine.trim().split(/\s+/)
        return {
          pid: parseInt(parts[0]),
          cmd: parts.slice(4).join(' '),
        }
      } else {
        // Windows parsing would be different
        return null
      }
    }

    return null
  } catch (error) {
    return null
  }
}
