#!/usr/bin/env node
// Cross-platform stand-in for `env -u NAME ... <command>`: strips the named
// variables from the environment and runs the rest of the argv.
//
//   node ./scripts/withoutEnv.mjs FOO BAR -- npm run something
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const separator = argv.indexOf('--')
if (separator === -1 || separator === argv.length - 1) {
  console.error('usage: withoutEnv.mjs VAR [VAR...] -- command [args...]')
  process.exit(2)
}

const env = { ...process.env }
for (const name of argv.slice(0, separator)) delete env[name]

const [command, ...args] = argv.slice(separator + 1)
const child = spawn(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
