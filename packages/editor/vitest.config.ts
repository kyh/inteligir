import { defineConfig } from "vitest/config";

// jsdom, not node: these tests drive a real EditorView. CodeMirror runs under
// jsdom with the small measurement stubs in src/__tests__/jsdom-setup.ts.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/__tests__/jsdom-setup.ts"],
    // Monorepo worker budget (see packages/notes/vitest.config.ts).
    maxWorkers: 2,
  },
});
