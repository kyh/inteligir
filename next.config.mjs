import { withContentlayer } from "next-contentlayer";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.infrastructureLogging = {
      level: "error",
    };

    return config;
  },
};

export default withContentlayer(nextConfig);
