// A remark plugin that links the references agents write in prose: `#12`,
// `owner/repo#12` and a commit hash. Only plain text is touched — never code, an
// authored link or a heading anchor — and only when the checkout's repository is
// known, since `#12` means nothing without it. No Node imports.
import type { GithubRepoRef } from './types'

type Node = { type: string; value?: string; url?: string; children?: Node[] }

// `owner/repo#12`, `#12`, or a 7-40 hex hash that holds both a letter and a digit
// (so words like "deadbeef" and numbers like "1234567" stay text).
const REFERENCE = /(?<![\w/.#&-])(?:([A-Za-z0-9][\w.-]*\/[\w.-]+)#([1-9]\d{0,6})|#([1-9]\d{0,6})|((?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}))(?![\w#-]|\.\w)/g
const SKIPPED = new Set(['link', 'linkReference', 'inlineCode', 'code', 'html', 'definition', 'image', 'imageReference'])

export type GithubReferencePart = string | { text: string; url: string }

export function splitGithubReferences(text: string, current: GithubRepoRef): GithubReferencePart[] {
  const parts: GithubReferencePart[] = []
  let end = 0
  for (const match of text.matchAll(REFERENCE)) {
    const [whole, otherRepo, otherNumber, number, sha] = match
    const base = `https://${current.host}/${otherRepo ?? current.repo}`
    // GitHub redirects /issues/n to the pull request when n is one, so one form serves both.
    const url = sha ? `${base}/commit/${sha}` : `${base}/issues/${otherNumber ?? number}`
    if (match.index > end) parts.push(text.slice(end, match.index))
    parts.push({ text: sha ? sha.slice(0, 7) : whole, url })
    end = match.index + whole.length
  }
  if (!parts.length) return [text]
  if (end < text.length) parts.push(text.slice(end))
  return parts
}

function walk(node: Node, current: GithubRepoRef): void {
  if (!node.children) return
  const next: Node[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value && /#\d|[0-9a-f]{7}/.test(child.value)) {
      for (const part of splitGithubReferences(child.value, current)) {
        next.push(typeof part === 'string' ? { type: 'text', value: part } : { type: 'link', url: part.url, children: [{ type: 'text', value: part.text }] })
      }
      continue
    }
    if (!SKIPPED.has(child.type)) walk(child, current)
    next.push(child)
  }
  node.children = next
}

export function remarkGithubReferences(current: GithubRepoRef) {
  return () => (tree: Node) => walk(tree, current)
}
