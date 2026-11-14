// Native ANSI output diagnostic. Unlike inputPerf, this exercises a Writable
// sink and its backpressure. OUTPUT_REAL_TERMINAL=1 forwards bytes to the actual
// terminal; otherwise the sink can simulate a limited link. Neither mode can
// measure the terminal emulator's final pixel presentation.
import { Writable } from 'node:stream'
import { createCliRenderer, TextRenderable } from '@opentui/core'
import { resolveRenderPolicy } from './renderPolicy'
import { summarizeFrameTimes } from './performanceBudget'

const policyPlatform = process.env.OUTPUT_POLICY_PLATFORM ?? process.platform
const policy = resolveRenderPolicy(policyPlatform)

const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
const realTerminal = process.env.OUTPUT_REAL_TERMINAL === '1'
if (realTerminal && !process.stdout.isTTY) throw new Error('Real terminal mode needs a TTY')
const seconds = positive(process.env.OUTPUT_SECONDS, 3)
const bytesPerSecond = positive(process.env.OUTPUT_BYTES_PER_SECOND, Infinity)
const scenario = process.env.OUTPUT_SCENARIO ?? 'stream'
if (!['stream', 'scroll', 'resize'].includes(scenario)) throw new Error('OUTPUT_SCENARIO must be stream, scroll, or resize')
const fullRepaint = process.env.AGENT_VIEWER_FULL_REPAINT === '1'
let bytes = 0
let writes = 0
const sink = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length
    writes++
    if (realTerminal) process.stdout.write(chunk, callback)
    else if (Number.isFinite(bytesPerSecond)) setTimeout(callback, Math.ceil(chunk.length * 1000 / bytesPerSecond))
    else callback()
  },
})
const width = realTerminal ? process.stdout.columns : 140
const height = realTerminal ? process.stdout.rows : 44
const renderer = await createCliRenderer({
  stdout: sink as NodeJS.WriteStream,
  width, height, remote: true, screenMode: 'alternate-screen',
  exitOnCtrlC: true, exitSignals: [], useMouse: false, consoleMode: 'disabled',
  maxFps: policy.maxFps, gatherStats: true, maxStatSamples: 10_000,
})
if (fullRepaint) {
  const repaintable = renderer as unknown as { forceFullRepaintRequested?: boolean }
  if (typeof repaintable.forceFullRepaintRequested !== 'boolean') throw new Error('Full repaint unavailable')
  renderer.setFrameCallback(async () => { repaintable.forceFullRepaintRequested = true })
}
const content = new TextRenderable(renderer, { id: 'output-workload', width: '100%', height: '100%', wrapMode: 'none' })
renderer.root.add(content)
const lines = Array.from({ length: 2000 }, (_, index) => (
  `${index.toString().padStart(4)}  const card = transcript[${index}]; // preserve the selected session and scroll anchor`
))
let offset = 0
let text = ''
const draw = () => {
  content.content = scenario === 'stream'
    ? [...lines.slice(0, Math.max(0, height - 4)), `Streaming: ${text.slice(-Math.max(1, width - 15))}`].join('\n')
    : lines.slice(offset, offset + height - 1).join('\n')
}
draw()
await new Promise(resolve => setTimeout(resolve, 250))
renderer.resetStats()
bytes = 0
writes = 0
const started = performance.now()
let updates = 0
let streamTimer: ReturnType<typeof setTimeout> | undefined
const producer = setInterval(() => {
  updates++
  if (scenario === 'stream') {
    text += String.fromCharCode(97 + updates % 26)
    if (streamTimer === undefined) streamTimer = setTimeout(() => {
      streamTimer = undefined
      draw()
    }, policy.liveTextFlushMs)
  } else {
    offset = (offset + 3) % (lines.length - height)
    if (scenario === 'resize') renderer.resize(width - (updates % 2) * 10, height - (updates % 2) * 4)
    draw()
  }
}, scenario === 'resize' ? 16 : 2)
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
clearInterval(producer)
if (streamTimer !== undefined) clearTimeout(streamTimer)
draw()
// Let queued output settle; shutdown below also waits for native delivery.
await new Promise(resolve => setTimeout(resolve, 250))
const elapsedMs = performance.now() - started
const stats = renderer.getStats()
const delivered = { bytes, writes }
renderer.destroy()
await renderer.closed
console.log(JSON.stringify({
  evidence: realTerminal ? 'native ANSI delivery to terminal; emulator paint unmeasured' : 'native ANSI delivery to simulated sink',
  platform: process.platform, policyPlatform, scenario, width, height, seconds, bytesPerSecond: Number.isFinite(bytesPerSecond) ? bytesPerSecond : null,
  ...policy, fullRepaint, updates, elapsedMs, ...delivered,
  frameCount: stats.frameCount, frames: summarizeFrameTimes(stats.frameTimes, 1000 / policy.maxFps),
}))
