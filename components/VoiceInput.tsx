'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'

export function VoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const transcription = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      transcription.current?.abort()
      if (timer.current) clearTimeout(timer.current)
      recorder.current?.stream.getTracks().forEach(track => track.stop())
      if (recorder.current?.state === 'recording') recorder.current.stop()
    }
  }, [])

  async function toggle() {
    if (transcription.current) { transcription.current.abort(); return }
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
    const signal = lifetime.current!.signal
    let openedStream: MediaStream | undefined
    setError('')
    setPhase('starting')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording requires a supported browser on HTTPS or localhost.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      openedStream = stream
      if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); return }
      const capture = new MediaRecorder(stream)
      recorder.current = capture
      const chunks: Blob[] = []
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      capture.onerror = () => {
        stream.getTracks().forEach(track => track.stop())
        if (!signal.aborted) { setError('Microphone recording failed.'); setPhase('idle') }
      }
      capture.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        if (timer.current) clearTimeout(timer.current)
        if (signal.aborted) return
        setPhase('transcribing')
        const request = new AbortController()
        transcription.current = request
        const deadline = setTimeout(() => request.abort(new Error('Transcription timed out. Please retry.')), 240_000)
        const cancel = () => request.abort()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          const response = await fetch('/api/voice/transcribe', { method: 'POST', body: new Blob(chunks, { type: capture.mimeType }), signal: request.signal })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error ?? 'Transcription failed.')
          if (!signal.aborted && !request.signal.aborted) onTranscript(result.text)
        } catch (cause) {
          if (!signal.aborted) setError(request.signal.aborted ? (request.signal.reason instanceof Error && request.signal.reason.name !== 'AbortError' ? request.signal.reason.message : 'Transcription cancelled.') : cause instanceof Error ? cause.message : 'Transcription failed.')
        } finally {
          clearTimeout(deadline)
          signal.removeEventListener('abort', cancel)
          if (transcription.current === request) transcription.current = null
          if (!signal.aborted) setPhase('idle')
        }
      }
      capture.start()
      setPhase('recording')
      timer.current = setTimeout(() => { if (capture.state === 'recording') capture.stop() }, 120_000)
    } catch (cause) {
      openedStream?.getTracks().forEach(track => track.stop())
      if (!signal.aborted) { setError(cause instanceof Error ? cause.message : 'Microphone unavailable.'); setPhase('idle') }
    }
  }

  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <button type="button" onClick={() => void toggle()} disabled={phase === 'starting'} aria-label={phase === 'transcribing' ? 'Cancel transcription' : phase === 'recording' ? 'Stop voice recording' : 'Dictate prompt'} aria-pressed={phase === 'recording'} title="Dictate with on-device transcription (up to 2 minutes)" style={{ padding: 8, borderRadius: 999, color: phase === 'recording' ? 'var(--danger, #ef4444)' : 'var(--text-2)', cursor: 'pointer' }}>
      {phase === 'recording' || phase === 'transcribing' ? <Square size={16} /> : <Mic size={16} />}
    </button>
    <span role="status" style={{ fontSize: 12 }}>{error || (phase === 'idle' ? '' : phase === 'recording' ? 'Listening… click to stop' : phase === 'starting' ? 'Opening microphone…' : 'Transcribing locally… click to cancel')}</span>
  </div>
}
