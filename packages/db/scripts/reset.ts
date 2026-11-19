import postgres from "postgres";
import { pushSchema } from "../src/run-databases.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const reset = async (url: string) => {
  const sql = postgres(url, { connection: { client_min_messages: "warning" }, max: 1 });

  try {
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
  } finally {
    await sql.end();
  }

  pushSchema(url);
  const { host, pathname } = new URL(url);
  console.log(`Emptied and pushed ${host}${pathname}`);
};

const url = process.env.POSTGRES_URL;

if (url === undefined || url === "") {
  console.error("No POSTGRES_URL in the shell, .env.local or .env: run `pnpm bootstrap`.");
  process.exitCode = 1;
} else if (LOOPBACK.has(new URL(url).hostname)) {
  await reset(url);
} else {
  console.error(
    `POSTGRES_URL points at ${new URL(url).host}, not this machine: reset empties only a local Postgres.`,
  );
  process.exitCode = 1;
}
