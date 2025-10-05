import bundleAnalyzerPlugin from '@next/bundle-analyzer';
import createJiti from 'jiti';
import { createSecureHeaders } from 'next-secure-headers';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV !== 'test') {
  const jiti = createJiti(fileURLToPath(import.meta.url));

  // Import env files to validate at build time. Use jiti so we can load .ts files in here.
  jiti('./src/env');
}

let debug = process.env.NEXT_PUBLIC_ENVIRONMENT === 'development';

/** @type {import('next').NextConfig} */
let nextConfig = {
  compiler: {
    removeConsole: debug,
  },
  eslint: {
    ignoreDuringBuilds: debug,
  },
  // https://nextjs.org/docs/basic-features/image-optimization#domains
  images: {
    remotePatterns: [
      {
        hostname: 'cdn.discordapp.com',
        protocol: 'https',
      },
      {
        hostname: 'lh3.googleusercontent.com',
        protocol: 'https',
      },
      {
        hostname: 'avatars.githubusercontent.com',
        protocol: 'https',
      },
      {
        hostname: 'images.unsplash.com',
        protocol: 'https',
      },
      {
        hostname: 'image.tmdb.org"',
        protocol: 'https',
      },
      {
        hostname: 'res.cloudinary.com',
        protocol: 'https',
      },
    ],
    // Cost
    unoptimized: true,
  },
  output: 'standalone',
  serverExternalPackages: ['@node-rs/argon2'],
  typescript: {
    ignoreBuildErrors: debug,
  },
  headers() {
    return [
      {
        headers: [
          ...createSecureHeaders({
            // HSTS Preload: https://hstspreload.org/
            forceHTTPSRedirect: [
              true,
              { includeSubDomains: true, maxAge: 63_072_000, preload: true },
            ],
            frameGuard: ['allow-from', { uri: 'https://pro.platejs.org' }],
          }),
        ],
        source: '/(.*)',
      },
    ];
  },
};

const withBundleAnalyzer = bundleAnalyzerPlugin({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer(nextConfig);
