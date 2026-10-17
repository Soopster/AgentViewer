import {
  searchEditorProject,
  searchEditorBuffers,
  type EditorProjectSearchBuffer,
  type EditorProjectSearchOptions,
  type EditorProjectSearchResult,
} from './editorProjectSearch'

type SearchRequest = {
  kind: 'search'
  id: number
  cwd: string
  query: string
  options: Omit<EditorProjectSearchOptions, 'signal'>
  buffers: readonly EditorProjectSearchBuffer[]
}

type CancelRequest = { kind: 'cancel'; id: number }
type WorkerRequest = SearchRequest | CancelRequest
type WorkerResponse =
  | { id: number; ok: true; results: EditorProjectSearchResult[] }
  | { id: number; ok: false; error: string; aborted?: boolean }

declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

const active = new Map<number, AbortController>()

self.onmessage = (event) => {
  const request = event.data
  if (request.kind === 'cancel') {
    active.get(request.id)?.abort()
    return
  }
  const controller = new AbortController()
  active.set(request.id, controller)
  void searchEditorProject(request.cwd, request.query, { ...request.options, signal: controller.signal }).then((diskResults) => {
    if (controller.signal.aborted) return
    const openPaths = new Set(request.buffers.map((buffer) => buffer.path))
    const bufferResults = searchEditorBuffers(request.buffers, request.query, request.options)
    const limit = request.options.limit ?? 500
    const results = [...diskResults.filter((result) => !openPaths.has(result.path)), ...bufferResults]
      .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.character - right.character)
      .slice(0, limit)
    if (!controller.signal.aborted) self.postMessage({ id: request.id, ok: true, results })
  }).catch((error) => {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      aborted: error instanceof Error && error.name === 'AbortError',
    })
  }).finally(() => active.delete(request.id))
}
