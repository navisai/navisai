/**
 * NavisAI Logging Utility
 * Provides structured logging with configurable levels and outputs
 */

import pino from 'pino'
import pretty from 'pino-pretty'

// Create pretty logger for development
const prettyLogger = pino(
  pretty({
    colorize: true,
    translateTime: 'HH:MM:ss Z',
    ignore: 'pid,hostname',
    messageFormat: '{service} | {msg}',
    customPrettifiers: {
      level: (label) => {
        const level = label.toUpperCase()
        const colors = {
          TRACE: '\x1b[90m', // Gray
          DEBUG: '\x1b[36m', // Cyan
          INFO: '\x1b[32m',  // Green
          WARN: '\x1b[33m',  // Yellow
          ERROR: '\x1b[31m', // Red
          FATAL: '\x1b[41m\x1b[37m', // Red background
        }
        const reset = '\x1b[0m'
        return `${colors[level] || ''}${level}${reset}`
      }
    }
  })
)

// Map string levels to pino levels
const LEVELS = {
  trace: pino.levelValues.trace,
  debug: pino.levelValues.debug,
  info: pino.levelValues.info,
  warn: pino.levelValues.warn,
  error: pino.levelValues.error,
  fatal: pino.levelValues.fatal,
  silent: pino.levelValues.silent
}

/**
 * Get a logger instance for a specific service
 */
export function getLogger(service = 'navisai', level = process.env.NAVIS_LOG_LEVEL || 'info') {
  return {
    trace: (msg, ...args) => prettyLogger.trace({ service }, msg, ...args),
    debug: (msg, ...args) => prettyLogger.debug({ service }, msg, ...args),
    info: (msg, ...args) => prettyLogger.info({ service }, msg, ...args),
    warn: (msg, ...args) => prettyLogger.warn({ service }, msg, ...args),
    error: (msg, ...args) => prettyLogger.error({ service }, msg, ...args),
    fatal: (msg, ...args) => prettyLogger.fatal({ service }, msg, ...args),

    // Extended logging methods
    child: (bindings) => ({
      trace: (msg, ...args) => prettyLogger.trace({ service, ...bindings }, msg, ...args),
      debug: (msg, ...args) => prettyLogger.debug({ service, ...bindings }, msg, ...args),
      info: (msg, ...args) => prettyLogger.info({ service, ...bindings }, msg, ...args),
      warn: (msg, ...args) => prettyLogger.warn({ service, ...bindings }, msg, ...args),
      error: (msg, ...args) => prettyLogger.error({ service, ...bindings }, msg, ...args),
      fatal: (msg, ...args) => prettyLogger.fatal({ service, ...bindings }, msg, ...args),
    })
  }
}

/**
 * Create a logger for a specific module
 */
export function createLogger(module, options = {}) {
  const service = `${options.service || 'navisai'}:${module}`
  return getLogger(service, options.level)
}

/**
 * Default logger instance
 */
export const logger = getLogger()

/**
 * Set global log level
 */
export function setLevel(level) {
  if (typeof level === 'string' && LEVELS.hasOwnProperty(level.toLowerCase())) {
    prettyLogger.level = LEVELS[level.toLowerCase()]
  }
}

/**
 * Get current log level
 */
export function getLevel() {
  return Object.keys(LEVELS).find(key => LEVELS[key] === prettyLogger.level) || 'unknown'
}

/**
 * Create a silent logger (for testing)
 */
export function getSilentLogger() {
  const silent = pino({ level: 'silent' })
  return {
    trace: () => { },
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    fatal: () => { },
    child: () => ({
      trace: () => { },
      debug: () => { },
      info: () => { },
      warn: () => { },
      error: () => { },
      fatal: () => { }
    })
  }
}
