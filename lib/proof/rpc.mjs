// A short-lived worker keeps hashing, Git and receipt IO off the TUI render thread.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as engine from './engine.mjs'
try {
  const [action, payload] = process.argv.slice(2), body = JSON.parse(payload ?? readFileSync(0, 'utf8'))
  let result
  if (action === 'read') result = await engine.read(body.cwd)
  else if (action === 'configure') result = await engine.configure(body.cwd, body.checks, body.version)
  else if (action === 'start') result = await engine.start(body.cwd, body.ids, body.version, body.origin, fileURLToPath(new URL('./worker.mjs', import.meta.url)))
  else if (action === 'cancel') result = await engine.cancel(body.cwd, body.id)
  else if (action === 'output') result = await engine.output(body.cwd, body.id, body.checkId)
  else throw new Error('Unknown Proof operation')
  process.stdout.write(JSON.stringify({ result: result ?? null }))
} catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1 }
