import { defineConfig } from "drizzle-kit";

// drizzle-kit is used ONLY to GENERATE the D1 migration SQL from src/db/schema.ts
// (`pnpm --filter @repo/cloud db:generate`). It never connects to a database here
// — the generated SQL under src/db/migrations/ is applied by wrangler at deploy
// (`migrations_dir` in wrangler.jsonc) and by the vitest Workers pool in tests
// (readD1Migrations + applyD1Migrations). Dialect is plain `sqlite`, which is
// what D1 runs.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
});
