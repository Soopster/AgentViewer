import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'

export type EditorLspServerSpec = { command: string; args: string[]; name: string }

const moduleRequire = createRequire(import.meta.url)

function typescriptLspCommand(): EditorLspServerSpec[] {
  const packagedCommand = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  const native = (command: string): EditorLspServerSpec => ({ command, args: ['--lsp', '--stdio'], name: 'TypeScript 7' })
  if (packagedCommand) return [native(packagedCommand)]
  const specs: EditorLspServerSpec[] = []
  try {
    const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}/package.json`
    const packagePath = moduleRequire.resolve(platformPackage)
    specs.push(native(join(dirname(packagePath), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')))
  } catch { /* the native server is not installed for this platform */ }
  // Bare `tsc` is not a fallback: TypeScript 5's compiler has no `--lsp`, so it
  // would spawn, reject the flags and die. The community server is the real
  // second choice, and it is what most machines already have.
  specs.push({ command: 'typescript-language-server', args: ['--stdio'], name: 'typescript-language-server' })
  return specs
}

const TYPESCRIPT_FILETYPES = new Set(['javascript', 'javascriptreact', 'typescript', 'typescriptreact'])

/**
 * Built-in servers per filetype, in preference order. A filetype may list
 * several: the first one actually installed wins, so a machine with basedpyright
 * and one with pylsp both work with no configuration.
 */
const SERVER_BY_FILETYPE: Readonly<Record<string, readonly EditorLspServerSpec[]>> = {
  bash: [{ command: 'bash-language-server', args: ['start'], name: 'bash-language-server' }],
  c: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  clojure: [{ command: 'clojure-lsp', args: [], name: 'clojure-lsp' }],
  cpp: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  csharp: [{ command: 'roslyn-language-server', args: ['--stdio'], name: 'Roslyn' }],
  css: [{ command: 'vscode-css-language-server', args: ['--stdio'], name: 'css-language-server' }],
  dart: [{ command: 'dart', args: ['language-server', '--protocol=lsp'], name: 'Dart' }],
  dockerfile: [{ command: 'docker-langserver', args: ['--stdio'], name: 'dockerfile-language-server' }],
  elixir: [
    { command: 'elixir-ls', args: [], name: 'ElixirLS' },
    { command: 'lexical', args: [], name: 'Lexical' },
  ],
  elm: [{ command: 'elm-language-server', args: [], name: 'elm-language-server' }],
  erlang: [{ command: 'erlang_ls', args: [], name: 'erlang_ls' }],
  go: [{ command: 'gopls', args: [], name: 'gopls' }],
  graphql: [{ command: 'graphql-lsp', args: ['server', '-m', 'stream'], name: 'graphql-language-service' }],
  haskell: [{ command: 'haskell-language-server-wrapper', args: ['--lsp'], name: 'haskell-language-server' }],
  html: [{ command: 'vscode-html-language-server', args: ['--stdio'], name: 'html-language-server' }],
  java: [
    { command: 'jdtls', args: [], name: 'Eclipse JDT LS' },
    { command: 'java-language-server', args: [], name: 'java-language-server' },
  ],
  json: [{ command: 'vscode-json-language-server', args: ['--stdio'], name: 'json-language-server' }],
  julia: [{ command: 'julia-lsp', args: [], name: 'julia-lsp' }],
  kotlin: [{ command: 'kotlin-language-server', args: [], name: 'kotlin-language-server' }],
  lua: [{ command: 'lua-language-server', args: [], name: 'lua-language-server' }],
  markdown: [
    { command: 'marksman', args: ['server'], name: 'Marksman' },
    { command: 'vscode-markdown-language-server', args: ['--stdio'], name: 'markdown-language-server' },
  ],
  nix: [
    { command: 'nixd', args: [], name: 'nixd' },
    { command: 'nil', args: [], name: 'nil' },
  ],
  objc: [{ command: 'clangd', args: ['--background-index'], name: 'clangd' }],
  ocaml: [{ command: 'ocamllsp', args: [], name: 'ocaml-lsp' }],
  php: [
    { command: 'intelephense', args: ['--stdio'], name: 'Intelephense' },
    { command: 'phpactor', args: ['language-server'], name: 'Phpactor' },
  ],
  powershell: [{ command: 'powershell-editor-services', args: ['--stdio'], name: 'PowerShell Editor Services' }],
  python: [
    { command: 'basedpyright-langserver', args: ['--stdio'], name: 'basedpyright' },
    { command: 'pyright-langserver', args: ['--stdio'], name: 'pyright' },
    { command: 'ruff', args: ['server'], name: 'Ruff' },
    { command: 'pylsp', args: [], name: 'pylsp' },
  ],
  r: [{ command: 'R', args: ['--slave', '-e', 'languageserver::run()'], name: 'r-languageserver' }],
  ruby: [
    { command: 'ruby-lsp', args: [], name: 'ruby-lsp' },
    { command: 'solargraph', args: ['stdio'], name: 'Solargraph' },
  ],
  rust: [{ command: 'rust-analyzer', args: [], name: 'rust-analyzer' }],
  scala: [{ command: 'metals', args: [], name: 'Metals' }],
  solidity: [{ command: 'nomicfoundation-solidity-language-server', args: ['--stdio'], name: 'Solidity' }],
  sql: [{ command: 'sqls', args: [], name: 'sqls' }],
  svelte: [{ command: 'svelteserver', args: ['--stdio'], name: 'svelte-language-server' }],
  swift: [{ command: 'sourcekit-lsp', args: [], name: 'SourceKit-LSP' }],
  terraform: [
    { command: 'terraform-ls', args: ['serve'], name: 'terraform-ls' },
    { command: 'tofu-ls', args: ['serve'], name: 'tofu-ls' },
  ],
  tex: [{ command: 'texlab', args: [], name: 'TexLab' }],
  toml: [{ command: 'taplo', args: ['lsp', 'stdio'], name: 'Taplo' }],
  vue: [{ command: 'vue-language-server', args: ['--stdio'], name: 'vue-language-server' }],
  yaml: [{ command: 'yaml-language-server', args: ['--stdio'], name: 'yaml-language-server' }],
  zig: [{ command: 'zls', args: [], name: 'zls' }],
}

export type EditorLspConfig = {
  /** Servers to try for a filetype, replacing the built-ins unless `extend` is set. */
  servers?: Record<string, Array<{ command: string; args?: string[]; name?: string; extend?: boolean }>>
  /** Extra filenames or directories that mark a workspace root, per filetype. */
  rootMarkers?: Record<string, string[]>
  /** Filetypes to never start a server for. */
  disabled?: string[]
}

const CONFIG_FILENAMES = ['.agent-viewer/lsp.json', '.agent-viewer-lsp.json']

type LoadedConfig = { config: EditorLspConfig; source: string | null; error: string | null }

const configCache = new Map<string, LoadedConfig>()

function parseConfig(raw: string): EditorLspConfig {
  // Trailing commas and `//` comments are what people actually write in an
  // editor config file; refusing the file over one is worse than accepting it.
  const stripped = raw
    .replace(/^﻿/, '')
    .replace(/(^|[^:])\/\/[^\n\r]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1')
  const parsed = JSON.parse(stripped) as unknown
  return parsed && typeof parsed === 'object' ? parsed as EditorLspConfig : {}
}

/** The nearest `lsp.json` at or above `root`, cached per root. */
export function loadEditorLspConfig(root: string): LoadedConfig {
  const cached = configCache.get(root)
  if (cached) return cached
  let loaded: LoadedConfig = { config: {}, source: null, error: null }
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(root, filename)
    if (!existsSync(candidate)) continue
    try {
      loaded = { config: parseConfig(readFileSync(candidate, 'utf8')), source: candidate, error: null }
    } catch (error) {
      loaded = { config: {}, source: candidate, error: error instanceof Error ? error.message : 'unreadable' }
    }
    break
  }
  configCache.set(root, loaded)
  return loaded
}

