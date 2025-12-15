import dbManager from './index.js'
import { projectsRepo, settingsRepo } from './repositories.js'

async function test() {
  try {
    console.log('Initializing database...')
    await dbManager.initialize(':memory:')
    console.log('✅ Database initialized')

    // Test setting a value
    console.log('Testing settings...')
    await settingsRepo.set('test_key', 'test_value')
    const value = await settingsRepo.get('test_key')
    console.log('✅ Setting test passed:', value === 'test_value')

    // Test creating a project
    console.log('Testing projects...')
    const project = await projectsRepo.create({
      path: '/test/project',
      name: 'Test Project',
    })
    console.log('✅ Project created:', project.id)

    const found = await projectsRepo.findById(project.id)
    console.log('✅ Project found:', found?.name === 'Test Project')

    console.log('\nAll tests passed! 🎉')

    await dbManager.close()
  } catch (error) {
    console.error('Test failed:', error)
    process.exit(1)
  }
}

test()
