#!/usr/bin/env node

import { program } from 'commander'
import {
  upCommand,
  downCommand,
  statusCommand,
  doctorCommand,
  logsCommand,
} from './commands.js'

// CLI configuration
program
  .name('navisai')
  .description('Navis AI - Local-first AI control plane CLI')
  .version('0.1.0')

// Commands
program
  .command('up')
  .description('Start the Navis daemon')
  .action(upCommand)

program
  .command('down')
  .description('Stop the Navis daemon')
  .action(downCommand)

program
  .command('status')
  .description('Show daemon status')
  .action(statusCommand)

program
  .command('doctor')
  .description('Run system diagnostics')
  .action(doctorCommand)

program
  .command('logs')
  .description('Follow daemon logs')
  .action(logsCommand)

// Parse command line arguments
program.parse()
