export function isNativeComposerCommandText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('/') || trimmed.startsWith('!')
}
