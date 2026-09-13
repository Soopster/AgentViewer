// Resolves the URL a Worker client should hand to `new Worker(...)`.
//
// When the TUI runs from source (`bun run tui/opentui/main.tsx`), the worker
// entrypoints exist on disk as `.ts` files next to the client. When the TUI is
// compiled into a standalone binary (`bun build --compile`), the worker files
// are listed as extra entrypoints and embedded under `$bunfs/root/<name>.js`
// (basename `.ts` → `.js`). Bun's worker-resolution remap for absolute $bunfs
// specifiers has not landed in the pinned bun (1.3.x), so referencing the
// `.ts` name from a compiled binary fails with
// `ModuleNotFound resolving "/$bunfs/root/<name>.ts"` — the embedded graph is
// keyed by `.js`. Pick the extension to match whichever layout is live.

const workerExtFor = (importerUrl: string): 'js' | 'ts' =>
  importerUrl.includes('$bunfs/') || importerUrl.includes('~BUN/') ? 'js' : 'ts'

export function tuiWorkerUrl(workerName: string, importerUrl: string): string {
  return new URL(`./${workerName}.${workerExtFor(importerUrl)}`, importerUrl).href
}