export function clearEditorLspConfigCache(): void {
  configCache.clear()
}

function builtinSpecs(filetype: string): readonly EditorLspServerSpec[] {
  if (TYPESCRIPT_FILETYPES.has(filetype)) return typescriptLspCommand()
  return SERVER_BY_FILETYPE[filetype] ?? []
}

/**
 * The servers to try for a filetype, in order. Without a project config this is
 * the built-in table; a config entry replaces that list, or prepends to it when
 * the entry sets `extend`, so a project can add one server without restating
 * the defaults.
 */
export function getEditorLspServerSpecs(filetype: string, root?: string): readonly EditorLspServerSpec[] {
  const builtin = builtinSpecs(filetype)
  if (!root) return builtin
  const { config } = loadEditorLspConfig(root)
  if (config.disabled?.includes(filetype)) return []
  const configured = config.servers?.[filetype]
  if (!configured || configured.length === 0) return builtin
  const specs = configured
    .filter((entry) => entry && typeof entry.command === 'string' && entry.command.length > 0)
    .map((entry) => ({
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === 'string') : [],
      name: entry.name ?? entry.command,
    }))
  const extend = configured.some((entry) => entry?.extend === true)
  return extend ? [...specs, ...builtin] : specs
}

/**
 * Files or directories that mark the root of a workspace for a language.
 * Getting this right matters: gopls indexes the module, rust-analyzer the
 * Cargo workspace, and pointing either at the repository root of a polyglot
 * monorepo makes them index everything or nothing.
 */
