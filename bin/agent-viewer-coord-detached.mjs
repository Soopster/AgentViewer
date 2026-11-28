import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entrypoint = fileURLToPath(new URL('./agent-viewer-coord-background.mjs', import.meta.url))

// Wait for durable registration, not merely a successful OS spawn. No pipes
// remain attached to the invoking terminal after the acknowledgement.
export function launchDetachedWorker(args, { cwd = process.cwd(), env = process.env, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd, env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.connected) child.disconnect()
      child.unref()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error(
      `Worker startup is unconfirmed (pid ${child.pid}). It may still be starting; inspect coord workers before retrying.`,
    )), timeoutMs)
    child.on('error', (error) => finish(error))
    child.on('exit', (code, signal) => finish(new Error(
      `Worker exited before registration (${signal || `exit ${code}`}).`,
    )))
    child.on('message', (message) => {
      if (message?.type === 'coordinator-worker-ready' && message.pid === child.pid) finish(null, message)
      else if (message?.type === 'coordinator-worker-startup-error') finish(new Error(message.error))
    })
  })
}
