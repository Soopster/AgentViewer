import { createAnsiCompactor } from './ansiCompact'

/**
 * A stdout that the renderer writes through JavaScript, with its ANSI output compacted.
 *
 * The renderer hands frames to a native writer thread only when its sink is
 * `process.stdout` itself; any other object takes the JS write path, which is
 * where `createAnsiCompactor` can rewrite the bytes. Everything else (columns,
 * isTTY, resize events) is inherited from the real stream.
 */
export function createCompactingStdout(real: NodeJS.WriteStream = process.stdout): NodeJS.WriteStream {
  const compactor = createAnsiCompactor()
  const decoder = new TextDecoder()
  const write = (chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown): boolean => {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    const out = compactor.write(text)
    if (out === '') {
      if (typeof done === 'function') queueMicrotask(() => done())
      return true
    }
    return typeof done === 'function' ? real.write(out, done as (error?: Error | null) => void) : real.write(out)
  }
  const wrapper = Object.create(real, { write: { value: write, configurable: true, writable: true } }) as NodeJS.WriteStream
  // Events belong to the real stream: it is the one that emits 'resize'. Listeners added to
  // a prototype-derived object would sit on the wrapper and never hear it.
  for (const method of ['on', 'once', 'off', 'addListener', 'removeListener', 'prependListener', 'prependOnceListener', 'removeAllListeners', 'listenerCount', 'listeners', 'emit'] as const) {
    Object.defineProperty(wrapper, method, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const result = (real[method] as (...a: unknown[]) => unknown)(...args)
        return result === real ? wrapper : result
      },
    })
  }
  return wrapper
}
