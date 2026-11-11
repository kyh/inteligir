import { defineConfig } from "drizzle-kit";

// Each conversation's SQLite, one per conversation's Durable Object: `pnpm --filter @repo/db
// generate:thread --name <what>` writes the next migration, which the conversation runs as it
// wakes, as a note runs its own.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./src/thread/migrations",
  schema: "./src/thread/schema.ts",
});
