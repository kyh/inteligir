// Which layout this package's own staged trees are read from. Only the
// migrations are pinned here, because they are the one tree whose stale copy is
// a DATA hazard: `dist/` is the ordinary state of a worked-in checkout, and a
// frozen snapshot either withholds the newest migration or carries the database
// past what the running code understands.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMigrationsFolder } from "../paths";

describe("resolveMigrationsFolder", () => {
  it("answers the workspace folder, whether or not a staged copy exists", () => {
    const folder = resolveMigrationsFolder() ?? "";

    expect(folder).toMatch(/packages[/\\]db[/\\]drizzle$/u);
    // The journal `runMigrations` reads its generation ceiling from.
    expect(existsSync(join(folder, "meta", "_journal.json"))).toBe(true);
  });
});
