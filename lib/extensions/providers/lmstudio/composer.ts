import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'LM Studio',
  glyph: '$',
  cssAccentVar: '--red',
  cssAccentRgb: '244,114,182',
  placeholderIdle: 'Ask your local model anything — served by LM Studio.',
  placeholderStreaming: 'Type a follow-up — Enter steers this turn or queues it safely',
  placeholderNoSession: 'Pick an LM Studio session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · ↑↓ history',
  // LM Studio has no steer primitive, so Enter falls through to the queue —
  // but the affordance is the same one every other provider advertises, and
  // placeholderStreaming above already promises it.
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ steer/queue follow-up',
  sendVerb: 'Send',
  examples: [
    'Try "summarise this file"',
    'Try "explain this error message"',
    'Try "write a haiku about debugging"',
  ],
  tuiAccentKey: 'red',
  welcomeTitle: '$ LM Studio',
  welcomeSubtitle: 'Local models via LM Studio\'s server · set LMSTUDIO_BASE_URL to change host',
  welcomeBullets: [
    'summarise this file',
    'explain this error message',
    'write a haiku about debugging',
  ],
}
