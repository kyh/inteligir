// A value SQLite binds or hands back, and a row of them, as every host's driver is held to them at
// its boundary; `./library-sql`'s `SqlValue` and `SqlRow` are their types. The module imports zod
// alone, so a node process loads it as it stands: the Worker's suites hold a replica's database on
// their node side (`apps/web/replica-sql-service.ts`).

import { z } from "zod";

export const sqlValueSchema = z.union([z.string(), z.number(), z.null()]);
export const sqlRowSchema = z.record(z.string(), sqlValueSchema);
