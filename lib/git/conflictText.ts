export type ConflictBlock = { start: number; end: number; ours: string; theirs: string; base: string | null }
export function conflictBlocks(content: string): ConflictBlock[] {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const blocks: ConflictBlock[] = []
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!, marker = /^(<{7,}) /.exec(line)
    if (!marker) { offset += line.length; continue }
    const width = marker[1]!.length, start = offset
    let baseAt = -1, separator = -1, end = -1
    for (let next = index + 1; next < lines.length; next++) {
      if (lines[next]!.startsWith('|'.repeat(width) + ' ')) baseAt = next
      if (lines[next]!.trimEnd() === '='.repeat(width)) separator = next
      if (lines[next]!.startsWith('>'.repeat(width) + ' ')) { end = next; break }
    }
    if (separator < 0 || end < 0) { offset += line.length; continue }
    const after = start + lines.slice(index, end + 1).join('').length
    blocks.push({ start, end: after, ours: lines.slice(index + 1, baseAt >= 0 ? baseAt : separator).join(''), base: baseAt >= 0 ? lines.slice(baseAt + 1, separator).join('') : null, theirs: lines.slice(separator + 1, end).join('') })
    index = end; offset = after
  }
  return blocks
}
export function chooseConflictBlock(content: string, index: number, choice: 'ours' | 'theirs' | 'both'): string {
  const block = conflictBlocks(content)[index]
  if (!block) return content
  return content.slice(0, block.start) + (choice === 'both' ? block.ours + block.theirs : block[choice]) + content.slice(block.end)
}
