import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";
// the module `exports.default` serves, which the plugin otherwise loads on its first fetch: loaded
// here, its cold import is the setup's cost rather than the first test's timeout
import "../index";

// the DDL's statements, split on `;`, which holds only while no string literal in it holds one
const statements = (): string[] =>
  env.TEST_SCHEMA.split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

// a file in the socket suites' project finds the tables in place once another file has made them,
// since that project shares one storage (vitest.config.ts)
const schemaApplied = async (): Promise<boolean> =>
  (await env.DB.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'",
  ).first()) !== null;

// one batch: D1 runs it as one transaction and pays the request overhead once
beforeAll(async () => {
  if (await schemaApplied()) {
    return;
  }
  await env.DB.batch(statements().map((statement) => env.DB.prepare(statement)));
});
