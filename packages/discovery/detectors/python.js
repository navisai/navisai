/**
 * Python Project Detector
 * Detects Python projects by looking for setup.py, pyproject.toml, requirements.txt, etc.
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class PythonDetector {
  constructor() {
    this.name = 'python'
    this.confidence = 0.9
    this.indicators = [
      { file: 'pyproject.toml', weight: 1.0 },
      { file: 'setup.py', weight: 0.8 },
      { file: 'requirements.txt', weight: 0.6 },
      { file: 'Pipfile', weight: 0.6 },
      { file: 'setup.cfg', weight: 0.4 },
      { file: 'tox.ini', weight: 0.3 },
      { file: '.python-version', weight: 0.3 },
      { file: 'poetry.lock', weight: 0.4 },
      { file: 'pdm.lock', weight: 0.4 },
      { file: '__init__.py', weight: 0.2 }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'python' }

      // Check for Python files
      const hasPythonFiles = await this._hasPythonFiles(projectPath)
      if (hasPythonFiles) {
        signals.push('has Python files')
        score += 0.1
      }

      // Check indicators
      for (const indicator of this.indicators) {
        maxScore += indicator.weight

        try {
          const indicatorPath = join(projectPath, indicator.file)
          await access(indicatorPath)
          score += indicator.weight
          signals.push(`has ${indicator.file}`)

          // Extract metadata from key files
          if (indicator.file === 'pyproject.toml') {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              const parsed = this._parseToml(content)
              if (parsed.project?.name) metadata.name = parsed.project.name
              if (parsed.project?.version) metadata.version = parsed.project.version
              if (parsed.tool?.poetry) metadata.tool = 'poetry'
              if (parsed.tool?.pdm) metadata.tool = 'pdm'
              if (parsed.build_system?.requires) {
                metadata.buildSystem = parsed.build_system.requires[0]
              }
            } catch {
              // Invalid TOML, skip
            }
          } else if (indicator.file === 'setup.py') {
            metadata.usesSetupPy = true
          } else if (indicator.file === 'requirements.txt') {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'))
              metadata.requirementsCount = lines.length
              signals.push(`${lines.length} requirements`)
            } catch {
              // Couldn't read, skip
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      const confidence = Math.min(score / (maxScore || 1), 1.0)

      return {
        detected: confidence > 0.4,
        confidence,
        signals,
        metadata
      }
    } catch (error) {
      return { detected: false, confidence: 0, error: error.message }
    }
  }

  async _hasPythonFiles(projectPath) {
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(projectPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.py')) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  _parseToml(content) {
    // Simple TOML parser for basic structures
    // In a real implementation, you'd use a proper TOML library
    const result = {}
    const lines = content.split('\n')
    let currentSection = null

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1)
        result[currentSection] = {}
      } else if (currentSection && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=')
        const value = valueParts.join('=').trim()
        result[currentSection][key.trim()] = value.replace(/["']/g, '')
      }
    }

    return result
  }
}
