import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the tests inside a real miniflare Workers runtime (in-process), with the
// same DO + R2 bindings wrangler.jsonc declares — so the DO's SQLite storage and
// R2 blob store are exercised for real, never mocked. (v0.18 plugin API — the
// pre-vitest-4 `defineWorkersConfig({ test: { poolOptions } })` form is gone.)
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
