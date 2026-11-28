// Browser-safe "Open in my IDE" contract: the service the plugin reads and writes,
// and the one route every place that opens a file asks first. With no route
// installed (plugin off) a file opens where it always did.
import type { IdeId } from '../ideCatalog'

export type IdeChoice = { readonly id: IdeId; readonly label: string }
export type IdeState = {
  /** Editors found on this machine. */
  readonly detected: readonly IdeChoice[]
  /** The saved choice; null when the person has never chosen. */
  readonly preference: IdeId | null
  /** `$VISUAL`/`$EDITOR`, when set, and whether it runs in a terminal. */
  readonly editor: { readonly command: string; readonly terminal: boolean } | null
}
export type IdeOpenInput = {
  readonly path: string
  readonly line?: number | null
  readonly column?: number | null
  /** Resolves a relative path. */
  readonly cwd?: string | null
  /** Overrides the saved choice for this one open. */
  readonly ide?: Exclude<IdeId, 'builtin'>
}
export type PluginIdeService = {
  read(signal?: AbortSignal): Promise<IdeState>
  setPreference(id: IdeId): Promise<IdeState>
  /** Opens the file in the chosen editor. Resolves with the editor's label. */
  open(input: IdeOpenInput): Promise<{ readonly label: string }>
}

/** Which editor a renderer uses: the saved choice, else the TUI's own editor, else the first one installed. */
export function effectiveIde(state: IdeState | null, renderer: 'web' | 'tui'): IdeId | null {
  if (!state) return null
  if (state.preference) return state.preference
  if (renderer === 'tui') return 'builtin'
  return state.detected[0]?.id ?? null
}

export type FileOpenRequest = { readonly path: string; readonly line?: number | null; readonly column?: number | null; readonly cwd?: string | null }
/** Returns true when it takes the open; `fallback` opens the file the host's own way (it may call it after a failed launch). */
export type FileOpenRoute = (request: FileOpenRequest, fallback: () => void) => boolean

let route: FileOpenRoute | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export function setFileOpenRoute(next: FileOpenRoute): () => void {
  route = next
  notify()
  return () => { if (route === next) { route = null; notify() } }
}

/** Ask before opening a file the host's way. True when the route took it. */
export function routeFileOpen(request: FileOpenRequest, fallback: () => void = () => {}): boolean {
  if (!route || !request.path) return false
  try { return route(request, fallback) } catch { return false }
}

export const hasFileOpenRoute = () => route !== null
export function subscribeFileOpenRoute(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
