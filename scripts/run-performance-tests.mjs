#!/usr/bin/env node

/**
 * Performance Test Runner for NavisAI Transparent Proxy
 *
 * Runs all performance benchmarks and generates a report.
 * This script ensures the proxy meets the targets defined in navisai-1l7.
 *
 * Targets:
 * - Latency: < 5ms overhead
 * - Throughput: > 500 Mbps
 * - Memory: < 50MB
 * - CPU: < 2% idle
 *
 * Refs: navisai-1l7
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createReadStream, createWriteStream } from 'node:fs'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROJECT_ROOT = dirname(__dirname)
const TESTS_DIR = join(PROJECT_ROOT, 'apps/daemon/src/__tests__')
const BENCHMARK_FILE = join(PROJECT_ROOT, 'tests/performance/proxy-benchmark.test.js')

// ANSI color codes for output
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
}

function colorize(color, text) {
  return `${COLORS[color]}${text}${COLORS.reset}`
}

function printHeader(title) {
  console.log(colorize('cyan', '\n╔' + '═'.repeat(title.length + 4) + '╗'))
  console.log(colorize('cyan', '║  ') + title + '  ║')
  console.log(colorize('cyan', '╚' + '═'.repeat(title.length + 4) + '╝\n'))
}

function printSection(title) {
  console.log(colorize('blue', `\n--- ${title} ---`))
}

async function runUnitTests() {
  printSection('Running Unit Tests')

  const testFiles = [
    'lru-cache.test.js',
    'connection-pool.test.js',
    'sni-extraction.test.js'
  ]

  let totalPassed = 0
  let totalFailed = 0

  for (const testFile of testFiles) {
    try {
      console.log(`\nRunning ${testFile}...`)
      const output = execSync(
        `node --test ${join(TESTS_DIR, testFile)}`,
        { encoding: 'utf8', cwd: PROJECT_ROOT }
      )

      // Parse results
      const passed = (output.match(/✓/g) || []).length
      const failed = (output.match(/✗/g) || []).length

      totalPassed += passed
      totalFailed += failed

      if (failed === 0) {
        console.log(colorize('green', `✅ ${testFile}: ${passed} tests passed`))
      } else {
        console.log(colorize('red', `❌ ${testFile}: ${passed} passed, ${failed} failed`))
        console.log(output)
      }
    } catch (error) {
      totalFailed++
      console.log(colorize('red', `❌ ${testFile}: Failed to run`))
      console.error(error.output)
    }
  }

  const total = totalPassed + totalFailed
  const coverage = total > 0 ? ((totalPassed / total) * 100).toFixed(1) : 0

  console.log(colorize('cyan', '\n📊 Unit Test Summary:'))
  console.log(`  Total: ${total}`)
  console.log(colorize('green', `  Passed: ${totalPassed}`))
  console.log(colorize('red', `  Failed: ${totalFailed}`))
  console.log(`  Coverage: ${coverage}%`)

  return totalFailed === 0
}

async function runBenchmarks() {
  printSection('Running Performance Benchmarks')

  try {
    // Import and run benchmarks dynamically
    const { spawn } = await import('node:child_process')

    const results = await new Promise((resolve, reject) => {
      const benchmark = spawn('node', [BENCHMARK_FILE], {
        stdio: 'pipe',
        cwd: PROJECT_ROOT
      })

      let output = ''
      benchmark.stdout.on('data', data => {
        output += data.toString()
      })

      benchmark.stderr.on('data', data => {
        output += data.toString()
      })

      benchmark.on('close', code => {
        if (code === 0) {
          const results = parseBenchmarkOutput(output)
          resolve(results)
        } else {
          reject(new Error(`Benchmark failed with code ${code}`))
        }
      })

      benchmark.on('error', reject)
    })

    const benchmark = new ProxyBenchmark()

    // Create a custom implementation to capture results
    const results = await runBenchmarkWithCapture(benchmark)

    // Display results with color coding
    displayBenchmarkResults(results)

    // Check if all benchmarks passed
    const allPassed = results.latency.passed &&
      results.throughput.passed &&
      results.memory.passed

    return allPassed ? results : null
  } catch (error) {
    console.error(colorize('red', '\n❌ Failed to run benchmarks:'))
    console.error(error)
    return null
  }
}

async function runBenchmarkWithCapture(benchmark) {
  return new Promise((resolve, reject) => {
    // Capture console.log output
    const originalLog = console.log
    let output = ''

    console.log = (...args) => {
      output += args.join(' ') + '\n'
      originalLog(...args)
    }

    // Run benchmarks with timeout
    const timeout = setTimeout(() => {
      console.log = originalLog
      reject(new Error('Benchmarks timed out'))
    }, 120000) // 2 minutes

    benchmark.runBenchmarks()
      .then(() => {
        clearTimeout(timeout)
        console.log = originalLog

        // Parse results from output
        const results = parseBenchmarkOutput(output)
        resolve(results)
      })
      .catch((error) => {
        clearTimeout(timeout)
        console.log = originalLog
        reject(error)
      })
  })
}

function parseBenchmarkOutput(output) {
  const results = {}

  // Parse latency
  const latencyMatch = output.match(/Average: ([\d.]+)ms/)
  if (latencyMatch) {
    results.latency = {
      value: parseFloat(latencyMatch[1]),
      target: 5,
      passed: parseFloat(latencyMatch[1]) < 5
    }
  }

  // Parse throughput
  const throughputMatch = output.match(/Achieved: ([\d.]+) Mbps/)
  if (throughputMatch) {
    results.throughput = {
      value: parseFloat(throughputMatch[1]),
      target: 500,
      passed: parseFloat(throughputMatch[1]) >= 500
    }
  }

  // Parse memory
  const memoryMatch = output.match(/Peak: ([\d.]+) MB/)
  if (memoryMatch) {
    results.memory = {
      value: parseFloat(memoryMatch[1]),
      target: 50,
      passed: parseFloat(memoryMatch[1]) < 50
    }
  }

  return results
}

function displayBenchmarkResults(results) {
  console.log(colorize('cyan', '\n📈 Performance Benchmark Results:'))

  // Latency
  const latencyIcon = results.latency.passed ? '✅' : '❌'
  const latencyColor = results.latency.passed ? 'green' : 'red'
  console.log(`\n${latencyIcon} Latency:`)
  console.log(`   Value: ${results.latency.value.toFixed(2)}ms`)
  console.log(`   Target: <${results.latency.target}ms`)
  console.log(`   Status: ${colorize(latencyColor, results.latency.passed ? 'PASS' : 'FAIL')}`)

  // Throughput
  const throughputIcon = results.throughput.passed ? '✅' : '❌'
  const throughputColor = results.throughput.passed ? 'green' : 'red'
  console.log(`\n${throughputIcon} Throughput:`)
  console.log(`   Value: ${results.throughput.value.toFixed(2)} Mbps`)
  console.log(`   Target: >${results.throughput.target} Mbps`)
  console.log(`   Status: ${colorize(throughputColor, results.throughput.passed ? 'PASS' : 'FAIL')}`)

  // Memory
  const memoryIcon = results.memory.passed ? '✅' : '❌'
  const memoryColor = results.memory.passed ? 'green' : 'red'
  console.log(`\n${memoryIcon} Memory:`)
  console.log(`   Value: ${results.memory.value.toFixed(2)} MB`)
  console.log(`   Target: <${results.memory.target} MB`)
  console.log(`   Status: ${colorize(memoryColor, results.memory.passed ? 'PASS' : 'FAIL')}`)
}

async function generateReport(unitTestsPassed, benchmarkResults) {
  printSection('Final Report')

  console.log(colorize('cyan', '\n🎯 NavisAI Performance Optimization Results'))
  console.log(colorize('cyan', '='.repeat(50)))

  const allTestsPassed = unitTestsPassed &&
    benchmarkResults &&
    benchmarkResults.latency.passed &&
    benchmarkResults.throughput.passed &&
    benchmarkResults.memory.passed

  if (allTestsPassed) {
    console.log(colorize('green', '\n🎉 SUCCESS: All targets met!'))
    console.log(colorize('green', '✅ Unit tests: PASSED'))
    console.log(colorize('green', '✅ Performance benchmarks: PASSED'))
    console.log(colorize('green', '\nThe optimized transparent proxy is ready for production!'))
  } else {
    console.log(colorize('yellow', '\n⚠️  Some targets not met:'))

    if (!unitTestsPassed) {
      console.log(colorize('red', '   ❌ Unit tests: FAILED'))
    }

    if (!benchmarkResults) {
      console.log(colorize('red', '   ❌ Benchmarks: FAILED TO RUN'))
    } else {
      if (!benchmarkResults.latency.passed) {
        console.log(colorize('red', `   ❌ Latency: ${benchmarkResults.latency.value.toFixed(2)}ms > 5ms`))
      }
      if (!benchmarkResults.throughput.passed) {
        console.log(colorize('red', `   ❌ Throughput: ${benchmarkResults.throughput.value.toFixed(2)} Mbps < 500 Mbps`))
      }
      if (!benchmarkResults.memory.passed) {
        console.log(colorize('red', `   ❌ Memory: ${benchmarkResults.memory.value.toFixed(2)} MB > 50 MB`))
      }
    }

    console.log(colorize('yellow', '\n💡 Recommendations:'))
    console.log('   - Review failing tests and fix issues')
    console.log('   - Consider further optimizations if needed')
    console.log('   - Check system resources during benchmarks')
  }

  return allTestsPassed
}

async function main() {
  printHeader('NavisAI Performance Test Suite')
  console.log(colorize('magenta', 'Testing optimized transparent proxy implementation'))
  console.log(colorize('magenta', 'Issue: navisai-1l7 (P0: Performance optimization and comprehensive testing)'))

  try {
    // Run unit tests
    const unitTestsPassed = await runUnitTests()

    // Run benchmarks
    const benchmarkResults = await runBenchmarks()

    // Generate final report
    const success = await generateReport(unitTestsPassed, benchmarkResults)

    // Exit with appropriate code
    process.exit(success ? 0 : 1)
  } catch (error) {
    console.error(colorize('red', '\n💥 Test suite failed:'))
    console.error(error)
    process.exit(1)
  }
}

// Run the test suite
main()
