// Language servers for the Web editor, hosted by the web server: one
// EditorLspClient per open buffer — the terminal editor's own client, so the
// server table, project overrides (.agent-viewer/lsp.json), incremental sync,
// restarts and session sharing are the same in both renderers. Positions are
// LSP's UTF-16 units, which is what a browser string index already is.
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorLspClient, getEditorLspServerSpecs, resolveLspWorkspaceRoot, type EditorCompletion, type EditorDiagnostic, type EditorLocation, type EditorLspStatus, type EditorPosition } from '../tui/editorLsp'
import { detectTuiCodeFiletypeFromPath } from '../../../tui/codeFiletypes'

type Entry = { client: EditorLspClient; status: EditorLspStatus | null; diagnostics: EditorDiagnostic[]; usedAt: number; started: Promise<boolean> }
const IDLE_MS = 10 * 60_000
const store = globalThis as typeof globalThis & { __agentViewerWebLsp?: Map<string, Entry>; __agentViewerWebLspReaper?: ReturnType<typeof setInterval> }
const documents = (store.__agentViewerWebLsp ??= new Map())
// A buffer nobody has touched for a while gives its server back (the session pool reaps the process).
store.__agentViewerWebLspReaper ??= setInterval(() => {
  for (const [key, entry] of documents) if (Date.now() - entry.usedAt > IDLE_MS) { entry.client.stop(); documents.delete(key) }
}, 60_000)
store.__agentViewerWebLspReaper.unref?.()

/** The file a request names, refused unless it is inside the workspace it names. */
function target(cwd: string, path: string): { root: string; file: string } {
  if (!cwd || !isAbsolute(cwd)) throw new Error('An absolute cwd is required')
  if (!path || path.includes('\0') || isAbsolute(path)) throw new Error('A relative path is required')
  const root = resolve(cwd)
  const file = resolve(root, path)
  if (!file.startsWith(root + sep)) throw new Error('Path escapes the workspace')
  return { root, file }
}
const keyOf = (cwd: string, path: string) => `${resolve(cwd)}\0${path}`
const entryOf = (cwd: string, path: string) => {
  const entry = documents.get(keyOf(cwd, path))
  if (!entry) throw new Error('That document is not open')
  entry.usedAt = Date.now()
  return entry
}

export async function openLspDocument(cwd: string, path: string, text: string): Promise<{ status: EditorLspStatus | null }> {
  const { root, file } = target(cwd, path)
  const key = keyOf(cwd, path)
  const existing = documents.get(key)
  if (existing) { existing.usedAt = Date.now(); existing.client.change(text); return { status: existing.status } }
  const filetype = detectTuiCodeFiletypeFromPath(path) ?? 'plaintext'
  const client = new EditorLspClient(resolveLspWorkspaceRoot(filetype, file, root), filetype, file, getEditorLspServerSpecs(filetype, root))
  const entry: Entry = { client, status: null, diagnostics: [], usedAt: Date.now(), started: Promise.resolve(false) }
  client.onStatus(status => { entry.status = status })
  client.onDiagnostics(next => { entry.diagnostics = next })
  // A server's rename or code action would edit files behind the browser's buffers; refuse it here.
  client.onWorkspaceEdit(async () => false)
  documents.set(key, entry)
  entry.started = client.start(text)
  await Promise.race([entry.started, new Promise(done => setTimeout(done, 1500))])
  return { status: entry.status }
}

export function changeLspDocument(cwd: string, path: string, text: string): void { entryOf(cwd, path).client.change(text) }
export function savedLspDocument(cwd: string, path: string, text: string): void { entryOf(cwd, path).client.saved(text) }
export function lspDocumentState(cwd: string, path: string): { status: EditorLspStatus | null; diagnostics: EditorDiagnostic[] } {
  const entry = entryOf(cwd, path)
  return { status: entry.status, diagnostics: entry.diagnostics }
}
export function closeLspDocument(cwd: string, path: string): void {
  const key = keyOf(cwd, path)
  documents.get(key)?.client.stop()
  documents.delete(key)
}

export async function lspCompletion(cwd: string, path: string, position: EditorPosition, trigger?: string) {
  const items: EditorCompletion[] = await entryOf(cwd, path).client.completion(position, trigger)
  // The raw item is the server's own object, kept for resolve; the browser does not need it.
  return items.slice(0, 200).map((item: EditorCompletion) => ({ ...item, rawItem: undefined }))
}
export async function lspHover(cwd: string, path: string, position: EditorPosition) { return entryOf(cwd, path).client.hover(position) }

/** Definitions as workspace-relative paths; one outside the workspace keeps its absolute path and says so. */
export async function lspDefinition(cwd: string, path: string, position: EditorPosition) {
  const root = resolve(cwd)
  const locations: EditorLocation[] = await entryOf(cwd, path).client.definition(position)
  return locations.map((location: EditorLocation) => {
    const absolute = location.uri.startsWith('file:') ? fileURLToPath(location.uri) : location.uri
    const inside = absolute.startsWith(root + sep)
    return { path: inside ? relative(root, absolute).split(sep).join('/') : absolute, inside, range: location.range }
  })
}

/** How many buffers hold a server: a test's proof that closing releases one. */
export function openLspDocumentCount(): number { return documents.size }
