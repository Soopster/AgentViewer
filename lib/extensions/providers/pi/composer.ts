import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'Pi',
  glyph: '·',
  cssAccentVar: '--red',
  cssAccentRgb: '244,114,182',
  placeholderIdle: 'What\'s on your mind? — Pi will write and run code with you. `!cmd` runs bash.',
  placeholderStreaming: 'Type a follow-up — Enter steers this turn or queues it safely',
  placeholderNoSession: 'Pick a Pi session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · ! bash · !! bash (no context) · / commands · ↑↓ history',
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ steer/queue follow-up',
  sendVerb: 'Send',
  examples: [
    'Try "build a quick prototype for X"',
    'Try "fix this error trace"',
    'Try "what does this regex match?"',
  ],
  tuiAccentKey: 'pink',
  welcomeTitle: '· Pi',
  welcomeSubtitle: '! to run a shell command · / for commands · drop files to attach',
  welcomeBullets: [
    'build a quick prototype for X',
    'fix this error trace',
    'what does this regex match?',
  ],
}
