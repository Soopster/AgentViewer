'use client'
import { useEffect, useMemo, useState } from 'react'
import { THEME_META, type Theme } from '@/lib/themes'
import { ansiHighlighterReady, ansiRuns, hasAnsiStyle, loadAnsiHighlighter, stripAnsi } from '@/lib/ansiOutput'

function currentAppearance(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  const theme = document.documentElement.dataset.theme as Theme | undefined
  return theme && THEME_META[theme]?.category === 'light' ? 'light' : 'dark'
}

/** Terminal output as text. Plain output passes through untouched; output with
 * colour codes is drawn in its colours once Highlights has loaded, and with the
 * escapes removed until then (or if it never loads). Render it inside a `<pre>`. */
export function AnsiText({ text }: { text: string }) {
  const styled = hasAnsiStyle(text)
  const [ready, setReady] = useState(ansiHighlighterReady)
  useEffect(() => {
    if (!styled || ready) return
    let live = true
    void loadAnsiHighlighter().then(ok => { if (live && ok) setReady(true) })
    return () => { live = false }
  }, [styled, ready])

  const lines = useMemo(
    () => (styled && ready ? ansiRuns(text, currentAppearance()) : null),
    [styled, ready, text],
  )
  if (!styled) return <>{text}</>
  if (!lines) return <>{stripAnsi(text)}</>
  return (
    <>
      {lines.map((line, row) => (
        <span key={row}>
          {line.map((run, index) => {
            if (!run.color && !run.background && !run.bold && !run.italic && !run.underline && !run.strike) return run.text
            return (
              <span
                key={index}
                style={{
                  color: run.color,
                  backgroundColor: run.background,
                  fontWeight: run.bold ? 600 : undefined,
                  fontStyle: run.italic ? 'italic' : undefined,
                  textDecoration: run.underline || run.strike
                    ? `${run.underline ? 'underline' : ''} ${run.strike ? 'line-through' : ''}`.trim()
                    : undefined,
                }}
              >
                {run.text}
              </span>
            )
          })}
          {row < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </>
  )
}
