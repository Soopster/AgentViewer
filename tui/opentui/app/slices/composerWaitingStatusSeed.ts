/** @jsxImportSource @opentui/react */
import { useMemo, useRef } from 'react'
import { type Session } from '../../../../lib/types'
import { getSlashCommandSuggestions, filterSlashCommands, type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type readViewSessionComposerOptions } from '../../../../lib/sessionBackend'
import { TUI_HANDOFF_COMMAND } from '../composerConstants'

export type UseComposerWaitingStatusSeedGroupContext = {
  composerWaitingSeed: string
  composerTargetSession: Session | null
  composerDraft: string
  composerSlashDismissed: boolean
  selectedSession: Session | null
  composerLiveSlashCommands: SlashCommandSuggestion[]
}

export function useComposerWaitingStatusSeedGroup(ctx: UseComposerWaitingStatusSeedGroupContext) {
  const {
    composerWaitingSeed, composerTargetSession, composerDraft, composerSlashDismissed,
    selectedSession, composerLiveSlashCommands,
  } = ctx

  const composerWaitingStatusSeed = composerWaitingSeed
    || `${composerTargetSession?.provider ?? 'unknown'}:${composerTargetSession?.sessionId ?? 'pending'}`
  // Only a slash command's first line matters here, and `composerDraftShape` makes the root
  // re-render per key only while one is being typed.
  const composerDraftFirstLine = composerDraft.slice(0, composerDraft.indexOf('\n') < 0 ? undefined : composerDraft.indexOf('\n'))
  const composerFirstLine = composerDraftFirstLine.startsWith('/') ? composerDraftFirstLine : ''
  const composerSlashOpen = composerFirstLine.startsWith('/') && !composerSlashDismissed
  const composerSlashCommands: SlashCommandSuggestion[] = useMemo(() => {
    if (!composerSlashOpen) return []
    const baseline = [...getSlashCommandSuggestions(selectedSession?.provider ?? 'claude'), TUI_HANDOFF_COMMAND]
    const merged: SlashCommandSuggestion[] = [...composerLiveSlashCommands]
    const seen = new Set(merged.map((entry) => entry.command))
    for (const entry of baseline) {
      if (!seen.has(entry.command)) {
        merged.push(entry)
        seen.add(entry.command)
      }
    }
    return filterSlashCommands(merged, composerFirstLine.slice(1))
  }, [composerSlashOpen, composerFirstLine, selectedSession?.provider, composerLiveSlashCommands])

  const composerAffordancesCacheRef = useRef(new Map<string, {
    commands: SlashCommandSuggestion[]
    options: Awaited<ReturnType<typeof readViewSessionComposerOptions>>
    ts: number
  }>())
  // Composer affordances (slash commands, agent pickers). For Claude,
  // readViewSessionSlashCommands SPAWNS a full `claude` CLI subprocess
  // (createSessionControlQuery → query({resume}), ~1–3s of a CPU core) — so:
  // - never track the live selection or a raw `selectedSession` object (one
  //   spawn per scrub step / per 5s sessions poll — the original progressive
  //   scrub slowdown);
  // - key on the SETTLED committedSessionKey with a per-session TTL cache so
  //   revisits spawn nothing;
  // - for Claude, DON'T fetch on settle at all. Scrubbing across N distinct
  //   sessions still spawned one CLI per settle, sustaining 3–5 concurrent
  //   node processes for the whole scrub — enough system CPU pressure to
  //   starve the render loop for seconds (measured: multi-second commit gaps
  //   mid-scrub). Slash commands and agent pickers only matter once the user
  //   actually engages the composer, so the Claude fetch is deferred to
  //   composerActive. Other providers answer over their SDK/server (no
  //   subprocess) and keep the eager fetch, e.g. for the OpenCode agent chip.
  const committedSessionKeyRef = useRef<string | null>(null)

  return {
    composerWaitingStatusSeed, composerFirstLine, composerSlashOpen, composerSlashCommands,
    composerAffordancesCacheRef, committedSessionKeyRef,
  }
}
