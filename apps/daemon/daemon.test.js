import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import test from 'node:test'
import discovery from '@navisai/discovery'
import { NavisDaemon } from './daemon.js'

test('scanHandler defaults a blank path to the daemon user home', async () => {
  const originalScan = discovery.scan
  let observedPath
  let observedOptions

  discovery.scan = async (path, options) => {
    observedPath = path
    observedOptions = options
    return []
  }

  try {
    const daemon = {
      config: {
        get(key) {
          assert.equal(key, 'discovery.scanDepth')
          return 4
        },
      },
    }

    const result = await NavisDaemon.prototype.scanHandler.call(
      daemon,
      { body: { path: '', options: { depth: 2 } } },
      { code() {} },
    )

    assert.equal(observedPath, homedir())
    assert.equal(observedOptions.maxDepth, 2)
    assert.equal(result.scannedPath, homedir())
    assert.equal(result.count, 0)
  } finally {
    discovery.scan = originalScan
  }
})
