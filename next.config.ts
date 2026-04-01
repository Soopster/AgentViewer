import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep the Agent SDK as a server-side external — it uses Node.js APIs
  // (filesystem, process spawning) that can't be bundled for the browser
  serverExternalPackages: [
    '@anthropic-ai/claude-agent-sdk',
    '@mariozechner/pi-coding-agent',
    '@mariozechner/pi-agent-core',
    '@mariozechner/pi-ai',
  ],
}

export default nextConfig
