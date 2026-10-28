import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SessionMessage } from '../../../lib/types'
import { downloadHtml } from '@/lib/downloadHtml'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import { type RewindPreview } from '../types'

export type HandleExportContext = {
  session: Session | null
  setExporting: Dispatch<SetStateAction<boolean>>
  messages: SessionMessage[]
  setSessionActionError: Dispatch<SetStateAction<string | null>>
}

export async function runHandleExport(ctx: HandleExportContext) {
  const {
    session, setExporting, messages, setSessionActionError,
  } = ctx
  if (!session) return
  const dirName  = session.customTitle ?? session.summary ?? getPrimarySessionTag(session.tag) ?? (pathBasename(session.cwd) || session.sessionId)
  const safeName = dirName.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase()
  const filename = `${safeName}_${session.sessionId.slice(0, 8)}.html`

  if (typeof Worker === 'undefined') {
    setExporting(true)
    try {
      const { exportSessionToHtml } = await import('@/lib/export')
      const html = exportSessionToHtml(session, messages)
      downloadHtml(html, filename)
    } catch (error) {
      setSessionActionError(error instanceof Error ? error.message : 'Failed to export session')
    } finally {
      setExporting(false)
    }
    return
  }

  setExporting(true)
  const worker = new Worker(new URL('../../../workers/exportWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ html?: string; error?: string }>) => {
    const { html, error } = event.data ?? {}
    if (html) {
      downloadHtml(html, filename)
    } else if (error) {
      setSessionActionError(error)
    }
    setExporting(false)
    worker.terminate()
  }
  worker.onerror = () => {
    setExporting(false)
    setSessionActionError('Failed to export session')
    worker.terminate()
  }
  worker.postMessage({ session, messages })
}

export type HandleRewindContext = {
  session: Session | null
  selectedRewindTarget: { uuid: string; content: string; timestamp: string | undefined; } | null
  previewingRewind: boolean
  applyingRewind: boolean
  setPreviewingRewind: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  selectedModel: string
  setRewindPreview: Dispatch<SetStateAction<RewindPreview | null>>
}

export async function runHandleRewind(ctx: HandleRewindContext) {
  const {
    session, selectedRewindTarget, previewingRewind, applyingRewind, setPreviewingRewind,
    setSessionActionError, setSessionActionNotice, selectedModel, setRewindPreview,
  } = ctx
  if (!session || !selectedRewindTarget || previewingRewind || applyingRewind) return

  setPreviewingRewind(true)
  setSessionActionError(null)
  setSessionActionNotice(null)
  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessageId: selectedRewindTarget.uuid, model: selectedModel, dryRun: true, provider: session.provider, providerInstanceId: session.providerInstanceId }),
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

    const filesChanged = Array.isArray(data.filesChanged)
      ? data.filesChanged.filter((file: unknown): file is string => typeof file === 'string')
      : []

    setRewindPreview({
      userMessageId: selectedRewindTarget.uuid,
      contentPreview: selectedRewindTarget.content.replace(/\s+/g, ' ').trim().slice(0, 160),
      filesChanged,
    })
    setSessionActionNotice(filesChanged.length > 0
      ? `Previewed ${filesChanged.length} file change${filesChanged.length === 1 ? '' : 's'}.`
      : 'No tracked file changes at that prompt.')
  } catch (err) {
    setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
  } finally {
    setPreviewingRewind(false)
  }
}
