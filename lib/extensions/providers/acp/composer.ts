import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'ACP agent',
  glyph: '>',
  cssAccentVar: '--green',
  cssAccentRgb: '52,211,153',
  placeholderIdle: 'Message your ACP agent.',
  placeholderStreaming: 'Type a follow-up — Enter queues it behind this turn',
  placeholderNoSession: 'Pick an ACP session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · ↑↓ history',
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ queue follow-up',
  sendVerb: 'Send',
  examples: [
    'Try "summarise this repository"',
    'Try "explain this error message"',
  ],
  tuiAccentKey: 'green',
  welcomeTitle: '> ACP agent',
  welcomeSubtitle: 'Any agent that speaks the Agent Client Protocol · set AGENT_VIEWER_ACP_COMMAND',
  welcomeBullets: [
    'summarise this repository',
    'explain this error message',
  ],
}
