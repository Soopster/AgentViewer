// beautiful-mermaid is loaded on demand, not at import (load-bearing for
// memory). It costs ~21MB of RSS to evaluate, this module is imported by both
// TUIs *and* by the threading worker — a Bun Worker re-imports its graph into
// its own VM, so the eager import was paying that price two or three times
// over — and a transcript containing a Mermaid fence is rare. Callers that are
// about to format a transcript containing one await ensureTuiMermaidRenderer()
// first; formatting stays synchronous.
type MermaidRenderer = typeof import('beautiful-mermaid').renderMermaidASCII

let mermaidRenderer: MermaidRenderer | null = null

let mermaidLoad: Promise<void> | null = null

/** True when the text contains a fence this module would hand to Mermaid, so a
 *  caller can skip the load for the overwhelming majority of transcripts. */
export function textNeedsTuiMermaid(text: string): boolean {
  return MERMAID_FENCE_HINT.test(text)
}

/** Loads the Mermaid renderer if it isn't loaded yet. Safe to call
 *  concurrently and on every format; it is a no-op once resolved. A failure to
 *  load is swallowed — renderMermaidForTui already degrades to showing the
 *  diagram source, which is what a render failure has always produced. */
export async function ensureTuiMermaidRenderer(): Promise<void> {
  if (mermaidRenderer) return
  mermaidLoad ??= import('beautiful-mermaid')
    .then((mod) => { mermaidRenderer = mod.renderMermaidASCII })
    .catch(() => { /* fall through to the source-only rendering below */ })
  await mermaidLoad
}

export const MERMAID_LANGS = new Set(['mermaid', 'mmd'])

const MERMAID_FENCE_HINT = /^```(?:mermaid|mmd)\b/im

export function renderMermaidForTui(content: string): string {
  // Not loaded means no caller ran ensureTuiMermaidRenderer(). Show the source
  // fence alone rather than a "render failed" banner — nothing failed, the
  // diagram just isn't drawable in this pass.
  if (!mermaidRenderer) return ['```mermaid', content, '```'].join('\n')
  try {
    const rendered = mermaidRenderer(content, {
      colorMode: 'none',
      useAscii: false,
      paddingX: 3,
      paddingY: 2,
      boxBorderPadding: 1,
    })
    return [
      '[diagram: mermaid]',
      rendered,
      '[source: mermaid]',
      '```mermaid',
      content,
      '```',
    ].join('\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to render Mermaid diagram.'
    return [
      `[diagram: mermaid render failed: ${message}]`,
      '```mermaid',
      content,
      '```',
    ].join('\n')
  }
}
