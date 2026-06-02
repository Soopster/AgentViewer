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
  // Keep the Agent SDK as a server-side external — it uses Node.js APIs
  // (filesystem, process spawning) that can't be bundled for the browser
  serverExternalPackages: [
    '@anthropic-ai/claude-agent-sdk',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
  ],
}

export default nextConfig
