/**
 * Typing-burst undo.
 *
 * The terminal edit buffer records one undo step per character, so undoing a
 * line someone just typed took as many presses as the line had characters. No
 * editor an engineer would call finished behaves that way: vim unwinds the
 * whole insert, and VS Code coalesces a burst.
 *
 * The buffer exposes no grouping, so a run is detected from its effect instead:
 * each step of a typing run removes exactly one character from the same line,
 * moving the caret back by that character's width. The caret counts display
 * cells, so a CJK character, an emoji or a tab moves it two: an editor that
 * says how wide the character before the caret is (`cellsBeforeCaret`) gets
 * those coalesced too, and one that does not is held to a single column. The
 * test needs only the caret and that one character —
 * `logicalCursor` is O(1), where reading `plainText` to diff the text costs
 * about a millisecond per step on a large file, on a key that must feel
 * instant.
 *
 * Anything that is not that shape — a newline, a paste, a multi-cursor edit, a
 * formatting rewrite — moves the caret differently and ends the run, so it
 * stays a single undo step of its own.
 */

export type UndoableEditor = {
  undo: () => void
  readonly logicalCursor: { row: number; col: number }
  /** Cells taken by the character just before the caret; one when omitted. */
  cellsBeforeCaret?: () => number
}

/** Steps to unwind at most, so a pathological history cannot hang the key. */
export const MAX_UNDO_RUN_STEPS = 400

export type UndoRunResult = { steps: number; coalesced: boolean }

/**
 * Undo one step, then keep undoing while the history continues to look like the
 * same typing run. Returns how many steps were taken.
 */
export function undoTypingRun(editor: UndoableEditor, maxSteps = MAX_UNDO_RUN_STEPS): UndoRunResult {
  const cellsBeforeCaret = () => editor.cellsBeforeCaret?.() ?? 1
  let previous = editor.logicalCursor
  let width = cellsBeforeCaret()
  editor.undo()
  let current = editor.logicalCursor
  let steps = 1
  while (steps < maxSteps && continuesTypingRun(previous, current, width)) {
    previous = current
    width = cellsBeforeCaret()
    editor.undo()
    current = editor.logicalCursor
    // The caret stopped moving: there is nothing left to undo, and continuing
    // would spin against an empty history.
    if (current.row === previous.row && current.col === previous.col) break
    steps += 1
  }
  return { steps, coalesced: steps > 1 }
}

/**
 * Whether the caret moving from `previous` to `current` looks like one more
 * character of the same typed run coming off: same line, back by exactly the
 * width of the character that was before it. A caret that jumps, changes line,
 * or moves forward ends the run.
 */
export function continuesTypingRun(
  previous: { row: number; col: number },
  current: { row: number; col: number },
  cells = 1,
): boolean {
  return current.row === previous.row && cells > 0 && previous.col - current.col === cells
}
