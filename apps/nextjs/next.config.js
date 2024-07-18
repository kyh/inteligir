import { recmaPlugins } from "@inteligir/mdx/plugins/recma.mjs";
import { rehypePlugins } from "@inteligir/mdx/plugins/rehype.mjs";
import { remarkPlugins } from "@inteligir/mdx/plugins/remark.mjs";
import createMDX from "@next/mdx";

const withMDX = createMDX({
  options: {
    remarkPlugins,
    rehypePlugins,
    recmaPlugins,
  },
});

/** @type {import("next").NextConfig} */
const config = {
  pageExtensions: ["js", "jsx", "mdx", "ts", "tsx"],
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: ["@inteligir/api", "@inteligir/db", "@inteligir/ui"],
  /** We already do linting and typechecking as separate tasks in CI */
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default withMDX(config);
