// the phone's writes, durable in its database before a write resolves, sent to the hosted vault
// oldest first, one change set per row, through the guarded route. A row the vault refuses as stale
// is settled here with the desktop's own verdict (outbox-reconcile.ts), and that settle is kept on
// the row before it is sent, so an answer lost after the vault applied it is resent as the same set,
// which the vault answers as already held. A landing moves the mirror's rows in the transaction that
// retires the row. Unreachable stops the queue and keeps it; a refusal no resend passes parks that
// row with its bytes and lets the rows on other paths go; nothing here ever drops the user's text.

import { z } from "zod";
import { base64FromBytes, utf8ByteLength } from "@repo/api/cloud/bytes";
import { describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, CloudFailure, VaultCommitOutcome } from "@repo/api/cloud/client";
import type { CloudErrorCode } from "@repo/api/cloud/errors";
import { createSingleFlight } from "@repo/api/cloud/sync/sync-session";
import type { SyncOutcome } from "@repo/api/cloud/sync/sync-session";
import { vaultChangePaths } from "@repo/api/cloud/vault/vault-commit-schema";
import type { VaultChangeRequest } from "@repo/api/cloud/vault/vault-commit-schema";
import { docStem, freePath } from "@repo/notes/knowledge/doc-file";
import { basenamePath, dirnamePath, extnamePath } from "@repo/notes/knowledge/vault-path";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import type { SyncConflictReport } from "@repo/notes/sync/conflict-copy";
import { diff3 } from "@repo/notes/text/diff3";
import { createExternalStore } from "../lib/external-store";
import type { ReadableStore } from "../lib/external-store";
import { migratePhoneDb } from "../lib/phone-db";
import type { SqlDriver, SqlExecutor } from "../lib/sql-driver";
import type { SessionPort } from "../sync/sync-runtime";
import {
  commentChanges,
  isTextOp,
  opPaths,
  putText,
  renameChanges,
  settleSchema,
  vaultOpSchema,
} from "./outbox-ops";
import type { OutboxRow, RowState, VaultOp } from "./outbox-ops";
import type { OutboxFiles } from "./outbox-files";
import { keptLanding, resolveConflict } from "./outbox-reconcile";
import type { ReconcileContext } from "./outbox-reconcile";
import { landInMirror } from "./vault-mirror";
import type { Fence, MirrorLanding } from "./vault-mirror";

// a row whose every resend meets a head that moved again is left for the next pass
const MAX_ROUNDS_PER_ROW = 3;

// bounds one pass, so a sign-out waits out at most this many sets
const MAX_SETS_PER_PASS = 25;

const MAX_RETRY_MS = 5 * 60 * 1000;

// refusals no resend passes: the row parks and the rows on other paths go on
const PARKING_CODES: ReadonlyMap<CloudErrorCode, string> = new Map([
  ["file-too-large", "This is too large to save to your vault from your phone."],
  ["bad-request", "Your vault could not take this change."],
]);

const STAGED_FILE_GONE = "This attachment is no longer on your phone.";

interface ParkedChange {
  seq: number;
  paths: readonly string[];
  reason: string;
  // a note's text or an attachment can be kept under a free name; a rename, a delete or a comment
  // cannot
  canSaveAsNew: boolean;
}

interface ConflictNotice {
  id: number;
  // describeSyncConflict's sentence, the one the desktop shows
  message: string;
  path: string;
  copyPath: string | null;
}

export interface OutboxStatus {
  // rows waiting for the vault; a parked row waits for the user instead
  unsent: number;
  parked: readonly ParkedChange[];
  conflicts: readonly ConflictNotice[];
  // why the last attempt stopped short of the vault, until a set lands
  lastError: string | null;
}

const EMPTY_STATUS: OutboxStatus = { conflicts: [], lastError: null, parked: [], unsent: 0 };

