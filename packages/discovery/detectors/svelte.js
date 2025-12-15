/**
 * Svelte Project Detector
 * Detects Svelte projects by looking for svelte.config.js, vite.config.js with Svelte plugin, etc.
 */

import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export class SvelteDetector {
  constructor() {
    this.name = 'svelte'
    this.confidence = 0.9
    this.indicators = [
      { file: 'svelte.config.js', weight: 1.0 },
      { file: 'svelte.config.ts', weight: 1.0 },
      { file: 'src/app.html', weight: 0.8 }, // SvelteKit default
      { file: 'src/routes/+layout.svelte', weight: 0.8 }, // SvelteKit
      { file: 'src/routes/+page.svelte', weight: 0.8 }, // SvelteKit
      { file: 'vite.config.js', weight: 0.4 },
      { file: 'vite.config.ts', weight: 0.4 },
      { file: '.svelte-kit', weight: 0.3, isDirectory: true }
    ]
  }

  async detect(projectPath) {
    try {
      let score = 0
      let maxScore = 0
      const signals = []
      const metadata = { framework: 'svelte' }

      // Check for Svelte files
      const hasSvelteFiles = await this._hasSvelteFiles(projectPath)
      if (hasSvelteFiles) {
        signals.push('has Svelte files')
        score += 0.2
      }

      // Check indicators
      for (const indicator of this.indicators) {
        maxScore += indicator.weight

        try {
          const indicatorPath = join(projectPath, indicator.file)
          await access(indicatorPath)
          score += indicator.weight
          signals.push(`has ${indicator.file}`)

          // Extract metadata from config files
          if (indicator.file.includes('svelte.config')) {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              if (content.includes('@sveltejs/kit')) {
                metadata.isSvelteKit = true
                signals.push('SvelteKit project')
              }
              if (content.includes('adapter-')) {
                const adapterMatch = content.match(/adapter-([a-zA-Z-]+)/)
                if (adapterMatch) {
                  metadata.adapter = adapterMatch[1]
                  signals.push(`adapter: ${adapterMatch[1]}`)
                }
              }
            } catch {
              // Couldn't read, skip
            }
          } else if (indicator.file.includes('vite.config')) {
            try {
              const content = await readFile(indicatorPath, 'utf8')
              if (content.includes('@sveltejs/kit/vite')) {
                metadata.usesSvelteKitVitePlugin = true
              }
            } catch {
              // Couldn't read, skip
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }

      // Check package.json for Svelte dependencies
      try {
        const packageJsonPath = join(projectPath, 'package.json')
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        const svelteDeps = Object.keys(deps).filter(dep =>
          dep.startsWith('svelte') || dep === '@sveltejs/kit'
        )

        if (svelteDeps.length > 0) {
          score += 0.6
          signals.push(`Svelte deps: ${svelteDeps.join(', ')}`)
          metadata.dependencies = svelteDeps
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

  async _hasSvelteFiles(projectPath) {
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(projectPath, { withFileTypes: true, recursive: true })

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.svelte')) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }
}
