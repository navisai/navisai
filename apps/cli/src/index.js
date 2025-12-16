#!/usr/bin/env node

import { program } from 'commander'
import {
  setupCommand,
  upCommand,
  downCommand,
  statusCommand,
  doctorCommand,
  logsCommand,
  scanCommand,
  indexCommand,
  pairCommand,
  resetCommand,
  cleanupCommand,
} from './commands.js'

// CLI configuration
program
  .name('navisai')
  .description('Navis AI - Local-first AI control plane CLI')
  .version('0.1.0')

// Commands
program
  .command('setup')
  .description('One-time setup for clean https://navis.local LAN access')
  .action(setupCommand)

program
  .command('up')
  .description('Start the Navis daemon')
  .option('-p, --port <number>', 'Port to run the daemon on (default: 47621)')
  .option('--no-open', 'Do not open the onboarding URL in the browser')
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

program
  .command('scan [path]')
  .description('Scan a directory for projects')
  .option('-d, --depth <number>', 'Scan depth', '3')
  .option('-c, --concurrency <number>', 'Concurrent scans', '5')
  .action(scanCommand)

program
  .command('index <paths...>')
  .description('Index specific paths for projects')
  .action(indexCommand)

program
  .command('pair')
  .description('Initiate device pairing for Navis')
  .option('-r, --re-pair', 'Force re-pairing of all devices')
  .action(pairCommand)

program
  .command('reset')
  .description('Reset local Navis setup (bridge/mDNS/certs)')
  .action(resetCommand)

program
  .command('cleanup')
  .description('Factory reset for repeatable onboarding tests (confirm-gated)')
  .option('--bridge-only', 'Remove bridge (+ optional certs); keep local state')
  .option('--all', 'Remove bridge + delete ~/.navis local state (destructive)')
  .action(cleanupCommand)

// Parse command line arguments
program.parse()
