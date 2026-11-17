// `pnpm push`: sql/extensions.sql, which no drizzle schema can declare, then drizzle-kit's push of
// the schema modules, given this script's arguments. drizzle-kit fails on a schema path that matches
// no module, so with none there is nothing past the extensions to push.

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import config from "../drizzle.config.ts";

const dbRoot = new URL("..", import.meta.url);

// "already exists, skipping" is a notice each push but the first would print
const sql = postgres(config.dbCredentials.url, {
  connection: { client_min_messages: "warning" },
  max: 1,
});
try {
  await sql.file(fileURLToPath(new URL("sql/extensions.sql", dbRoot)));
} finally {
  await sql.end();
}

if (globSync(config.schema, { cwd: dbRoot }).length === 0) {
  console.log("No schema module declares a table yet: the extensions are all there is to push.");
} else {
  const run = spawnSync("drizzle-kit", ["push", ...process.argv.slice(2)], {
    cwd: dbRoot,
    stdio: "inherit",
  });
  process.exitCode = run.status ?? 1;
}
