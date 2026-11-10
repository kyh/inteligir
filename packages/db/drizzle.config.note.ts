import { defineConfig } from "drizzle-kit";

// Each note's SQLite, one per note's Durable Object: `pnpm --filter @repo/db generate:note --name
// <what>` writes the next migration, which the note runs as it wakes, as the cell runs its own.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./src/note/migrations",
  schema: "./src/note/schema.ts",
});