const ROOT_MARKERS: Readonly<Record<string, readonly string[]>> = {
  c: ['compile_commands.json', '.clangd', 'CMakeLists.txt', 'Makefile'],
  clojure: ['project.clj', 'deps.edn'],
  cpp: ['compile_commands.json', '.clangd', 'CMakeLists.txt', 'Makefile'],
  csharp: ['*.sln', '*.csproj'],
  dart: ['pubspec.yaml'],
  elixir: ['mix.exs'],
  elm: ['elm.json'],
  erlang: ['rebar.config'],
  go: ['go.mod', 'go.work'],
  haskell: ['stack.yaml', 'cabal.project', '*.cabal'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
  javascript: ['package.json', 'jsconfig.json'],
  javascriptreact: ['package.json', 'jsconfig.json'],
  kotlin: ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts'],
  objc: ['compile_commands.json'],
  ocaml: ['dune-project', '*.opam'],
  php: ['composer.json'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
  r: ['DESCRIPTION'],
  ruby: ['Gemfile', '*.gemspec'],
  rust: ['Cargo.toml'],
  scala: ['build.sbt', 'build.sc'],
  swift: ['Package.swift'],
  terraform: ['main.tf', '.terraform'],
  typescript: ['tsconfig.json', 'package.json'],
  typescriptreact: ['tsconfig.json', 'package.json'],
  zig: ['build.zig'],
}

const ALWAYS_ROOT = ['.git', '.hg', '.agent-viewer']

function markerExists(directory: string, marker: string): boolean {
  if (!marker.includes('*')) return existsSync(join(directory, marker))
  // A single glob suffix (`*.csproj`, `*.cabal`) is the only pattern the
  // markers use, and a readdir per directory is cheaper than a glob library.
  const suffix = marker.slice(marker.indexOf('*') + 1)
  try {
    const { readdirSync } = moduleRequire('node:fs') as typeof import('node:fs')
    return readdirSync(directory).some((entry) => entry.endsWith(suffix))
  } catch {
    return false
  }
}

/**
 * The directory a server should treat as the workspace for this file: the
 * nearest ancestor carrying one of the language's markers, never above
 * `fallbackRoot`. Falls back to `fallbackRoot`, so a file with no project
 * around it still gets a server.
 */
export function resolveLspWorkspaceRoot(filetype: string, filePath: string, fallbackRoot: string): string {
  const absolute = isAbsolute(filePath) ? filePath : resolve(fallbackRoot, filePath)
  const boundary = resolve(fallbackRoot)
  const configured = loadEditorLspConfig(boundary).config.rootMarkers?.[filetype] ?? []
  const markers = [...configured, ...(ROOT_MARKERS[filetype] ?? [])]
  if (markers.length === 0) return boundary
  const { root: filesystemRoot } = parse(absolute)
  let current = dirname(absolute)
  let gitRoot: string | null = null
  while (true) {
    if (markers.some((marker) => markerExists(current, marker))) return current
    if (!gitRoot && ALWAYS_ROOT.some((marker) => existsSync(join(current, marker)))) gitRoot = current
    if (current === boundary || current === filesystemRoot) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return gitRoot ?? boundary
}
