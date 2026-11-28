import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { voiceEngine } from '../../lib/appleVoice'
import { transcribeVoice } from '../../lib/voiceTranscription'

export async function recordVoice(signal: AbortSignal, onRecording: (stop: () => void) => void): Promise<string> {
  if (voiceEngine() === 'whisper' && !process.env.AGENT_VIEWER_WHISPER_MODEL) throw new Error('Set AGENT_VIEWER_WHISPER_MODEL first; see docs/voice.md.')
  const dir = await mkdtemp(join(tmpdir(), 'agent-viewer-mic-'))
  try {
    signal.throwIfAborted()
    const path = join(dir, 'mic.wav')
    const backend = process.platform === 'darwin' ? 'avfoundation' : process.platform === 'win32' ? 'dshow' : 'pulse'
    const device = process.env.AGENT_VIEWER_VOICE_DEVICE ?? (process.platform === 'darwin' ? ':0' : process.platform === 'win32' ? 'audio=default' : 'default')
    const child = spawn(process.env.AGENT_VIEWER_FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', backend, '-i', device, '-t', '120', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', path], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-2000) })
    const abort = () => { child.kill('SIGKILL') }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`Microphone capture failed. Check ffmpeg and microphone permissions. ${stderr}`)))
        child.once('spawn', () => onRecording(() => { child.stdin.end('q\n') }))
      })
    } finally { signal.removeEventListener('abort', abort) }
    signal.throwIfAborted()
    return await transcribeVoice(await readFile(path), signal)
  } finally { await rm(dir, { recursive: true, force: true }) }
}
