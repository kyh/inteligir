import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { relations } from "./drizzle-relations";

const connectionString = process.env.POSTGRES_URL;

if (connectionString === undefined || connectionString === "") {
  throw new Error("POSTGRES_URL must be set");
}

const client = postgres(connectionString, {
  idle_timeout: 10,
  max: 10,
  prepare: false,
});

export const db = drizzle({ client, relations });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DbExecutor = typeof db | Tx;
