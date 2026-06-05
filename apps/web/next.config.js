const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** @returns {NonNullable<NonNullable<import("next").NextConfig["images"]>["remotePatterns"]>} */
const getRemotePatterns = () => {
  /** @type {NonNullable<NonNullable<import("next").NextConfig["images"]>["remotePatterns"]>} */
  const remotePatterns = [];

  if (!IS_PRODUCTION) {
    remotePatterns.push({ protocol: "http", hostname: "127.0.0.1" });
    remotePatterns.push({ protocol: "http", hostname: "localhost" });
  }

  return remotePatterns;
};

/** @type {import("next").NextConfig} */
const config = {
  cacheComponents: true,
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  transpilePackages: ["@repo/api", "@repo/db", "@repo/ui"],
  images: {
    remotePatterns: getRemotePatterns(),
    localPatterns: [{ pathname: "/assets/**" }],
  },
};

export default config;
