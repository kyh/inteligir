import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Logger } from "babel-plugin-react-compiler";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Rolldown } from "vite";

// a component the compiler skipped, said as the build runs (react.dev/reference/react-compiler/
// logger): the card grid is the one it may name (packages/ui/CLAUDE.md § The card grid is
// virtualized by uniform rows)
const reportSkips: Logger = {
  logEvent: (filename, event) => {
    if (event.kind !== "CompileError" && event.kind !== "PipelineError") {
      return;
    }
    const at = event.fnLoc === null ? "" : `:${String(event.fnLoc.start.line)}`;
    const why = event.kind === "CompileError" ? event.detail.reason : event.data;
    console.warn(`React Compiler skipped ${filename ?? "a module"}${at}: ${why}`);
  },
};

// src/library/CLAUDE.md § The library is one chunk. A route file's own module stays out, since the
// route tree the site's entry imports holds its options. Every library route's split halves go in,
// so a loaded tab opens Settings with nothing to fetch, and so do what they reach and what the
// beforeLoad imports lazily, the tab's open. A module the site reaches too is left to rolldown's
// own chunks, which the library's chunk imports.
const LIBRARY_ROUTE_SPLIT = /[\\/]src[\\/]routes[\\/]library(?:\.tsx|[\\/])[^?]*\?tsr-split=/u;
const LIBRARY_ROUTE_FILE = /[\\/]src[\\/]routes[\\/]library\.tsx$/u;

type ChunkingContext = Rolldown.ChunkingContext;

// whether every path into a module starts at a library route; a cycle counts as a site path, so
// a module whose answer is still being worked out is no proof
const reachedOnlyFromLibrary = (
  id: string,
  context: ChunkingContext,
  known: Map<string, boolean>,
): boolean => {
  if (LIBRARY_ROUTE_SPLIT.test(id)) {
    return true;
  }
  const settled = known.get(id);
  if (settled !== undefined) {
    return settled;
  }
  known.set(id, false);
  const info = context.getModuleInfo(id);
  const only =
    info !== null &&
    !info.isEntry &&
    info.importers.length + info.dynamicImporters.length > 0 &&
    info.importers.every((importer) => reachedOnlyFromLibrary(importer, context, known)) &&
    info.dynamicImporters.every(
      (importer) =>
        LIBRARY_ROUTE_FILE.test(importer) || reachedOnlyFromLibrary(importer, context, known),
    );
  known.set(id, only);
  return only;
};

const answers = new WeakMap<ChunkingContext, Map<string, boolean>>();

const libraryChunk = (id: string, context: ChunkingContext): string | null => {
  const known = answers.get(context) ?? new Map<string, boolean>();
  answers.set(context, known);
  return reachedOnlyFromLibrary(id, context, known) ? "library" : null;
};

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      experimental: { newConfig: { cfBuildOutput: true } },
    }),
    // the entry lives in src/worker because that directory is its own tsconfig program and the
    // entry names Env.
    tanstackStart({ server: { entry: "./worker/server.ts" } }),
    viteReact(),
    // the React Compiler, react.dev's Vite path (react.dev/learn/react-compiler/installation). It
    // outlines a hook's closures to module scope, where an enclosing function's locals are gone,
    // so a hook or component defined inside a function fails the build
    babel({
      presets: [
        reactCompilerPreset({
          environment: { validateNoDynamicallyCreatedComponentsOrHooks: true },
          logger: reportSkips,
        }),
      ],
    }),
    tailwindcss(),
  ],
  // strictPort: every doc and script names :5174, so failing to bind beats moving. No CORS of the
  // dev server's own: its default answers every preflight itself, for loopback pages alone, and the
  // deployed Worker answers none, so a page on another origin would read here what it never could
  // there
  server: { cors: false, port: 5174, strictPort: true },
  // an import's module worker (src/library/import/import-run.ts) is split like the page, which an
  // IIFE worker cannot be
  worker: { format: "es" },
  resolve: {
    // micromark's entity decoder parses through a DOM element under the browser condition, and Vite
    // resolves a worker's modules as the page's, so the import's worker would load with no
    // document; the table it takes everywhere else costs the page about 12 kB gzipped
    alias: {
      "decode-named-character-reference": fileURLToPath(
        import.meta.resolve("decode-named-character-reference"),
      ),
    },
  },
  environments: {
    client: {
      build: {
        // the library's chunk is about 3.2 MB on purpose (above), so the ceiling (kB) is there to
        // catch a dependency that doubles it
        chunkSizeWarningLimit: 6000,
        // the file LICENSES_PATH links (src/lib/site-config.ts). Vite reads no worker's bundle, so a
        // package the import's worker alone loads is not in it
        license: { fileName: "licenses.md" },
        // the group leaves what it reaches through a barrel (lucide-react, Base UI) to rolldown's own
        // chunks, which import the group back; rolldown's advice for a group that takes no
        // dependencies is both of these, or a chunk reads an export the cycle has yet to run
        rolldownOptions: {
          preserveEntrySignatures: "allow-extension",
          output: {
            strictExecutionOrder: true,
            codeSplitting: {
              groups: [
                { debugName: "library", includeDependenciesRecursively: false, name: libraryChunk },
              ],
            },
          },
        },
      },
    },
    // `cf deploy` uploads whatever source maps the build emits
    ssr: { build: { sourcemap: true } },
  },
});
