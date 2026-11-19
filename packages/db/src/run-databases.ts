import { execFileSync } from "node:child_process";
import type { Sql } from "postgres";

export const withDatabase = (url: string, database: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;

  return parsed.toString();
};

const dbRoot = new URL("..", import.meta.url);

export const pushSchema = (url: string) => {
  try {
    execFileSync("pnpm", ["run", "--silent", "push"], {
      cwd: dbRoot,
      encoding: "utf-8",
      env: { ...process.env, POSTGRES_URL: url, POSTGRES_URL_NON_POOLING: url },
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`The schema did not push into ${new URL(url).pathname.slice(1)}.`, {
      cause: error,
    });
  }
};

export const dropDatabases = async (admin: Sql, prefix: string) => {
  const left = await admin<{ datname: string }[]>`
    select datname from pg_database where starts_with(datname, ${prefix})
  `;

  for (const { datname } of left) {
    await admin`drop database if exists ${admin(datname)} with (force)`;
  }
};