export interface CreateVaultOutboxArgs {
  db: SqlDriver;
  files: OutboxFiles;
  session: SessionPort;
  fenceFor: (sessionId: number) => Fence;
  // the store's last reset: a pass waits it out, so a wipe has cleared the rows of the sign-in it
  // ended before the next sign-in's pass reads them
  resetWork: () => Promise<void>;
  // the name conflict reports and copies tell this phone by
  thisDevice: string;
  // whether a path is taken on this phone, ignoring case
  isTaken: (path: string) => boolean;
  // the rows or the mirror moved; `landed` names what the vault now holds
  onChange: (rows: readonly OutboxRow[], landed: readonly MirrorLanding[]) => void;
  // the first wait after a failed attempt, doubling to five minutes; null never retries on a timer
  retryBaseMs: number | null;
}

export interface VaultOutbox {
  status: ReadableStore<OutboxStatus>;
  rows: () => readonly OutboxRow[];
  // the rows the last launch left
  load: (fence: Fence) => Promise<void>;
  // every row and staged file, with the mirror on a sign-out or a revocation
  wipe: () => Promise<void>;
  // durable before it resolves; false only when the sign-in it ran under ended
  enqueue: (op: VaultOp, fence: Fence) => Promise<boolean>;
  // replaces the text of a queued write or create, keeping its base; `expected` is the text the
  // caller read the row as, so a row a landing rebased meanwhile answers `stale`
  coalesce: (
    seq: number,
    expected: string,
    content: string,
    fence: Fence,
  ) => Promise<"coalesced" | "stale" | "fenced">;
  stage: (name: string, bytes: Uint8Array) => Promise<void>;
  stagedUri: (name: string) => Promise<string | null>;
  drain: () => Promise<void>;
  retry: (seq: number) => Promise<void>;
  // the text or attachment stays, under a free name beside it; null when the row has none to keep
  saveAsNew: (seq: number) => Promise<string | null>;
  discard: (seq: number) => Promise<void>;
  dismiss: (noticeId: number) => void;
}

const stateColumnsSchema = z.discriminatedUnion("state", [
  z.object({ reason: z.null(), state: z.literal("pending") }),
  z.object({ reason: z.string(), state: z.literal("parked") }),
]);

const rowColumnsSchema = z
  .object({
    created_at: z.number(),
    op: z.string(),
    seq: z.number(),
    settle: z.string().nullable(),
  })
  .and(stateColumnsSchema);

const SELECT_ROWS = "SELECT seq, op, state, reason, settle, created_at FROM outbox";

type RowColumns = z.infer<typeof rowColumnsSchema>;

// a row this build cannot read throws: dropping it would drop the user's text
const rowOf = (columns: RowColumns): OutboxRow => ({
  createdAt: columns.created_at,
  op: vaultOpSchema.parse(JSON.parse(columns.op)),
  seq: columns.seq,
  settle: columns.settle === null ? null : settleSchema.parse(JSON.parse(columns.settle)),
  state:
    columns.state === "parked" ? { kind: "parked", reason: columns.reason } : { kind: "pending" },
});

const readRows = async (db: SqlExecutor): Promise<OutboxRow[]> => {
  const raw = await db.all(`${SELECT_ROWS} ORDER BY seq`);
  return raw.map((row) => rowOf(rowColumnsSchema.parse(row)));
};

const readRow = async (tx: SqlExecutor, seq: number): Promise<OutboxRow | null> => {
  const [raw] = await tx.all(`${SELECT_ROWS} WHERE seq = ?`, [seq]);
  return raw === undefined ? null : rowOf(rowColumnsSchema.parse(raw));
};

const insertRow = async (tx: SqlExecutor, op: VaultOp, createdAt: number): Promise<OutboxRow> => {
  await tx.run("INSERT INTO outbox (op, state, created_at) VALUES (?, 'pending', ?)", [
    JSON.stringify(op),
    createdAt,
  ]);
  const [raw] = await tx.all(`${SELECT_ROWS} WHERE seq = last_insert_rowid()`);
  return rowOf(rowColumnsSchema.parse(raw));
};

