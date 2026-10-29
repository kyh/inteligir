// The library's SQL runs on three engines: the cell's Durable Object, whose `sql.exec` is
// synchronous and whose transaction is `transactionSync`, and the two device replicas, whose
// drivers are asynchronous. A query is written once as a plan, a generator that yields one
// statement at a time and is handed back each statement's rows, so a host drives it with
// `runPlan` over a synchronous port or `runPlanAsync` over an asynchronous one. A port runs exactly
// one statement per call, never a BEGIN or a SAVEPOINT: a transaction is its `transaction(work)`.

import { utf8ByteLength } from "./canonical-json";

export type SqlValue = string | number | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

// `all` hands the plan its rows; `run` hands it none
export type SqlStep = SqlStatement & { readonly kind: "all" | "run" };

export type SqlPlan<T> = Generator<SqlStep, T, readonly SqlRow[]>;

export interface SqlStatements {
  readonly run: (sql: string, params: readonly SqlValue[]) => void;
  readonly all: (sql: string, params: readonly SqlValue[]) => readonly SqlRow[];
}

// the cell's: `transaction` is `ctx.storage.transactionSync`, which commits when `work` returns
// and rolls back when it throws
export interface SqlPort extends SqlStatements {
  readonly transaction: <T>(work: () => T) => T;
}

export interface AsyncSqlStatements {
  readonly run: (sql: string, params: readonly SqlValue[]) => Promise<void>;
  readonly all: (sql: string, params: readonly SqlValue[]) => Promise<readonly SqlRow[]>;
}

// a replica's: `transaction` holds the database exclusively for `work`
export interface AsyncSqlPort extends AsyncSqlStatements {
  readonly transaction: <T>(work: (tx: AsyncSqlStatements) => Promise<T>) => Promise<T>;
}

const NO_ROWS: readonly SqlRow[] = [];

export const all = (sql: string, params: readonly SqlValue[] = []): SqlStep => ({
  kind: "all",
  params,
  sql,
});

export const run = (sql: string, params: readonly SqlValue[] = []): SqlStep => ({
  kind: "run",
  params,
  sql,
});

// a statement that fails is thrown into the plan at its yield, so a plan can answer an engine's
// refusal itself; one it does not catch leaves the runner as the error
export const runPlan = <T>(port: SqlStatements, plan: SqlPlan<T>): T => {
  let step = plan.next(NO_ROWS);
  while (step.done !== true) {
    const { kind, params, sql } = step.value;
    let rows: readonly SqlRow[] = NO_ROWS;
    try {
      if (kind === "all") {
        rows = port.all(sql, params);
      } else {
        port.run(sql, params);
      }
    } catch (error) {
      step = plan.throw(error);
      continue;
    }
    step = plan.next(rows);
  }
  return step.value;
};

export const runPlanAsync = async <T>(port: AsyncSqlStatements, plan: SqlPlan<T>): Promise<T> => {
  let step = plan.next(NO_ROWS);
  while (step.done !== true) {
    const { kind, params, sql } = step.value;
    let rows: readonly SqlRow[] = NO_ROWS;
    try {
      if (kind === "all") {
        rows = await port.all(sql, params);
      } else {
        await port.run(sql, params);
      }
    } catch (error) {
      step = plan.throw(error);
      continue;
    }
    step = plan.next(rows);
  }
  return step.value;
};

// a plan as one transaction: every statement lands, or none does
export const transactPlan = <T>(port: SqlPort, plan: SqlPlan<T>): T =>
  port.transaction(() => runPlan(port, plan));

export const transactPlanAsync = async <T>(port: AsyncSqlPort, plan: SqlPlan<T>): Promise<T> =>
  await port.transaction(async (tx) => await runPlanAsync(tx, plan));

// A SQLite Durable Object binds at most 100 parameters to one statement and reads at most 100 KB
// of statement text (https://developers.cloudflare.com/durable-objects/platform/limits/); every
// many-row statement is cut under whichever binds first.
export const SQL_MAX_PARAMS = 100;
export const SQL_MAX_STATEMENT_BYTES = 100_000;

export interface RepeatedStatement {
  // the text before the repeated part, and the parameters it binds there
  readonly head: string;
  readonly headParams?: readonly SqlValue[];
  // one repetition's text, holding one `?` per parameter of its row
  readonly each: string;
  readonly separator: string;
  readonly tail?: string;
  readonly rows: readonly (readonly SqlValue[])[];
}

const placeholdersIn = (text: string): number => text.split("?").length - 1;

// the fewest statements that carry every row in order, each under both caps; no rows, none
export const chunkStatement = (statement: RepeatedStatement): SqlStatement[] => {
  const { each, head, rows, separator } = statement;
  const headParams = statement.headParams ?? [];
  const tail = statement.tail ?? "";
  const width = placeholdersIn(each);
  if (placeholdersIn(head) !== headParams.length || placeholdersIn(tail) !== 0) {
    throw new Error("a repeated statement's head binds its own parameters and its tail none");
  }
  const fixedBytes = utf8ByteLength(head) + utf8ByteLength(tail);
  const eachBytes = utf8ByteLength(each);
  const separatorBytes = utf8ByteLength(separator);
  const statements: SqlStatement[] = [];
  let count = 0;
  let params: SqlValue[] = [];
  const close = (): void => {
    if (count > 0) {
      statements.push({
        params: [...headParams, ...params],
        sql: `${head}${Array.from({ length: count }, () => each).join(separator)}${tail}`,
      });
    }
    count = 0;
    params = [];
  };
  const bytesWith = (rowsIn: number): number =>
    fixedBytes + rowsIn * eachBytes + Math.max(0, rowsIn - 1) * separatorBytes;
  if (headParams.length + width > SQL_MAX_PARAMS || bytesWith(1) > SQL_MAX_STATEMENT_BYTES) {
    throw new Error("one row of this statement is past a SQLite Durable Object's limits");
  }
  for (const row of rows) {
    if (row.length !== width) {
      throw new Error(
        `a row binds ${String(row.length)} values where its text holds ${String(width)}`,
      );
    }
    const fits =
      headParams.length + params.length + width <= SQL_MAX_PARAMS &&
      bytesWith(count + 1) <= SQL_MAX_STATEMENT_BYTES;
    if (!fits) {
      close();
    }
    params.push(...row);
    count += 1;
  }
  close();
  return statements;
};

// the store's own database holds a row this build cannot read: a host answers it as corruption
export class LibraryRowError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryRowError";
  }
}
