import {
  answerableDecisions,
  APPROVAL_MAX_OPEN,
  approvalPayloadSchema,
  approvalStateSchema,
  claimedDispatchSchema,
  DISPATCH_CLAIM_TTL_MS,
  DISPATCH_MAX_PENDING,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type {
  AckDispatchesResponse,
  ApprovalRow,
  ApprovalState,
  CancelDispatchResponse,
  ClaimDispatchesResponse,
  ClaimedDispatch,
  CloseApprovalResponse,
  CreateDispatchRequest,
  DispatchResult,
  DispatchStatus,
  OpenApprovalRequest,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type { z } from "zod";

// The dispatch inbox's SQL, over the thread-sync object's own storage; the object owns the
// tombstone and the sockets. The clock is an argument, so a claim's TTL is judged on read and a
// lapsed claim needs no alarm. A row's body is the claimed row itself, frozen at create, so a
// claim hands over exactly what the phone sent.

// a settled row outlives the phone's last status poll by far; one it lost track of reads unknown
const DISPATCH_RETENTION_MS = 24 * 60 * 60_000;

export const DISPATCH_TABLES = `
  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    from_device_id TEXT NOT NULL,
    to_device_id TEXT,
    approval_id TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    claim_token TEXT,
    claimed_at INTEGER,
    state TEXT NOT NULL,
    message TEXT,
    settled_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS dispatch_approvals (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    from_device_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    closed_at INTEGER
  );
`;

const ALREADY_ANSWERED = "That request was already answered.";
const NO_LONGER_WAITING = "That request is no longer waiting.";
const UNREADABLE = "This request could not be read.";
const SIGNED_OUT = "That computer was signed out.";

interface ClaimColumns {
  claim_token: string | null;
  claimed_at: number | null;
}

const liveClaim = (row: ClaimColumns, now: number): boolean =>
  row.claim_token !== null &&
  row.claimed_at !== null &&
  row.claimed_at > now - DISPATCH_CLAIM_TTL_MS;

const readStatus = (sql: SqlStorage, id: string, now: number): DispatchStatus | null => {
  const [row] = sql
    .exec<{
      state: string;
      message: string | null;
      claim_token: string | null;
      claimed_at: number | null;
    }>("SELECT state, message, claim_token, claimed_at FROM dispatches WHERE id = ?", id)
    .toArray();
  if (row === undefined) {
    return null;
  }
  switch (row.state) {
    case "delivered": {
      return { id, state: "delivered" };
    }
    case "refused": {
      return { id, message: row.message ?? "", state: "refused" };
    }
    default: {
      return { id, state: liveClaim(row, now) ? "claimed" : "waiting" };
    }
  }
};

const parseStored = <TSchema extends z.ZodType>(
  schema: TSchema,
  stored: string,
): z.infer<TSchema> | null => {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const approvalStateOf = (stored: string): ApprovalState => {
  const state = approvalStateSchema.safeParse(stored);
  return state.success ? state.data : "closed";
};

const prune = (sql: SqlStorage, now: number): void => {
  const before = now - DISPATCH_RETENTION_MS;
  sql.exec("DELETE FROM dispatches WHERE state <> 'pending' AND settled_at <= ?", before);
  sql.exec("DELETE FROM dispatch_approvals WHERE state = 'closed' AND closed_at <= ?", before);
};

// an answer withdrawn before its Mac held it leaves the approval answerable again
const reopenApproval = (sql: SqlStorage, approvalId: string | null): void => {
  if (approvalId !== null) {
    sql.exec(
      "UPDATE dispatch_approvals SET state = 'open' WHERE id = ? AND state = 'answered'",
      approvalId,
    );
  }
};

const closeApproval = (sql: SqlStorage, approvalId: string | null, now: number): void => {
  if (approvalId !== null) {
    sql.exec(
      "UPDATE dispatch_approvals SET state = 'closed', closed_at = ? WHERE id = ? AND state <> 'closed'",
      now,
      approvalId,
    );
  }
};

// a turn pings every desktop but its creator's own sockets; an answer, only the Mac that asked
export type DispatchPing =
  | { threadId: string; to: "desktops" }
  | { threadId: string; to: "device"; deviceId: string };

export type CreateDispatchOutcome =
  | { kind: "stored"; dispatch: DispatchStatus; duplicate: boolean; ping: DispatchPing | null }
  | { kind: "full" }
  | { kind: "no-approval" }
  | { kind: "not-offered" };

const insertDispatch = (
  sql: SqlStorage,
  row: {
    claimed: ClaimedDispatch;
    fromDeviceId: string;
    toDeviceId: string | null;
    approvalId: string | null;
    settled: { message: string; at: number } | null;
  },
): void => {
  sql.exec(
    `INSERT INTO dispatches
       (id, kind, thread_id, from_device_id, to_device_id, approval_id, body, created_at, state, message, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.claimed.id,
    row.claimed.kind,
    row.claimed.threadId,
    row.fromDeviceId,
    row.toDeviceId,
    row.approvalId,
    JSON.stringify(row.claimed),
    row.claimed.createdAt,
    row.settled === null ? "pending" : "refused",
    row.settled?.message ?? null,
    row.settled?.at ?? null,
  );
};

type AnswerRequest = Extract<CreateDispatchRequest, { kind: "answer" }>;

const storeAnswer = (
  sql: SqlStorage,
  deviceId: string,
  request: AnswerRequest,
  now: number,
): CreateDispatchOutcome => {
  const [approval] = sql
    .exec<{
      thread_id: string;
      from_device_id: string;
      payload: string;
      state: string;
    }>(
      "SELECT thread_id, from_device_id, payload, state FROM dispatch_approvals WHERE id = ?",
      request.approvalId,
    )
    .toArray();
  if (approval === undefined) {
    return { kind: "no-approval" };
  }
  const claimed: ClaimedDispatch = { ...request, createdAt: now, threadId: approval.thread_id };
  const state = approvalStateOf(approval.state);
  if (state !== "open") {
    // stored settled, so the phone reads this verdict the way it reads every other one
    const message = state === "answered" ? ALREADY_ANSWERED : NO_LONGER_WAITING;
    insertDispatch(sql, {
      approvalId: request.approvalId,
      claimed,
      fromDeviceId: deviceId,
      settled: { at: now, message },
      toDeviceId: approval.from_device_id,
    });
    return {
      dispatch: { id: request.id, message, state: "refused" },
      duplicate: false,
      kind: "stored",
      ping: null,
    };
  }
  // a payload that no longer parses still takes a deny, the answer every cancel path gives
  const payload = parseStored(approvalPayloadSchema, approval.payload);
  const offered: readonly AnswerRequest["decision"][] =
    payload === null ? ["deny"] : answerableDecisions(payload);
  if (!offered.includes(request.decision)) {
    return { kind: "not-offered" };
  }
  insertDispatch(sql, {
    approvalId: request.approvalId,
    claimed,
    fromDeviceId: deviceId,
    settled: null,
    toDeviceId: approval.from_device_id,
  });
  sql.exec("UPDATE dispatch_approvals SET state = 'answered' WHERE id = ?", request.approvalId);
  return {
    dispatch: { id: request.id, state: "waiting" },
    duplicate: false,
    kind: "stored",
    ping: { deviceId: approval.from_device_id, threadId: approval.thread_id, to: "device" },
  };
};

export const createDispatchRow = (
  sql: SqlStorage,
  deviceId: string,
  request: CreateDispatchRequest,
  now: number,
): CreateDispatchOutcome => {
  prune(sql, now);
  const existing = readStatus(sql, request.id, now);
  if (existing !== null) {
    return { dispatch: existing, duplicate: true, kind: "stored", ping: null };
  }
  const pending = sql
    .exec<{ n: number }>("SELECT COUNT(*) AS n FROM dispatches WHERE state = 'pending'")
    .one().n;
  if (pending >= DISPATCH_MAX_PENDING) {
    return { kind: "full" };
  }
  switch (request.kind) {
    case "turn": {
      insertDispatch(sql, {
        approvalId: null,
        claimed: { ...request, createdAt: now },
        fromDeviceId: deviceId,
        settled: null,
        toDeviceId: null,
      });
      return {
        dispatch: { id: request.id, state: "waiting" },
        duplicate: false,
        kind: "stored",
        ping: { threadId: request.threadId, to: "desktops" },
      };
    }
    case "answer": {
      return storeAnswer(sql, deviceId, request, now);
    }
    // no default
  }
};

export const claimDispatchRows = (
  sql: SqlStorage,
  deviceId: string,
  limit: number,
  now: number,
): ClaimDispatchesResponse => {
  prune(sql, now);
  const claimToken = crypto.randomUUID();
  // rowid is insertion order, where two turns sent within one millisecond share a created_at;
  // RETURNING follows no ORDER BY, and a thread's turns must reach the Mac in the order asked
  const rows = sql
    .exec<{ position: number; id: string; body: string; approval_id: string | null }>(
      `UPDATE dispatches SET claim_token = ?, claimed_at = ?
       WHERE id IN (
         SELECT id FROM dispatches
         WHERE state = 'pending'
           AND (to_device_id IS NULL OR to_device_id = ?)
           AND (claim_token IS NULL OR claimed_at <= ?)
         ORDER BY rowid LIMIT ?
       )
       RETURNING rowid AS position, id, body, approval_id`,
      claimToken,
      now,
      deviceId,
      now - DISPATCH_CLAIM_TTL_MS,
      limit,
    )
    .toArray()
    .toSorted((left, right) => left.position - right.position);
  const dispatches: ClaimedDispatch[] = [];
  for (const row of rows) {
    const claimed = parseStored(claimedDispatchSchema, row.body);
    if (claimed === null) {
      // settled rather than skipped, or every claim would hand it out again
      sql.exec(
        "UPDATE dispatches SET state = 'refused', message = ?, settled_at = ? WHERE id = ?",
        UNREADABLE,
        now,
        row.id,
      );
      closeApproval(sql, row.approval_id, now);
      continue;
    }
    dispatches.push(claimed);
  }
  return { claimToken, dispatches, expiresAt: now + DISPATCH_CLAIM_TTL_MS };
};

export const ackDispatchRows = (
  sql: SqlStorage,
  claimToken: string,
  results: readonly DispatchResult[],
  now: number,
): AckDispatchesResponse => ({
  results: results.map((result): AckDispatchesResponse["results"][number] => {
    const { id } = result;
    const [settled] = sql
      .exec<{ approval_id: string | null }>(
        `UPDATE dispatches SET state = ?, message = ?, settled_at = ?
         WHERE id = ? AND claim_token = ? AND state = 'pending'
         RETURNING approval_id`,
        result.outcome,
        result.outcome === "refused" ? result.message : null,
        now,
        id,
        claimToken,
      )
      .toArray();
    if (settled !== undefined) {
      // an answer its Mac took settles the approval, whichever way the Mac took it
      closeApproval(sql, settled.approval_id, now);
      return { id, outcome: "recorded" };
    }
    const [row] = sql
      .exec<{ claim_token: string | null }>("SELECT claim_token FROM dispatches WHERE id = ?", id)
      .toArray();
    if (row === undefined) {
      return { id, outcome: "unknown" };
    }
    // this claim's own settle, acked again after a lost response
    return { id, outcome: row.claim_token === claimToken ? "recorded" : "reclaimed" };
  }),
});

export const dispatchStatuses = (
  sql: SqlStorage,
  ids: readonly string[],
  now: number,
): DispatchStatus[] => ids.map((id) => readStatus(sql, id, now) ?? { id, state: "unknown" });

export const cancelDispatchRow = (
  sql: SqlStorage,
  id: string,
  now: number,
): CancelDispatchResponse["outcome"] => {
  const [removed] = sql
    .exec<{ approval_id: string | null }>(
      `DELETE FROM dispatches
       WHERE id = ? AND state = 'pending' AND (claim_token IS NULL OR claimed_at <= ?)
       RETURNING approval_id`,
      id,
      now - DISPATCH_CLAIM_TTL_MS,
    )
    .toArray();
  if (removed !== undefined) {
    reopenApproval(sql, removed.approval_id);
    return "cancelled";
  }
  const [row] = sql
    .exec<{ state: string }>("SELECT state FROM dispatches WHERE id = ?", id)
    .toArray();
  if (row === undefined) {
    return "unknown";
  }
  return row.state === "pending" ? "claimed" : "settled";
};

export type OpenApprovalOutcome =
  | { kind: "stored"; duplicate: boolean; state: ApprovalState }
  | { kind: "full" };

export const openApprovalRow = (
  sql: SqlStorage,
  deviceId: string,
  request: OpenApprovalRequest,
  now: number,
): OpenApprovalOutcome => {
  prune(sql, now);
  const [existing] = sql
    .exec<{ state: string }>("SELECT state FROM dispatch_approvals WHERE id = ?", request.id)
    .toArray();
  if (existing !== undefined) {
    return { duplicate: true, kind: "stored", state: approvalStateOf(existing.state) };
  }
  const open = sql
    .exec<{ n: number }>("SELECT COUNT(*) AS n FROM dispatch_approvals WHERE state <> 'closed'")
    .one().n;
  if (open >= APPROVAL_MAX_OPEN) {
    return { kind: "full" };
  }
  sql.exec(
    `INSERT INTO dispatch_approvals (id, thread_id, turn_id, from_device_id, payload, created_at, state)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    request.id,
    request.threadId,
    request.turnId,
    deviceId,
    JSON.stringify(request.payload),
    now,
  );
  return { duplicate: false, kind: "stored", state: "open" };
};

// only the Mac that opened it closes it: its waiter is the one that resolved
export const closeApprovalRow = (
  sql: SqlStorage,
  deviceId: string,
  id: string,
  now: number,
): CloseApprovalResponse["outcome"] => {
  const [row] = sql
    .exec<{ id: string }>(
      "SELECT id FROM dispatch_approvals WHERE id = ? AND from_device_id = ?",
      id,
      deviceId,
    )
    .toArray();
  if (row === undefined) {
    return "unknown";
  }
  closeApproval(sql, id, now);
  return "closed";
};

export const openApprovalRows = (sql: SqlStorage): ApprovalRow[] =>
  sql
    .exec<{
      id: string;
      thread_id: string;
      turn_id: string;
      payload: string;
      created_at: number;
      state: string;
    }>(
      `SELECT id, thread_id, turn_id, payload, created_at, state FROM dispatch_approvals
       WHERE state <> 'closed' ORDER BY created_at, id LIMIT ?`,
      APPROVAL_MAX_OPEN,
    )
    .toArray()
    .flatMap((row): ApprovalRow[] => {
      const payload = parseStored(approvalPayloadSchema, row.payload);
      const state = approvalStateOf(row.state);
      return payload === null || state === "closed"
        ? []
        : [
            {
              createdAt: row.created_at,
              id: row.id,
              payload,
              state,
              threadId: row.thread_id,
              turnId: row.turn_id,
            },
          ];
    });

// a revoked phone's waiting rows never run, and a revoked Mac's approvals can take no answer
export const forgetDevice = (sql: SqlStorage, deviceId: string, now: number): void => {
  const withdrawn = sql
    .exec<{ approval_id: string | null }>(
      `DELETE FROM dispatches
       WHERE from_device_id = ? AND state = 'pending' AND (claim_token IS NULL OR claimed_at <= ?)
       RETURNING approval_id`,
      deviceId,
      now - DISPATCH_CLAIM_TTL_MS,
    )
    .toArray();
  for (const row of withdrawn) {
    reopenApproval(sql, row.approval_id);
  }
  sql.exec(
    "UPDATE dispatch_approvals SET state = 'closed', closed_at = ? WHERE from_device_id = ? AND state <> 'closed'",
    now,
    deviceId,
  );
  sql.exec(
    "UPDATE dispatches SET state = 'refused', message = ?, settled_at = ? WHERE to_device_id = ? AND state = 'pending'",
    SIGNED_OUT,
    now,
    deviceId,
  );
};