const saveRow = async (tx: SqlExecutor, row: OutboxRow): Promise<void> => {
  await tx.run("UPDATE outbox SET op = ?, state = ?, reason = ?, settle = ? WHERE seq = ?", [
    JSON.stringify(row.op),
    row.state.kind,
    row.state.kind === "parked" ? row.state.reason : null,
    row.settle === null ? null : JSON.stringify(row.settle),
    row.seq,
  ]);
};

const PENDING: RowState = { kind: "pending" };

const isParked = (row: OutboxRow): boolean => row.state.kind === "parked";

// oldest first; a row sharing a path with a parked row, or with a row held behind one, waits
const nextToSend = (rows: readonly OutboxRow[]): OutboxRow | null => {
  const held = new Set<string>();
  for (const row of rows) {
    const paths = opPaths(row.op);
    if (!isParked(row) && !paths.some((path) => held.has(path))) {
      return row;
    }
    for (const path of paths) {
      held.add(path);
    }
  }
  return null;
};

const parkReasonFor = (failure: CloudFailure): string | null =>
  failure.kind === "refused" ? (PARKING_CODES.get(failure.code) ?? null) : null;

// the text the phone knows a landed put by; an attachment's is none
const landedText = (change: Extract<VaultChangeRequest, { op: "put" }>): string | null =>
  change.content.encoding === "utf-8" ? change.content.text : null;

// what a committed set leaves on the phone: each change's result, and the vault's own version at a
// path the settle left as it was
const landingsOf = (
  row: OutboxRow,
  sent: readonly VaultChangeRequest[],
  committed: Extract<VaultCommitOutcome, { kind: "committed" }>,
): MirrorLanding[] => {
  const oids = new Map(committed.results.map((result) => [result.path, result.oid]));
  const { commit } = committed;
  const landings: MirrorLanding[] = [];
  for (const change of sent) {
    if (change.op === "delete") {
      landings.push({ kind: "remove", path: change.path });
      continue;
    }
    const oid = oids.get(change.op === "put" ? change.path : change.to);
    if (oid === undefined || oid === null) {
      continue;
    }
    if (change.op === "put") {
      const text = landedText(change);
      const size =
        text === null && row.op.op === "putAsset" ? row.op.size : utf8ByteLength(text ?? "");
      landings.push({ commit, kind: "put", oid, path: change.path, size, text });
    } else {
      const text = row.op.op === "rename" ? row.op.baseContent : null;
      landings.push({ commit, from: change.from, kind: "move", oid, text, to: change.to });
    }
  }
  const against = row.settle?.against ?? null;
  if (against !== null && !sent.some((change) => vaultChangePaths(change).includes(against.path))) {
    const kept = keptLanding(against.path, against);
    if (kept !== null) {
      landings.push(kept);
    }
  }
  return landings;
};

// a write made while its row was out lands as a new row on what the vault took: rebased when the
// vault took a merge, kept as it is when the vault left no text to rebase onto
const remainderOf = (
  now: OutboxRow,
  mine: string | null,
  landings: readonly MirrorLanding[],
): OutboxRow | null => {
  if (!isTextOp(now.op) || mine === null || now.op.content === mine) {
    return null;
  }
  const { path } = now.op;
  const landed = landings.find(
    (landing): landing is Extract<MirrorLanding, { kind: "put" }> =>
      landing.kind === "put" && landing.path === path,
  );
  if (landed === undefined || landed.text === null) {
    return { ...now, settle: null, state: PENDING };
  }
  const content =
    landed.text === mine ? now.op.content : diff3(mine, now.op.content, landed.text).merged;
  return {
    ...now,
    op: { baseContent: landed.text, baseOid: landed.oid, content, op: "write", path },
    settle: null,
    state: PENDING,
  };
};

const mineOf = (row: OutboxRow): string | null => {
  if (row.settle !== null) {
    return row.settle.mine;
  }
  return isTextOp(row.op) ? row.op.content : null;
};

type SendOutcome = "landed" | "parked" | "again" | "stop" | "fenced";

