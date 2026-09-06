import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function normalizeEditorFilePath(root: string, input: string): { absolute: string; path: string } {
  const trimmed = input.trim()
  if (!trimmed || trimmed.includes('\0')) throw new Error('Enter a valid workspace-relative path')
  const absolute = resolve(root, trimmed)
  if (!isWithin(resolve(root), absolute) || absolute === resolve(root)) throw new Error('Path must stay inside the workspace')
  return { absolute, path: relative(resolve(root), absolute) }
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
    await lstat(target.absolute)
    throw new Error(`Refusing to overwrite existing path: ${target.path}`)
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
