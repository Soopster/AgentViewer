'use client'
import { Button } from '@/components/ui/button'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import { latestReviewFor, secondOpinionGlyph, secondOpinionLabel, type SecondOpinionFinding } from '@/lib/plugins/secondOpinion'
import { turnAge, useSecondOpinionView, type SecondOpinionViewState } from '../useSecondOpinionView'

const SEVERITY_CLASS: Record<SecondOpinionFinding['severity'], string> = {
  bug: 'text-red-500', risk: 'text-amber-500', nit: 'text-muted-foreground',
}

function Turns({ state }: { state: SecondOpinionViewState }) {
  if (!state.turns) return <p className="text-sm text-muted-foreground">Loading turns…</p>
  if (!state.turns.length) return <p className="text-sm text-muted-foreground">{state.scopedToSession ? 'No turn of this session was checkpointed. Show all turns to review others in this repository.' : 'No agent turns have been checkpointed in this repository yet.'}</p>
  return <ul className="flex flex-col gap-0.5" aria-label="Turns">
    {state.turns.map(turn => {
      const record = latestReviewFor(state.snapshot, turn.sha)
      const selected = turn.sha === state.turn?.sha
      return <li key={turn.sha}>
        <button type="button" onClick={() => state.selectTurn(turn.sha)} aria-current={selected}
          className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm ${selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}>
          <span className="w-8 shrink-0 text-xs text-muted-foreground">{turnAge(turn.createdAt)}</span>
          <span className="min-w-0 flex-1 truncate">{turn.label || '(no prompt)'}</span>
          {record ? <span className="shrink-0 text-xs text-muted-foreground">{secondOpinionLabel(record)}{record.stale ? ' · stale' : ''}</span> : null}
        </button>
      </li>
    })}
  </ul>
}

function Finding({ state, finding, onOpen }: { state: SecondOpinionViewState; finding: SecondOpinionFinding; onOpen?: (path: string, line: number) => void }) {
  const selected = finding.id === state.finding?.id
  return <article className={`rounded border p-3 ${selected ? 'border-primary' : ''}`} onClick={() => state.selectFinding(finding.id)}>
    <h4 className="flex items-baseline gap-2 text-sm font-medium">
      <span className={SEVERITY_CLASS[finding.severity]}>{secondOpinionGlyph(finding.severity)} {finding.severity}</span>
      <span>{finding.title}</span>
    </h4>
    {finding.why ? <p className="mt-1 text-sm">{finding.why}</p> : null}
    {finding.suggestion ? <p className="mt-1 text-sm text-muted-foreground">Suggested: {finding.suggestion}</p> : null}
    {finding.excerpts.map(excerpt => <div key={`${excerpt.path}:${excerpt.startLine}`} className="mt-2">
      <button type="button" className="font-mono text-xs text-primary underline-offset-2 hover:underline" disabled={!onOpen}
        onClick={event => { event.stopPropagation(); onOpen?.(excerpt.path, excerpt.startLine) }}>
        {excerpt.path}:{excerpt.startLine}-{excerpt.endLine}
      </button>
      <pre className="mt-1 overflow-auto rounded bg-muted p-2 font-mono text-xs">{excerpt.lines.map((line, index) =>
        <div key={index} className={line.startsWith('+') ? 'text-green-600 dark:text-green-400' : line.startsWith('-') ? 'text-red-600 dark:text-red-400' : ''}>{line || ' '}</div>)}</pre>
    </div>)}
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="outline" onClick={event => { event.stopPropagation(); state.selectFinding(finding.id); state.handToAuthor() }}>Send to composer</Button>
      <Button size="sm" variant="ghost" onClick={event => { event.stopPropagation(); state.selectFinding(finding.id); state.dismiss() }}>Dismiss</Button>
    </div>
  </article>
}

function Review({ state, onOpen }: { state: SecondOpinionViewState; onOpen?: (path: string, line: number) => void }) {
  const record = state.record
  if (!state.turn) return null
  return <section className="flex min-w-0 flex-1 flex-col gap-3" aria-label="Review">
    <div>
      <h3 className="text-sm font-medium">{state.turn.label || '(no prompt)'}</h3>
      <p className="text-xs text-muted-foreground">
        {record ? `${record.reviewer}${record.model ? ` (${record.model})` : ''} · ${secondOpinionLabel(record)}${record.stale ? ' · stale: the code moved since this review' : ''}` : 'Not reviewed yet.'}
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={state.armed ? 'destructive' : 'default'} disabled={record?.status === 'running'} onClick={state.review}>
        {state.armed ? `Confirm: send diff to ${state.nextReviewer}` : `Review with ${state.nextReviewer}`}
      </Button>
      <Button size="sm" variant="outline" onClick={state.cycleReviewer}>Use {state.nextReviewer === 'claude' ? 'codex' : 'claude'} instead</Button>
      {record?.status === 'running' ? <Button size="sm" variant="ghost" onClick={state.cancel}>Cancel</Button> : null}
    </div>
    {record?.fellBackFrom ? <p className="text-sm text-amber-600">{record.fellBackFrom} is not installed, so {record.reviewer} reviewed instead.</p> : null}
    {record?.error ? <p role="alert" className="text-sm text-red-600">{record.error}</p> : null}
    {record?.review?.summary ? <p className="text-sm">{record.review.summary}</p> : null}
    {record?.review?.unread.length ? <details className="text-xs text-amber-600">
      <summary className="cursor-pointer">Not read: {record.review.unread.length} file{record.review.unread.length === 1 ? '' : 's'} too large for one review</summary>
      <p className="mt-1 break-words">{record.review.unread.join(', ')}</p>
    </details> : null}
    {record?.status === 'done' && !state.findings.length ? <p className="text-sm text-muted-foreground">Nothing open.</p> : null}
    {state.findings.map(finding => <Finding key={finding.id} state={state} finding={finding} onOpen={onOpen} />)}
  </section>
}

function SecondOpinion({ services, useState: scopedState }: WebPluginViewProps) {
  const cwd = services.repository!.cwd
  const state = useSecondOpinionView({
    service: services['second-opinion']!, checkpoints: services.checkpoints!, cwd,
    sessionId: services.repository!.sessionId, insert: services.composer?.insertText, scoped: scopedState,
  })
  const auto = state.snapshot?.settings.autoReview ?? false
  return <div className="flex h-full min-h-0 flex-col gap-3 p-4">
    <header className="flex items-center gap-3">
      <h2 className="text-base font-semibold">Second opinion</h2>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{cwd}</span>
      {services.repository!.sessionId ? <Button size="sm" variant="ghost" onClick={state.toggleScope}>{state.allTurns ? 'This session only' : `All turns${state.repositoryTurns ? ` (${state.repositoryTurns})` : ''}`}</Button> : null}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={auto} disabled={!state.snapshot} onChange={state.toggleAuto} />
        Review every turn (spends model usage)
      </label>
    </header>
    {state.error || state.notice ? <p role="status" className={`text-sm ${state.error ? 'text-red-600' : 'text-muted-foreground'}`}>{state.error ?? state.notice}</p> : null}
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
      <div className="w-80 shrink-0 overflow-auto"><Turns state={state} /></div>
      <div className="min-w-0 flex-1 overflow-auto"><Review state={state} /></div>
    </div>
  </div>
}

export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'second-opinion', views: { 'second-opinion': SecondOpinion } }
