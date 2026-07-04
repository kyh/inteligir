import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // pi-driver / agent-runtime are folded in under src/server; the backend
    // code still imports them via their @repo/* aliases (the agent boundary
    // forbids "../" reaches), so mirror the tsconfig paths for the test run.
    alias: {
      "@repo/features": src,
      "@repo/pi-driver": `${src}/server/pi`,
      "@repo/agent-runtime": `${src}/server/agent-runtime`,
    },
  },
});
