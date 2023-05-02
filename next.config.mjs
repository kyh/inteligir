import { withContentlayer } from "next-contentlayer"

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true,
    enableUndici: true,
    scrollRestoration: true,
  },
}

export default withContentlayer(nextConfig)
