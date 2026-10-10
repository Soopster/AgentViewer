import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import nodePath, { dirname, resolve } from 'node:path'

// Containment is decided with the path flavour's own rules rather than by
// string surgery on '/': `relative` is case-insensitive on win32 and case-
// sensitive on posix, and only it knows that C:\a and D:\b share no prefix.
// The flavour is a parameter so win32 containment can be driven — and tested —
// from a posix machine, which is the only place this code is ever developed.
export type EditorPathApi = Pick<typeof nodePath, 'relative' | 'resolve' | 'isAbsolute'> & { sep: string }

/**
 * Whether `candidate` is `root` or sits underneath it.
 *
 * `isAbsolute(rel)` is not redundant: on win32 `relative('C:\\root', 'D:\\evil')`
 * cannot express the answer as a traversal and returns 'D:\\evil' — which is
 * neither '..' nor '..\\'-prefixed, so a check without it reports a different
 * drive as inside the workspace.
 */
export function isEditorPathWithin(root: string, candidate: string, pathApi: EditorPathApi = nodePath): boolean {
  const rel = pathApi.relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel))
}

const isWithin = isEditorPathWithin

export function normalizeEditorFilePath(
  root: string,
  input: string,
  pathApi: EditorPathApi = nodePath,
): { absolute: string; path: string } {
  const trimmed = input.trim()
  if (!trimmed || trimmed.includes('\0')) throw new Error('Enter a valid workspace-relative path')
  const absoluteRoot = pathApi.resolve(root)
  const absolute = pathApi.resolve(absoluteRoot, trimmed)
  if (!isEditorPathWithin(absoluteRoot, absolute, pathApi) || absolute === absoluteRoot) {
    throw new Error('Path must stay inside the workspace')
  }
  return { absolute, path: pathApi.relative(absoluteRoot, absolute) }
}

export async function resolveSafeEditorFile(root: string, input: string): Promise<{ absolute: string; path: string }> {
  const target = normalizeEditorFilePath(root, input)
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target.absolute)])
  if (!isWithin(realRoot, realTarget)) throw new Error('File resolves outside the workspace through a symbolic link')
  const info = await lstat(realTarget)
  if (!info.isFile()) throw new Error('Only regular files can be edited')
  return { absolute: realTarget, path: target.path }
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let candidate = path
  while (true) {
    try {
      const info = await lstat(candidate)
      if (!info.isDirectory()) throw new Error(`${candidate} is not a directory`)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

async function assertSafeParent(root: string, target: string): Promise<void> {
  const [realRoot, ancestor] = await Promise.all([realpath(root), nearestExistingDirectory(dirname(target))])
  const realAncestor = await realpath(ancestor)
  if (!isWithin(realRoot, realAncestor)) throw new Error('Path resolves outside the workspace through a symbolic link')
}

export async function createEditorFile(root: string, input: string): Promise<string> {
  const target = normalizeEditorFilePath(root, input)
  await assertSafeParent(root, target.absolute)
  await mkdir(dirname(target.absolute), { recursive: true })
  await writeFile(target.absolute, '', { encoding: 'utf8', flag: 'wx', mode: 0o644 })
  return target.path
}

export async function renameEditorFile(root: string, sourceInput: string, targetInput: string): Promise<{ from: string; to: string }> {
  const source = normalizeEditorFilePath(root, sourceInput)
  const target = normalizeEditorFilePath(root, targetInput)
  const [realRoot, realSource] = await Promise.all([realpath(root), realpath(source.absolute)])
  if (!isWithin(realRoot, realSource)) throw new Error('Source resolves outside the workspace through a symbolic link')
  const sourceInfo = await lstat(source.absolute)
  if (!sourceInfo.isFile()) throw new Error('Only files can be renamed from the editor explorer')
  await assertSafeParent(root, target.absolute)
  try {
    const existing = await lstat(target.absolute)
    // On a case-insensitive filesystem (APFS and NTFS by default) lstat of the
    // new name finds the *source* when only its case is changing, so a plain
    // existence check refused every rename of Foo.ts to foo.ts. Same device and
    // inode means the "existing path" is the file being renamed.
    if (existing.dev !== sourceInfo.dev || existing.ino !== sourceInfo.ino) {
      throw new Error(`Refusing to overwrite existing path: ${target.path}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(target.absolute), { recursive: true })
  await rename(source.absolute, target.absolute)
  return { from: source.path, to: target.path }
}

export async function deleteEditorFile(root: string, input: string): Promise<string> {
  const target = normalizeEditorFilePath(root, input)
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target.absolute)])
  if (!isWithin(realRoot, realTarget)) throw new Error('File resolves outside the workspace through a symbolic link')
  const info = await lstat(target.absolute)
  if (!info.isFile()) throw new Error('Only files can be deleted from the editor explorer')
  await unlink(target.absolute)
  return target.path
}
