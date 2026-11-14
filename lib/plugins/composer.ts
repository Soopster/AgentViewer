import type { SessionIdentity } from '../sessionIdentity'
import type { PLUGIN_API_VERSION } from './types'

export type ComposerAccessoryPresentation = { readonly rows: number; readonly modal?: boolean; readonly backgroundKeys?: boolean; readonly summary?: string | null }
export type ComposerAccessoryKey = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string }
export type ComposerAccessoryKeyResult = boolean | 'input'
export type ComposerAccessoryServices = {
  readonly composer?: {
    readonly sendDraft: (text: string) => void | Promise<void>
    /** Stage a reviewed rewrite; preserve text typed since `original` was captured. Never sends. */
    readonly stageDraft?: (text: string, original: string) => void
  }
}
export type ComposerAccessoryProps = {
  readonly pluginId: string
  readonly accessoryId: string
  readonly session: Readonly<SessionIdentity>
  readonly cwd?: string
  readonly draft: string
  readonly disabled: boolean
  readonly visible: boolean
  readonly signal: AbortSignal
  readonly invocation?: import('./commands').PluginCommandInput
  readonly openRequest: number
  readonly services: ComposerAccessoryServices
  readonly report: (presentation: ComposerAccessoryPresentation) => void
  readonly registerKeys: (handler: ((key: ComposerAccessoryKey) => ComposerAccessoryKeyResult) | null) => void
}
export type PluginComposerModule<View> = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly accessories: Readonly<Record<string, View>>
}

/** A rewrite may finish after typing resumed; retain the newer draft below it. */
export function mergeComposerRewrite(current: string, original: string, improved: string): string {
  if (!improved) return current === original ? '' : current
  return current === original || !current.trim() ? improved : `${improved}\n\n${current}`
}
