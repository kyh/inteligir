import { withContentlayer } from "next-contentlayer";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { hostname: "files.stripe.com" },
      { hostname: "framerusercontent.com" },
      { hostname: "res.cloudinary.com" },
    ],
  },
};

export default withContentlayer(nextConfig);
