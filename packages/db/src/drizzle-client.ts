import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { relations } from "./drizzle-relations";

const connectionString = process.env.POSTGRES_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error("POSTGRES_URL must be set");
}

// Keep the default `max_pipeline`: lowering it stops postgres.js reserving a connection for a queued
// BEGIN, leaving sessions idle in transaction and losing writes that already reported success.
const client = postgres(connectionString, {
  // An open connection holds the event loop, so a server or script waits on an idle one to exit.
  idle_timeout: 10,
  max: 10,
  // Supabase's transaction pooler doesn't support prepared statements.
  prepare: false,
});

export const db = drizzle({ client, relations });
