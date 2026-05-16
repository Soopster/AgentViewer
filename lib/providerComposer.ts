import type { AgentProvider } from './types'

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

const CLAUDE: ProviderComposerConfig = {
  label: 'Claude',
  glyph: '>',
  cssAccentVar: '--violet',
  cssAccentRgb: '139,128,240',
  placeholderIdle: 'Try "fix the failing test" — Claude can read, edit, run, and explain code.',
  placeholderStreaming: 'Draft your next message for Claude…',
  placeholderNoSession: 'Pick a Claude session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · @ files · ↑↓ history',
  footerHintSending: 'Esc cancel · ⏎ queue next message',
  sendVerb: 'Send',
  examples: [
    'Try "find where API errors are logged"',
    'Try "refactor this component to use hooks"',
    'Try "summarise the diff on this branch"',
    'Try "write a test for handleSubmit"',
  ],
  tuiAccentKey: 'violet',
  welcomeTitle: '✻ Welcome to Claude Code',
  welcomeSubtitle: '/help for help · /status for your setup · /model to change model',
  welcomeBullets: [
    'find where API errors are logged',
    'refactor this component to use hooks',
    'summarise the diff on this branch',
  ],
}

const CODEX: ProviderComposerConfig = {
  label: 'Codex',
  glyph: '›',
  cssAccentVar: '--green',
  cssAccentRgb: '45,212,160',
  placeholderIdle: 'What can codex do for you? — describe a change and codex will run it.',
  placeholderStreaming: 'Draft your next instruction for codex…',
  placeholderNoSession: 'Pick a codex session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · ↑↓ history',
  footerHintSending: 'Esc cancel · running…',
  sendVerb: 'Run',
  examples: [
    'Try "apply the migration to production"',
    'Try "patch this file to add logging"',
    'Try "show /diff and stage the changes"',
  ],
  tuiAccentKey: 'green',
  welcomeTitle: '› codex',
  welcomeSubtitle: '/help · /diff · /status · approvals on demand',
  welcomeBullets: [
    'apply the pending migration',
    'patch this file to add logging',
    'show /diff and stage the changes',
  ],
}

const OPENCODE: ProviderComposerConfig = {
  label: 'opencode',
  glyph: '❯',
  cssAccentVar: '--amber',
  cssAccentRgb: '234,170,64',
  placeholderIdle: 'Ask anything — opencode will plan, edit, and run with your tools.',
  placeholderStreaming: 'Draft your next prompt for opencode…',
  placeholderNoSession: 'Pick an opencode session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · @ files · ↑↓ history',
  footerHintSending: 'Esc cancel · streaming…',
  sendVerb: 'Send',
  examples: [
    'Try "explore the routing layer"',
    'Try "open the failing CI logs and explain"',
    'Try "draft a PR for the search refactor"',
  ],
  tuiAccentKey: 'amber',
  welcomeTitle: '❯ opencode',
  welcomeSubtitle: '/help · /summarize · @ to attach files',
  welcomeBullets: [
    'explore the routing layer',
    'open the failing CI logs and explain',
    'draft a PR for the search refactor',
  ],
}

const COPILOT: ProviderComposerConfig = {
  label: 'Copilot',
  glyph: '»',
  cssAccentVar: '--cyan',
  cssAccentRgb: '56,217,245',
  placeholderIdle: 'How can Copilot help with this repo?',
  placeholderStreaming: 'Draft your next question for Copilot…',
  placeholderNoSession: 'Pick a Copilot session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · ↑↓ history',
  footerHintSending: 'Esc cancel · thinking…',
  sendVerb: 'Ask',
  examples: [
    'Try "what changed in the last release?"',
    'Try "open a PR titled \'flaky test fix\'"',
    'Try "review the diff for security issues"',
  ],
  tuiAccentKey: 'cyan',
  welcomeTitle: '» GitHub Copilot',
  welcomeSubtitle: '/help · /clear · ask about this repo',
  welcomeBullets: [
    'what changed in the last release?',
    'open a PR titled "flaky test fix"',
    'review the diff for security issues',
  ],
}

const PI: ProviderComposerConfig = {
  label: 'Pi',
  glyph: '·',
  cssAccentVar: '--red',
  cssAccentRgb: '244,114,182',
  placeholderIdle: 'What\'s on your mind? — Pi will write and run code with you.',
  placeholderStreaming: 'Draft your next message for Pi…',
  placeholderNoSession: 'Pick a Pi session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · ↑↓ history',
  footerHintSending: 'Esc cancel · responding…',
  sendVerb: 'Send',
  examples: [
    'Try "build a quick prototype for X"',
    'Try "fix this error trace"',
    'Try "what does this regex match?"',
  ],
  tuiAccentKey: 'pink',
  welcomeTitle: '· Pi',
  welcomeSubtitle: '/help · /clear · chat with Pi about anything',
  welcomeBullets: [
    'build a quick prototype for X',
    'fix this error trace',
    'what does this regex match?',
  ],
}

export const PROVIDER_COMPOSER: Record<AgentProvider, ProviderComposerConfig> = {
  claude: CLAUDE,
  codex: CODEX,
  opencode: OPENCODE,
  copilot: COPILOT,
  pi: PI,
}

export function getProviderComposer(provider: AgentProvider | undefined | null): ProviderComposerConfig {
  if (!provider) return CLAUDE
  return PROVIDER_COMPOSER[provider] ?? CLAUDE
}

/** Pick a rotating example based on a stable index (e.g. session id hash). */
export function pickProviderExample(provider: AgentProvider | undefined | null, seed: number): string {
  const config = getProviderComposer(provider)
  const examples = config.examples
  if (examples.length === 0) return config.placeholderIdle
  const idx = Math.abs(seed) % examples.length
  return examples[idx] ?? examples[0]!
}
