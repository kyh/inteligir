// A run's throwaway databases on one Postgres server: a template the schema is pushed into once,
// clones of it, and every one of them dropped by the prefix their names share. The suites'
// (test-database.ts) and the e2e flows' (tools/e2e) are made this way.

import { execFileSync } from "node:child_process";
import type { Sql } from "postgres";

export const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
};

const dbRoot = new URL("..", import.meta.url);

// as `pnpm db:push` pushes it, extensions first
export const pushSchema = (url: string): void => {
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
    throw new Error(`The schema did not push into ${new URL(url).pathname.slice(1)}.`, {
      cause: error,
    });
  }
};

// forced: a run's clients may still hold their connections, idle
export const dropDatabases = async (admin: Sql, prefix: string): Promise<void> => {
  const left = await admin<{ datname: string }[]>`
    select datname from pg_database where starts_with(datname, ${prefix})
  `;
  for (const { datname } of left) {
    await admin`drop database if exists ${admin(datname)} with (force)`;
  }
};
