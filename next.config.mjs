/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: { optimizePackageImports: ['lucide-react'] },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
      { source: '/img/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    ];
  },
};

export default nextConfig;
