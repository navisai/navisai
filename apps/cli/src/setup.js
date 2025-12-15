import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function setupCommand() {
  try {
    console.log('🧭 NavisAI Setup')
    console.log('================\n')

    console.log('This script will configure your system for seamless navis.local access.')
    console.log('It will:\n')
    console.log('  1. Add navis.local to your hosts file')
    console.log('  2. Configure system resolver (macOS)')
    console.log('  3. Set up authbind for port 443 (Linux, optional)\n')

    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'setup-navis.sh')

    try {
      // Make script executable
      await execAsync(`chmod +x "${scriptPath}"`)

      console.log('Running setup script with sudo...\n')

      // Run the setup script with sudo
      const { stdout, stderr } = await execAsync(`sudo "${scriptPath}"`)

      if (stdout) console.log(stdout)
      if (stderr) console.error(stderr)

    } catch (error) {
      console.error('\n❌ Setup failed:', error.message)
      process.exit(1)
    }

  } catch (error) {
    console.error('Setup command failed:', error.message)
    process.exit(1)
  }
}
