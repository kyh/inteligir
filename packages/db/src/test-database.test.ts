import { sql } from "drizzle-orm";
import { expect, inject, test } from "vitest";
import { db } from "./drizzle-client";
import { dbSuite } from "./test-database";

dbSuite("a suite file's database", () => {
  test("is a clone of the run's template, its own", async () => {
    const databases = inject("testDatabases");
    const [current] = await db.execute<{ name: string }>(
      sql`select current_database() as name`,
      "objects",
    );
    expect(current?.name.slice(0, databases?.prefix.length)).toBe(databases?.prefix);
    expect(current?.name).not.toBe(databases?.template);
  });

  test("holds the extensions push applies before the schema", async () => {
    const [row] = await db.execute<{ folded: string; near: boolean }>(
      sql`select unaccent('Café') as folded, similarity('library', 'libary') > 0.3 as near`,
      "objects",
    );
    expect(row).toEqual({ folded: "Cafe", near: true });
  });
});
