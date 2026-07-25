import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
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
