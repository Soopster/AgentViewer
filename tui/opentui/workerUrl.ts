// Resolves the URL a Worker client should hand to `new Worker(...)`, from the
// worker's path relative to the repository root (`tui/opentui/threadingWorker`,
// `plugins/analytics/tui/analyticsWorker`), without an extension.
//
// From source (`bun run tui/opentui/main.tsx`) that is the `.ts` file in the
// checkout. In a binary compiled with `bun build --compile --root .`
// (scripts/prepareDesktopResources.mjs), every worker entrypoint is embedded at
// `$bunfs/root/<that path>.js` — keyed by `.js`, and by the path from the
// build root. `--root .` is what makes that path the repository path whatever
// directories the entrypoints come from: without it Bun uses their common
// ancestor, so one plugin worker outside tui/opentui moved every other worker
// and each failed with `ModuleNotFound`. A bundled module's own
// `import.meta.url` is the binary, never its source file, so the path cannot
// be derived from the client either; callers name it.

const COMPILED_ROOTS = ['$bunfs/root/', '~BUN/root/']

export function tuiWorkerUrl(workerPath: string, here: string = import.meta.url): string {
  for (const root of COMPILED_ROOTS) {
    const at = here.indexOf(root)
    if (at >= 0) return `${here.slice(0, at + root.length)}${workerPath}.js`
  }
  return new URL(`../../${workerPath}.ts`, here).href
}
