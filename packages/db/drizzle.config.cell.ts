import { defineConfig } from "drizzle-kit";

// The library cell's SQLite, one per account's Durable Object: `pnpm --filter @repo/db
// generate:cell --name <what>` writes the next migration, which the cell runs as it opens. Not
// named drizzle.config.ts, the D1 configs' name, which the d1-unique-index guard sweeps.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./src/cell/migrations",
  schema: "./src/cell/schema.ts",
});
