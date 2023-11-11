// Importing env files here to validate on build
import "./src/env.mjs";
import "@inteligir/auth/env.mjs";

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@inteligir/api",
    "@inteligir/auth",
    "@inteligir/db",
    "@inteligir/ui",
  ],
  /** We already do linting and typechecking as separate tasks in CI */
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default config;
