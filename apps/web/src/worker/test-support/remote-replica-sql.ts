// A replica's SQL port inside workerd, reaching the database the node side of the suite holds for
// it (`apps/web/replica-sql-service.ts`) over the function binding the suites declare
// (`apps/web/vitest.config.ts`): each statement one call, a transaction a begin and a commit or a
// rollback around the work, as the in-memory driver holds its database around `exclusive`.

import type { ReplicaSql, ReplicaStatements } from "@repo/library-replica/replica-ports";
import type { SqlValue } from "@repo/notes/library/library-sql";
import { env } from "cloudflare:workers";
import { z } from "zod";

const rowsSchema = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
});
const txSchema = z.object({ tx: z.string() });
const failureSchema = z.object({ message: z.string() });
const doneSchema = z.object({});

type Call =
  | {
      readonly op: "all" | "run";
      readonly sql: string;
      readonly params: readonly SqlValue[];
      readonly tx: string | null;
    }
  | { readonly op: "begin" }
  | { readonly op: "commit" | "rollback"; readonly tx: string };

export const remoteReplicaSql = (db: string): ReplicaSql => {
  const call = async <T>(body: Call, schema: z.ZodType<T>): Promise<T> => {
    const response = await env.REPLICA_SQL.fetch("http://replica-sql/", {
      body: JSON.stringify({ ...body, db }),
      method: "POST",
    });
    const answer: unknown = await response.json();
    if (!response.ok) {
      throw new Error(failureSchema.parse(answer).message);
    }
    return schema.parse(answer);
  };
  const statementsIn = (tx: string | null): ReplicaStatements => ({
    all: async (sql, params) => {
      const { rows } = await call({ op: "all", params, sql, tx }, rowsSchema);
      return rows;
    },
    run: async (sql, params) => {
      await call({ op: "run", params, sql, tx }, rowsSchema);
    },
  });
  return {
    ...statementsIn(null),
    exclusive: async (work) => {
      const { tx } = await call({ op: "begin" }, txSchema);
      let value: Awaited<ReturnType<typeof work>>;
      try {
        value = await work(statementsIn(tx));
      } catch (error) {
        await call({ op: "rollback", tx }, doneSchema);
        throw error;
      }
      await call({ op: "commit", tx }, doneSchema);
      return value;
    },
  };
};
