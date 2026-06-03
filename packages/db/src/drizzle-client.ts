import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schemaAuth from "./drizzle-schema-auth";

const url = process.env.POSTGRES_URL;
if (!url) {
  throw new Error("POSTGRES_URL is not set");
}

const client = postgres(url);

export const db = drizzle({
  client,
  schema: { ...schemaAuth },
  casing: "snake_case",
});

export type Db = typeof db;
