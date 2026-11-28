import { APPLE_VOICE_SOURCE, voiceEngine } from '../lib/appleVoice'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MAX_VOICE_BYTES, transcribeVoice } from '../lib/voiceTranscription'

const root = await mkdtemp(join(tmpdir(), 'voice-smoke-'))
const saved = { ...process.env }
try {
  assert.equal(voiceEngine('darwin', 'auto'), 'auto')
  assert.equal(voiceEngine('linux', 'auto'), 'whisper')
  assert.equal(voiceEngine('darwin', 'whisper'), 'whisper')
  assert.equal(voiceEngine('darwin', 'apple'), 'apple')
  assert.throws(() => voiceEngine('linux', 'apple'), /macOS/)
  assert.throws(() => voiceEngine('darwin', 'invalid'), /must be/)
  assert.match(APPLE_VOICE_SOURCE, /SpeechAnalyzer/)
  process.env.AGENT_VIEWER_VOICE_ENGINE = 'whisper'
  delete process.env.AGENT_VIEWER_WHISPER_MODEL
  await assert.rejects(transcribeVoice(new Uint8Array([1])), /WHISPER_MODEL/)
  await assert.rejects(transcribeVoice(new Uint8Array()), /Recording/)
  await assert.rejects(transcribeVoice(new Uint8Array(MAX_VOICE_BYTES + 1)), /Recording/)
  const model = join(root, 'model.bin')
  await writeFile(model, '')
  const ffmpeg = join(root, 'ffmpeg')
  const whisper = join(root, 'whisper')
  await writeFile(ffmpeg, '#!/bin/sh\nexit 0\n')
  await writeFile(whisper, '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\nif [ "$1" = "-of" ]; then shift; printf "Hello from local speech" > "$1.txt"; fi\nshift\ndone\n')
  await chmod(ffmpeg, 0o700)
  await chmod(whisper, 0o700)
  process.env.AGENT_VIEWER_WHISPER_MODEL = model
  process.env.AGENT_VIEWER_FFMPEG = ffmpeg
  process.env.AGENT_VIEWER_WHISPER_BIN = whisper
  const before = (await readdir(tmpdir())).filter(x => x.startsWith('agent-viewer-voice-')).sort()
  assert.equal(await transcribeVoice(new Uint8Array([1, 2])), 'Hello from local speech')
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(transcribeVoice(new Uint8Array([1]), abort.signal))
  await writeFile(ffmpeg, '#!/bin/sh\nexec sleep 30\n')
  const running = new AbortController()
  const cancelTimer = setTimeout(() => running.abort(), 100)
  try { await assert.rejects(transcribeVoice(new Uint8Array([1]), running.signal), /abort/i) }
  finally { clearTimeout(cancelTimer) }
  await writeFile(ffmpeg, '#!/bin/sh\nexit 0\n')
  process.env.AGENT_VIEWER_WHISPER_BIN = join(root, 'missing')
  await assert.rejects(transcribeVoice(new Uint8Array([1])), /requires ffmpeg/)
  assert.deepEqual((await readdir(tmpdir())).filter(x => x.startsWith('agent-viewer-voice-')).sort(), before)
  console.log('Voice smoke passed: validation, local command output, cancellation, failure, cleanup')
} finally {
  process.env = saved
  await rm(root, { recursive: true, force: true })
}
