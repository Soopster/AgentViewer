export type RenderFontId =
  | 'plex-sans'
  | 'atkinson'
  | 'lexend'
  | 'inter'
  | 'noto-sans'
  | 'roboto'
  | 'open-sans'
  | 'source-sans'
  | 'system'
  | 'verdana'
  | 'tahoma'
  | 'humanist'
  | 'serif'
  | 'merriweather'
  | 'mono'

export type RenderFont = {
  id: RenderFontId
  label: string
  family: string
}

export const RENDER_FONTS: readonly RenderFont[] = [
  { id: 'plex-sans', label: 'IBM Plex Sans', family: "'IBM Plex Sans', system-ui, sans-serif" },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', family: "var(--font-atkinson), Verdana, sans-serif" },
  { id: 'lexend', label: 'Lexend', family: "var(--font-lexend), system-ui, sans-serif" },
  { id: 'inter', label: 'Inter', family: "var(--font-inter), system-ui, sans-serif" },
  { id: 'noto-sans', label: 'Noto Sans', family: "var(--font-noto-sans), system-ui, sans-serif" },
  { id: 'roboto', label: 'Roboto', family: "var(--font-roboto), Arial, sans-serif" },
  { id: 'open-sans', label: 'Open Sans', family: "var(--font-open-sans), system-ui, sans-serif" },
  { id: 'source-sans', label: 'Source Sans 3', family: "var(--font-source-sans), system-ui, sans-serif" },
  { id: 'system', label: 'System Sans', family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: 'verdana', label: 'Verdana', family: "Verdana, Geneva, sans-serif" },
  { id: 'tahoma', label: 'Tahoma', family: "Tahoma, Verdana, sans-serif" },
  { id: 'humanist', label: 'Humanist', family: "Avenir, 'Avenir Next', 'Trebuchet MS', sans-serif" },
  { id: 'serif', label: 'Reader Serif', family: "Georgia, 'Times New Roman', serif" },
  { id: 'merriweather', label: 'Merriweather', family: "var(--font-merriweather), Georgia, serif" },
  { id: 'mono', label: 'IBM Plex Mono', family: "'IBM Plex Mono', ui-monospace, monospace" },
]

export const DEFAULT_RENDER_FONT_ID: RenderFontId = 'plex-sans'
export const RENDER_FONT_STORAGE_KEY = 'agentViewer:renderFont'
export const RENDER_FONT_IDS: RenderFontId[] = RENDER_FONTS.map((font) => font.id)

const renderFontIds = new Set<RenderFontId>(RENDER_FONT_IDS)
const renderFontListeners = new Set<() => void>()

export function isRenderFontId(value: string | null | undefined): value is RenderFontId {
  return !!value && renderFontIds.has(value as RenderFontId)
}

export function getCurrentRenderFont(): RenderFontId {
  if (typeof document === 'undefined') return DEFAULT_RENDER_FONT_ID
  const current = document.documentElement.dataset.renderFont
  return isRenderFontId(current) ? current : DEFAULT_RENDER_FONT_ID
}

export function subscribeRenderFont(listener: () => void): () => void {
  renderFontListeners.add(listener)
  return () => renderFontListeners.delete(listener)
}

export function applyRenderFont(fontId: RenderFontId): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.renderFont = fontId
  localStorage.setItem(RENDER_FONT_STORAGE_KEY, fontId)
  for (const listener of renderFontListeners) listener()
}
