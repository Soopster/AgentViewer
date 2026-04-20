/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { execFile } from 'child_process'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'

// ---------------------------------------------------------------------------
// Git data types
// ---------------------------------------------------------------------------

type GitData = {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  status: GitStatusEntry[]
  unstaged: string
  staged: string
  branches: string[]
  commits: string[]
}

type GitStatusEntry = {
  x: string
  y: string
  path: string
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

type TreeNode =
  | { kind: 'dir';  path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'file'; path: string; name: string; depth: number; x: string; y: string }

function buildVisibleNodes(entries: GitStatusEntry[], expandedDirs: Set<string>): TreeNode[] {
  // Build a nested map: dirPath → { subdirs, files }
  interface DirData { subdirs: Map<string, DirData>; files: GitStatusEntry[] }
  const root: DirData = { subdirs: new Map(), files: [] }

  for (const entry of entries) {
    const parts = entry.path.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      if (!cur.subdirs.has(seg)) cur.subdirs.set(seg, { subdirs: new Map(), files: [] })
      cur = cur.subdirs.get(seg)!
    }
    cur.files.push(entry)
  }

  const nodes: TreeNode[] = []

  function flatten(dir: DirData, prefix: string, depth: number) {
    // Directories first (alphabetical), then root-level files
    const sortedDirs = [...dir.subdirs.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [name, sub] of sortedDirs) {
      const dirPath = prefix ? `${prefix}/${name}` : name
      const expanded = expandedDirs.has(dirPath)
      nodes.push({ kind: 'dir', path: dirPath, name, depth, expanded })
      if (expanded) flatten(sub, dirPath, depth + 1)
    }
    for (const entry of dir.files) {
      const name = entry.path.split('/').at(-1) ?? entry.path
      nodes.push({ kind: 'file', path: entry.path, name, depth, x: entry.x, y: entry.y })
    }
  }

  flatten(root, '', 0)
  return nodes
}

function allDirPaths(entries: GitStatusEntry[]): Set<string> {
  const dirs = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'))
    }
  }
  return dirs
}

// ---------------------------------------------------------------------------
// Pane definitions
// ---------------------------------------------------------------------------

type PaneId = 0 | 1 | 2 | 3 | 4

const PANE_TITLES: Record<PaneId, string> = {
  0: 'Unstaged changes',
  1: 'Status',
  2: 'Files',
  3: 'Branches',
  4: 'Commits',
}

// ---------------------------------------------------------------------------
// GitPopover component
// ---------------------------------------------------------------------------

type GitKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  cwd?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: GitKeyEvent) => void) => void
}

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout) => {
      if (!err) {
        resolve(String(stdout).trimEnd())
        return
      }

      // git diff exits with code 1 when differences exist — stdout is in the error.
      if (typeof err === 'object' && err && 'stdout' in err) {
        const out = (err as { stdout?: unknown }).stdout
        if (!out) {
          resolve('')
          return
        }
        resolve(Buffer.isBuffer(out) ? out.toString('utf-8').trimEnd() : String(out).trimEnd())
        return
      }

      resolve('')
    })
  })
}

