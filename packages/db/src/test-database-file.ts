// vitest's setupFiles: each suite file's own database, a clone of the template test-database.ts
// pushed, which POSTGRES_URL names for that file and which goes when the file ends. With no
// TEST_POSTGRES_URL it names a server nobody runs, so the client still imports and no suite reaches
// a database it was not given.

import postgres from "postgres";
import { afterAll, inject } from "vitest";
import { withDatabase } from "./run-databases";
import { cloneName } from "./test-database";

const databases = inject("testDatabases");

if (databases === null) {
  process.env.POSTGRES_URL = "postgresql://nobody@127.0.0.1:1/none";
} else {
  const clone = cloneName(databases);
  const admin = postgres(databases.adminUrl, { max: 1 });
  await admin`create database ${admin(clone)} template ${admin(databases.template)}`;
  process.env.POSTGRES_URL = withDatabase(databases.adminUrl, clone);

  afterAll(async () => {
    // forced: the file's own client still holds its connections, idle
    await admin`drop database if exists ${admin(clone)} with (force)`;
    await admin.end();
  });
}
