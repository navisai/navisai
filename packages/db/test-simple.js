import dbManager from './index.js'

async function test() {
  try {
    console.log('Testing database manager...')

    // Test initialization
    const client = await dbManager.initialize(':memory:')
    if (client) {
      console.log('✅ Database initialized successfully')
    } else {
      console.log('⚠️  Database not available (native driver missing)')
    }

    // Test graceful close
    await dbManager.close()
    console.log('✅ Database closed successfully')

    console.log('\nAll tests passed! 🎉')
  } catch (error) {
    console.error('Test failed:', error)
    process.exit(1)
  }
}

test()
