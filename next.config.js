/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'fal.media', pathname: '/**' },
      { protocol: 'https', hostname: 'v3.fal.media', pathname: '/**' },
      { protocol: 'https', hostname: 'gateway.alpha.fal.ai', pathname: '/**' },
    ],
  },
}

module.exports = nextConfig
