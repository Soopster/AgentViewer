/** Build an index patch from raw diff row identities, preserving unselected content. */
export function partialPatch(patch: string, selected: number[], reverse: boolean): string {
  if (/^diff --git /gm.test(patch) === false || (patch.match(/^diff --git /gm)?.length ?? 0) !== 1
    || /^(?:GIT binary patch|Binary files |rename from |copy from |old mode |new mode |(?:new file mode|deleted file mode) 120000)/m.test(patch)) {
    throw new Error('Use the whole-file action for binary, renamed, copied, or mode-only changes.')
  }
  const lines = patch.replace(/\n$/, '').split('\n')
  const first = lines.findIndex(line => line.startsWith('@@ '))
  if (first < 0) throw new Error('This diff has no selectable text changes.')
  const chosen = new Set(selected)
  let offset = 0, changed = false
  const hunks: string[] = []
  for (let start = first; start < lines.length;) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[start]!)
    if (!match) throw new Error('Invalid diff hunk')
    let end = start + 1
    while (end < lines.length && !lines[end]!.startsWith('@@ ')) end++
    const body: string[] = []
    let oldCount = 0, newCount = 0, hunkChanged = false, previousIncluded = false
    for (let i = start + 1; i < end; i++) {
      const line = lines[i]!
      if (line.startsWith('\\')) { if (previousIncluded) body.push(line); continue }
      const mark = reverse ? line[0] === '+' ? '-' : line[0] === '-' ? '+' : line[0] : line[0]
      if (mark !== '+' && mark !== '-' && mark !== ' ') throw new Error('Invalid diff line')
      const take = chosen.has(i) && mark !== ' '
      previousIncluded = mark !== '+' || take
      if (!previousIncluded) continue
      const out = take ? mark : ' '
      body.push(out + line.slice(1))
      if (out !== '+') oldCount++
      if (out !== '-') newCount++
      if (take) hunkChanged = true
    }
    const sourceStart = Number(reverse ? match[3] : match[1])
    const sourceCount = Number((reverse ? match[4] : match[2]) ?? 1)
    const oldStart = oldCount === 0 ? sourceStart : sourceCount === 0 ? sourceStart + 1 : sourceStart
    const targetStart = oldCount === 0 ? sourceStart + offset + 1 : newCount === 0 ? oldStart + offset - 1 : oldStart + offset
    if (hunkChanged) {
      hunks.push(`@@ -${oldStart},${oldCount} +${targetStart},${newCount} @@${match[5]}\n${body.join('\n')}\n`)
      changed = true
    }
    offset += newCount - oldCount
    start = end
  }
  if (!changed) throw new Error('Select changed lines or a hunk first.')
  const oldHeader = lines.find(line => line.startsWith('--- '))!
  const newHeader = lines.find(line => line.startsWith('+++ '))!
  if (!oldHeader || !newHeader) throw new Error('Invalid file headers')
  let from = reverse ? '--- ' + newHeader.slice(4).replace(/^b\//, 'a/') : oldHeader
  let to = reverse ? '+++ ' + oldHeader.slice(4).replace(/^a\//, 'b/') : newHeader
  // A partially deleted file still exists in the resulting index.
  const remaining = hunks.some(hunk => /^ /m.test(hunk))
  if (to === '+++ /dev/null' && remaining) to = '+++ ' + from.slice(4).replace(/^a\//, 'b/')
  // git apply recognizes a new file from /dev/null, without index/mode hints.
  const mode = from === '--- /dev/null' ? lines.find(line => /^(new file mode|deleted file mode) /.test(line))?.replace('deleted file mode', 'new file mode') : undefined
  return `${lines[0]}\n${mode ? mode + '\n' : ''}${from}\n${to}\n${hunks.join('')}`
}
