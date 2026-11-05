// The user's own ⌃K chords: rebinding the built-in ones and adding commands of
// their own (herdr's keys.json and `[[keys.command]]`).
//
// Read from the USER's config only — `$AGENT_VIEWER_KEYS_FILE`, else
// `$XDG_CONFIG_HOME/agent-viewer/keys.json` (~/.config/…). Never from the
// project: a command named by a cloned repository would run its author's code
// the first time someone pressed a key, the same rule as coordinator command hooks.
//
//   {
//     "chords": { "x": "coord-board", "b": null },       // key → palette command id; null unbinds
//     "commands": [ { "key": "g", "name": "lazygit", "run": ["lazygit"] } ]
//   }
//
// A custom command runs as a managed process in the Terminal view. `run` is argv:
// it is quoted into one shell line here, so a value can never become syntax.

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PORTABLE_COMMAND_CHORDS } from './shortcutKeys'
import { quoteArgv, type ShellDialect } from '../../lib/shellQuote'

export type ChordBinding = { command: string; label: string; short?: string; hint?: false }
export type UserCommand = { key: string; name: string; run: string[] }
export type UserKeyConfig = { chords: Record<string, string | null>; commands: UserCommand[]; problems: string[] }
export type ResolvedChords = { bindings: Map<string, ChordBinding>; commands: Map<string, UserCommand>; problems: string[] }

export const USER_COMMAND_PREFIX = 'user:'
/** `?` opens the chord help and Escape/⌃C/⌃G cancel, so none may be rebound. */
const RESERVED_KEYS = new Set(['?', 'escape'])

export function userKeysPath(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENT_VIEWER_KEYS_FILE) return env.AGENT_VIEWER_KEYS_FILE
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agent-viewer', 'keys.json')
}

function parseLenient(raw: string): unknown {
  // Comments and trailing commas are what people write in a config file.
  return JSON.parse(raw
    .replace(/^﻿/, '')
    .replace(/(^|[^:])\/\/[^\n\r]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1')) as unknown
}

const isChordKey = (key: unknown): key is string => typeof key === 'string' && [...key].length === 1 && !RESERVED_KEYS.has(key)

export function parseUserKeyConfig(raw: string | null): UserKeyConfig {
  const config: UserKeyConfig = { chords: {}, commands: [], problems: [] }
  if (raw === null) return config
  let parsed: unknown
  try { parsed = parseLenient(raw) } catch (error) {
    config.problems.push(`keys.json is not valid JSON (${error instanceof Error ? error.message : 'parse error'}); using the defaults`)
    return config
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    config.problems.push('keys.json must be an object; using the defaults')
    return config
  }
  const { chords, commands } = parsed as { chords?: unknown; commands?: unknown }
  if (chords && typeof chords === 'object' && !Array.isArray(chords)) {
    for (const [key, value] of Object.entries(chords)) {
      if (!isChordKey(key)) config.problems.push(`chords: "${key}" is not a bindable single key`)
      else if (value !== null && (typeof value !== 'string' || !value)) config.problems.push(`chords: "${key}" must be a command id or null`)
      else config.chords[key.toLowerCase()] = value as string | null
    }
  }
  if (Array.isArray(commands)) {
    for (const entry of commands) {
      const { key, name, run } = (entry ?? {}) as Record<string, unknown>
      if (!isChordKey(key)) config.problems.push(`commands: "${String(key)}" is not a bindable single key`)
      else if (typeof name !== 'string' || !name.trim()) config.problems.push(`commands: "${key}" needs a name`)
      else if (!Array.isArray(run) || run.length === 0 || !run.every((part) => typeof part === 'string' && part)) config.problems.push(`commands: "${name}" needs run as a non-empty array of strings`)
      else config.commands.push({ key: key.toLowerCase(), name: name.trim(), run: run as string[] })
    }
  }
  return config
}

export function readUserKeyConfig(file = userKeysPath()): UserKeyConfig {
  try { return parseUserKeyConfig(readFileSync(file, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseUserKeyConfig(null)
    return { chords: {}, commands: [], problems: [`keys.json could not be read (${error instanceof Error ? error.message : 'error'})`] }
  }
}

/**
 * The built-in table with the user's changes on top. `knownCommands` maps each
 * palette command id to its label: an id that names nothing is a problem, never
 * a chord that silently does nothing. The user's entry always wins a collision,
 * and says what it displaced.
 */
export function resolveChords(config: UserKeyConfig, knownCommands: ReadonlyMap<string, string>): ResolvedChords {
  const bindings = new Map<string, ChordBinding>(Object.entries(PORTABLE_COMMAND_CHORDS).map(([key, entry]) => [key, { ...entry }]))
  const commands = new Map<string, UserCommand>()
  const problems = [...config.problems]
  const claimed = new Set<string>()
  const displace = (key: string, by: string) => {
    const previous = bindings.get(key)
    if (previous && !claimed.has(key)) problems.push(`⌃K ${key} was "${previous.label}"; now ${by}`)
    claimed.add(key)
  }
  for (const [key, command] of Object.entries(config.chords)) {
    if (command === null) { bindings.delete(key); claimed.add(key); continue }
    const label = knownCommands.get(command)
    if (label === undefined) { problems.push(`chords: "${key}" names an unknown command "${command}"`); continue }
    displace(key, `"${label}"`)
    bindings.set(key, { command, label, short: label.toLowerCase().slice(0, 8) })
  }
  for (const entry of config.commands) {
    if (claimed.has(entry.key) && !bindings.has(entry.key) && commands.has(entry.key)) continue
    if (commands.has(entry.key)) { problems.push(`commands: "${entry.key}" is bound twice; the first stays`); continue }
    displace(entry.key, `"${entry.name}"`)
    commands.set(entry.key, entry)
    bindings.set(entry.key, { command: `${USER_COMMAND_PREFIX}${entry.key}`, label: `Run ${entry.name}`, short: entry.name.slice(0, 8) })
  }
  return { bindings, commands, problems }
}

let active: ResolvedChords | null = null

/** Installed once at boot, before the first render. Tests install their own. */
export function installUserKeys(resolved: ResolvedChords | null): void { active = resolved }
export const activeChordBindings = (): ReadonlyMap<string, ChordBinding> | null => active?.bindings ?? null
export const userKeyProblems = (): readonly string[] => active?.problems ?? []
export const userCommandForChordId = (id: string): UserCommand | null =>
  id.startsWith(USER_COMMAND_PREFIX) ? active?.commands.get(id.slice(USER_COMMAND_PREFIX.length)) ?? null : null

/** One command line from argv for the shell that will read it (POSIX unless told otherwise). */
export function shellQuoteArgv(argv: readonly string[], dialect: ShellDialect = 'posix'): string {
  return quoteArgv(argv, dialect)
}
