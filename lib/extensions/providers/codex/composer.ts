import type { ProviderComposerConfig } from '../../../providerComposer'

export const composer: ProviderComposerConfig = {
  label: 'Codex',
  glyph: '›',
  cssAccentVar: '--green',
  cssAccentRgb: '45,212,160',
  // Mirror codex-rs PLACEHOLDERS[0] so the empty composer reads the same as the CLI.
  placeholderIdle: 'Explain this codebase',
  placeholderStreaming: 'Type a follow-up — Enter steers this turn or queues it safely',
  placeholderNoSession: 'Pick a Codex thread to send a message',
  // Match the bindings implemented by this composer: `/` for commands, `@` for file paths,
  // and Shift+Enter for newline.
  footerHintIdle: '⏎ send · ⇧⏎ newline · / commands · ! shell · @ files',
  footerHintSending: 'Esc view transcript · ⌃C cancel · ⏎ steer/queue follow-up',
  sendVerb: 'Send',
  // Verbatim from codex-rs chatwidget.rs PLACEHOLDERS so rotating examples match what Codex shows.
  examples: [
    'Explain this codebase',
    'Summarize recent commits',
    'Implement {feature}',
    'Find and fix a bug in @filename',
    'Write tests for @filename',
    'Improve documentation in @filename',
    'Run /review on my current changes',
    'Use /skills to list available skills',
  ],
  tuiAccentKey: 'green',
  // Codex's onboarding banner: "Welcome to Codex, OpenAI's command-line coding agent".
  welcomeTitle: 'Welcome to Codex',
  welcomeSubtitle: "OpenAI's command-line coding agent · /status · /diff · /review",
  welcomeBullets: [
    'Explain this codebase',
    'Summarize recent commits',
    'Run /review on my current changes',
  ],
}
