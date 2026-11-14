import { MAX_VOICE_BYTES, transcribeVoice } from '@/lib/voiceTranscription'

export const runtime = 'nodejs'
let busy = false

export async function POST(request: Request) {
  if (busy) return Response.json({ error: 'Transcription is busy. Try again shortly.' }, { status: 429 })
  busy = true
  try {
    const reader = request.body?.getReader()
    if (!reader) return Response.json({ error: 'Audio required.' }, { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_VOICE_BYTES) {
          await reader.cancel()
          return Response.json({ error: 'Recording exceeds 20 MB.' }, { status: 413 })
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const audio = Buffer.concat(chunks)
    return Response.json({ text: await transcribeVoice(audio, request.signal) })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Transcription failed.' }, { status: 400 })
  } finally { busy = false }
}
