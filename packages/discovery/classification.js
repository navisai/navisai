/**
 * Project Classification System
 * Categorizes projects based on detected signals and metadata
 */

export class ClassificationEngine {
  constructor() {
    this.categories = {
      'web-app': {
        name: 'Web Application',
        description: 'Frontend web applications and SPAs',
        keywords: ['react', 'vue', 'angular', 'svelte', 'frontend', 'spa'],
        frameworks: ['svelte', 'react', 'vue', 'angular'],
        minConfidence: 0.6
      },
      'backend-api': {
        name: 'Backend API',
        description: 'Server-side APIs and microservices',
        keywords: ['api', 'server', 'backend', 'express', 'fastapi', 'django'],
        languages: ['nodejs', 'python', 'go', 'rust'],
        excludePatterns: ['react', 'vue', 'angular', 'svelte'],
        minConfidence: 0.6
      },
      'full-stack': {
        name: 'Full Stack Application',
        description: 'Applications with both frontend and backend',
        keywords: ['fullstack', 'full-stack', 'monolith'],
        requiresMultiple: true,
        minConfidence: 0.5
      },
      'mobile-app': {
        name: 'Mobile Application',
        description: 'Native mobile applications',
        keywords: ['mobile', 'ios', 'android', 'react-native', 'flutter'],
        frameworks: ['react-native', 'flutter', 'cordova', 'capacitor'],
        minConfidence: 0.7
      },
      'desktop-app': {
        name: 'Desktop Application',
        description: 'Native desktop applications',
        keywords: ['desktop', 'electron', 'tauri', 'wails'],
        frameworks: ['electron', 'tauri', 'wails'],
        minConfidence: 0.7
      },
      'cli-tool': {
        name: 'CLI Tool',
        description: 'Command-line interface tools',
        keywords: ['cli', 'command', 'tool'],
        signals: ['has bin field', 'has cli script'],
        minConfidence: 0.6
      },
      'library': {
        name: 'Library/Package',
        description: 'Reusable libraries and packages',
        keywords: ['lib', 'library', 'package', 'module'],
        signals: ['has main field', 'has exports field'],
        excludeSignals: ['has dev script', 'has start script'],
        minConfidence: 0.6
      },
      'data-science': {
        name: 'Data Science Project',
        description: 'Machine learning and data analysis projects',
        keywords: ['ml', 'ai', 'data', 'science', 'jupyter'],
        languages: ['python'],
        signals: ['has jupyter', 'has pandas', 'has numpy'],
        minConfidence: 0.6
      },
      'devops': {
        name: 'DevOps/Infrastructure',
        description: 'Infrastructure and deployment automation',
        keywords: ['docker', 'kubernetes', 'terraform', 'ansible'],
        signals: ['has dockerfile', 'has k8s', 'has terraform'],
        minConfidence: 0.7
      },
      'documentation': {
        name: 'Documentation Site',
        description: 'Documentation and wiki sites',
        keywords: ['docs', 'documentation', 'wiki'],
        frameworks: ['vuepress', 'gitbook', 'docusaurus'],
        minConfidence: 0.7
      }
    }
  }

  /**
   * Classify a project based on detection results
   */
  classify(detectionResults, signals = []) {
    const classifications = []
    const detectedFrameworks = detectionResults.all.map(r => r.detector)
    const primaryLanguage = this._getPrimaryLanguage(detectionResults)

    // Check each category
    for (const [categoryId, category] of Object.entries(this.categories)) {
      const score = this._calculateCategoryScore(
        category,
        detectionResults,
        signals,
        detectedFrameworks,
        primaryLanguage
      )

      if (score >= category.minConfidence) {
        classifications.push({
          id: categoryId,
          name: category.name,
          description: category.description,
          confidence: score,
          reasons: this._getReasons(category, detectionResults, signals)
        })
      }
    }

    // Sort by confidence
    classifications.sort((a, b) => b.confidence - a.confidence)

    return {
      primary: classifications[0] || null,
      all: classifications,
      language: primaryLanguage,
      frameworks: detectedFrameworks
    }
  }

  /**
   * Calculate score for a specific category
   */
  _calculateCategoryScore(category, detectionResults, signals, detectedFrameworks, primaryLanguage) {
    let score = 0
    let maxScore = 0

    // Check frameworks
    if (category.frameworks) {
      maxScore += 1.0
      const frameworkMatch = detectedFrameworks.some(f => category.frameworks.includes(f))
      if (frameworkMatch) {
        score += 1.0
      }
    }

    // Check languages
    if (category.languages) {
      maxScore += 1.0
      if (category.languages.includes(primaryLanguage)) {
        score += 1.0
      }
    }

    // Check keywords in signals
    if (category.keywords) {
      maxScore += 0.5
      const signalText = signals.join(' ').toLowerCase()
      const keywordMatches = category.keywords.filter(keyword =>
        signalText.includes(keyword)
      )
      if (keywordMatches.length > 0) {
        score += Math.min(keywordMatches.length / category.keywords.length, 1.0) * 0.5
      }
    }

    // Check specific signals
    if (category.signals) {
      maxScore += 0.5
      const matchingSignals = category.signals.filter(signal =>
        signals.some(s => s.toLowerCase().includes(signal))
      )
      if (matchingSignals.length > 0) {
        score += Math.min(matchingSignals.length / category.signals.length, 1.0) * 0.5
      }
    }

    // Check exclusion patterns
    if (category.excludePatterns) {
      const signalText = signals.join(' ').toLowerCase()
      const hasExclusion = category.excludePatterns.some(pattern =>
        signalText.includes(pattern)
      )
      if (hasExclusion) {
        score *= 0.3 // Reduce score significantly
      }
    }

    // Check for multiple frameworks (full-stack)
    if (category.requiresMultiple) {
      maxScore += 1.0
      if (detectedFrameworks.length >= 2) {
        score += 1.0
      }
    }

    // Normalize score
    return maxScore > 0 ? Math.min(score / maxScore, 1.0) : 0
  }

  /**
   * Get primary language from detection results
   */
  _getPrimaryLanguage(detectionResults) {
    if (detectionResults.primary) {
      // Map detector names to languages
      const languageMap = {
        'nodejs': 'javascript',
        'python': 'python',
        'go': 'go',
        'rust': 'rust'
      }
      return languageMap[detectionResults.primary.detector] || 'unknown'
    }
    return 'unknown'
  }

  /**
   * Get reasons for classification
   */
  _getReasons(category, detectionResults, signals) {
    const reasons = []

    // Framework matches
    if (category.frameworks) {
      const matches = detectionResults.all
        .filter(r => category.frameworks.includes(r.detector))
        .map(r => r.detector)
      if (matches.length > 0) {
        reasons.push(`Has ${matches.join(', ')} framework${matches.length > 1 ? 's' : ''}`)
      }
    }

    // Language matches
    if (category.languages && detectionResults.primary) {
      const detectorLang = {
        'nodejs': 'javascript',
        'python': 'python',
        'go': 'go',
        'rust': 'rust'
      }[detectionResults.primary.detector]

      if (detectorLang && category.languages.includes(detectorLang)) {
        reasons.push(`Written in ${detectorLang}`)
      }
    }

    // Signal matches
    const matchingSignals = signals.filter(s => {
      const lower = s.toLowerCase()
      return category.keywords?.some(kw => lower.includes(kw)) ||
        category.signals?.some(sig => lower.includes(sig))
    })

    if (matchingSignals.length > 0) {
      reasons.push(`Has ${matchingSignals.length} matching signals`)
    }

    return reasons
  }
}

// Export singleton instance
export const classificationEngine = new ClassificationEngine()
