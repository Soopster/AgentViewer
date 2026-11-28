// @jsxImportSource @opentui/react
import { act as reactAct, useMemo, type ReactNode } from 'react'
import { SyntaxStyle } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { testRender as upstreamTestRender } from '@opentui/react/test-utils'

/**
 * OpenTUI 0.6 writes each frame to the terminal asynchronously, so a synchronous capture that lands
 * while one is in flight throws `OutputBusy`. The frame is not wrong, only not drained yet. Smokes
 * capture synchronously right after `flush()`, so `flush()` is what waits: it yields to the event
 * loop until the screen is quiet and a capture succeeds. Waiting here, rather than spinning inside
 * the capture, matters — blocking the thread also blocks the drain.
 */
const DRAIN_LIMIT_MS = 1000

// A 0.6 renderer keeps native handles alive, so a smoke that throws used to sit there until its
// timeout with the reason buried. Fail the process at once, with the message.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (error) => {
    console.error(error)
    process.exit(1)
  })
}

function isOutputBusy(error: unknown): boolean {
  return error instanceof Error && /OutputBusy/.test(`${error.name} ${error.message}`)
}

async function untilDrained(capture: () => unknown): Promise<void> {
  const deadline = performance.now() + DRAIN_LIMIT_MS
  for (;;) {
    try {
      capture()
      return
    } catch (error) {
      if (!isOutputBusy(error) || performance.now() >= deadline) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }
}

type TestSetup = Awaited<ReturnType<typeof upstreamTestRender>>
let latestSetup: TestSetup | null = null

async function settleScreen(setup: TestSetup): Promise<void> {
  await setup.renderOnce().catch(() => {})
  await untilDrained(setup.captureCharFrame)
}

/**
 * React's `act`, for a renderer that paints a frame after it commits. A smoke reads the screen right
 * after `await act(...)`, which under 0.5 was already painted; under 0.6 it is the frame before the
 * commit unless the renderer is let to settle. Only an async act waits — a synchronous one has
 * nothing to await, and its caller follows it with a flush.
 */
export const act: typeof reactAct = ((callback: Parameters<typeof reactAct>[0]) => {
  const result = reactAct(callback as never) as unknown
  if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return result
  // React's act hands back a bare thenable whose `then` returns nothing, so it is wrapped in a real promise.
  return new Promise((resolve, reject) => (result as PromiseLike<unknown>).then(resolve, reject)).then(async (value) => {
    if (latestSetup) await settleScreen(latestSetup)
    return value
  })
}) as typeof reactAct

export async function testRender(...args: Parameters<typeof upstreamTestRender>) {
  const setup = await upstreamTestRender(...args)
  latestSetup = setup
  const { flush, renderOnce, captureCharFrame } = setup
  setup.flush = async (...flushArgs) => { await flush(...flushArgs); await untilDrained(captureCharFrame) }
  setup.renderOnce = async () => { await renderOnce(); await untilDrained(captureCharFrame) }
  return setup
}

type SyntaxStyleDefinitions = Parameters<typeof SyntaxStyle.fromStyles>[0]

/** A SyntaxStyle is bound to the native Context of the scene that draws it, so smokes build theirs from the renderer's own scene. */
function SyntaxStyleHost({ definitions, makeNode }: { definitions: SyntaxStyleDefinitions; makeNode: (style: SyntaxStyle) => ReactNode }) {
  const renderer = useRenderer()
  const style = useMemo(() => SyntaxStyle.fromStyles(definitions, renderer.nativeScene), [definitions, renderer])
  return <>{makeNode(style)}</>
}

export function testRenderWithSyntaxStyle(
  definitions: SyntaxStyleDefinitions,
  makeNode: (style: SyntaxStyle) => ReactNode,
  options: Parameters<typeof upstreamTestRender>[1],
) {
  return testRender(<SyntaxStyleHost definitions={definitions} makeNode={makeNode} />, options)
}
