import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Traces a pruned production node_modules for packaging (e.g. the Tauri
  // desktop sidecar); keep serverExternalPackages/node:sqlite indirection
  // working under standalone tracing — see CLAUDE.md's node:sqlite note.
  output: 'standalone',
  // .agent-viewer-data is gitignored runtime state (search index, coord
  // worktrees, tags) — never packaging input. Without this, the tracer
  // sweeps up nested worktree symlinks under it and fails to copy them.
  outputFileTracingExcludes: {
    '*': ['.agent-viewer-data/**'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  logging: {
    browserToTerminal: 'warn',
  },
  devIndicators: false,
  // Keep agent SDKs as server-side externals — they use Node.js APIs and native
  // modules (filesystem, process spawning, Koffi) that Turbopack cannot bundle.
  serverExternalPackages: [
    '@anthropic-ai/claude-agent-sdk',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
    '@github/copilot-sdk',
  ],
}

export default nextConfig
