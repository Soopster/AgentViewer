import type { AgentProvider } from './types'
import { getProviderManifest } from './extensions/providers/catalog'

export type ProviderComposerConfig = {
  /** Display label for the assistant. Mirrors getAssistantLabel but kept here so this module is self-contained. */
  label: string
  /** Short prompt glyph shown to the left of the textarea (e.g. `>`, `❯`). Empty string means no glyph. */
  glyph: string
  /** CSS custom-property name on the web (without var()) used as the composer accent. */
  cssAccentVar: string
  /** Rough rgba tint used for accent backgrounds (popover hover, send button bg) on the web. */
  cssAccentRgb: string
  /** Provider-tinted placeholder shown when the composer is empty and idle. */
  placeholderIdle: string
  /** Placeholder while a previous send is still streaming. Used for both web and TUI. */
  placeholderStreaming: string
  /** TUI placeholder when no session is selected. */
  placeholderNoSession: string
  /** Footer hint when not sending. Should describe the native send/newline/history binding pattern. */
  footerHintIdle: string
  /** Footer hint while sending (cancel hint). */
  footerHintSending: string
  /** Send button label / send verb (web only). */
  sendVerb: string
  /** Short marketing-style rotating examples shown when input is empty. The first one is also used as a fallback. */
  examples: readonly string[]
  /** TUI accent palette key — names a slot on `TuiThemePalette` (e.g. 'amber', 'cyan'). */
  tuiAccentKey: 'amber' | 'cyan' | 'green' | 'violet' | 'pink' | 'red'
  /** Big welcome line shown for empty sessions — mirrors what the CLI prints on launch. */
  welcomeTitle: string
  /** Secondary line under the title — short list of slash hints / setup info, CLI-style. */
  welcomeSubtitle: string
  /** Bullet items shown beneath the welcome banner — quick-start prompts the user can click. */
  welcomeBullets: readonly string[]
}

// Cached, neutral defaults for extensions that supply no composer branding.
const generic = new Map<AgentProvider, ProviderComposerConfig>()
export function getProviderComposer(provider: AgentProvider | undefined | null): ProviderComposerConfig {
  const id = provider ?? 'claude'
  const manifest = getProviderManifest(id)
  if (manifest.composer) return manifest.composer
  const cached = generic.get(id)
  if (cached) return cached
  const config: ProviderComposerConfig = {
    label: manifest.displayName, glyph: '>', cssAccentVar: '--violet', cssAccentRgb: '139,128,240',
    placeholderIdle: `Message ${manifest.displayName}`,
    placeholderStreaming: 'Type a follow-up', placeholderNoSession: 'Pick a session to send a message',
    footerHintIdle: 'Enter send · Shift+Enter newline', footerHintSending: 'Ctrl+C cancel',
    sendVerb: 'Send', examples: [], tuiAccentKey: 'violet',
    welcomeTitle: manifest.displayName, welcomeSubtitle: '', welcomeBullets: [],
  }
  generic.set(id, config)
  return config
}

/** Pick a rotating example based on a stable index (e.g. session id hash). */
export function pickProviderExample(provider: AgentProvider | undefined | null, seed: number): string {
  const config = getProviderComposer(provider)
  const examples = config.examples
  if (examples.length === 0) return config.placeholderIdle
  const idx = Math.abs(seed) % examples.length
  return examples[idx] ?? examples[0]!
}
