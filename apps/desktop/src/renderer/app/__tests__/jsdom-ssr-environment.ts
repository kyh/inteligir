// the builtin jsdom environment transforms imports in client mode, where vite rewrites
// `import.meta.url` to an http URL and `@repo/db/migrate` can no longer find its drizzle
// folder; this keeps jsdom's globals under the ssr transform.

import type { Environment } from "vitest/runtime";
import { builtinEnvironments } from "vitest/runtime";

const jsdomSsr: Environment = {
  name: "jsdom-ssr",
  viteEnvironment: "ssr",
  setup: (global, options) => builtinEnvironments.jsdom.setup(global, options),
};

export default jsdomSsr;
