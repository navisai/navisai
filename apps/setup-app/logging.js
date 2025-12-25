import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { getLogger } from '@navisai/logging'

const component = 'setup-app'
const logger = getLogger(component)
const logDir = path.join(homedir(), '.navis', 'logs')
const logPath = path.join(logDir, 'setup-app.log')

async function writeLog(entry) {
  await mkdir(logDir, { recursive: true })
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
}

export function getLogPath() {
  return logPath
}

export async function logEvent(level, message, meta = {}) {
  const timestamp = new Date().toISOString()
  const entry = {
    timestamp,
    level: level.toUpperCase(),
    name: component,
    message,
    ...meta
  }

  logger.log(level, message, meta)

  try {
    await writeLog(entry)
  } catch (error) {
    logger.warn('Failed to write setup app log', { error: error.message })
  }

  return entry
}
