import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import config from "../drizzle.config.ts";

const dbRoot = new URL("..", import.meta.url);

const sql = postgres(config.dbCredentials.url, {
  connection: { client_min_messages: "warning" },
  max: 1,
});

try {
  await sql.file(fileURLToPath(new URL("sql/extensions.sql", dbRoot)));
} finally {
  await sql.end();
}

const run = spawnSync("drizzle-kit", ["push", ...process.argv.slice(2)], {
  cwd: dbRoot,
  stdio: "inherit",
});

process.exitCode = run.status ?? 1;
