// The suites' Postgres. TEST_POSTGRES_URL names a server and a name; unset, every `dbSuite` skips.
// As vitest's globalSetup, this module makes the run's template on that server, pushes the schema
// into it once, and drops the run's databases at the end; test-database-file.ts gives each suite
// file a clone of it. Every database a run makes is named `<name>__<run>…`, so two runs at once
// (turbo runs each workspace's suites side by side) never touch each other's.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe } from "vitest";
import type { TestProject } from "vitest/node";

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

// postgres truncates a longer identifier, and two clones cut to one name would collide
const IDENTIFIER_MAX = 63;

const testUrl = process.env.TEST_POSTGRES_URL;
const configured = testUrl !== undefined && testUrl !== "";

export const dbSuite = describe.skipIf(!configured);

export const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
};

export const cloneName = (databases: TestDatabases): string =>
  `${databases.prefix}${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const testDatabasesOf = (url: string): TestDatabases => {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (name === "") {
    throw new Error("TEST_POSTGRES_URL names no database: end it in /<a name of your own>.");
  }
  const prefix = `${name}__${Date.now().toString(36)}${randomUUID().slice(0, 4)}_`;
  if (prefix.length + 12 > IDENTIFIER_MAX) {
    throw new Error(`TEST_POSTGRES_URL's database name "${name}" is too long for its clones.`);
  }
  return { adminUrl: withDatabase(url, "postgres"), prefix, template: `${prefix}template` };
};

const dbRoot = new URL("..", import.meta.url);

const pushInto = (url: string): void => {
  try {
    execFileSync("pnpm", ["run", "--silent", "push"], {
      cwd: dbRoot,
      encoding: "utf-8",
      // set both: drizzle.config.ts prefers the non-pooling URL, and push's env files never
      // override a variable already set
      env: { ...process.env, POSTGRES_URL: url, POSTGRES_URL_NON_POOLING: url },
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error("The schema did not push into the suites' template database.", {
      cause: error,
    });
  }
};

const setup = async (project: TestProject) => {
  if (!configured) {
    project.provide("testDatabases", null);
    return;
  }
  const databases = testDatabasesOf(testUrl);
  const admin = postgres(databases.adminUrl, { max: 1 });
  const dropRun = async () => {
    const left = await admin<{ datname: string }[]>`
      select datname from pg_database where starts_with(datname, ${databases.prefix})
    `;
    for (const { datname } of left) {
      await admin`drop database if exists ${admin(datname)} with (force)`;
    }
    await admin.end();
  };

  await admin`create database ${admin(databases.template)}`;
  try {
    pushInto(withDatabase(databases.adminUrl, databases.template));
  } catch (error) {
    await dropRun();
    throw error;
  }
  project.provide("testDatabases", databases);
  return dropRun;
};

export default setup;
