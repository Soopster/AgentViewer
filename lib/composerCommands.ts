export function isNativeComposerCommandText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('/') || trimmed.startsWith('!')
}

export function commandResultExpectsTranscript(result: { transcriptExpected?: unknown }): boolean {
  return result.transcriptExpected !== false
}
