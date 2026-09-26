import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Traces a pruned production node_modules for packaging (e.g. the Tauri
  // desktop sidecar); keep serverExternalPackages/node:sqlite indirection
  // working under standalone tracing — see CLAUDE.md's node:sqlite note.
  output: 'standalone',
  // Non-packaging directories the tracer otherwise sweeps into the
  // standalone output: .agent-viewer-data is gitignored runtime state
  // (search index, coord worktrees, tags) whose nested worktree symlinks
  // fail to copy; .git and src-tauri/** are source-control/build-tool
  // metadata, and src-tauri/resources + src-tauri/target/release are this
  // same standalone output from a *previous* build, so leaving them
  // unexcluded lets each rebuild sweep up the last one's artifacts —
  // confirmed by finding a stray .git/info/exclude nested three levels
  // deep inside a rebuilt src-tauri/resources/next-standalone/.
  outputFileTracingExcludes: {
    '*': ['.agent-viewer-data/**', '.git/**', 'src-tauri/**'],
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
