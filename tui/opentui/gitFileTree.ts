import type { GitStatusEntry } from '../../lib/gitProvider'
import { sortTreePaths } from './pierreLight'

// chainPaths: all dir segments in a flattened chain, e.g. ['tui', 'tui/opentui'] for a
// merged single-child dir. Used so expand/collapse toggles all segments together.
export type GitFileTreeNode =
  | { kind: 'dir'; path: string; name: string; depth: number; expanded: boolean; chainPaths: readonly string[] }
  | { kind: 'file'; path: string; name: string; depth: number; x: string; y: string; previousPath?: string }

export function buildGitFileTree(entries: GitStatusEntry[], expandedDirs: Set<string>): GitFileTreeNode[] {
  if (entries.length === 0) return []

  // Use @pierre/trees for correct tree-aware sorting (dirs before files per level,
  // consistent with the web GitPopover). Map from path → sort index.
  const filePaths = entries.map((e) => e.path)
  const sortedFilePaths = sortTreePaths(filePaths)

  // Build the nested dir/file structure in sorted order.
  interface DirData { subdirs: Map<string, DirData>; files: GitStatusEntry[] }
  const root: DirData = { subdirs: new Map(), files: [] }
  const entryByPath = new Map(entries.map((e) => [e.path, e]))

  for (const fp of sortedFilePaths) {
    const entry = entryByPath.get(fp)
    if (!entry) continue
    const parts = fp.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      if (!cur.subdirs.has(seg)) cur.subdirs.set(seg, { subdirs: new Map(), files: [] })
      cur = cur.subdirs.get(seg)!
    }
    cur.files.push(entry)
  }

  const nodes: GitFileTreeNode[] = []

  // Walk a chain of single-subdir/no-file dirs, collecting paths for display flattening.
  // e.g. tui/ → opentui/ (no files, one subdir) → returns chainPath='tui/opentui', chainDir=opentui's DirData
  function walkChain(dir: DirData, dirPath: string): { chainPath: string; chainDir: DirData; chainPaths: string[] } {
    const chainPaths = [dirPath]
    let currentPath = dirPath
    let currentDir = dir
    while (currentDir.subdirs.size === 1 && currentDir.files.length === 0) {
      const [childName, childDir] = [...currentDir.subdirs.entries()][0]!
      currentPath = `${currentPath}/${childName}`
      chainPaths.push(currentPath)
      currentDir = childDir
    }
    return { chainPath: currentPath, chainDir: currentDir, chainPaths }
  }

  function visit(dir: DirData, prefix: string, depth: number) {
    for (const [name, subdir] of dir.subdirs.entries()) {
      const dirPath = prefix ? `${prefix}/${name}` : name
      const { chainPath, chainDir, chainPaths } = walkChain(subdir, dirPath)
      const expanded = expandedDirs.has(chainPath)
      // Display name is the full flattened path segment, e.g. 'tui/opentui'
      const displayName = chainPath.slice(prefix ? prefix.length + 1 : 0)
      nodes.push({ kind: 'dir', path: chainPath, name: displayName, depth, expanded, chainPaths })
      if (expanded) {
        visit(chainDir, chainPath, depth + 1)
      }
    }
    for (const entry of dir.files) {
      const name = entry.path.split('/').at(-1) ?? entry.path
      nodes.push({ kind: 'file', path: entry.path, name, depth, x: entry.x, y: entry.y, previousPath: entry.previousPath })
    }
  }

  visit(root, '', 0)
  return nodes
}

export function gitFileTreeDirectories(entries: GitStatusEntry[]): Set<string> {
  const dirs = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'))
    }
  }
  return dirs
}