async function fetchGitData(cwd: string): Promise<GitData> {
  // Full working-tree diffs are deferred to the per-pane loader — on Windows,
  // `git diff` on a large repo adds seconds to popover open.
  const [branch, upstreamRaw, statusRaw, branchesRaw, commitsRaw] = await Promise.all([
    execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    execGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    execGit(cwd, ['status', '--porcelain', '-u']),
    execGit(cwd, ['branch', '-a', '--format=%(refname:short)']),
    execGit(cwd, ['log', '--oneline', '-30']),
  ])
  const unstaged = ''
  const staged = ''

  const upstream = upstreamRaw.startsWith('fatal') ? null : upstreamRaw || null
  const aheadBehindRaw = upstream
    ? await execGit(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
    : ''
  const [behindStr, aheadStr] = aheadBehindRaw.split('\t')
  const ahead = parseInt(aheadStr ?? '0', 10) || 0
  const behind = parseInt(behindStr ?? '0', 10) || 0

  const status: GitStatusEntry[] = statusRaw
    ? statusRaw.split('\n').filter(Boolean).map((line) => ({
        x: line[0] ?? ' ',
        y: line[1] ?? ' ',
        path: line.slice(3),
      }))
    : []

  const branches = branchesRaw ? branchesRaw.split('\n').filter(Boolean) : []
  const commits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : []

  return { branch: branch || 'HEAD', upstream, ahead, behind, status, unstaged, staged, branches, commits }
}

export function GitPopover({ cwd, theme, width, height, onClose, onKeyHandlerReady }: Props) {
  const repoCwd = cwd || process.cwd()
  const [data, setData] = useState<GitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [pane, setPane] = useState<PaneId>(2)
  const [treeCursor, setTreeCursor] = useState(0)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [branchIndex, setBranchIndex] = useState(0)
  const [commitIndex, setCommitIndex] = useState(0)
  const diffScrollRef = useRef<ScrollBoxRenderable>(null)
  const rightContentRequestRef = useRef(0)
  const rightContentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refresh on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    void fetchGitData(repoCwd)
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [repoCwd])

  // When data loads, expand all dirs and place cursor on the first file node
  useEffect(() => {
    if (!data) return
    const dirs = allDirPaths(data.status)
    setExpandedDirs(dirs)
    // Compute nodes inline so we can find the first file without waiting for
    // visibleNodes to recompute in a separate render cycle.
    const nodes = buildVisibleNodes(data.status, dirs)
    const firstFile = nodes.findIndex((n) => n.kind === 'file')
    setTreeCursor(firstFile >= 0 ? firstFile : 0)
  }, [data])

  // Visible tree nodes (recomputed when data or expanded state changes)
  const visibleNodes = useMemo(
    () => (data ? buildVisibleNodes(data.status, expandedDirs) : []),
    [data, expandedDirs],
  )

  // The file selected by the tree cursor (skip dirs for diff purposes)
  const selectedFilePath = useMemo(() => {
    const node = visibleNodes[treeCursor]
    return node?.kind === 'file' ? node.path : null
  }, [visibleNodes, treeCursor])

  // File count for the N of M counter
  const fileCount = useMemo(
    () => visibleNodes.filter((n) => n.kind === 'file').length,
    [visibleNodes],
  )
  const filePosition = useMemo(() => {
    let pos = 0
    for (let i = 0; i <= treeCursor && i < visibleNodes.length; i++) {
      if (visibleNodes[i]?.kind === 'file') pos++
    }
    return pos
  }, [visibleNodes, treeCursor])

  // Right-panel content is loaded in an effect so git commands do not block render.
  const [rightContent, setRightContent] = useState('Loading…')

  useEffect(() => {
    const requestId = ++rightContentRequestRef.current
    if (rightContentTimerRef.current) {
      clearTimeout(rightContentTimerRef.current)
      rightContentTimerRef.current = null
    }

    if (!data) {
      setContentLoading(false)
      setRightContent('Loading…')
      return () => {
        if (rightContentRequestRef.current === requestId) {
          rightContentRequestRef.current += 1
        }
      }
    }

    setRightContent('Loading…')
    setContentLoading(true)
    // Debounce keeps rapid navigation (j/k) from spawning a git process per
    // keystroke — costly on Windows where process creation is slow.
    rightContentTimerRef.current = setTimeout(() => {
      const activeRequestId = rightContentRequestRef.current
      void (async () => {
        let content = ''
        switch (pane) {
          case 0: {
            const [unstaged, staged] = await Promise.all([
              execGit(repoCwd, ['diff']),
              execGit(repoCwd, ['diff', '--cached']),
            ])
            content = unstaged || (staged
              ? '(no unstaged changes)\n\n' + staged
              : '(working tree clean)')
            break
          }
          case 1: {
            const parts = [`Branch:   ${data.branch}`]
            parts.push(data.upstream
              ? `Upstream: ${data.upstream}  ↑${data.ahead}  ↓${data.behind}`
              : 'No upstream configured')
            content = parts.join('\n')
            break
          }
          case 2: {
            if (!selectedFilePath) {
              content = data.status.length === 0 ? '(working tree clean)' : '(select a file)'
              break
            }
            const entry = data.status.find((e) => e.path === selectedFilePath)
            const isUntracked = entry?.x === '?' && entry?.y === '?'
            if (isUntracked) {
              content = await execGit(repoCwd, ['diff', '--no-index', '/dev/null', selectedFilePath]) || '(empty file)'
            } else {
              content = await execGit(repoCwd, ['diff', 'HEAD', '--', selectedFilePath])
                || await execGit(repoCwd, ['diff', '--cached', '--', selectedFilePath])
                || '(no changes)'
            }
            break
          }
          case 3: {
            const b = data.branches[branchIndex]
            content = b ? (await execGit(repoCwd, ['log', '--oneline', '-20', b]) || b) : '(no branches)'
            break
          }
          case 4: {
            const commit = data.commits[commitIndex]
            if (!commit) { content = '(no commits)'; break }
            const hash = commit.split(' ')[0]
            content = hash ? await execGit(repoCwd, ['show', '--stat', hash]) : commit
            break
          }
          default:
            content = ''
        }

        if (rightContentRequestRef.current !== activeRequestId) return
        setRightContent(content)
        setContentLoading(false)
        diffScrollRef.current?.scrollTo(0)
      })().catch(() => {
        if (rightContentRequestRef.current !== activeRequestId) return
        setContentLoading(false)
      })
    }, 180)

    return () => {
      if (rightContentTimerRef.current) {
        clearTimeout(rightContentTimerRef.current)
        rightContentTimerRef.current = null
      }
      if (rightContentRequestRef.current === requestId) {
        rightContentRequestRef.current += 1
      }
    }
  }, [branchIndex, commitIndex, data, pane, repoCwd, selectedFilePath])

  const handleKey = useCallback((key: GitKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }

    // 0–4 switch panes
    if (key.sequence >= '0' && key.sequence <= '4') {
      setPane(parseInt(key.sequence, 10) as PaneId)
      return
    }

    if (key.name === 'j' || key.name === 'down') {
      if (pane === 2) setTreeCursor((i) => Math.min(i + 1, visibleNodes.length - 1))
      else if (pane === 3 && data) setBranchIndex((i) => Math.min(i + 1, data.branches.length - 1))
      else if (pane === 4 && data) setCommitIndex((i) => Math.min(i + 1, data.commits.length - 1))
      else diffScrollRef.current?.scrollBy(1)
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      if (pane === 2) setTreeCursor((i) => Math.max(i - 1, 0))
      else if (pane === 3 && data) setBranchIndex((i) => Math.max(i - 1, 0))
      else if (pane === 4 && data) setCommitIndex((i) => Math.max(i - 1, 0))
      else diffScrollRef.current?.scrollBy(-1)
      return
    }

    // Enter / space: toggle dir expansion
    if ((key.name === 'return' || key.sequence === ' ') && pane === 2) {
      const node = visibleNodes[treeCursor]
      if (node?.kind === 'dir') {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          if (next.has(node.path)) next.delete(node.path)
          else next.add(node.path)
          return next
        })
      }
      return
    }

    if (key.name === 'd') { diffScrollRef.current?.scrollBy(10); return }
    if (key.name === 'u') { diffScrollRef.current?.scrollBy(-10); return }
    if (key.name === 'r') {
      setLoading(true)
      void fetchGitData(repoCwd)
        .then((next) => setData(next))
        .finally(() => setLoading(false))
      return
    }
  }, [data, onClose, pane, repoCwd, treeCursor, visibleNodes])

  // Register key handler with parent
  useEffect(() => {
    onKeyHandlerReady(handleKey)
  }, [handleKey, onKeyHandlerReady])

  // Dimensions
  const popW = Math.min(width - 4, 160)
  const popH = Math.min(height - 4, 60)
  const leftW = Math.min(40, Math.floor(popW * 0.28))
  const rightW = popW - leftW - 3
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)

  const leftInnerH = popH - 2
  const statusH = 4
  const treeH = Math.max(5, Math.min(14, (visibleNodes.length) + 3))
  const branchesH = Math.max(4, Math.min(8, (data?.branches.length ?? 0) + 3))
  const commitsH = Math.max(leftInnerH - statusH - treeH - branchesH, 4)
  const rightH = popH - 2

  function statusColor(x: string, y: string): string {
    if (x === '?' && y === '?') return theme.red  // untracked
    if (x.trim()) return theme.green              // staged change
    if (y === 'M') return theme.amber             // unstaged modified
    if (y === 'D') return theme.red               // deleted
    return theme.muted
  }

  const allDiffLines = rightContent.split('\n')
  // Cap rendered lines so large diffs do not stall the render loop — each
  // line becomes a box/text pair and OpenTUI does not virtualize scrollbox
  // children, so ~10k+ lines can visibly hang the app on Windows.
  const MAX_DIFF_LINES = 1500
  const diffTruncated = allDiffLines.length > MAX_DIFF_LINES
  const diffLines = diffTruncated ? allDiffLines.slice(0, MAX_DIFF_LINES) : allDiffLines

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="row"
      title=" Git "
      titleAlignment="left"
    >
      {/* ── Left column ─────────────────────────────────── */}
      <box width={leftW} flexDirection="column" border={['right']} borderStyle="single" borderColor={theme.border}>

        {/* [1] Status */}
        <box
          height={statusH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 1 ? theme.border2 : theme.border}
          backgroundColor={pane === 1 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 1 ? theme.cyan : 'transparent'}>
            <text fg={pane === 1 ? theme.surface : theme.muted}>[1] Status</text>
          </box>
          <box paddingX={1}>
            <text fg={theme.text} wrapMode="none">
              {loading ? 'loading…' : data ? `${data.branch}${data.upstream ? `  ↑${data.ahead}↓${data.behind}` : ''}` : '…'}
            </text>
          </box>
        </box>

        {/* [2] Files — tree view */}
        <box
          height={treeH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 2 ? theme.border2 : theme.border}
          backgroundColor={pane === 2 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} flexDirection="row" backgroundColor={pane === 2 ? theme.cyan : 'transparent'}>
            <text fg={pane === 2 ? theme.surface : theme.muted}>[2] Files</text>
            {pane === 2 && fileCount > 0 ? (
              <box flexGrow={1}>
                <text fg={pane === 2 ? theme.surface2 : theme.dim}>{`  ${filePosition}/${fileCount}`}</text>
              </box>
            ) : null}
          </box>

          {visibleNodes.slice(0, treeH - 2).map((node, i) => {
            const isCursor = i === treeCursor && pane === 2
            const indent = '  '.repeat(node.depth)
            let label: string
            let labelColor: string
            if (node.kind === 'dir') {
              label = `${indent}${node.expanded ? '▼' : '▶'} ${node.name}`
              labelColor = isCursor ? theme.text : theme.muted
            } else {
              const flags = `${node.x.trim() || node.y.trim() ? (node.x.trim() || node.y) : '??'}`
              label = `${indent}${flags} ${node.name}`
              labelColor = isCursor ? theme.text : statusColor(node.x, node.y)
            }
            return (
              <box
                key={node.path}
                paddingX={1}
                backgroundColor={isCursor ? theme.surface3 : 'transparent'}
              >
                <text fg={labelColor} wrapMode="none">{label}</text>
              </box>
            )
          })}

          {(!data || data.status.length === 0) ? (
            <box paddingX={1}><text fg={theme.dim}>clean</text></box>
          ) : null}
        </box>

        {/* [3] Branches */}
        <box
          height={branchesH}
          flexDirection="column"
          border={['bottom']} borderStyle="single"
          borderColor={pane === 3 ? theme.border2 : theme.border}
          backgroundColor={pane === 3 ? theme.surface2 : theme.surface}
        >
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 3 ? theme.cyan : 'transparent'}>
            <text fg={pane === 3 ? theme.surface : theme.muted}>[3] Branches</text>
          </box>
          {(data?.branches ?? []).slice(0, branchesH - 2).map((b, i) => {
            const isCurrent = b === data?.branch
            const isSel = i === branchIndex && pane === 3
            return (
              <box key={b} paddingX={1} backgroundColor={isSel ? theme.surface3 : 'transparent'}>
                <text fg={isCurrent ? theme.green : isSel ? theme.text : theme.muted} wrapMode="none">
                  {isCurrent ? `* ${b}` : `  ${b}`}
                </text>
              </box>
            )
          })}
        </box>

        {/* [4] Commits */}
        <box flexGrow={1} flexDirection="column" backgroundColor={pane === 4 ? theme.surface2 : theme.surface}>
          <box paddingX={1} width={leftW - 2} backgroundColor={pane === 4 ? theme.cyan : 'transparent'}>
            <text fg={pane === 4 ? theme.surface : theme.muted}>[4] Commits</text>
          </box>
          {(data?.commits ?? []).slice(0, commitsH - 1).map((c, i) => {
            const isSel = i === commitIndex && pane === 4
            const spaceIdx = c.indexOf(' ')
            const hash = spaceIdx > 0 ? c.slice(0, spaceIdx) : c
            const msg = spaceIdx > 0 ? c.slice(spaceIdx + 1) : ''
            return (
              <box key={c} paddingX={1} flexDirection="row" backgroundColor={isSel ? theme.surface3 : 'transparent'}>
                <text fg={theme.amber} wrapMode="none">{hash} </text>
                <text fg={isSel ? theme.text : theme.dim} wrapMode="none">
                  {msg.slice(0, leftW - hash.length - 4)}
                </text>
              </box>
            )
          })}
        </box>
      </box>

      {/* ── Right column ────────────────────────────────── */}
      <box flexGrow={1} flexDirection="column">
        <box paddingX={1}>
          <text fg={theme.cyan}>{`[0] ${PANE_TITLES[pane]}  ·  j/k  enter toggle  r refresh  esc close`}</text>
        </box>
        <scrollbox
          ref={diffScrollRef}
          width={rightW}
          height={rightH - 1}
          backgroundColor={theme.surface}
          scrollY
          scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
        >
          {contentLoading && diffLines.length === 1 && diffLines[0] === 'Loading…' ? (
            <box width={rightW}>
              <text fg={theme.dim} wrapMode="none">loading…</text>
            </box>
          ) : (
            <>
              {diffLines.map((line, i) => {
                const fg = line.startsWith('+') && !line.startsWith('+++')
                  ? theme.green
                  : line.startsWith('-') && !line.startsWith('---')
                    ? theme.red
                    : line.startsWith('@@')
                      ? theme.cyan
                      : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
                        ? theme.muted
                        : theme.text
                return (
                  <box key={i} width={rightW}>
                    <text fg={fg} wrapMode="none">{line || ' '}</text>
                  </box>
                )
              })}
              {diffTruncated && (
                <box width={rightW}>
                  <text fg={theme.amber} wrapMode="none">
                    {`… diff truncated — ${allDiffLines.length - MAX_DIFF_LINES} more lines not shown`}
                  </text>
                </box>
              )}
            </>
          )}
        </scrollbox>
      </box>
    </box>
  )
}
