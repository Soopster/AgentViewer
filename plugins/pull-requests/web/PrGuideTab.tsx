'use client'

// The review guide beside a pull request's diff: one stop at a time, in reading
// order, with the lines worth reading and a way to ask the agent about them.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildPrGuideQuestion, type PrGuide } from '@/lib/github/guide'

const MONO = "'IBM Plex Mono', monospace"

type Props = {
  cwd: string
  pr: { number: number; url: string; headRefOid: string }
  onAskAgent: (prompt: string) => void
  onOpenFile: (path: string, line: number) => void
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

export function PrGuideTab({ cwd, pr, onAskAgent, onOpenFile }: Props) {
  const [state, setState] = useState<{ number: number; guide: PrGuide | null; loaded: boolean }>({ number: pr.number, guide: null, loaded: false })
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState('')
  const [at, setAt] = useState(0)
  const current = state.number === pr.number ? state : { number: pr.number, guide: null, loaded: false }

  useEffect(() => {
    let live = true
    setProblem(''); setAt(0)
    const read = () => request<{ guide: PrGuide | null; writing: boolean }>(`/api/github/guide?cwd=${encodeURIComponent(cwd)}&number=${pr.number}`)
      .then(body => { if (!live) return; setState({ number: pr.number, guide: body.guide, loaded: true }); setWriting(body.writing) })
      .catch((error: Error) => { if (live) setProblem(error.message) })
    void read()
    return () => { live = false }
  }, [cwd, pr.number])

  // Someone else (or this tab before it was closed) is writing it: look again until it lands.
  useEffect(() => {
    if (!writing) return
    const timer = setInterval(() => {
      void request<{ guide: PrGuide | null; writing: boolean }>(`/api/github/guide?cwd=${encodeURIComponent(cwd)}&number=${pr.number}`)
        .then(body => { if (!body.writing) { setState({ number: pr.number, guide: body.guide, loaded: true }); setWriting(false) } }).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [writing, cwd, pr.number])

  const write = () => {
    setWriting(true); setProblem('')
    request<{ guide: PrGuide }>('/api/github/guide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, number: pr.number }) })
      .then(body => { setState({ number: pr.number, guide: body.guide, loaded: true }); setAt(0); setWriting(false) })
      .catch((error: Error) => { setProblem(error.message); setWriting(false) })
  }

  const guide = current.guide
  const stop = guide?.stops[Math.min(at, guide.stops.length - 1)]
  const stale = !!guide && !!pr.headRefOid && guide.headOid !== pr.headRefOid
  return (
    <div data-pr-guide style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 18, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {problem ? <div role="alert" style={{ color: 'var(--red)', fontFamily: MONO, fontSize: 12 }}>{problem}</div> : null}
        {!guide ? (
          <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7 }}>
            <p>A guide is a tour of this pull request in reading order: the parts worth reading, and where a judgement is needed. Mechanical changes are grouped at the end.</p>
            <p style={{ color: 'var(--text-3)' }}>A Claude model writes it from the diff, with no tools. It uses model credits, and takes a few minutes on a large change.</p>
            <Button size="sm" onClick={write} disabled={writing || !current.loaded}>{writing ? 'Writing guide…' : 'Write guide'}</Button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>
              <span>written by {guide.model}</span>
              {stale ? <span style={{ color: 'var(--yellow)' }}>· the pull request has changed since — excerpts may no longer match</span> : null}
              <span style={{ flex: 1 }} />
              <Button size="sm" variant={stale ? 'secondary' : 'ghost'} onClick={write} disabled={writing}>{writing ? 'Writing…' : 'Rewrite guide'}</Button>
            </div>
            {guide.summary ? <p style={{ margin: 0, color: 'var(--text)', fontSize: 14, lineHeight: 1.7 }}>{guide.summary}</p> : null}
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {guide.stops.map((entry, index) => (
                <li key={index}>
                  <button type="button" onClick={() => setAt(index)} aria-current={entry === stop ? 'step' : undefined} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 12, border: `1px solid ${entry === stop ? 'var(--cyan)' : 'var(--border-2)'}`, background: 'var(--surface-2)', color: entry === stop ? 'var(--text)' : 'var(--text-2)' }}>
                    {entry.lookClosely ? <TriangleAlert size={11} style={{ color: 'var(--yellow)' }} aria-label="Look closely" /> : null}{index + 1}. {entry.title}
                  </button>
                </li>
              ))}
            </ol>
            {stop ? (
              <section style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)' }}>{stop.title}</h3>
                {stop.lookClosely ? <div style={{ color: 'var(--yellow)', fontFamily: MONO, fontSize: 11 }}>Look closely</div> : null}
                <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.7 }}>{stop.why}</p>
                {stop.excerpts.map((excerpt, index) => (
                  <figure key={index} style={{ margin: 0, border: '1px solid var(--border-2)', borderRadius: 6, overflow: 'hidden' }}>
                    <figcaption>
                      <button type="button" onClick={() => onOpenFile(excerpt.path, excerpt.startLine)} title="Open in Files changed" style={{ width: '100%', textAlign: 'left', padding: '5px 10px', border: 0, cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--text-2)', fontFamily: MONO, fontSize: 11.5 }}>
                        {excerpt.path} · {excerpt.startLine}–{excerpt.endLine}
                      </button>
                    </figcaption>
                    <pre style={{ margin: 0, padding: '6px 0', overflow: 'auto', fontFamily: MONO, fontSize: 12, lineHeight: 1.55 }}>
                      {excerpt.lines.map((line, row) => (
                        <div key={row} style={{ padding: '0 10px', whiteSpace: 'pre', color: 'var(--text)', background: line.startsWith('+') ? 'color-mix(in srgb, var(--green) 12%, transparent)' : line.startsWith('-') ? 'color-mix(in srgb, var(--red) 12%, transparent)' : undefined }}>{line || ' '}</div>
                      ))}
                    </pre>
                  </figure>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="ghost" disabled={at <= 0} onClick={() => setAt(at - 1)}><ChevronLeft size={14} />Back</Button>
                  <Button size="sm" variant="ghost" disabled={at >= guide.stops.length - 1} onClick={() => setAt(at + 1)}>Next<ChevronRight size={14} /></Button>
                  <span style={{ flex: 1 }} />
                  <Button size="sm" variant="secondary" onClick={() => onAskAgent(buildPrGuideQuestion(pr, stop))}>{stop.question ? `Ask: ${stop.question.length > 70 ? `${stop.question.slice(0, 69)}…` : stop.question}` : 'Ask about this stop'}</Button>
                </div>
              </section>
            ) : null}
            {([['Mechanical changes', guide.mechanical], ['Changed, not on the tour', guide.uncovered], ['Too large for the guide to read', guide.unread]] as const).map(([label, files]) => files.length ? (
              <div key={label} style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--text-3)' }}>
                <div style={{ color: 'var(--text-2)' }}>{label} ({files.length})</div>
                {files.map(file => <div key={file}><button type="button" onClick={() => onOpenFile(file, 1)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}>{file}</button></div>)}
              </div>
            ) : null)}
          </>
        )}
      </div>
    </div>
  )
}
