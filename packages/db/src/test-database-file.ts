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
    await admin`drop database if exists ${admin(clone)} with (force)`;
    await admin.end();
  });
}
