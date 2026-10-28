/** Count newline-delimited lines, including an empty trailing line, stopping
 * once the positive integer cap is reached. Useful for collapsed previews.
 */
export function countLinesUpTo(text: string, cap: number): number {
  let lines = 1
  let offset = 0
  while (lines < cap) {
    const newline = text.indexOf('\n', offset)
    if (newline < 0) break
    lines++
    offset = newline + 1
  }
  return lines
}
