// The library's raw SQL runs on the cell's Durable Object, whose `sql.exec` is synchronous and
// whose transaction is `transactionSync`. A port runs exactly one statement per call, never a BEGIN
// or a SAVEPOINT: a transaction is the host's to open.

import type { z } from "zod";

import type { sqlValueSchema } from "./sql-value";

type SqlValue = z.infer<typeof sqlValueSchema>;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

interface SqlStatements {
  readonly run: (sql: string, params: readonly SqlValue[]) => void;
  readonly all: (sql: string, params: readonly SqlValue[]) => readonly SqlRow[];
}

// the cell's: `transaction` is `ctx.storage.transactionSync`, which commits when `work` returns
// and rolls back when it throws
export interface SqlPort extends SqlStatements {
  readonly transaction: <T>(work: () => T) => T;
}

// the store's own database holds a row this build cannot read: a host answers it as corruption
export class LibraryRowError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryRowError";
  }
}
