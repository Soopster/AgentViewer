// Render-thread handle on the editor's Highlights worker: one shared worker,
// one tokenizer per buffer id inside it. Responses are routed by buffer id;
// the facade (editorSyntaxBuffer.ts) decides whether a response is still
// current.
import { tuiWorkerUrl } from '../../../tui/opentui/workerUrl'
import type { EditorHighlightRequest, EditorHighlightResponse } from './editorHighlightProtocol'

type Listener = (response: EditorHighlightResponse) => void
type Failure = (message: string) => void

let worker: Worker | undefined
let broken = false
const listeners = new Map<number, { onResponse: Listener; onFailure: Failure }>()

function fail(message: string) {
  broken = true
  const failed = worker
  worker = undefined
  failed?.terminate()
  for (const { onFailure } of [...listeners.values()]) onFailure(message)
}

function ensureWorker(): Worker | undefined {
  if (broken) return undefined
  if (worker) return worker
  try {
    const created = new Worker(tuiWorkerUrl('plugins/editor/tui/editorHighlightWorker'), { type: 'module' })
    ;(created as unknown as { unref(): void }).unref()
    created.onmessage = ({ data }: MessageEvent<EditorHighlightResponse>) => listeners.get(data.id)?.onResponse(data)
    created.onerror = event => fail(event.message || 'editor highlight worker failed')
    worker = created
    return created
  } catch (error) {
    fail(String(error))
    return undefined
  }
}

/** Attach a buffer. Returns null when no worker can run (the caller falls back). */
export function attachEditorHighlightBuffer(id: number, onResponse: Listener, onFailure: Failure) {
  if (!ensureWorker()) return null
  listeners.set(id, { onResponse, onFailure })
  return {
    send(request: EditorHighlightRequest) {
      try { ensureWorker()?.postMessage(request) } catch (error) { fail(String(error)) }
    },
    detach() {
      if (!listeners.delete(id)) return
      try { worker?.postMessage({ type: 'dispose', id } satisfies EditorHighlightRequest) } catch { /* worker already gone */ }
    },
  }
}
