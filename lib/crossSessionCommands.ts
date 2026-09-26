export type CrossSessionComposerCommand =
  | { kind: 'list' }
  | { kind: 'message'; target: string; text: string }

export function parseCrossSessionComposerCommand(value: string): CrossSessionComposerCommand | null {
  const trimmed = value.trim()
  if (/^\/sessions$/i.test(trimmed)) return { kind: 'list' }
  const match = trimmed.match(/^\/message(?:\s+(\S+))?(?:\s+([\s\S]+))?$/i)
  if (!match) return null
  return {
    kind: 'message',
    target: match[1]?.trim() ?? '',
    text: match[2]?.trim() ?? '',
  }
}
