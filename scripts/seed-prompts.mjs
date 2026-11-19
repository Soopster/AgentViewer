#!/usr/bin/env node
// Seeds a few example prompts into .agent-viewer-data/prompts/ so the prompt
// library has something to show on a fresh checkout. Skips entirely if any
// prompt files already exist — never overwrites user-authored prompts.
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PROMPTS_DIR = path.join(process.cwd(), '.agent-viewer-data', 'prompts')

const SEEDS = [
  {
    slug: 'explain-codebase',
    title: 'Explain this codebase',
    description: 'High-level summary of the repository and key areas',
    tags: ['seed', 'example'],
    providers: ['claude', 'codex', 'opencode'],
    body: 'Provide a high-level explanation of this codebase. Describe the major modules, how they interact, and any important files to look at.\n\nInclude suggested next steps for a new contributor.',
  },
  {
    slug: 'run-tests-summarise-failures',
    title: 'Run tests and summarise failures',
    description: 'Run the tests and summarise failing tests and stack traces',
    tags: ['seed', 'example'],
    providers: ['codex', 'opencode'],
    body: 'Run the test suite for {{target}}. If there are failures, summarise the top failures and suggest likely fixes.\n\nInclude file paths and error messages.',
  },
  {
    slug: 'summarise-diff',
    title: 'Summarise the diff on this branch',
    description: 'Summarise the Git diff for the current branch',
    tags: ['seed', 'example'],
    providers: ['claude', 'copilot', 'codex'],
    body: 'Summarise the changes in the current working tree and recent commits. Highlight potential regressions, risk areas, and tests to add.',
  },
  {
    slug: 'review-pr',
    title: 'Review a pull request',
    description: 'Focused code review with a specific lens',
    tags: ['seed', 'example', 'review'],
    providers: [],
    body: 'Review the changes in {{target}} with a focus on {{focus}}.\n\nCall out anything risky, anything that could be simplified, and anything missing tests. Be specific — cite file paths and line numbers.',
  },
]

function frontmatter(seed, now) {
  const lines = [
    '---',
    `title: "${seed.title.replace(/"/g, '\\"')}"`,
    `description: "${seed.description.replace(/"/g, '\\"')}"`,
    `providers: [${seed.providers.map((p) => `"${p}"`).join(', ')}]`,
    `tags: [${seed.tags.map((t) => `"${t}"`).join(', ')}]`,
    `created_at: "${now}"`,
    `updated_at: "${now}"`,
    `slug: "${seed.slug}"`,
    '---',
    '',
    seed.body,
    '',
  ]
  return lines.join('\n')
}

async function main() {
  await mkdir(PROMPTS_DIR, { recursive: true })
  const existing = (await readdir(PROMPTS_DIR)).filter((name) => name.endsWith('.md'))
  if (existing.length > 0) {
    console.log(`Prompt library already has ${existing.length} prompt(s) under .agent-viewer-data/prompts/ — skipping seed.`)
    return
  }
  const now = new Date().toISOString()
  for (const seed of SEEDS) {
    const file = path.join(PROMPTS_DIR, `${seed.slug}.md`)
    await writeFile(file, frontmatter(seed, now), 'utf8')
    console.log(`Seeded ${seed.slug}.md`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
