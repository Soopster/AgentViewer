// Stacked pull requests, read from branches: a pull request whose base is another
// open one's head sits on top of it. No Node imports.
import type { GithubStackLayer } from './types'

const MAX_LAYERS = 20

/**
 * The chain through `current`, bottom first. Upward it follows only an unambiguous
 * child; a branch two pull requests build on ends the chain there. Absent when the
 * pull request stands alone. A trunk is never a layer: a pull request whose head is
 * `main` (a back-merge) would otherwise sit under every other one.
 */
export function buildPrStack(open: readonly (GithubStackLayer & { crossRepository?: boolean })[], current: number, trunk?: string): GithubStackLayer[] | undefined {
  // A fork's branch name says nothing about branches in this repository.
  const local = open.filter(layer => !layer.crossRepository && layer.headRefName !== trunk)
  const start = open.find(layer => layer.number === current)
  if (!start) return undefined
  const chain = [start]
  const used = new Set([current])
  for (let base = start.baseRefName; chain.length < MAX_LAYERS && base !== trunk;) {
    const below = local.filter(layer => layer.headRefName === base && !used.has(layer.number))
    if (below.length !== 1) break
    chain.unshift(below[0]!)
    used.add(below[0]!.number)
    base = below[0]!.baseRefName
  }
  for (let head = start.crossRepository ? '' : start.headRefName; head && head !== trunk && chain.length < MAX_LAYERS;) {
    const above = open.filter(layer => layer.baseRefName === head && !used.has(layer.number))
    if (above.length !== 1) break
    chain.push(above[0]!)
    used.add(above[0]!.number)
    head = above[0]!.crossRepository ? '' : above[0]!.headRefName
  }
  return chain.length > 1 ? chain.map(({ number, title, url, isDraft, headRefName, baseRefName }) => ({ number, title, url, isDraft, headRefName, baseRefName })) : undefined
}

export function stackPosition(stack: readonly GithubStackLayer[] | undefined, number: number): { layer: number; of: number } | null {
  const at = stack?.findIndex(entry => entry.number === number) ?? -1
  return stack && at >= 0 ? { layer: at + 1, of: stack.length } : null
}
