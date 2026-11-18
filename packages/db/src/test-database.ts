import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe } from "vitest";
import type { TestProject } from "vitest/node";
import { dropDatabases, pushSchema, withDatabase } from "./run-databases";

interface TestDatabases {
  /** the server's own `postgres` database, where the run's are made and dropped */
  readonly adminUrl: string;
  /** every database of this run starts with it */
  readonly prefix: string;
  /** pushed once, then only cloned: nothing connects to it after the push */
  readonly template: string;
}

declare module "vitest" {
  interface ProvidedContext {
    testDatabases: TestDatabases | null;
  }
}

const IDENTIFIER_MAX = 63;

const testUrl = process.env.TEST_POSTGRES_URL;
const configured = testUrl !== undefined && testUrl !== "";

export const dbSuite = describe.skipIf(!configured);

export const cloneName = (databases: TestDatabases) =>
  `${databases.prefix}${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const testDatabasesOf = (url: string) => {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));

  if (name === "") {
    throw new Error("TEST_POSTGRES_URL names no database: end it in /<a name of your own>.");
  }

  const prefix = `${name}__${Date.now().toString(36)}${randomUUID().slice(0, 4)}_`;

  if (prefix.length + 12 > IDENTIFIER_MAX) {
    throw new Error(`TEST_POSTGRES_URL's database name "${name}" is too long for its clones.`);
  }

  return {
    adminUrl: withDatabase(url, "postgres"),
    prefix,
    template: `${prefix}template`,
  } satisfies TestDatabases;
};

const setup = async (project: TestProject) => {
  if (!configured) {
    project.provide("testDatabases", null);

    return;
  }

  const databases = testDatabasesOf(testUrl);
  const admin = postgres(databases.adminUrl, { max: 1 });

  const dropRun = async () => {
    await dropDatabases(admin, databases.prefix);
    await admin.end();
  };

  await admin`create database ${admin(databases.template)}`;

  try {
    pushSchema(withDatabase(databases.adminUrl, databases.template));
  } catch (error) {
    await dropRun();
    throw error;
  }

  project.provide("testDatabases", databases);

  return dropRun;
};

export default setup;
