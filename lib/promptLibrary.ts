import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { isAgentProvider } from './provider'
import type { AgentProvider } from './types'

// Prompt library entries are local-only state stored as markdown files (YAML
// frontmatter + body) under .agent-viewer-data/prompts/ — one file per prompt,
// keyed by slug. This mirrors how tags/title overrides/bookmarks are mirrored
// locally, but uses plain markdown so prompts are easy to read, edit, and sync
// outside the app (e.g. via git or a notes tool).
const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const PROMPTS_DIR = path.join(DATA_DIR, 'prompts')

export type PromptMeta = {
  slug: string
  title: string
  description: string
  tags: string[]
  /** Providers this prompt is tailored for; empty = usable with any provider. */
  providers: AgentProvider[]
  createdAt: string
  updatedAt: string
}

export type PromptRecord = {
  meta: PromptMeta
  body: string
  /** `{{name}}` tokens found in the body, in first-seen order. */
  placeholders: string[]
}

export type PromptSummary = PromptMeta & {
  /** Flattened, truncated excerpt of the body for list views. */
  preview: string
  placeholders: string[]
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][\w.-]*)\s*\}\}/g
const PREVIEW_LENGTH = 220

let dirReady: Promise<void> | null = null

function ensurePromptsDir(): Promise<void> {
  if (!dirReady) dirReady = mkdir(PROMPTS_DIR, { recursive: true }).then(() => undefined)
  return dirReady
}

export function sanitizeSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug
}

function uniqueSlug(input: string, taken: Set<string>): string {
  const base = sanitizeSlug(input) || 'prompt'
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return []
}

function toProviderArray(value: unknown): AgentProvider[] {
  return toStringArray(value).filter(isAgentProvider)
}

function normalizeMeta(slug: string, data: Record<string, unknown>): PromptMeta {
  const now = new Date().toISOString()
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : slug
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  return {
    slug,
    title,
    description,
    tags: toStringArray(data.tags),
    providers: toProviderArray(data.providers),
    createdAt: typeof data.created_at === 'string' ? data.created_at : now,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : now,
  }
}

export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** Replace `{{name}}` tokens with provided values; tokens left unfilled (or filled with '') stay intact. */
export function applyPlaceholders(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_PATTERN, (full, name: string) => {
    const value = values[name]
    return value && value.length > 0 ? value : full
  })
}

function buildPreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH).trimEnd()}…` : flat
}

function toRecord(slug: string, raw: string): PromptRecord {
  const parsed = matter(raw)
  const meta = normalizeMeta(slug, parsed.data as Record<string, unknown>)
  const body = parsed.content.trim()
  return { meta, body, placeholders: extractPlaceholders(body) }
}

/** Serialize a prompt to markdown with YAML frontmatter — the on-disk format. */
export function serializePrompt(meta: Omit<PromptMeta, 'slug'>, body: string): string {
  const data: Record<string, unknown> = {
    title: meta.title,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
  }
  if (meta.description) data.description = meta.description
  if (meta.tags.length) data.tags = meta.tags
  if (meta.providers.length) data.providers = meta.providers
  return matter.stringify(`${body.trim()}\n`, data)
}

async function readPromptFile(slug: string): Promise<PromptRecord | null> {
  try {
    const raw = await readFile(path.join(PROMPTS_DIR, `${slug}.md`), 'utf8')
    return toRecord(slug, raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writePromptFile(slug: string, content: string): Promise<void> {
  await ensurePromptsDir()
  const file = path.join(PROMPTS_DIR, `${slug}.md`)
  const tmp = path.join(PROMPTS_DIR, `.${slug}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

export async function listPrompts(): Promise<PromptSummary[]> {
  await ensurePromptsDir()
  let entries: string[]
  try {
    entries = (await readdir(PROMPTS_DIR)).filter((name) => name.endsWith('.md') && !name.startsWith('.'))
  } catch {
    return []
  }
  const summaries: PromptSummary[] = []
  for (const name of entries) {
    const slug = name.slice(0, -3)
    try {
      const raw = await readFile(path.join(PROMPTS_DIR, name), 'utf8')
      const record = toRecord(slug, raw)
      summaries.push({ ...record.meta, preview: buildPreview(record.body), placeholders: record.placeholders })
    } catch {
      // skip unreadable/corrupt files rather than failing the whole list
    }
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return summaries
}

export async function getPrompt(slug: string): Promise<PromptRecord | null> {
  return readPromptFile(sanitizeSlug(slug))
}

export type SavePromptInput = {
  /** Existing slug to update; omit to create a new prompt. */
  slug?: string
  title: string
  description?: string
  tags?: string[]
  providers?: AgentProvider[]
  body: string
}

/** Create or update a prompt. Returns the saved record (slug may differ from input on create). */
export async function savePrompt(input: SavePromptInput): Promise<PromptRecord> {
  await ensurePromptsDir()
  const now = new Date().toISOString()
  const title = input.title.trim() || 'Untitled prompt'
  const description = (input.description ?? '').trim()
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  const providers = (input.providers ?? []).filter(isAgentProvider)
  const body = input.body

  if (input.slug) {
    const slug = sanitizeSlug(input.slug)
    const existing = await readPromptFile(slug)
    const meta: PromptMeta = {
      slug,
      title,
      description,
      tags,
      providers,
      createdAt: existing?.meta.createdAt ?? now,
      updatedAt: now,
    }
    await writePromptFile(slug, serializePrompt(meta, body))
    return { meta, body: body.trim(), placeholders: extractPlaceholders(body) }
  }

  const existingSlugs = new Set((await listPrompts()).map((entry) => entry.slug))
  const slug = uniqueSlug(title, existingSlugs)
  const meta: PromptMeta = { slug, title, description, tags, providers, createdAt: now, updatedAt: now }
  await writePromptFile(slug, serializePrompt(meta, body))
  return { meta, body: body.trim(), placeholders: extractPlaceholders(body) }
}

export async function deletePrompt(slug: string): Promise<boolean> {
  const safe = sanitizeSlug(slug)
  try {
    await unlink(path.join(PROMPTS_DIR, `${safe}.md`))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
