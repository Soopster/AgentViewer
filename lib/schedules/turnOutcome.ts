/**
 * Drains an unattended turn's event stream to its end and answers why it failed,
 * or null. A turn that fails does so inside a 200 stream, as an `error` frame;
 * dropping the stream unread reported every such turn as having worked.
 */
export async function drainTurnStream(body: ReadableStream<Uint8Array> | null | undefined): Promise<string | null> {
  if (!body) return null
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let failure: string | null = null
  const read = (line: string) => {
    if (line.startsWith('event:')) { event = line.slice(6).trim(); return }
    if (line === '') { event = ''; return }
    if (event !== 'error' || !line.startsWith('data:') || failure !== null) return
    const data = line.slice(5).trim()
    try { failure = String((JSON.parse(data) as { error?: unknown }).error ?? data) } catch { failure = data }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) read(line.replace(/\r$/, ''))
      if (done) break
    }
    if (buffer) read(buffer)
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error)
  }
  return failure
}
