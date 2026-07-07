import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Create the D1 auth schema before any test runs. TEST_SCHEMA is the DDL exported
// from src/db/schema.ts (see vitest.config.ts). Each test file gets an isolated
// D1, so we just apply the CREATEs once — split the DDL on `;` (no string
// literals contain one) and run each statement. Mirrors what `drizzle-kit push`
// does against a real database, without any migration files.
beforeAll(async () => {
  const statements = env.TEST_SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});
