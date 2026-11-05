// One LiveTokenizer per open editor buffer, off the render thread.
//
// Edits are applied in the order they arrive, so every response describes the
// document as of `state.seq`, and the facade drops anything older than the edit
// it last sent. `renderRange` keeps the synchronous part of an edit to the rows
// on screen; the tokenizer delivers the rest through `onDeferTokenize`.
import { LiveTokenizer, isSupportedLanguage } from '@pierre/highlights'
import type { HighlightedToken } from '@pierre/highlights'
import {
  editorHighlightGroup,
  type EditorHighlightLine,
  type EditorHighlightRange,
  type EditorHighlightRequest,
  type EditorHighlightResponse,
} from './editorHighlightProtocol'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<EditorHighlightRequest>) => void
  postMessage: (response: EditorHighlightResponse) => void
}

const SCOPE_THEME = { name: 'Agent Viewer scopes', appearance: 'dark', cssVariables: true, style: {} } as const
const SNAPSHOT_CHUNK_LINES = 2_000

type State = {
  tokenizer: LiveTokenizer | null
  generation: number
  seq: number
  initial: boolean
  // First line of a tail resend still in progress; a newer edit restarts it
  // from the earlier of the two starts, because lines above an edit never move.
  tailFrom: number | null
  tailTimer: ReturnType<typeof setTimeout> | null
}
const states = new Map<number, State>()

function disposeState(id: number) {
  const state = states.get(id)
  if (state?.tailTimer != null) clearTimeout(state.tailTimer)
  state?.tokenizer?.dispose()
  states.delete(id)
}

function captures(tokens: readonly HighlightedToken[]): EditorHighlightLine[1] {
  const out: [number, number, string][] = []
  for (const [start, color, text] of tokens) {
    const group = editorHighlightGroup(color)
    if (group && text.length > 0) out.push([start, start + text.length, group])
  }
  return out
}

function linesOf(map: Map<number, HighlightedToken[]>): EditorHighlightLine[] {
  const lines: EditorHighlightLine[] = []
  for (const [line, tokens] of map) lines.push([line, captures(tokens)])
  return lines
}

function clampRange(tokenizer: LiveTokenizer, [start, end]: EditorHighlightRange): EditorHighlightRange {
  const last = tokenizer.lineCount
  return [Math.max(0, Math.min(start, last)), Math.max(0, Math.min(end, last))]
}

function post(id: number, state: State, lines: EditorHighlightLine[]) {
  scope.postMessage({ type: 'lines', id, generation: state.generation, seq: state.seq, initial: state.initial, lines })
  state.initial = false
}

function readLines(tokenizer: LiveTokenizer, start: number, end: number): EditorHighlightLine[] {
  const lines: EditorHighlightLine[] = []
  for (let line = start; line < end; line += 1) lines.push([line, captures(tokenizerTokens(tokenizer, line))])
  return lines
}

/** The editor's native highlights are keyed by row and do not move when rows
 * are inserted or removed, so every row below a line-count change must be sent
 * again: the visible part now, the rest in slices so no message carries the
 * file. A line the tokenizer has not finished keeps its previous tokens and is
 * sent again when it completes. */
function resendTail(id: number, state: State, tokenizer: LiveTokenizer, from: number, viewportEnd: number) {
  if (state.tailTimer != null) clearTimeout(state.tailTimer)
  const start = state.tailFrom == null ? from : Math.min(state.tailFrom, from)
  state.tailFrom = start
  const total = tokenizer.lineCount
  const visibleEnd = Math.max(start, Math.min(total, viewportEnd))
  post(id, state, readLines(tokenizer, start, visibleEnd))
  let next = visibleEnd
  const step = () => {
    state.tailTimer = null
    if (states.get(id) !== state || state.tokenizer !== tokenizer) return
    if (next >= tokenizer.lineCount) { state.tailFrom = null; return }
    const end = Math.min(tokenizer.lineCount, next + SNAPSHOT_CHUNK_LINES)
    post(id, state, readLines(tokenizer, next, end))
    next = end
    state.tailTimer = setTimeout(step, 0)
  }
  state.tailTimer = setTimeout(step, 0)
}

