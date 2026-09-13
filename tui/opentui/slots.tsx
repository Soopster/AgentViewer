/** @jsxImportSource @opentui/react */
// Named render slots for the OpenTUI root.
//
// `App.tsx` is one component holding the reader, composer, key dispatch and
// every popover, so a surface can only be added by editing the root. A slot is
// the seam: the root declares WHERE a surface may appear and the surface says
// what it draws, so the two stop sharing a scope.
//
// The registry is deliberately NOT a React context. Contributions are
// registered at module load (or from an effect), and a context would put every
// registration on the root's render path — the exact coupling this exists to
// break. `<Slot>` subscribes with `useSyncExternalStore`, so registering a
// contribution re-renders that slot alone.
//
// A slot is a structural seam, not a performance fix on its own. In Solid a
// slot child is its own reactive scope and isolates by construction; in React a
// contribution still re-renders whenever its props change. What the registry
// buys is that a contribution CAN subscribe to its own state and be wrapped in
// `memo`, which is impossible while its state lives in the root's 133
// `useState` calls. `slotPropsEqual` below is what makes that memoization
// actually hold.
import { memo, useCallback, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { TuiDensity, TuiThemePalette } from '../theme'

/**
 * Where the root will render contributions. Adding a name here is a promise
 * about placement and about which props arrive — both are part of the contract
 * a contribution is written against, so neither may change silently.
 */
export type SlotName =
  /** Under the reader's context/status rows, above the error line. */
  | 'reader_status'
  /** Full-screen overlays, drawn above the transcript at the root's end. */
  | 'overlay'
  /** Rows inside the sidebar, below the session list. */
  | 'sidebar_content'

export type SlotPropsMap = {
  reader_status: { theme: TuiThemePalette; width: number }
  overlay: { theme: TuiThemePalette; width: number; height: number }
  sidebar_content: {
    theme: TuiThemePalette
    innerWidth: number
    rowBudget: number
    density: TuiDensity
    scrollbarOptions: unknown
  }
}

export type SlotProps<Name extends SlotName> = SlotPropsMap[Name]

type Contribution<Name extends SlotName> = {
  readonly id: string
  readonly order: number
  readonly render: (props: SlotProps<Name>) => ReactNode
}

type AnyContribution = Contribution<SlotName>

const contributions = new Map<SlotName, AnyContribution[]>()
const listeners = new Map<SlotName, Set<() => void>>()
// useSyncExternalStore compares snapshots by identity, so a slot with no
// contributions must return the SAME empty array every time or it re-renders
// forever.
const EMPTY: readonly AnyContribution[] = Object.freeze([])

function notify(name: SlotName) {
  for (const listener of listeners.get(name) ?? []) listener()
}

/**
 * Register a contribution. Returns its unregister function; calling it twice is
 * a no-op. Contributions render in ascending `order`, ties broken by `id` so
 * the order two modules register in cannot change what the user sees.
 */
export function registerSlot<Name extends SlotName>(
  name: Name,
  contribution: Contribution<Name>,
): () => void {
  const list = contributions.get(name) ?? []
  if (list.some((entry) => entry.id === contribution.id)) {
    throw new Error(`slot ${name} already has a contribution with id ${contribution.id}`)
  }
  const next = [...list, contribution as AnyContribution].sort(
    (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  contributions.set(name, next)
  notify(name)
  let removed = false
  return () => {
    if (removed) return
    removed = true
    contributions.set(name, (contributions.get(name) ?? []).filter((entry) => entry.id !== contribution.id))
    notify(name)
  }
}

/** Test/diagnostic reader — the rendered order for one slot. */
export function slotContributionIds(name: SlotName): readonly string[] {
  return (contributions.get(name) ?? EMPTY).map((entry) => entry.id)
}

/** Drop every contribution. Only for tests; the app registers once per process. */
export function resetSlots(): void {
  const names = [...contributions.keys()]
  contributions.clear()
  for (const name of names) notify(name)
}

function subscribe(name: SlotName, listener: () => void): () => void {
  const set = listeners.get(name) ?? new Set()
  set.add(listener)
  listeners.set(name, set)
  return () => { set.delete(listener) }
}

/**
 * Shallow prop comparison for a memoized contribution. Slot props are flat
 * records of primitives plus the theme palette, which is interned per theme, so
 * shallow equality is exact rather than a heuristic.
 */
function slotPropsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (!Object.is(a[key], b[key])) return false
  return true
}

const SlotEntry = memo(
  function SlotEntry({ render, entryProps }: {
    render: (props: never) => ReactNode
    entryProps: Record<string, unknown>
  }) {
    return <>{(render as (props: Record<string, unknown>) => ReactNode)(entryProps)}</>
  },
  (prev, next) => prev.render === next.render && slotPropsEqual(prev.entryProps, next.entryProps),
)

/**
 * Render every contribution to `name`. The root places this once; what appears
 * is whatever registered, in `order`.
 */
export function Slot<Name extends SlotName>({ name, ...props }: { name: Name } & SlotProps<Name>) {
  const subscribeToSlot = useCallback((listener: () => void) => subscribe(name, listener), [name])
  const getSnapshot = useCallback(() => contributions.get(name) ?? EMPTY, [name])
  const entries = useSyncExternalStore(subscribeToSlot, getSnapshot, getSnapshot)
  // Props arrive spread so the root's call site reads like an ordinary element.
  // This record is rebuilt every render on purpose: `SlotEntry`'s comparator
  // reads its fields, so a fresh object with unchanged fields still bails out,
  // and memoizing it here would need a dep array whose length depends on the
  // slot.
  const entryProps = props as unknown as Record<string, unknown>
  if (entries.length === 0) return null
  return (
    <>
      {entries.map((entry) => (
        <SlotEntry key={entry.id} render={entry.render as (props: never) => ReactNode} entryProps={entryProps} />
      ))}
    </>
  )
}
