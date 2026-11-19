import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { db } from "./drizzle-client";
import { dbSuite } from "./test-database";

dbSuite("the pushed schema", () => {
  test("turns row-level security on for every table", async () => {
    const open = await db.execute<{ relname: string }>(
      sql`
        select c.relname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      `,
      "objects",
    );

    expect(open.map((row) => row.relname)).toEqual([]);
  });
});