function open(request: Extract<EditorHighlightRequest, { type: 'open' }>) {
  const { id, generation, language, code } = request
  disposeState(id)
  if (!isSupportedLanguage(language)) {
    states.delete(id)
    scope.postMessage({ type: 'unsupported', id, generation })
    return
  }
  const state: State = { tokenizer: null, generation, seq: 0, initial: true, tailFrom: null, tailTimer: null }
  states.set(id, state)
  // The constructor may deliver deferred lines before it returns, so the
  // callback must only use what it is handed, never `state.tokenizer`.
  const tokenizer = new LiveTokenizer({
    lang: language,
    theme: SCOPE_THEME,
    code,
    renderRange: request.range,
    onDeferTokenize: map => {
      if (states.get(id) === state) post(id, state, linesOf(map))
    },
  })
  state.tokenizer = tokenizer
  // The constructor's synchronous lines are not returned, so the initial
  // response reads the rendered range from the tokenizer's own records.
  const [start, end] = clampRange(tokenizer, request.range)
  post(id, state, readLines(tokenizer, start, end))
}

function tokenizerTokens(tokenizer: LiveTokenizer, line: number): HighlightedToken[] {
  const out: HighlightedToken[] = []
  for (const token of tokenizer.getLineTokens(line).tokens) {
    out.push([token.offset, token.color ?? '', token.content])
  }
  return out
}

function edit(request: Extract<EditorHighlightRequest, { type: 'edit' }>) {
  const state = states.get(request.id)
  const tokenizer = state?.tokenizer
  if (!state || !tokenizer || state.generation !== request.generation) return
  const { edit: change } = request
  const update = tokenizer.applyEdits(
    [{
      range: {
        start: { line: change.startLine, character: change.startCharacter },
        end: { line: change.endLine, character: change.endCharacter },
      },
      newText: change.newText,
    }],
    { renderRange: clampRange(tokenizer, request.range) },
  )
  state.seq = request.seq
  const lines = linesOf(update.lines)
  if (update.lineCount !== update.previousLineCount || state.tailFrom != null) {
    const first = update.lineChanges.reduce((low, change) => Math.min(low, change.newStartLine), Number.POSITIVE_INFINITY)
    if (Number.isFinite(first)) {
      resendTail(request.id, state, tokenizer, first, request.range[1])
      return
    }
  }
  // Always acknowledged, even with no lines: the facade waits for the response
  // carrying its newest seq before it trusts what it has painted.
  post(request.id, state, lines)
}

function snapshot(request: Extract<EditorHighlightRequest, { type: 'snapshot' }>) {
  const state = states.get(request.id)
  const tokenizer = state?.tokenizer
  if (!state || !tokenizer || state.generation !== request.generation) return
  const total = tokenizer.lineCount
  const [first, last] = clampRange(tokenizer, request.range)
  const send = (start: number, end: number) => {
    post(request.id, state, readLines(tokenizer, start, end))
  }
  send(first, last)
  // The rest of the document follows in slices so one message never carries the
  // whole file; each slice re-checks that this tokenizer is still current.
  const pending: [number, number][] = []
  for (let start = 0; start < first; start += SNAPSHOT_CHUNK_LINES) pending.push([start, Math.min(first, start + SNAPSHOT_CHUNK_LINES)])
  for (let start = last; start < total; start += SNAPSHOT_CHUNK_LINES) pending.push([start, Math.min(total, start + SNAPSHOT_CHUNK_LINES)])
  const rest = () => {
    if (states.get(request.id) !== state || state.tokenizer !== tokenizer) return
    const slice = pending.shift()
    if (!slice) return
    send(slice[0], slice[1])
    setTimeout(rest, 0)
  }
  setTimeout(rest, 0)
}

scope.onmessage = ({ data }) => {
  try {
    if (data.type === 'open') open(data)
    else if (data.type === 'edit') edit(data)
    else if (data.type === 'snapshot') snapshot(data)
    else {
      disposeState(data.id)
    }
  } catch (error) {
    const id = 'id' in data ? data.id : 0
    const generation = 'generation' in data ? data.generation : 0
    disposeState(id)
    scope.postMessage({ type: 'error', id, generation, message: String(error) })
  }
}
