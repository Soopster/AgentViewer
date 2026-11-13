// Interactive views from mods, without a build step. A mod declares views in
// plugin.json (`"views": [{ "id": "board", "title": "Build board" }]`) and its
// server module returns each as data:
//
//   export const views = { board: ({ signal }) => ({ title, blocks: [
//     { type: 'heading', text: 'Builds' },
//     { type: 'item', id: 'b1', label: 'main', detail: 'green', action: 'rerun' },
//     { type: 'button', action: 'refresh', label: 'Refresh' },
//     { type: 'text', text: 'Last checked 2m ago', tone: 'muted' },
//   ] }) }
//   export const actions = { rerun: ({ view, item, signal }) => ({ notice: 'Re-running ' + item }) }
//
// The bundled `mod-views` plugin draws them in both renderers (rows and
// buttons are clickable, and keyboard-selectable in the TUI), runs an action
// where the mod lives, shows its notice and re-renders the view. Browser-safe.
import type { LocalCommandEffects } from './localManifest'

export type ModViewBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'text'; readonly text: string; readonly tone?: 'default' | 'muted' | 'success' | 'warning' | 'error' }
  | { readonly type: 'item'; readonly id?: string; readonly label: string; readonly detail?: string; readonly action?: string }
  | { readonly type: 'button'; readonly label: string; readonly action: string }

export type ModViewContent = { readonly title: string; readonly blocks: readonly ModViewBlock[] }
export type ModViewRef = { readonly pluginId: string; readonly viewId: string; readonly title: string }

const TONES = new Set(['default', 'muted', 'success', 'warning', 'error'])
const MAX_BLOCKS = 200

/** Untrusted module output or an HTTP body, reduced to what the renderers draw. */
export function decodeModView(value: unknown, fallbackTitle: string): ModViewContent {
  const raw = (value && typeof value === 'object' ? value : {}) as { title?: unknown; blocks?: unknown }
  const blocks: ModViewBlock[] = []
  const text = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '')
  const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : undefined)
  for (const entry of Array.isArray(raw.blocks) ? raw.blocks.slice(0, MAX_BLOCKS) : []) {
    const block = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (block.type === 'heading' && text(block.text)) blocks.push({ type: 'heading', text: text(block.text, 120) })
    else if (block.type === 'text' && typeof block.text === 'string') blocks.push({ type: 'text', text: text(block.text, 2000), ...(TONES.has(block.tone as string) ? { tone: block.tone as 'muted' } : {}) })
    else if (block.type === 'item' && text(block.label)) {
      const action = id(block.action), itemId = id(block.id)
      blocks.push({ type: 'item', label: text(block.label, 200), ...(text(block.detail) ? { detail: text(block.detail, 300) } : {}), ...(action ? { action } : {}), ...(itemId ? { id: itemId } : {}) })
    } else if (block.type === 'button' && text(block.label) && id(block.action)) blocks.push({ type: 'button', label: text(block.label, 60), action: id(block.action)! })
  }
  return { title: text(raw.title, 80) || fallbackTitle, blocks }
}

/** The blocks a person can act on, in order: what keyboard selection moves through. */
export function modViewActionables(content: ModViewContent): Array<Extract<ModViewBlock, { type: 'item' | 'button' }> & { readonly index: number }> {
  return content.blocks.flatMap((block, index) => (block.type === 'button' || (block.type === 'item' && block.action)) ? [{ ...block, index }] as never[] : [])
}

/** Where mods' views live, installed by each renderer (TUI in process, Web through its daemon). */
export type ModViewService = {
  readonly list: () => readonly ModViewRef[]
  readonly render: (view: ModViewRef, signal: AbortSignal) => Promise<ModViewContent>
  readonly act: (view: ModViewRef, action: string, item: string | undefined, signal: AbortSignal) => Promise<LocalCommandEffects>
}
let service: ModViewService | null = null
export function setModViewService(next: ModViewService): void { service = next }
export function modViewService(): ModViewService | null { return service }
