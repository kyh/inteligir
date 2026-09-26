// the phone's one database, as a port: expo-sql-driver.ts is the app's, node-sql-driver.ts the
// tests'. rows cross as `unknown` because a column's type is the file's to say, not the query's;
// each call site parses what it selected.

export type SqlValue = string | number | null;

export interface SqlExecutor {
  // statements without parameters, several allowed
  exec: (sql: string) => Promise<void>;
  run: (sql: string, params?: readonly SqlValue[]) => Promise<void>;
  all: (sql: string, params?: readonly SqlValue[]) => Promise<readonly unknown[]>;
}

export interface SqlDriver extends SqlExecutor {
  // one write transaction at a time, in call order: it commits when `work` resolves and rolls back
  // when it throws. every statement inside runs on `tx`: a write on the driver waits for the
  // transaction to end, so issued from inside it would wait forever.
  exclusive: (work: (tx: SqlExecutor) => Promise<void>) => Promise<void>;
}

// a queue of one: each task starts once the one before it has settled, whichever way
export const createSerialLock = (): (<T>(task: () => Promise<T>) => Promise<T>) => {
  let tail: Promise<unknown> = Promise.resolve();
  return async (task) => {
    const previous = tail;
    const run = (async () => {
      try {
        await previous;
      } catch {
        // that task's caller heard its failure; this one only waited for it to end
      }
      return await task();
    })();
    tail = run;
    return await run;
  };
};
