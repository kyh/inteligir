import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

// splitting the DDL on `;` holds only while no string literal in the schema contains one
beforeAll(async () => {
  const statements = env.TEST_SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
});
