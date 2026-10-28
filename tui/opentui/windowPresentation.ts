/** Temporary presentation, addressed by identity rather than a layout slot. */
export type WindowPresentation = { mode: 'zoom' | 'fullscreen'; target: string }
export function presentationIndex(target: string | undefined, keys: readonly string[], floatingKey: string | null, readerKey: string | null, floatingIndex: number): number | 'reader' | null {
  if (!target) return null
  if (target === floatingKey) return floatingIndex
  if (target === readerKey) return 'reader'
  const index = keys.indexOf(target)
  return index < 0 ? null : index
}
