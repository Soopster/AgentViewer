// The three functions a transcript diff card needs from @pierre/diffs and
// @pierre/trees, without the rest of either package.
//
// Every transcript with an edit in it renders a diff card, and building one
// takes a patch parser and a file order. Importing them from the packages'
// entry points evaluates everything else those entries export — Shiki and its
// grammars, the web components, the virtualizers — which measured ~23MB of
// footprint on the render thread at every launch, for a parser and a sort
// that are ~8MB on their own. Highlighting does need the whole package, and
// pierreDiffView loads it on demand when a highlight is first asked for.
//
// Neither package exports these files, so they are found next to the entry
// point. If a release moves them, the entry point is used instead: the same
// functions, at the old cost, never a broken card.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { FileDiffMetadata } from '@pierre/diffs'

type ParsedPatch = { files: FileDiffMetadata[] }
type PierreLight = {
  /** Which copy loaded: 'package' means a release moved the internals. */
  source: 'internal' | 'package'
  parsePatchFiles: (diffText: string, cacheKey?: string, throwOnError?: boolean) => ParsedPatch[]
  cleanLastNewline: (value: string) => string
  /** @pierre/trees' default file order: directories before files at each level, natural, case-insensitive. */
  sortTreePaths: (paths: readonly string[]) => string[]
}

type TreesPathEntry = { path: string; segments: string[]; isDirectory: boolean }

// Loaded synchronously (Bun's require() takes ES modules): a top-level await
// here would make every importer async, and a worker whose module is still
// awaiting drops the messages posted to it meanwhile.
const requireModule = createRequire(import.meta.url)

function loadInternal<T>(entry: string, relative: string): T {
  return requireModule(fileURLToPath(new URL(relative, import.meta.resolve(entry)))) as T
}

function loadPierreLight(): PierreLight {
  try {
    const patches = loadInternal<{ parsePatchFiles: PierreLight['parsePatchFiles'] }>('@pierre/diffs', './utils/parsePatchFiles.js')
    const newline = loadInternal<{ cleanLastNewline: PierreLight['cleanLastNewline'] }>('@pierre/diffs', './utils/cleanLastNewline.js')
    const treePath = loadInternal<{ parseInputPath: (path: string) => TreesPathEntry }>('@pierre/trees', './path-store/src/path.js')
    const treeSort = loadInternal<{ comparePreparedPaths: (left: TreesPathEntry, right: TreesPathEntry) => number }>('@pierre/trees', './path-store/src/sort.js')
    if (typeof patches.parsePatchFiles !== 'function' || typeof newline.cleanLastNewline !== 'function'
      || typeof treePath.parseInputPath !== 'function' || typeof treeSort.comparePreparedPaths !== 'function') {
      throw new Error('unexpected @pierre internals')
    }
    return {
      source: 'internal',
      parsePatchFiles: patches.parsePatchFiles,
      cleanLastNewline: newline.cleanLastNewline,
      sortTreePaths: (paths) => paths.map(treePath.parseInputPath).sort(treeSort.comparePreparedPaths).map((entry) => entry.path),
    }
  } catch {
    const diffs = requireModule('@pierre/diffs') as typeof import('@pierre/diffs')
    const trees = requireModule('@pierre/trees') as typeof import('@pierre/trees')
    return {
      source: 'package',
      parsePatchFiles: diffs.parsePatchFiles as PierreLight['parsePatchFiles'],
      cleanLastNewline: diffs.cleanLastNewline,
      sortTreePaths: (paths) => [...trees.prepareFileTreeInput([...paths], { sort: 'default' }).paths],
    }
  }
}

export const { source: pierreLightSource, parsePatchFiles, cleanLastNewline, sortTreePaths } = loadPierreLight()
