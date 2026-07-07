import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Apply the D1 auth migrations to each test file's isolated database before any
// test runs. The migration SQL is injected as the `TEST_MIGRATIONS` binding by
// vitest.config.ts (`readD1Migrations`); `applyD1Migrations` is idempotent
// (tracks applied migrations in `d1_migrations`).
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
