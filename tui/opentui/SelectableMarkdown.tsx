/** @jsxImportSource @opentui/react */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MarkdownRenderable, SyntaxStyle } from '@opentui/core'
import { useWindowVisible } from './windowActivity'
import { TranscriptViewportContext, VirtualTranscriptRows } from './VirtualTranscriptRows'
import { parseMarkdownBlocksAsync } from './markdownBlocksWorkerClient'
import type { MarkdownBlock } from './markdownBlocks'
import { applySelectionColorsToTree, type SelectionColors } from './selectionTree'
import { MarkdownCode, MarkdownList, MarkdownTable } from './StructuredMarkdown'

export type SelectableMarkdownProps = {
  content: string
  documentKey?: string
  syntaxStyle: SyntaxStyle
  fg: string
  width: number
  selectionColors: SelectionColors
  borderColor: string
}

export function NativeSelectableMarkdown({
  content,
  syntaxStyle,
  fg,
  width,
  selectionColors,
  borderColor,
}: SelectableMarkdownProps) {
  const markdownRef = useRef<MarkdownRenderable | null>(null)

  useLayoutEffect(() => {
    applySelectionColorsToTree(markdownRef.current, selectionColors)
  }, [content, syntaxStyle, selectionColors.selectionBg, selectionColors.selectionFg])

  return (
    <markdown
      ref={markdownRef}
      content={content}
      syntaxStyle={syntaxStyle}
      fg={fg}
      streaming={false}
      width={width}
      tableOptions={{ widthMode: 'content', borders: true, borderColor, selectable: true }}
    />
  )
}

// Large documents are tokenized off-thread and virtualized within a card.
// Short prose keeps the existing one-text/native Markdown path.
export function SelectableMarkdown(props: SelectableMarkdownProps) {
  const visible = useWindowVisible()
  const [parsed, setParsed] = useState<{ source: string; blocks: MarkdownBlock[] } | null>(null)
  const large = props.content.length > 16_384
  const viewport = React.useContext(TranscriptViewportContext)
  useEffect(() => {
    if (!large || !visible || !viewport || parsed?.source === props.content) return
    let cancelled = false
    const abort = new AbortController()
    void parseMarkdownBlocksAsync(props.content, abort.signal).then(blocks => {
      if (!cancelled) setParsed({ source: props.content, blocks })
    }).catch(() => { if (!cancelled) setParsed({ source: props.content, blocks: [] }) })
    return () => { cancelled = true; abort.abort() }
  }, [large, visible, viewport, props.content, parsed])
  if (!large || !viewport || parsed?.source === props.content && parsed.blocks.length < 2 && !parsed.blocks.some(block => block.code || block.list || block.table)) return <NativeSelectableMarkdown {...props} />
  if (parsed?.source !== props.content) return <box id="transcript-block-loading" height={Math.max(1, Math.ceil(props.content.length / Math.max(props.width, 20)))}><text fg={props.fg}>Loading…</text></box>
  return <VirtualTranscriptRows rows={parsed.blocks} threshold={1} rowKey={block => block.key}
    documentKey={props.documentKey} geometryKey={`markdown:${props.width}`} estimateHeight={block => Math.max(block.estimatedRows, Math.ceil(block.content.length / Math.max(props.width, 20))) + block.marginBottom}
    renderRow={block => <box key={block.key} marginBottom={block.marginBottom} flexDirection="column"><MarkdownBlockBody {...props} block={block} /></box>} />
}

/** Exported so parity fixtures can force structured paths on small samples. */
export function MarkdownBlockBody({ block, ...props }: SelectableMarkdownProps & { block: MarkdownBlock }) {
  if (block.code) return <MarkdownCode {...props} block={{ ...block, code: block.code }} />
  if (block.list) return <MarkdownList {...props} block={{ ...block, list: block.list }} renderBody={(content, width, key) =>
    <SelectableMarkdown {...props} content={content} width={width} documentKey={`${props.documentKey}:${key}`} />} />
  if (block.table) return <MarkdownTable {...props} block={{ ...block, table: block.table }} />
  return <NativeSelectableMarkdown {...props} content={block.content} />
}

