import { canUseWASM } from '@pierre/diffs'

// Choose before the first Diffs initialization in each runtime. Pools must use
// the same preference as standalone renderers; the first initialization wins.
export function preferredDiffHighlighter(): 'highlights' | 'shiki-js' {
  return canUseWASM() ? 'highlights' : 'shiki-js'
}
