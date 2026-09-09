import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMigrationsFolder } from "../paths";

describe("resolveMigrationsFolder", () => {
  it("answers the workspace folder, whether or not a staged copy exists", () => {
    const folder = resolveMigrationsFolder() ?? "";

    expect(folder).toMatch(/packages[/\\]db[/\\]drizzle$/u);
    // the journal `runMigrations` reads its generation ceiling from.
    expect(existsSync(path.join(folder, "meta", "_journal.json"))).toBe(true);
  });
});
