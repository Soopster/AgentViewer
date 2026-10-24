import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'Claude',
  glyph: '>',
  cssAccentVar: '--violet',
  cssAccentRgb: '139,128,240',
  placeholderIdle: 'Try "fix the failing test" — Claude can read, edit, run, and explain code.',
  placeholderStreaming: 'Type a follow-up — Enter steers this turn or queues it safely',
  placeholderNoSession: 'Pick a Claude session to send a message',
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · @ files · ! bash · ↑↓ history',
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ steer/queue follow-up',
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
