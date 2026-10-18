// the builtin jsdom environment transforms imports in client mode, where vite rewrites
// `import.meta.url` to an http URL and `@repo/db/migrate` can no longer find its drizzle
// folder; this keeps jsdom's globals under the ssr transform.
//
// Node's own Blob, File and FormData are put back over jsdom's: these suites route the page's
// requests into a node server in-process, and a body the page builds from jsdom's classes is one
// node's fetch cannot read (an upload of a file, as a save or an import sends).

import type { Environment } from "vitest/runtime";
import { builtinEnvironments } from "vitest/runtime";

const jsdomSsr: Environment = {
  name: "jsdom-ssr",
  setup: async (global, options) => {
    const { Blob, File, FormData } = globalThis;
    const environment = await builtinEnvironments.jsdom.setup(global, options);
    Object.assign(global, { Blob, File, FormData });
    return environment;
  },
  viteEnvironment: "ssr",
};

export default jsdomSsr;
