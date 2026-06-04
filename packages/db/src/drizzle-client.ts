import { drizzle } from "drizzle-orm/d1";
import * as schemaAuth from "./drizzle-schema-auth";

export const createDb = (d1: D1Database) =>
  drizzle(d1, { schema: { ...schemaAuth }, casing: "snake_case" });

export type Db = ReturnType<typeof createDb>;
