/**
 * Navis AI Logging Utilities
 * Centralized logging for the Navis ecosystem
 */

class Logger {
  constructor(name = 'navis') {
    this.name = name
  }

  log(level, message, meta = {}) {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      name: this.name,
      message,
      ...meta
    }

    // Format for console output
    const prefix = `[${timestamp}] ${level.toUpperCase()} ${this.name}:`

    switch (level) {
      case 'error':
        console.error(prefix, message, meta)
        break
      case 'warn':
        console.warn(prefix, message, meta)
        break
      case 'info':
        console.info(prefix, message, meta)
        break
      case 'debug':
        console.debug(prefix, message, meta)
        break
      default:
        console.log(prefix, message, meta)
    }

    return logEntry
  }

  error(message, meta) {
    return this.log('error', message, meta)
  }

  warn(message, meta) {
    return this.log('warn', message, meta)
  }

  info(message, meta) {
    return this.log('info', message, meta)
  }

  debug(message, meta) {
    return this.log('debug', message, meta)
  }

  child(name) {
    return new Logger(`${this.name}:${name}`)
  }
}

// Create default logger instance
export const logger = new Logger()

// Export the Logger class for creating custom loggers
export { Logger }

// Export a simple function for quick logging
export function log(level, message, meta) {
  return logger.log(level, message, meta)
}
