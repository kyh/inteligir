// What a host hands the replica engine: everything that differs between the Mac's Rust replica,
// the phone's expo-sqlite, the browser tab's memory and a test. The engine names no platform: its
// SQL, its clock, its ids, its transport, its socket, the bytes it uploads and the block merge are
// all these ports.

import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import type { SqlRow, SqlValue } from "@repo/notes/library/library-sql";

export interface ReplicaStatements {
  readonly all: (sql: string, params: readonly SqlValue[]) => Promise<readonly SqlRow[]>;
  readonly run: (sql: string, params: readonly SqlValue[]) => Promise<void>;
}

// the replica's database: one statement per call, never a BEGIN or a SAVEPOINT. `exclusive` holds
// it for `work`, one at a time in call order, committing when `work` resolves and rolling back
// when it throws; every statement inside runs on `tx`. A statement outside waits out a running
// transaction, so nothing reads half of one
export interface ReplicaSql extends ReplicaStatements {
  readonly exclusive: <T>(work: (tx: ReplicaStatements) => Promise<T>) => Promise<T>;
}

// the time, and a timer the engine cancels: the outbox's backoff, the socket's keepalive and
// reconnect, and the minute's check-in
export interface ReplicaClock {
  readonly now: () => number;
  readonly after: (ms: number, run: () => void) => () => void;
}

// `/v1` as the host reaches it: the cloud's origin and a fetch that adds the device's credential
// and build (or, in the browser tab, the session's cookie). The RPC link and every file upload go
// through it
export interface ReplicaTransport {
  readonly origin: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

// the account's socket, as every platform's WebSocket is
export interface ReplicaSocket {
  readonly addEventListener: {
    (type: "open" | "error", listener: () => void): void;
    (type: "message", listener: (event: { readonly data?: unknown }) => void): void;
    (type: "close", listener: (event: { readonly code?: number | undefined }) => void): void;
  };
  readonly send: (data: string) => void;
  readonly close: () => void;
}

export type SocketDial = (url: string) => ReplicaSocket;

// a file waiting to be uploaded, by its SHA-256: the bytes stay on the device until the write that
// names them lands, and outlive a relaunch
export interface StagedBlobs {
  readonly put: (sha: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  // null when the device no longer holds them
  readonly read: (sha: string) => Promise<Uint8Array<ArrayBuffer> | null>;
  readonly remove: (sha: string) => Promise<void>;
  readonly clear: () => Promise<void>;
}

// a block two writers changed: `base` as this device's write was computed from it, `mine` as it
// wrote it, `theirs` as the cell holds it now. The answer keeps `theirs`'s id; the editor's diff3
// over each side's markdown projection (`@repo/editor`) answers one whatever the overlap
export type BlockMerge = (sides: {
  readonly base: LibraryBlock;
  readonly mine: LibraryBlock;
  readonly theirs: LibraryBlock;
}) => LibraryBlock;

// a fresh UUIDv7: an op's id, and an item's or a folder's this device makes, so one made offline
// already has its id
export type NewId = () => string;

export interface ReplicaDeps {
  readonly sql: ReplicaSql;
  readonly transport: ReplicaTransport;
  readonly clock: ReplicaClock;
  readonly newId: NewId;
  readonly merge: BlockMerge;
  readonly blobs: StagedBlobs;
  // null keeps the replica on its check-in alone
  readonly dial: SocketDial | null;
}
