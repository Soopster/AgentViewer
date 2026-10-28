import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SessionMessage } from '../../../lib/types'
import { downloadHtml } from '@/lib/downloadHtml'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'

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
