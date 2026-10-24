import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'Copilot',
  glyph: '»',
  cssAccentVar: '--cyan',
  cssAccentRgb: '56,217,245',
  placeholderIdle: 'How can Copilot help with this repo?',
  placeholderStreaming: 'Type a follow-up — Enter steers this turn or queues it safely',
  placeholderNoSession: 'Pick a Copilot session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · ! shell · mode picker · ↑↓ history',
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ steer/queue follow-up',
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
