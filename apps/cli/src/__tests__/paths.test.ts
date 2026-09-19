import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMigrationsFolder } from "../paths";

describe("resolveMigrationsFolder", () => {
  it("answers the workspace folder, whether or not a staged copy exists", () => {
    const folder = resolveMigrationsFolder() ?? "";

    expect(folder).toMatch(/packages[/\\]db[/\\]drizzle$/u);
    // the per-generation folders `runMigrations` reads its generation ceiling from.
    const generations = readdirSync(folder).filter((name) =>
      existsSync(path.join(folder, name, "migration.sql")),
    );
    expect(generations.length).toBeGreaterThan(0);
  });
});
