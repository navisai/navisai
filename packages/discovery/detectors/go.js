/**
 * Go Project Detector
 * Detects Go projects by looking for go.mod, go.sum, main.go, etc.
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class GoDetector {
  constructor() {
    this.name = 'go'
    this.confidence = 0.9
    this.indicators = [
      { file: 'go.mod', weight: 1.0 },
      { file: 'go.sum', weight: 0.6 },
      { file: 'main.go', weight: 0.8 },
      { file: 'Gopkg.toml', weight: 0.6 },
      { file: 'Gopkg.lock', weight: 0.4 },
      { file: '.go-version', weight: 0.3 }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'go' }

      // Check for Go files
      const hasGoFiles = await this._hasGoFiles(projectPath)
      if (hasGoFiles) {
        signals.push('has Go files')
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

          // Extract metadata from go.mod
          if (indicator.file === 'go.mod') {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              const modLine = content.split('\n').find(line => line.startsWith('module '))
              if (modLine) {
                metadata.module = modLine.replace('module ', '').trim()
                signals.push(`module: ${metadata.module}`)
              }

              const goVersionLine = content.split('\n').find(line => line.startsWith('go '))
              if (goVersionLine) {
                metadata.goVersion = goVersionLine.replace('go ', '').trim()
                signals.push(`Go version: ${metadata.goVersion}`)
              }
            } catch {
              // Couldn't parse, skip
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

  async _hasGoFiles(projectPath) {
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(projectPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.go')) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }
}
