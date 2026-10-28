import { APPLE_VOICE_SOURCE, voiceEngine } from './appleVoice'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile, access, mkdir } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const exec = promisify(execFile)
export const MAX_VOICE_BYTES = 20 * 1024 * 1024

export async function transcribeVoice(audio: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (!audio.length || audio.length > MAX_VOICE_BYTES) throw new Error('Recording must be between 1 byte and 20 MB.')
  const engine = voiceEngine()
  const model = process.env.AGENT_VIEWER_WHISPER_MODEL
  if (engine === 'whisper' && !model) throw new Error('Set AGENT_VIEWER_WHISPER_MODEL to a local whisper.cpp model file. See docs/voice.md.')
  if (engine === 'whisper' && model) await access(model)
  const dir = await mkdtemp(join(tmpdir(), 'agent-viewer-voice-'))
  try {
    const input = join(dir, 'recording')
    const wav = join(dir, 'audio.wav')
    const output = join(dir, 'transcript')
    await writeFile(input, audio, { mode: 0o600 })
    await exec(process.env.AGENT_VIEWER_FFMPEG ?? 'ffmpeg', ['-nostdin', '-v', 'error', '-i', input, '-t', '120', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 30_000, killSignal: 'SIGKILL', signal })
    if (engine !== 'whisper') {
      const source = join(dir, 'AppleVoice.swift')
      await writeFile(source, APPLE_VOICE_SOURCE, { mode: 0o600 })
      try {
        // Reuse compiler modules: a fresh cache per recording can take minutes.
        const cache = join(homedir(), '.cache', 'agent-viewer', 'swift-modules')
        await mkdir(cache, { recursive: true, mode: 0o700 })
        const { stdout } = await exec('/usr/bin/xcrun', ['swift', '-module-cache-path', cache, source, wav, process.env.AGENT_VIEWER_VOICE_LANGUAGE ?? 'auto'], { timeout: 60_000, killSignal: 'SIGKILL', signal, maxBuffer: 4 * 1024 * 1024 })
        const text = stdout.trim()
        if (!text) throw new Error('No speech detected. Try recording again.')
        return text
      } catch (error) {
        signal?.throwIfAborted()
        if (engine === 'apple' || !model) {
          if ((error as { killed?: boolean }).killed) throw new Error('Apple transcription timed out after 60 seconds. Retry, or configure local Whisper. See docs/voice.md.')
          const stderr = (error as { stderr?: string }).stderr?.trim()
          throw new Error(stderr || 'Apple transcription requires macOS 26+, Apple speech models, and Xcode Command Line Tools. See docs/voice.md.')
        }
        // Auto mode only falls back to another local engine explicitly configured by the user.
      }
    }
    if (!model) throw new Error('Configure AGENT_VIEWER_WHISPER_MODEL for local Whisper.')
    await access(model)
    await exec(process.env.AGENT_VIEWER_WHISPER_BIN ?? 'whisper-cli', ['-m', model, '-f', wav, '-l', (process.env.AGENT_VIEWER_VOICE_LANGUAGE ?? 'auto').split(/[-_]/)[0], '-otxt', '-of', output], { timeout: 180_000, killSignal: 'SIGKILL', signal, maxBuffer: 4 * 1024 * 1024 })
    const text = (await readFile(`${output}.txt`, 'utf8')).trim()
    if (!text) throw new Error('No speech detected. Try recording again.')
    return text
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Voice requires ffmpeg and whisper-cli on PATH. See docs/voice.md.')
    throw error
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
