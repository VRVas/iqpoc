/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Externalize heavy Node.js SDK so webpack doesn't bundle it
    serverComponentsExternalPackages: ['@azure/identity'],
  },
}
module.exports = nextConfig