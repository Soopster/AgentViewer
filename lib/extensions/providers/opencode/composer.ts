import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'opencode',
  glyph: '❯',
  cssAccentVar: '--amber',
  cssAccentRgb: '234,170,64',
  placeholderIdle: 'Ask anything — opencode will plan, edit, and run. `!cmd` runs shell.',
  placeholderStreaming: 'Type a follow-up — Enter steers this turn or queues it safely',
  placeholderNoSession: 'Pick an opencode session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · ! shell · @ files/agents · ↑↓ history',
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ steer/queue follow-up',
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
