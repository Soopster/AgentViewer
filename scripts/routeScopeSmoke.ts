// Asserts lib/routeScopes.ts and the actual API routes agree.
//
// The scope table decides what a read-only paired device may reach. Anything
// undeclared falls back to `write`, so a missing entry fails closed rather
// than open — but silently locking a new route to full scope is still a bug,
// just a quieter one. This walks app/api and fails when:
//
//   - a route file exports a method the table does not declare, or
//   - the table declares a route or method that no longer exists.
//
// Same job as CAPABILITY_METHODS in lib/adapters/registry.ts: make the pairing
// of declaration and implementation impossible to drift.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ROUTE_SCOPES, requiredScopeFor, type HttpMethod } from '../lib/routeScopes'

const API_ROOT = path.join(process.cwd(), 'app', 'api')
const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

async function findRouteFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await findRouteFiles(full))
    else if (entry.name === 'route.ts') found.push(full)
  }
  return found
}

function routePattern(file: string): string {
  return `/api${file.slice(API_ROOT.length).replace(/\/route\.ts$/, '')}`
}

async function exportedMethods(file: string): Promise<HttpMethod[]> {
  const source = await readFile(file, 'utf8')
  return METHODS.filter((method) => new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source))
}

async function main() {
  const files = (await findRouteFiles(API_ROOT)).sort()
  const problems: string[] = []
  const seen = new Set<string>()
  let declared = 0

  for (const file of files) {
    const pattern = routePattern(file)
    seen.add(pattern)
    const methods = await exportedMethods(file)
    const entry = ROUTE_SCOPES[pattern]
    if (!entry) {
      problems.push(`undeclared route: ${pattern} (exports ${methods.join(', ') || 'nothing'})`)
      continue
    }
    for (const method of methods) {
      if (!entry[method]) problems.push(`undeclared method: ${method} ${pattern}`)
      else declared += 1
    }
    for (const method of Object.keys(entry) as HttpMethod[]) {
      if (!methods.includes(method)) problems.push(`declared but not exported: ${method} ${pattern}`)
    }
  }

  for (const pattern of Object.keys(ROUTE_SCOPES)) {
    if (!seen.has(pattern)) problems.push(`declared route no longer exists: ${pattern}`)
  }

  // The specificity rule is what keeps `/api/sessions/running` from being
  // resolved by `/api/sessions/[sessionId]`, so pin the cases that collide.
  const resolutions: Array<[string, string, 'read' | 'write']> = [
    ['GET', '/api/sessions/running', 'read'],
    ['GET', '/api/sessions/abc123', 'read'],
    ['POST', '/api/sessions/new', 'write'],
    ['POST', '/api/sessions/project/messages', 'read'],
    ['POST', '/api/sessions/abc123/messages', 'write'],
    ['GET', '/api/sessions/abc123/messages', 'read'],
    ['GET', '/api/remote-access', 'write'],
    ['GET', '/api/sessions/abc/messages/uuid-1/raw', 'write'],
    ['DELETE', '/api/sessions/abc123', 'write'],
    // Undeclared paths must fail closed.
    ['GET', '/api/some/brand/new/route', 'write'],
  ]
  for (const [method, pathname, expected] of resolutions) {
    const actual = requiredScopeFor(method, pathname)
    if (actual !== expected) problems.push(`resolution: ${method} ${pathname} → ${actual}, expected ${expected}`)
  }

  if (problems.length > 0) {
    console.error('Route scope smoke: FAIL')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`Route scope smoke: PASS (${files.length} routes, ${declared} methods declared, ${resolutions.length} resolutions pinned)`)
}

main().catch((error) => {
  console.error('Route scope smoke: FAIL', error)
  process.exit(1)
})
