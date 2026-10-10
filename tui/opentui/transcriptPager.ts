import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The transcript is drawn on the alternate screen, so the terminal's own search
// and copy tools cannot see it. This hands the whole conversation back to them:
// written to a temporary file and opened in the user's pager or editor while
// the renderer is suspended, the way Claude Code's fullscreen `v` does.

export type TranscriptPagerRenderer = {
  suspend(): void
  resume(): void
}

export type PagerEnv = Record<string, string | undefined>

/**
 * What opens the file: `$VISUAL`, then `$EDITOR`, then a pager. Either variable
 * may carry arguments (`code --wait`), so it is run through the shell the way
 * git runs `core.editor`.
 */
export function transcriptPagerCommand(env: PagerEnv = process.env, platform = process.platform): string {
  const configured = env.VISUAL?.trim() || env.EDITOR?.trim()
  if (configured) return configured
  return platform === 'win32' ? 'more' : 'less'
}

export function openTranscriptInPager(
  renderer: TranscriptPagerRenderer,
  text: string,
  options: { env?: PagerEnv; platform?: NodeJS.Platform } = {},
): { ok: true; command: string } | { ok: false; command: string; error: string } {
  const platform = options.platform ?? process.platform
  const command = transcriptPagerCommand(options.env, platform)
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-viewer-transcript-'))
  const file = path.join(dir, 'transcript.txt')
  writeFileSync(file, text, { mode: 0o600 })
  renderer.suspend()
  try {
    const result = platform === 'win32'
      ? spawnSync(`${command} "${file}"`, { stdio: 'inherit', shell: true })
      : spawnSync('/bin/sh', ['-c', `${command} "$1"`, 'sh', file], { stdio: 'inherit' })
    if (result.error) return { ok: false, command, error: result.error.message }
    if (result.status !== 0 && result.status !== null) {
      return { ok: false, command, error: `exited with status ${result.status}` }
    }
    return { ok: true, command }
  } finally {
    renderer.resume()
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Claude Code's and Codex's ⌃G: the prompt opens in `$VISUAL`/`$EDITOR` (falling
 * back to vi, not a pager — this one is for writing) and comes back as whatever
 * was saved. An editor that fails hands back nothing, so the draft is kept.
 */
export function editTextInEditor(
  renderer: TranscriptPagerRenderer,
  text: string,
  options: { env?: PagerEnv; platform?: NodeJS.Platform } = {},
): { ok: true; text: string } | { ok: false; command: string; error: string } {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const command = env.VISUAL?.trim() || env.EDITOR?.trim() || (platform === 'win32' ? 'notepad' : 'vi')
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-viewer-prompt-'))
  const file = path.join(dir, 'prompt.md')
  writeFileSync(file, text, { mode: 0o600 })
  renderer.suspend()
  try {
    const result = platform === 'win32'
      ? spawnSync(`${command} "${file}"`, { stdio: 'inherit', shell: true })
      : spawnSync('/bin/sh', ['-c', `${command} "$1"`, 'sh', file], { stdio: 'inherit' })
    if (result.error) return { ok: false, command, error: result.error.message }
    if (result.status !== 0 && result.status !== null) {
      return { ok: false, command, error: `exited with status ${result.status}` }
    }
    // Editors add a trailing newline on save; a prompt does not want it.
    return { ok: true, text: readFileSync(file, 'utf8').replace(/\r?\n$/, '') }
  } finally {
    renderer.resume()
    rmSync(dir, { recursive: true, force: true })
  }
}
