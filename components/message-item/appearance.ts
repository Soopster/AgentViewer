'use client'

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_COLOR_TREATMENT,
  getCurrentColorTreatment,
  subscribeColorTreatment,
  type ColorTreatment,
} from '@/lib/colorTreatment'

import { canonicalToolName } from './toolModel'

// ── Tool color palette ────────────────────────────────────────────────────────

export const TOOL_COLORS: Record<string, string> = {
  Bash:      'var(--t-bash)',
  Edit:      'var(--t-edit)',
  MultiEdit: 'var(--t-edit)',
  FileChange: 'var(--t-edit)',
  Write:     'var(--t-write)',
  Read:      'var(--t-read)',
  Grep:      'var(--t-grep)',
  Glob:      'var(--t-glob)',
  Agent:     'var(--t-agent)',
  task:      'var(--t-agent)',
  task_status: 'var(--t-agent)',
  WebSearch: 'var(--cyan)',
  WebFetch:  'var(--t-read)',
  NotebookEdit: 'var(--t-edit)',
}

export function toolColor(name: string) {
  return TOOL_COLORS[canonicalToolName(name)] ?? 'var(--t-other)'
}

// Flat-vs-gradient color treatment, document-level. Same external-store pattern
// as MessageView/SessionList — reads [data-color-treatment="flat"] on <html>.
export function useColorTreatment(): ColorTreatment {
  return useSyncExternalStore<ColorTreatment>(
    subscribeColorTreatment,
    getCurrentColorTreatment,
    () => DEFAULT_COLOR_TREATMENT,
  )
}

// Tool-card header background. In gradient treatment this is the soft
// tool-colored wash that fades into the surface; in flat treatment a plain
// surface so the tool left-border + label carry the identity instead.
export function washBg(flat: boolean, gradient: string, flatBg = 'var(--surface-2)'): string {
  return flat ? flatBg : gradient
}
