import type { SessionIdentity } from '../sessionIdentity'
import type { PLUGIN_API_VERSION } from './types'

export type ComposerAccessoryPresentation = { readonly rows: number; readonly modal?: boolean; readonly summary?: string | null }
export type ComposerAccessoryKey = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string }
export type ComposerAccessoryKeyResult = boolean | 'input'
export type ComposerAccessoryServices = {
  readonly composer?: { readonly sendDraft: (text: string) => void | Promise<void> }
}
export type ComposerAccessoryProps = {
  readonly pluginId: string
  readonly accessoryId: string
  readonly session: Readonly<SessionIdentity>
  readonly draft: string
  readonly disabled: boolean
  readonly visible: boolean
  readonly signal: AbortSignal
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
