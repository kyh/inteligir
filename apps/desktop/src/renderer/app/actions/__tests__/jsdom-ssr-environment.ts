// jsdom globals with the SSR module transform. The builtin jsdom environment
// transforms every import in "client" mode, where vite rewrites
// `import.meta.url` to an http URL — and the server graph these suites boot
// resolves real files from it (`@repo/db/migrate`'s drizzle folder), so the
// boot dies at import. The DOM half and the transform half are independent
// choices: this environment keeps jsdom's globals and restores the ssr
// transform the node suites already run under. No setupVM: these suites run
// in the forks pool, which never asks for one.

import type { Environment } from "vitest/runtime";
import { builtinEnvironments } from "vitest/runtime";

const jsdomSsr: Environment = {
  name: "jsdom-ssr",
  viteEnvironment: "ssr",
  setup: (global, options) => builtinEnvironments.jsdom.setup(global, options),
};

export default jsdomSsr;
