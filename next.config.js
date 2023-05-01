const withAnalyzer = require("@next/bundle-analyzer");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
    enableUndici: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback.fs = false;
    }

    return config;
  },
};

module.exports = withAnalyzer({
  enabled: process.env.ANALYZE === "true",
})(nextConfig);
