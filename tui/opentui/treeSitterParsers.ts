import { addDefaultParsers } from '@opentui/core'
import type { FiletypeParserOptions } from '@opentui/core'
import { fileURLToPath } from 'node:url'

type ParserSpec = {
  filetype: string
  aliases?: string[]
  wasmName?: string
  queryDir?: string
  injections?: string[]
  injectionMapping?: FiletypeParserOptions['injectionMapping']
}

let registered = false

const MARKDOWN_INJECTION_MAP: NonNullable<FiletypeParserOptions['injectionMapping']> = {
  nodeTypes: {
    inline: 'markdown_inline',
    pipe_table_cell: 'markdown_inline',
  },
  infoStringMap: {
    bash: 'bash',
    c: 'c',
    'c#': 'csharp',
    'c++': 'cpp',
    cpp: 'cpp',
    csharp: 'csharp',
    css: 'css',
    dart: 'dart',
    elisp: 'elisp',
    elixir: 'elixir',
    embedded_template: 'embedded_template',
    embeddedtemplate: 'embedded_template',
    go: 'go',
    golang: 'go',
    html: 'html',
    java: 'java',
    javascript: 'javascript',
    javascriptreact: 'javascriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    markdown: 'markdown',
    md: 'markdown',
    objc: 'objc',
    objectivec: 'objc',
    'objective-c': 'objc',
    ocaml: 'ocaml',
    php: 'php',
    py: 'python',
    python: 'python',
    rescript: 'rescript',
    ruby: 'ruby',
    rust: 'rust',
    scala: 'scala',
    sh: 'bash',
    shell: 'bash',
    shellscript: 'bash',
    swift: 'swift',
    tla: 'tlaplus',
    'tla+': 'tlaplus',
    tlaplus: 'tlaplus',
    toml: 'toml',
    ts: 'typescript',
    tsx: 'typescriptreact',
    typescript: 'typescript',
    typescriptreact: 'typescriptreact',
    zig: 'zig',
    zsh: 'bash',
  },
}

function assetPath(dir: string, filename: string): string {
  return fileURLToPath(new URL(`../tree-sitter-assets/${dir}/${filename}`, import.meta.url))
}

function parser(spec: ParserSpec): FiletypeParserOptions {
  const dir = spec.queryDir ?? spec.filetype
  const wasmName = spec.wasmName ?? spec.filetype
  return {
    filetype: spec.filetype,
    aliases: spec.aliases,
    queries: {
      highlights: [assetPath(dir, 'highlights.scm')],
      injections: spec.injections?.map((filename) => assetPath(dir, filename)),
    },
    wasm: assetPath(dir, `tree-sitter-${wasmName}.wasm`),
    injectionMapping: spec.injectionMapping,
  }
}

const VENDORED_PARSERS: ParserSpec[] = [
  {
    filetype: 'bash',
    aliases: ['sh', 'shell', 'shellscript', 'zsh', 'ksh'],
  },
  {
    filetype: 'c',
    aliases: ['h'],
  },
  {
    filetype: 'cpp',
    aliases: ['c++', 'cc', 'cxx', 'hpp', 'hxx', 'hh', 'h++'],
  },
  {
    filetype: 'csharp',
    aliases: ['c#', 'cs', 'c_sharp'],
  },
  { filetype: 'css' },
  { filetype: 'dart' },
  {
    filetype: 'elisp',
    aliases: ['el', 'emacs-lisp', 'emacs_lisp'],
  },
  {
    filetype: 'elixir',
    aliases: ['ex', 'exs'],
  },
  {
    filetype: 'embedded_template',
    aliases: ['eex', 'ejs', 'erb'],
  },
  {
    filetype: 'go',
    aliases: ['golang'],
  },
  {
    filetype: 'html',
    aliases: ['htm', 'xhtml'],
  },
  { filetype: 'java' },
  {
    filetype: 'javascript',
    aliases: ['js', 'jsx', 'javascriptreact'],
  },
  { filetype: 'json' },
  {
    filetype: 'markdown',
    aliases: ['md', 'mdown', 'mkd'],
    injections: ['injections.scm'],
    injectionMapping: MARKDOWN_INJECTION_MAP,
  },
  { filetype: 'markdown_inline' },
  {
    filetype: 'objc',
    aliases: ['objective-c', 'objective_c', 'objectivec'],
  },
  {
    filetype: 'ocaml',
    aliases: ['ml', 'mli'],
  },
  {
    filetype: 'php',
    aliases: ['phtml'],
  },
  {
    filetype: 'python',
    aliases: ['py', 'pyi', 'pyw'],
  },
  {
    filetype: 'rescript',
    aliases: ['res', 'resi'],
  },
  {
    filetype: 'ruby',
    aliases: ['rb', 'rake'],
  },
  {
    filetype: 'rust',
    aliases: ['rs'],
  },
  {
    filetype: 'scala',
    aliases: ['sc'],
  },
  { filetype: 'swift' },
  {
    filetype: 'tlaplus',
    aliases: ['tla', 'tla+'],
  },
  { filetype: 'toml' },
  {
    filetype: 'typescript',
    aliases: ['ts', 'cts', 'mts'],
  },
  {
    filetype: 'typescriptreact',
    aliases: ['tsx', 'ctsx', 'mtsx'],
  },
  { filetype: 'zig' },
]

export function registerExtraTreeSitterParsers(): void {
  if (registered) return
  registered = true
  addDefaultParsers(VENDORED_PARSERS.map(parser))
}