interface CoalesceVerdict {
  value: "coalesced" | "stale";
}

// a note too large to ride a conflict inline is read at the conflict's head; past the wire's cap
// it is bytes no merge reads
const readVaultText =
  (client: CloudClient): ReconcileContext["readText"] =>
  async (path, head) => {
    const result = await client.vaultFile({ path, ref: head });
    if (result.ok) {
      return { kind: "text", text: result.value.content };
    }
    return result.failure.kind === "refused" && result.failure.code === "file-too-large"
      ? { kind: "opaque" }
      : { failure: result.failure, kind: "failed" };
  };

export const createVaultOutbox = (args: CreateVaultOutboxArgs): VaultOutbox => {
  const { db, files, session } = args;
  let rows: OutboxRow[] = [];
  let conflicts: ConflictNotice[] = [];
  let noticeIds = 0;
  let lastError: string | null = null;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const flight = createSingleFlight();
  const status = createExternalStore<OutboxStatus>(EMPTY_STATUS);

  let migrated: Promise<void> | null = null;
  const ready = async (): Promise<void> => {
    migrated ??= migratePhoneDb(db);
    await migrated;
  };

  const publish = (): void => {
    status.set({
      conflicts,
      lastError,
      parked: rows.flatMap((row): ParkedChange[] =>
        row.state.kind === "parked"
          ? [
              {
                canSaveAsNew: isTextOp(row.op) || row.op.op === "putAsset",
                paths: opPaths(row.op),
                reason: row.state.reason,
                seq: row.seq,
              },
            ]
          : [],
      ),
      unsent: rows.filter((row) => !isParked(row)).length,
    });
  };

  const changed = (landed: readonly MirrorLanding[]): void => {
    publish();
    args.onChange(rows, landed);
  };

  const clearRetry = (): void => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  // one transaction, re-checking the fence inside it: a wipe queued ahead of it wins. the cache
  // is read back whole when the transaction fails, since its work may have moved it
  const mutate = async (
    fence: Fence,
    work: (tx: SqlExecutor) => Promise<void>,
  ): Promise<boolean> => {
    await ready();
    const outcome = { landed: false };
    try {
      await db.exclusive(async (tx) => {
        if (!fence()) {
          return;
        }
        await work(tx);
        outcome.landed = true;
      });
    } catch (error) {
      rows = await readRows(db);
      throw error;
    }
    return outcome.landed;
  };

  const replaceRow = (next: OutboxRow): void => {
    rows = rows.map((row) => (row.seq === next.seq ? next : row));
  };

  const dropRow = (seq: number): void => {
    rows = rows.filter((row) => row.seq !== seq);
  };

  // a staged file goes once no row names it; two rows staging the same bytes share one
  const stagedBy = (file: string): boolean =>
    rows.some((row) => row.op.op === "putAsset" && row.op.stagedFile === file);

  const releaseStaged = async (op: VaultOp): Promise<void> => {
    if (op.op !== "putAsset" || stagedBy(op.stagedFile)) {
      return;
    }
    try {
      await files.remove(op.stagedFile);
    } catch {
      // an orphan costs space until the next wipe clears the folder
    }
  };

  const noticeOf = (report: SyncConflictReport): ConflictNotice => {
    noticeIds += 1;
    return {
      copyPath: report.kind === "copied" ? report.copyPath : null,
      id: noticeIds,
      message: describeSyncConflict(report, { thisDevice: args.thisDevice }),
      path: report.path,
    };
  };

  // a note another device changed before a rename reached the vault keeps its bytes, and so its
  // link keeps the old name, which the renamed note's alias still answers
  const unlinkedNotice = (path: string): ConflictNotice => {
    noticeIds += 1;
    return {
      copyPath: null,
      id: noticeIds,
      message: `${docStem(path)} changed on another device first, so its link keeps the old name, which still opens the note.`,
      path,
    };
  };

  // the landings and the row's retirement are one transaction; a text written since stays queued
  const settleRow = async (
    fence: Fence,
    row: OutboxRow,
    mine: string | null,
    landings: readonly MirrorLanding[],
    reports: readonly SyncConflictReport[],
  ): Promise<boolean> => {
    const landed = await mutate(fence, async (tx) => {
      await landInMirror(tx, landings);
      const now = await readRow(tx, row.seq);
      if (now === null) {
        return;
      }
      const remainder = remainderOf(now, mine, landings);
      if (remainder === null) {
        await tx.run("DELETE FROM outbox WHERE seq = ?", [row.seq]);
        dropRow(row.seq);
      } else {
        await saveRow(tx, remainder);
        replaceRow(remainder);
      }
    });
    if (!landed) {
      return false;
    }
    await releaseStaged(row.op);
    failures = 0;
    lastError = null;
    conflicts = [...conflicts, ...reports.map(noticeOf)];
    changed(landings);
    return true;
  };

  const park = async (fence: Fence, row: OutboxRow, reason: string): Promise<boolean> => {
    const landed = await mutate(fence, async (tx) => {
      const now = await readRow(tx, row.seq);
      if (now !== null) {
        const next: OutboxRow = { ...now, settle: null, state: { kind: "parked", reason } };
        await saveRow(tx, next);
        replaceRow(next);
      }
    });
    if (landed) {
      changed([]);
    }
    return landed;
  };

  const changesToSend = async (
    row: OutboxRow,
  ): Promise<{ kind: "set"; changes: readonly VaultChangeRequest[] } | { kind: "gone" }> => {
    if (row.settle !== null) {
      return { changes: row.settle.changes, kind: "set" };
    }
    const { op } = row;
    switch (op.op) {
      case "write": {
        return { changes: [putText(op.path, op.baseOid, op.content)], kind: "set" };
      }
      case "create": {
        return { changes: [putText(op.path, null, op.content)], kind: "set" };
      }
      case "remove": {
        return {
          changes: [op, ...op.stores].map((removed): VaultChangeRequest => ({
            base: removed.baseOid,
            op: "delete",
            path: removed.path,
          })),
          kind: "set",
        };
      }
      case "rename": {
        return { changes: renameChanges(op), kind: "set" };
      }
      case "comment": {
        return { changes: commentChanges(op), kind: "set" };
      }
      case "putAsset": {
        let bytes: Uint8Array;
        try {
          bytes = await files.read(op.stagedFile);
        } catch {
          return { kind: "gone" };
        }
        const put: VaultChangeRequest = {
          base: null,
          content: { data: base64FromBytes(bytes), encoding: "base64" },
          op: "put",
          path: op.path,
        };
        return { changes: [put], kind: "set" };
      }
      // no default
    }
  };

  // a refusal that ends the sign-in stops everything; one no resend passes parks the row; any
  // other failure stops the queue with every row kept
  const afterFailure = async (
    fence: Fence,
    row: OutboxRow,
    failure: CloudFailure,
  ): Promise<SendOutcome> => {
    if (session.recordFailure(failure) === "ended") {
      return "fenced";
    }
    const parking = parkReasonFor(failure);
    if (parking !== null) {
      return (await park(fence, row, parking)) ? "parked" : "fenced";
    }
    lastError = describeCloudFailure(failure);
    return "stop";
  };

  const afterConflict = async (
    client: CloudClient,
    fence: Fence,
    row: OutboxRow,
    conflict: Extract<VaultCommitOutcome, { kind: "conflict" }>,
  ): Promise<SendOutcome> => {
    const resolution = await resolveConflict(row, conflict, {
      isTaken: args.isTaken,
      readText: readVaultText(client),
      thisDevice: args.thisDevice,
    });
    if (!fence()) {
      return "fenced";
    }
    switch (resolution.kind) {
      case "send":
      case "retarget": {
        const next: OutboxRow =
          resolution.kind === "send"
            ? { ...row, settle: resolution.settle }
            : { ...row, op: resolution.op, settle: null };
        const saved = await mutate(fence, async (tx) => {
          const now = await readRow(tx, row.seq);
          if (now !== null) {
            // an edit coalesced meanwhile keeps its text; the settle records what it was made from
            const kept = { ...next, op: isTextOp(now.op) ? now.op : next.op, state: now.state };
            await saveRow(tx, kept);
            replaceRow(kept);
          }
        });
        if (!saved) {
          return "fenced";
        }
        // a retarget changes what the row lays over the mirror
        if (resolution.kind === "retarget") {
          conflicts = [...conflicts, ...resolution.unlinked.map(unlinkedNotice)];
          changed([]);
        }
        return "again";
      }
      case "local": {
        const mine = isTextOp(row.op) ? row.op.content : null;
        return (await settleRow(fence, row, mine, resolution.landings, resolution.reports))
          ? "landed"
          : "fenced";
      }
      case "park": {
        return (await park(fence, row, resolution.reason)) ? "parked" : "fenced";
      }
      case "failed": {
        return await afterFailure(fence, row, resolution.failure);
      }
      // no default
    }
  };

  const sendRow = async (
    client: CloudClient,
    fence: Fence,
    row: OutboxRow,
  ): Promise<SendOutcome> => {
    const set = await changesToSend(row);
    if (set.kind === "gone") {
      return (await park(fence, row, STAGED_FILE_GONE)) ? "parked" : "fenced";
    }
    const answer = await client.vaultCommit({
      authoredAt: row.createdAt,
      changes: [...set.changes],
    });
    if (!fence()) {
      return "fenced";
    }
    if (!answer.ok) {
      return await afterFailure(fence, row, answer.failure);
    }
    if (answer.value.kind === "conflict") {
      return await afterConflict(client, fence, row, answer.value);
    }
    const landings = landingsOf(row, set.changes, answer.value);
    return (await settleRow(fence, row, mineOf(row), landings, row.settle?.reports ?? []))
      ? "landed"
      : "fenced";
  };

  // whether the last pass stopped short of the vault, which arms the retry timer
  let stopped = false;

  const armRetry = (run: () => void): void => {
    if (args.retryBaseMs === null) {
      return;
    }
    clearRetry();
    const delay = Math.min(args.retryBaseMs * 2 ** failures, MAX_RETRY_MS);
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      run();
    }, delay);
    retryTimer.unref?.();
  };

  const pass = async (): Promise<SyncOutcome> => {
    stopped = false;
    await args.resetWork();
    await ready();
    const current = session.current();
    if (current.kind !== "live") {
      return "fenced";
    }
    const fence = args.fenceFor(current.id);
    const rounds = new Map<number, number>();
    for (let sets = 0; sets < MAX_SETS_PER_PASS; sets += 1) {
      if (!fence()) {
        return "fenced";
      }
      const row = nextToSend(rows);
      if (row === null) {
        return "caught-up";
      }
      const round = (rounds.get(row.seq) ?? 0) + 1;
      rounds.set(row.seq, round);
      if (round > MAX_ROUNDS_PER_ROW) {
        lastError = "Your vault kept changing while this phone saved. It will try again.";
      }
      const outcome =
        round > MAX_ROUNDS_PER_ROW ? "stop" : await sendRow(current.client, fence, row);
      if (outcome === "fenced") {
        return "fenced";
      }
      if (outcome === "stop") {
        stopped = true;
        publish();
        return "failed";
      }
    }
    return "more";
  };

  const drain = async (): Promise<void> => {
    if (session.current().kind !== "live") {
      return;
    }
    await flight.run({
      onError: (message) => {
        lastError = message;
        publish();
      },
      pass,
      repeat: () => session.current().kind === "live",
    });
    if (stopped) {
      armRetry(() => {
        void drain();
      });
    }
  };

  // a user's own action on a parked row, under the sign-in that is live now
  const liveFence = (): Fence | null => {
    const current = session.current();
    return current.kind === "live" ? args.fenceFor(current.id) : null;
  };

  // `Plan.md` is kept as `Plan 2.md`, the way a create steps past a taken name
  const freeNameBeside = (path: string): string => {
    const name = basenamePath(path);
    const extension = extnamePath(name);
    const stem = name.slice(0, name.length - extension.length);
    return freePath(dirnamePath(path), stem, extension, args.isTaken);
  };

  return {
    coalesce: async (seq, expected, content, fence) => {
      const verdict: CoalesceVerdict = { value: "stale" };
      const landed = await mutate(fence, async (tx) => {
        const now = await readRow(tx, seq);
        if (now === null || !isTextOp(now.op) || now.op.content !== expected) {
          return;
        }
        // a parked settle was refused, so none of it is in the vault to land again
        const next: OutboxRow = {
          ...now,
          op: { ...now.op, content },
          settle: isParked(now) ? null : now.settle,
          state: PENDING,
        };
        await saveRow(tx, next);
        replaceRow(next);
        verdict.value = "coalesced";
      });
      if (!landed) {
        return "fenced";
      }
      if (verdict.value === "coalesced") {
        changed([]);
        void drain();
      }
      return verdict.value;
    },

    discard: async (seq) => {
      const fence = liveFence();
      const row = rows.find((candidate) => candidate.seq === seq);
      if (fence === null || row === undefined) {
        return;
      }
      if (
        await mutate(fence, async (tx) => {
          await tx.run("DELETE FROM outbox WHERE seq = ?", [seq]);
          dropRow(seq);
        })
      ) {
        await releaseStaged(row.op);
        changed([]);
        void drain();
      }
    },

    dismiss: (noticeId) => {
      conflicts = conflicts.filter((notice) => notice.id !== noticeId);
      publish();
    },

    drain,

    enqueue: async (op, fence) => {
      const landed = await mutate(fence, async (tx) => {
        rows = [...rows, await insertRow(tx, op, Date.now())];
      });
      if (landed) {
        changed([]);
        void drain();
      }
      return landed;
    },

    load: async (fence) => {
      await ready();
      const loaded = await readRows(db);
      if (fence()) {
        rows = loaded;
        publish();
      }
    },

    retry: async (seq) => {
      const fence = liveFence();
      if (fence === null) {
        return;
      }
      failures = 0;
      clearRetry();
      await mutate(fence, async (tx) => {
        const now = await readRow(tx, seq);
        if (now !== null && isParked(now)) {
          const next = { ...now, state: PENDING };
          await saveRow(tx, next);
          replaceRow(next);
        }
      });
      changed([]);
      await drain();
    },

    rows: () => rows,

    saveAsNew: async (seq) => {
      const fence = liveFence();
      const row = rows.find((candidate) => candidate.seq === seq);
      if (fence === null || row === undefined) {
        return null;
      }
      const { op } = row;
      if (!isTextOp(op) && op.op !== "putAsset") {
        return null;
      }
      const path = freeNameBeside(op.path);
      const copy: VaultOp =
        op.op === "putAsset" ? { ...op, path } : { content: op.content, op: "create", path };
      const landed = await mutate(fence, async (tx) => {
        await tx.run("DELETE FROM outbox WHERE seq = ?", [seq]);
        dropRow(seq);
        rows = [...rows, await insertRow(tx, copy, row.createdAt)];
      });
      if (!landed) {
        return null;
      }
      changed([]);
      void drain();
      return path;
    },

    stage: async (name, bytes) => {
      await files.stage(name, bytes);
    },

    stagedUri: async (name) => await files.find(name),

    status,

    wipe: async () => {
      clearRetry();
      failures = 0;
      rows = [];
      conflicts = [];
      lastError = null;
      publish();
      try {
        await ready();
        // cleared again inside: a write whose transaction was queued ahead of this one landed in
        // the cache after the line above
        await db.exclusive(async (tx) => {
          await tx.run("DELETE FROM outbox");
          rows = [];
        });
      } catch {
        // a sign-in after this one wipes again, and a row is only sent under a live session
      }
      try {
        await files.clear();
      } catch {
        // the same: the next wipe retries
      }
    },
  };
};
