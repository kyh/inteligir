import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: { banner: "#!/usr/bin/env node", entryFileNames: "inteligir.js" },
    },
    ssr: "src/main.ts",
    target: "node24",
  },
  ssr: { noExternal: ["@repo/contract"] },
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
