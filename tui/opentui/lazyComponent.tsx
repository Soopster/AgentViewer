/** @jsxImportSource @opentui/react */
// A component whose module loads the first time it renders.
//
// The root imports every overlay it can open — the editor, Git, analytics, the
// Coordinator panels — and evaluating them all at launch put their libraries
// (Shiki through @pierre/diffs, zod through the review store) on the render
// thread before the first frame, for surfaces most sessions never open. Each
// overlay is mounted only while it is open, so loading it then costs one
// import, once: the App graph went from ~150ms and 46MB to ~65ms and 32MB.
//
// Not React.lazy: React 19 throttles revealing a Suspense boundary's content
// (~300ms), so every first open would have waited on a timer for a module that
// arrived in a few milliseconds. This renders nothing until the import
// resolves, then renders on the next commit; once loaded it is synchronous.
import { useEffect, useState, type ComponentProps, type JSXElementConstructor, type ReactElement } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any component's props
export function lazyComponent<C extends JSXElementConstructor<any>>(load: () => Promise<C>): C {
  let loaded: C | null = null
  let pending: Promise<C> | null = null
  const ensure = () => {
    pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        // Let the next mount try again rather than caching the failure.
        pending = null
        throw error
      },
    )
    return pending
  }
  function LazyComponent(props: ComponentProps<C>) {
    const [, setReady] = useState(false)
    useEffect(() => {
      if (loaded) return undefined
      let mounted = true
      ensure().then(() => { if (mounted) setReady(true) }, (error: unknown) => {
        console.error('Failed to load overlay:', error)
      })
      return () => { mounted = false }
    }, [])
    if (!loaded) return null
    const Component = loaded as unknown as (props: ComponentProps<C>) => ReactElement | null
    return <Component {...props} />
  }
  // Typed as the component it stands in for, so call sites check its props.
  return LazyComponent as unknown as C
}
