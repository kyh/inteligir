// A replica's SQLite for the suites that run the replica engine inside workerd against the real
// cell (`src/worker/library/library-replica.test.ts`): workerd compiles no WebAssembly a module
// did not ship and sqlite-wasm compiles its own glue at load, so the database runs here, in the
// node process miniflare serves a function binding from, and the suite's port reaches it over
// that binding (`src/worker/test-support/remote-replica-sql.ts`). It is `@repo/library-replica`'s
// own in-memory driver, the browser tab's; a transaction holds its database between the begin and
// the commit the suite sends, as the driver's `exclusive` holds it around its work.

import { openMemorySql } from "@repo/library-replica/memory-sql";
import type { MemorySql } from "@repo/library-replica/memory-sql";
import type { ReplicaStatements } from "@repo/library-replica/replica-ports";
import { sqlValueSchema } from "@repo/notes/library/sql-value";
import { z } from "zod";

const replicaSqlCallSchema = z.discriminatedUnion("op", [
  z.object({
    db: z.string(),
    op: z.enum(["all", "run"]),
    params: z.array(sqlValueSchema),
    sql: z.string(),
    tx: z.string().nullable(),
  }),
  z.object({ db: z.string(), op: z.literal("begin") }),
  z.object({ db: z.string(), op: z.enum(["commit", "rollback"]), tx: z.string() }),
]);

interface Held {
  readonly statements: ReplicaStatements;
  readonly end: (commit: boolean) => Promise<void>;
}

const databases = new Map<string, Promise<MemorySql>>();
const transactions = new Map<string, Held>();
let opened = 0;

const databaseOf = async (name: string): Promise<MemorySql> => {
  let database = databases.get(name);
  if (database === undefined) {
    database = openMemorySql();
    databases.set(name, database);
  }
  return await database;
};

// what a rollback throws through the driver's transaction, so it rolls back
class RolledBackError extends Error {
  override name = "RolledBackError";
}

const unset = (): void => undefined;

// a transaction, answered once the database is held for it
const begin = async (sql: MemorySql): Promise<string> => {
  opened += 1;
  const id = `tx-${String(opened)}`;
  let hold: (statements: ReplicaStatements) => void = unset;
  let end: (commit: boolean) => void = unset;
  // oxlint-disable-next-line promise/avoid-new -- the driver hands its statements to a callback, and the begin's answer waits on them
  const held = new Promise<ReplicaStatements>((resolve) => {
    hold = resolve;
  });
  // oxlint-disable-next-line promise/avoid-new -- the commit or rollback comes in a later request, which only a promise can wait across
  const ended = new Promise<boolean>((resolve) => {
    end = resolve;
  });
  const finished = (async () => {
    try {
      await sql.exclusive(async (statements) => {
        hold(statements);
        if (!(await ended)) {
          throw new RolledBackError("the suite rolled the transaction back");
        }
      });
    } catch (error) {
      if (!(error instanceof RolledBackError)) {
        throw error;
      }
    }
  })();
  transactions.set(id, {
    end: async (commit) => {
      end(commit);
      await finished;
    },
    statements: await held,
  });
  return id;
};

export const replicaSqlService = async (request: Request): Promise<Response> => {
  try {
    const call = replicaSqlCallSchema.parse(await request.json());
    const sql = await databaseOf(call.db);
    switch (call.op) {
      case "begin": {
        return Response.json({ tx: await begin(sql) });
      }
      case "commit":
      case "rollback": {
        const held = transactions.get(call.tx);
        transactions.delete(call.tx);
        await held?.end(call.op === "commit");
        return Response.json({});
      }
      case "all":
      case "run": {
        const statements = call.tx === null ? sql : transactions.get(call.tx)?.statements;
        if (statements === undefined) {
          return Response.json({ message: `no transaction ${call.tx ?? ""}` }, { status: 409 });
        }
        if (call.op === "run") {
          await statements.run(call.sql, call.params);
          return Response.json({ rows: [] });
        }
        return Response.json({ rows: await statements.all(call.sql, call.params) });
      }
      // no default
    }
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
