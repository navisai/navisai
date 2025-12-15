/**
 * Vue Project Detector
 * Detects Vue.js projects by looking for Vue dependencies and specific file patterns
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class VueDetector {
  constructor() {
    this.name = 'vue'
    this.confidence = 0.9
    this.indicators = [
      { file: 'src/App.vue', weight: 0.8 },
      { file: 'src/main.js', weight: 0.4 },
      { file: 'src/main.ts', weight: 0.4 },
      { file: 'vite.config.js', weight: 0.3 },
      { file: 'vite.config.ts', weight: 0.3 },
      { file: 'vue.config.js', weight: 0.6 }, // Vue CLI
      { file: 'index.html', weight: 0.3 } // Vite default
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'vue' }

      // Check for Vue files
      const hasVueFiles = await this._hasVueFiles(projectPath)
      if (hasVueFiles) {
        signals.push('has Vue files')
        score += 0.2
      }

      // Check file indicators
      for (const indicator of this.indicators) {
        maxScore += indicator.weight

        try {
          const indicatorPath = join(projectPath, indicator.file)
          await access(indicatorPath)
          score += indicator.weight
          signals.push(`has ${indicator.file}`)
        } catch {
          // File doesn't exist, skip
        }
      }

      // Check package.json for Vue dependencies
      try {
        const packageJsonPath = join(projectPath, 'package.json')
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        const vueDeps = Object.keys(deps).filter(dep =>
          dep.startsWith('vue') ||
          dep.startsWith('@vue') ||
          dep === 'nuxt' || // Nuxt.js
          dep.startsWith('nuxt')
        )

        if (vueDeps.length > 0) {
          score += 1.0
          signals.push(`Vue deps: ${vueDeps.join(', ')}`)
          metadata.dependencies = vueDeps

          // Detect specific frameworks
          if (deps['nuxt'] || deps['@nuxt']) {
            metadata.isNuxt = true
            signals.push('Nuxt.js detected')
            score += 0.5
          }
          if (deps['vuepress']) {
            metadata.isVuePress = true
            signals.push('VuePress detected')
          }
        }
      } catch {
        // No package.json or invalid JSON
      }

      maxScore = Math.max(maxScore, 1.0) // Ensure we have a denominator
      const confidence = Math.min(score / maxScore, 1.0)

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

  async _hasVueFiles(projectPath) {
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(projectPath, { withFileTypes: true, recursive: true })

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.vue')) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }
}
