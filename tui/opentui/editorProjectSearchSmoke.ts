import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchEditorProject } from './editorProjectSearch'
import { disposeEditorProjectSearchWorker, searchEditorProjectAsync } from './editorProjectSearchWorkerClient'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-project-search-'))

try {
  await writeFile(join(cwd, 'alpha.ts'), 'const caféValue = needle\nconst needle2 = 1\n', 'utf8')
  await writeFile(join(cwd, 'beta.ts'), 'NEEDLE and needle\n', 'utf8')

  const literal = await searchEditorProjectAsync(cwd, 'needle', {
    regex: false,
    matchCase: false,
    wholeWord: false,
  })
  const unicodePrefix = literal.find((result) => result.path === 'alpha.ts' && result.line === 0)
  if (literal.length !== 4 || unicodePrefix?.character !== 'const caféValue = '.length) {
    throw new Error(`Literal project search did not preserve UTF-16 cursor columns: ${JSON.stringify(literal)}`)
  }

  const unsaved = await searchEditorProjectAsync(cwd, 'needle', {
    regex: false,
    matchCase: false,
    wholeWord: false,
  }, [{ path: 'alpha.ts', content: 'const unsavedNeedle = needle\n' }])
  const alphaResults = unsaved.filter((result) => result.path === 'alpha.ts')
  if (alphaResults.length !== 2 || alphaResults.some((result) => result.preview.includes('caféValue'))) {
    throw new Error(`Unsaved buffer search did not replace stale disk results: ${JSON.stringify(unsaved)}`)
  }

  const abortController = new AbortController()
  const abortedSearch = searchEditorProjectAsync(cwd, 'needle', {
    regex: false,
    matchCase: false,
    wholeWord: false,
    signal: abortController.signal,
  })
  abortController.abort()
  let abortError: unknown
  try { await abortedSearch } catch (error) { abortError = error }
  if (!(abortError instanceof Error) || abortError.name !== 'AbortError') {
    throw new Error(`Cancelled project search did not reject promptly: ${String(abortError)}`)
  }

  const caseSensitive = await searchEditorProject(cwd, 'NEEDLE', {
    regex: false,
    matchCase: true,
    wholeWord: false,
  })
  if (caseSensitive.length !== 1 || caseSensitive[0]?.path !== 'beta.ts') {
    throw new Error(`Case-sensitive project search returned the wrong matches: ${JSON.stringify(caseSensitive)}`)
  }

  const wholeWord = await searchEditorProject(cwd, 'needle', {
    regex: false,
    matchCase: false,
    wholeWord: true,
  })
  if (wholeWord.length !== 3 || wholeWord.some((result) => result.preview.includes('needle2'))) {
    throw new Error(`Whole-word project search included a partial match: ${JSON.stringify(wholeWord)}`)
  }

  const regex = await searchEditorProject(cwd, 'needle\\d', {
    regex: true,
    matchCase: false,
    wholeWord: false,
  })
  if (regex.length !== 1 || regex[0]?.preview !== 'const needle2 = 1') {
    throw new Error(`Regex project search did not return the expected match: ${JSON.stringify(regex)}`)
  }

  console.log('Editor project literal/case/whole-word/regex/UTF-16 search smoke passed')
} finally {
  disposeEditorProjectSearchWorker()
  await rm(cwd, { recursive: true, force: true })
}
