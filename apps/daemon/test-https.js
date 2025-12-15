#!/usr/bin/env node

console.log('Starting HTTPS daemon test...')

const daemon = import('./https-server.js').then(module => {
  console.log('Module imported successfully')
  const daemonInstance = module.default
  console.log('Starting daemon...')
  return daemonInstance.start()
}).then(() => {
  console.log('Daemon started successfully')
  setTimeout(() => {
    console.log('Stopping daemon...')
    process.exit(0)
  }, 5000)
}).catch(error => {
  console.error('Failed to start daemon:', error)
  console.error('Stack:', error.stack)
  process.exit(1)
})

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, exiting...')
  process.exit(0)
})
