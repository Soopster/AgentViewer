// Portability cases the development machine (macOS) cannot reach on its own.
//
// Windows path semantics are driven by injecting `path.win32` rather than by
// branching on `process.platform` somewhere no test can observe, and the
// search backends' path dialects are driven by injecting `platform` into the
// search options. Everything here fails on a posix host against the pre-fix
// code, which is the only reason it is worth having.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const realpath = async (command: string) => (await promisify(execFile)('sh', ['-c', `command -v ${command}`])).stdout.trim()
import { isEditorPathWithin, normalizeEditorFilePath } from './editorFileOperations'
import { EditorProjectSearchUnavailableError, searchEditorProject } from './editorProjectSearch'

// --- Containment on win32 -------------------------------------------------
// `relative` cannot express "C:\root -> D:\evil" as a traversal, so it answers
// with the absolute target. A check that only rejects '..' and '..\' prefixes
// reads that as inside the workspace.
assert.equal(win32.relative('C:\\root', 'D:\\evil'), 'D:\\evil')
assert.equal(isEditorPathWithin('C:\\root', 'D:\\evil', win32), false, 'a different drive is not inside the workspace')
assert.equal(isEditorPathWithin('C:\\root', 'C:\\root\\src\\a.ts', win32), true)
assert.equal(isEditorPathWithin('C:\\root', 'C:\\root', win32), true)
assert.equal(isEditorPathWithin('C:\\root', 'C:\\rootless\\a.ts', win32), false, 'a sibling with a shared prefix is outside')
assert.equal(isEditorPathWithin('C:\\root', '\\\\server\\share\\a.ts', win32), false, 'a UNC path is outside')
// NTFS is case-insensitive, and `win32.relative` knows it; posix does not.
assert.equal(isEditorPathWithin('C:\\Root', 'C:\\root\\a.ts', win32), true)
assert.equal(isEditorPathWithin('/root', '/Root/a.ts', posix), false)

// A backslash is a separator on win32 and an ordinary filename character on
// posix, so the same input has to resolve differently under each flavour.
assert.equal(normalizeEditorFilePath('C:\\root', 'src\\a.ts', win32).path, 'src\\a.ts')
assert.throws(() => normalizeEditorFilePath('C:\\root', '..\\escape.ts', win32), /inside the workspace/)
assert.throws(() => normalizeEditorFilePath('C:\\root', 'D:\\escape.ts', win32), /inside the workspace/)
assert.throws(() => normalizeEditorFilePath('C:\\root', '\\\\server\\share\\escape.ts', win32), /inside the workspace/)
assert.equal(normalizeEditorFilePath('/root', 'a\\b.ts', posix).path, 'a\\b.ts', 'a backslash is a posix filename character')

// --- Search backend path dialects ----------------------------------------
const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-portability-'))
try {
  await mkdir(join(cwd, 'sub'), { recursive: true })
  await writeFile(join(cwd, 'sub', 'alpha.ts'), 'const needle = 1\n', 'utf8')

  const posixResults = await searchEditorProject(cwd, 'needle', {
    regex: false, matchCase: false, wholeWord: false, platform: 'darwin',
  })
  assert.deepEqual(posixResults.map((result) => result.path), ['sub/alpha.ts'])

  // Both backends report a dialect the editor does not use on Windows: ripgrep
  // echoes the './' it was handed as '.\', and git always emits '/'. A buffer's
  // path there comes from `win32.relative`, so it is 'sub\alpha.ts' — anything
  // else fails to deduplicate against the open buffer and displays wrong.
  const windowsResults = await searchEditorProject(cwd, 'needle', {
    regex: false, matchCase: false, wholeWord: false, platform: 'win32',
  })
  assert.deepEqual(windowsResults.map((result) => result.path), ['sub\\alpha.ts'])
  assert.equal(normalizeEditorFilePath('C:\\root', 'sub/alpha.ts', win32).path, windowsResults[0]!.path)

  // --- Degrading when no backend exists ----------------------------------
  // An empty PATH is the "ripgrep is not installed" case, and a temp directory
  // is the "not a git repository" case. Together they are the only state where
  // project search cannot answer at all, and it has to say so rather than
  // surfacing `spawn rg ENOENT` or git's exit 128.
  const realPath = process.env.PATH
  process.env.PATH = join(cwd, 'no-such-bin')
  try {
    await assert.rejects(
      searchEditorProject(cwd, 'needle', { regex: false, matchCase: false, wholeWord: false }),
      (error: unknown) => error instanceof EditorProjectSearchUnavailableError && /ripgrep/.test((error as Error).message),
      'a missing backend reports itself as unavailable',
    )
    await assert.rejects(
      searchEditorProject(cwd, 'needle', { regex: true, matchCase: false, wholeWord: false }),
      (error: unknown) => error instanceof EditorProjectSearchUnavailableError,
      'regex search has no fallback and says which tool it needs',
    )
  } finally {
    if (realPath === undefined) delete process.env.PATH
    else process.env.PATH = realPath
  }

  // git present, ripgrep absent, and this directory is not a repository: git
  // grep exits 128 with "not a git repository", which is not a search failure.
  const gitOnlyBin = join(cwd, 'git-only-bin')
  await mkdir(gitOnlyBin, { recursive: true })
  const gitBinary = await realpath('git').catch(() => null)
  if (gitBinary) {
    await symlink(gitBinary, join(gitOnlyBin, 'git'))
    const realPathAgain = process.env.PATH
    process.env.PATH = gitOnlyBin
    try {
      await assert.rejects(
        searchEditorProject(cwd, 'needle', { regex: false, matchCase: false, wholeWord: false }),
        (error: unknown) => error instanceof EditorProjectSearchUnavailableError && /git repository/.test((error as Error).message),
        'outside a repository the git fallback reports no backend, not exit 128',
      )
    } finally {
      if (realPathAgain === undefined) delete process.env.PATH
      else process.env.PATH = realPathAgain
    }
  }

  // The git fallback's own dialect, exercised through a real `git grep`: it
  // reports forward slashes on every platform, including Windows, so it needs
  // the same normalization ripgrep does even though its output differs.
  if (gitBinary) {
    const run = promisify(execFile)
    await run('git', ['init', '-q'], { cwd })
    await run('git', ['add', '-A'], { cwd })
    const realPathForGit = process.env.PATH
    process.env.PATH = gitOnlyBin
    try {
      const gitWindows = await searchEditorProject(cwd, 'needle', {
        regex: false, matchCase: false, wholeWord: false, platform: 'win32',
      })
      assert.deepEqual(gitWindows.map((result) => result.path), ['sub\\alpha.ts'], 'git grep reports "/" even on Windows')
      const gitPosix = await searchEditorProject(cwd, 'needle', {
        regex: false, matchCase: false, wholeWord: false, platform: 'darwin',
      })
      assert.deepEqual(gitPosix.map((result) => result.path), ['sub/alpha.ts'])
    } finally {
      if (realPathForGit === undefined) delete process.env.PATH
      else process.env.PATH = realPathForGit
    }
  }

  console.log('Editor portability smoke passed: win32 containment, search path dialects, absent backends')
} finally {
  await rm(cwd, { recursive: true, force: true })
}
