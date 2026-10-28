/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTextAttributes, StyledText, treeSitterToTextChunks, type CliRenderer, type MouseEvent, type SyntaxStyle, type TextChunk } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import type { SelectableMarkdownProps } from './SelectableMarkdown'
import type { MarkdownBlock } from './markdownBlocks'
import { markdownTableWidths, type MarkdownCodeChunk, type MarkdownInlineSpan } from './markdownStructure'
import { prepareMarkdownCode } from './markdownCodeClient'
import { VirtualTranscriptRows } from './VirtualTranscriptRows'
import { useWindowSnapshot, useWindowVisible } from './windowActivity'
import './MarkdownTableSelection'
import type { MarkdownTableCell, MarkdownTableSelection } from './MarkdownTableSelection'

function inlineStyle(style: SyntaxStyle, scope: string) {
  return style.getStyle(scope) ?? style.getStyle(scope.split('.')[0]!) ?? style.getStyle('default')
}

function subscribeCapabilities(renderer: CliRenderer, listener: () => void): () => void {
  renderer.on('capabilities', listener)
  return () => { renderer.off('capabilities', listener) }
}
function inlineChunks(spans: readonly MarkdownInlineSpan[], style: SyntaxStyle, links: boolean, header = false): TextChunk[] {
  const heading = header ? inlineStyle(style, 'markup.heading') : undefined
  return spans.filter(span => !links || !span.fallback).map(span => {
    const selected = inlineStyle(style, span.scope)
    return { __isChunk: true, text: span.text,
      fg: heading?.fg ?? selected?.fg, bg: heading?.bg ?? selected?.bg,
      attributes: createTextAttributes(heading ?? selected ?? {}),
      link: span.url ? { url: span.url } : undefined }
  })
}

function CodeSlice({ chunk, ...props }: SelectableMarkdownProps & { chunk: MarkdownCodeChunk }) {
  const styled = useMemo(() => chunk.styled ? new StyledText(treeSitterToTextChunks(chunk.text, chunk.highlights ?? [], props.syntaxStyle, { enabled: false })) : chunk.text, [chunk, props.syntaxStyle])
  return <text content={styled}
    fg={props.fg} width={props.width} wrapMode="word" selectable {...props.selectionColors} />
}

export function MarkdownCode({ block, ...props }: SelectableMarkdownProps & { block: MarkdownBlock & { code: NonNullable<MarkdownBlock['code']> } }) {
  const visible = useWindowVisible()
  const [loaded, setLoaded] = useState<{ source: object; chunks: MarkdownCodeChunk[] | null } | null>(null)
  useEffect(() => {
    if (!visible || loaded?.source === block.code) return
    const abort = new AbortController()
    void prepareMarkdownCode(block.code.content, block.code.language, abort.signal).then(chunks => {
      if (!abort.signal.aborted) setLoaded({ source: block.code, chunks })
    }).catch(() => { if (!abort.signal.aborted) setLoaded({ source: block.code, chunks: null }) })
    return () => abort.abort()
  }, [visible, block.code, loaded])
  if (loaded?.source !== block.code) return <box id="transcript-block-loading" height={block.estimatedRows}><text fg={props.fg}>Loading…</text></box>
  if (!loaded.chunks) return <text content={block.code.content} fg={props.fg} width={props.width} wrapMode="word" selectable {...props.selectionColors} />
  return <VirtualTranscriptRows rows={loaded.chunks} threshold={0} rowKey={chunk => chunk.key}
    documentKey={`${props.documentKey}:${block.key}:code`} geometryKey={`code:${props.width}`}
    estimateHeight={chunk => Math.max(chunk.lines, Math.ceil(chunk.text.length / Math.max(1, props.width)))}
    renderRow={chunk => <CodeSlice {...props} chunk={chunk} />} />
}

export function MarkdownList({ block, renderBody, ...props }: SelectableMarkdownProps & {
  block: MarkdownBlock & { list: NonNullable<MarkdownBlock['list']> }
  renderBody: (content: string, width: number, key: string) => React.ReactNode
}) {
  const bodyWidth = props.width
  return <VirtualTranscriptRows rows={block.list.items} threshold={0} rowKey={item => item.key}
    documentKey={`${props.documentKey}:${block.key}:list`} geometryKey={`list:${props.width}`}
    estimateHeight={item => Math.max(1, Math.ceil(item.body.length / bodyWidth)) + item.marginBottom}
    renderRow={item => <box width={bodyWidth} marginBottom={item.marginBottom} flexDirection="column">{renderBody(item.body, bodyWidth, item.key)}</box>} />
}

export function MarkdownTable({ block, ...props }: SelectableMarkdownProps & { block: MarkdownBlock & { table: NonNullable<MarkdownBlock['table']> } }) {
  const renderer = useRenderer()
  const subscribe = useCallback((listener: () => void) => subscribeCapabilities(renderer, listener), [renderer])
  const snapshot = useCallback(() => renderer.capabilities?.hyperlinks === true, [renderer])
  const links = useWindowSnapshot(subscribe, snapshot)
  const columns = useMemo(() => markdownTableWidths(links ? block.table.linkedWidths : block.table.widths, props.width), [block.table, links, props.width])
  const width = columns.reduce((sum, value) => sum + value, columns.length + 1)
  const cells = useRef(new Map<string, MarkdownTableCell>())
  const selection = useRef<MarkdownTableSelection | null>(null)
  const beginSelection = (event: MouseEvent) => {
    const owner = selection.current
    if (event.button !== 0 || event.modifiers.ctrl || !owner?.shouldStartSelection(event.x, event.y)) return
    event.stopPropagation()
    event.preventDefault()
    renderer.startSelection(owner, event.x, event.y)
  }
  const border = (left: string, middle: string, right: string) => left + columns.map(value => '─'.repeat(value)).join(middle) + right
  const divider = (text: string) => <text content={text} fg={props.borderColor} height={1} wrapMode="none" selectable={false} />
  return <markdownTableSelection ref={selection} cells={cells.current} columns={columns} width={width} flexDirection="column"
    onMouseDown={beginSelection}><VirtualTranscriptRows rows={block.table.rows} threshold={0} rowKey={row => row.key}
    documentKey={`${props.documentKey}:${block.key}:table`} geometryKey={`table:${props.width}:${links}`}
    estimateHeight={row => Math.max(1, ...row.cells.map((cell, index) => Math.ceil((links ? cell.linkedWidth : cell.width) / columns[index]!))) + 1 + (row.last ? 1 : 0)}
    renderRow={(row, rowIndex) => <box flexDirection="column" width={width}>
      {divider(row.header ? border('┌', '┬', '┐') : border('├', '┼', '┤'))}
      <box flexDirection="row" width={width} border={['left']} borderColor={props.borderColor}>
        {row.cells.map((cell, index) => <box key={index} flexDirection="column" width={columns[index]! + 1} border={['right']} borderColor={props.borderColor}>
          <text ref={node => { const key = `${row.key}:${index}`; if (node) cells.current.set(key, { row: rowIndex, column: index, node }); else cells.current.delete(key) }}
            content={new StyledText(inlineChunks(cell.spans, props.syntaxStyle, links, row.header))} fg={props.fg}
            width={columns[index]} wrapMode="word" selectable={false} onMouseDown={beginSelection} {...props.selectionColors} />
        </box>)}
      </box>
      {row.last ? divider(border('└', '┴', '┘')) : null}
    </box>} /></markdownTableSelection>
}
