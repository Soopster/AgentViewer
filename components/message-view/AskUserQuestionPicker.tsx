'use client'
import { useState, useSyncExternalStore } from 'react'
import { type ColorTreatment, subscribeColorTreatment, getCurrentColorTreatment, DEFAULT_COLOR_TREATMENT } from '../../lib/colorTreatment'
import { type PendingPermission, type PendingQuestionAnswers, initialQuestionState } from '../../lib/permissions'
import { getAssistantDisplayName } from '../../lib/provider'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export function AskUserQuestionPicker({
  permission, busy, onSubmit, onCancel,
}: {
  permission: PendingPermission
  busy: boolean
  onSubmit: (answers: PendingQuestionAnswers) => void
  onCancel: () => void
}) {
  const questions = permission.questions ?? []
  const [selections, setSelections] = useState(() => initialQuestionState(questions).selections)
  const [freeformAnswers, setFreeformAnswers] = useState(() => initialQuestionState(questions).freeformAnswers)
  const [openPreview, setOpenPreview] = useState<string | null>(null)
  const flat = useSyncExternalStore<ColorTreatment>(subscribeColorTreatment, getCurrentColorTreatment, () => DEFAULT_COLOR_TREATMENT) === 'flat'

  const toggle = (qi: number, multiSelect: boolean, label: string) => {
    if (!multiSelect) {
      setFreeformAnswers((freeform) => freeform[qi] ? { ...freeform, [qi]: '' } : freeform)
    }
    setSelections((prev) => {
      const current = prev[qi] ?? []
      let next: string[]
      if (multiSelect) {
        next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label]
      } else {
        next = current.length === 1 && current[0] === label ? current : [label]
      }
      return { ...prev, [qi]: next }
    })
  }

  let allAnswered = questions.length > 0
  for (let qi = 0; qi < questions.length; qi += 1) {
    if (questions[qi]?.required !== false && (selections[qi]?.length ?? 0) === 0 && !freeformAnswers[qi]?.trim()) {
      allAnswered = false
      break
    }
  }

  const submit = () => {
    if (!allAnswered || busy) return
    const answers: PendingQuestionAnswers = {}
    questions.forEach((q, qi) => {
      const selected = selections[qi] ?? []
      const freeform = freeformAnswers[qi]?.trim()
      const values = q.multiSelect && freeform
        ? [...selected, freeform]
        : freeform
          ? [freeform]
          : selected
      if (values.length > 0) answers[q.id ?? q.question] = values
    })
    onSubmit(answers)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '10px 11px',
        borderRadius: 6,
        border: '1px solid rgba(139,128,240,0.30)',
        background: 'rgba(139,128,240,0.06)',
      }}
    >
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--violet)', letterSpacing: '0.06em' }}>
        {questions.length === 1
          ? `${getAssistantDisplayName(permission.provider ?? 'claude')} asks`
          : `${getAssistantDisplayName(permission.provider ?? 'claude')} asks · ${questions.length} questions`}
      </div>
      {questions.map((q, qi) => {
        const selected = selections[qi] ?? []
        return (
          <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {q.header && (
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                  color: 'var(--text-3)',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  flexShrink: 0,
                }}>
                  {q.header}
                </span>
              )}
              <span>{q.question}{q.multiSelect ? <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>(select all that apply)</span> : null}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.externalUrl ? <a href={q.externalUrl} target="_blank" rel="noopener noreferrer">Open form in browser ↗</a> : null}
              {q.options.map((opt, oi) => {
                const optionValue = opt.value ?? opt.label
                const isSelected = selected.includes(optionValue)
                const previewKey = `${qi}:${oi}`
                const previewOpen = openPreview === previewKey
                return (
                  <div key={oi}>
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
                      <button
                        type="button"
                        className="av-hover-control"
                        onClick={() => toggle(qi, q.multiSelect === true, optionValue)}
                        disabled={busy}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                          padding: '6px 10px',
                          borderRadius: 4,
                          border: `1px solid ${isSelected ? 'rgba(139,128,240,0.55)' : 'var(--border)'}`,
                          background: isSelected
                            ? flat
                              ? 'rgba(139,128,240,0.16)'
                              : 'linear-gradient(to right, rgba(139,128,240,0.16), rgba(139,128,240,0.05))'
                            : 'var(--surface)',
                          cursor: busy ? 'not-allowed' : 'pointer',
                          transition: 'border-color 0.14s ease, background 0.14s ease',
                        }}
                      >
                        <span style={{
                          width: 14, height: 14,
                          borderRadius: q.multiSelect ? 3 : '50%',
                          border: `1.5px solid ${isSelected ? 'var(--violet)' : 'var(--border-2)'}`,
                          background: isSelected ? 'var(--violet)' : 'transparent',
                          flexShrink: 0,
                          marginTop: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSelected && <span style={{ fontSize: 10, color: 'var(--bg)', lineHeight: 1, fontWeight: 700 }}>✓</span>}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontFamily: "'IBM Plex Sans', sans-serif",
                            fontSize: 13, fontWeight: isSelected ? 600 : 400,
                            color: isSelected ? 'var(--text)' : 'var(--text-2)',
                          }}>
                            {opt.label}
                          </span>
                          {opt.description && (
                            <span style={{
                              display: 'block',
                              fontFamily: "'IBM Plex Sans', sans-serif",
                              fontSize: 11, color: 'var(--text-3)',
                              marginTop: 2, lineHeight: 1.5,
                            }}>
                              {opt.description}
                            </span>
                          )}
                        </span>
                      </button>
                      {opt.preview && (
                        <button
                          type="button"
                          className="av-hover-control"
                          aria-label={`${previewOpen ? 'Hide' : 'Show'} preview for ${opt.label}`}
                          aria-expanded={previewOpen}
                          onClick={() => setOpenPreview(previewOpen ? null : previewKey)}
                          disabled={busy}
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 10,
                            color: 'var(--text-3)',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '0 8px',
                            cursor: busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {previewOpen ? '▲ preview' : '▼ preview'}
                        </button>
                      )}
                    </div>
                    {opt.preview && previewOpen && (
                      <pre style={{
                        margin: '2px 0 0',
                        padding: '8px 12px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11, lineHeight: 1.6,
                        color: 'var(--text-2)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        borderRadius: '0 0 4px 4px',
                        overflowX: 'auto',
                        whiteSpace: 'pre',
                      }}>
                        {opt.preview}
                      </pre>
                    )}
                  </div>
                )
              })}
              {q.allowFreeform && (
                <Input
                  type={q.secret ? 'password' : 'text'}
                  value={freeformAnswers[qi] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    setFreeformAnswers((prev) => ({ ...prev, [qi]: value }))
                    if (!q.multiSelect && value) {
                      setSelections((prev) => ({ ...prev, [qi]: [] }))
                    }
                  }}
                  disabled={busy}
                  aria-label={`Custom answer for ${q.question}`}
                  placeholder={q.secret ? 'Enter a private answer…' : 'Other — type a custom answer…'}
                  autoComplete="off"
                  style={{
                    height: 32,
                    borderColor: freeformAnswers[qi]?.trim() ? 'rgba(139,128,240,0.55)' : 'var(--border)',
                    background: 'var(--surface)',
                    fontFamily: q.secret ? "'IBM Plex Mono', monospace" : "'IBM Plex Sans', sans-serif",
                    fontSize: 12,
                  }} />
              )}
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button
          type="button"
          onClick={onCancel}
          disabled={busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            border: '1px solid rgba(248,113,113,0.24)',
            background: 'rgba(248,113,113,0.08)',
            color: 'var(--red, #f87171)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.06em',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          SKIP
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={!allAnswered || busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 12px', borderRadius: 4,
            border: '1px solid rgba(139,128,240,0.40)',
            background: 'rgba(139,128,240,0.14)',
            color: 'var(--violet)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.06em',
            cursor: (!allAnswered || busy) ? 'not-allowed' : 'pointer',
            opacity: (!allAnswered || busy) ? 0.55 : 1,
          }}
        >
          {busy ? 'SENDING…' : 'SUBMIT'}
        </Button>
      </div>
    </div>
  )
}
