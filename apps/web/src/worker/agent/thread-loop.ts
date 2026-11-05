// A conversation's loop, step by step, over the thread's own SQL, its Messages client, its cell
// and its clock, which the object hands in (`./agent-thread`). One step is one model call or one
// round of tool calls. The rules:
// - the transcript is append-only and holds what was sent and returned (`./thread-schema`);
// - a reply lands only once its stream ends, so a call cut short is sent again whole, never
//   continued: a call stamped by an instance that died is cut, and its step re-sent byte for byte;
// - every tool call of a reply is journaled before any runs, and each is run by the cell under an
//   op id of its own, so one run again lands once;
// - every call is reserved with the cell before it is sent, and what it cost pushed after;
// - a reply silent for three minutes, pings included, is cut as a lost connection and sent again;
// - what the turn did reaches the cell through the outbox, in order, each push once;
// - a turn is sent under the definition in force when it started: one a deploy changed is taken up
//   at the next turn's start, never mid-turn, and from then on no request carries a thinking block
//   from before that turn (`./thread-request`); a tool call the older definition named still runs
//   against the cell's procedures as they stand, one they no longer take answered as an error
//   (`./agent-tools`).
// The filing rules a turn brings ride a system message after the person's: it goes as the last
// message until the turn's first reply lands, and lands with it, so a turn that ends with no reply
// leaves no system message last, which no message after could follow. They go again at the next
// turn after a compaction, which summarized the system messages before it, and at a turn that
// takes up a new definition, whose requests may leave an earlier one out.

import { APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgentEvent, TurnEndReason } from "@repo/contract/cloud/library/agent-events";
import { TOOL_RESULT_SUMMARY_MAX } from "@repo/contract/cloud/library/agent-events";
import type { SqlPort, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import { asksFirst } from "./agent-tools";
import { callFailureFields } from "./anthropic-client";
import { AGENT_MAX_TOKENS } from "./library-agent";
import {
  agentRequest,
  frozenDefinition,
  logDroppedThinking,
  replyBlocksOf,
  requestMessages,
  sha256Hex,
  storedDefinition,
  tokensAtMost,
  transcriptMessage,
} from "./thread-request";
import type {
  ReplyBlock,
  ThreadDefinition,
  ToolResultBlock,
  TranscriptMessage,
} from "./thread-request";
import { THREAD_TURN_STATUSES } from "./thread-schema";
import { pushEntrySchema } from "./thread-wire";
import type {
  CallEstimate,
  CellAnswer,
  DeliveryRequest,
  PreviewRequest,
  PushEntry,
  PushRequest,
  Reservation,
  ReserveRequest,
  ThreadInspection,
  ToolAnswer,
  ToolRequest,
} from "./thread-wire";

// an approval nobody answers is denied this long after it was asked
const APPROVAL_LIMIT_MS = 10 * 60_000;
// Claude unreachable: the step is sent again after each of these, or the server's retry-after when
// longer, at most five minutes; then the turn ends unavailable
const RETRY_MS = [2000, 10_000, 60_000] as const;
const RETRY_AFTER_MAX_MS = 5 * 60_000;
// the cell unreachable: the work is tried again this long after
const CELL_AGAIN_MS = 30_000;
// a live preview of the reply is sent at most this often
const PREVIEW_EVERY_MS = 250;
// a reply this long without a byte, the API's pings included, is taken for a lost connection
const SILENCE_MS = 3 * 60_000;

const DECLINED = "The person declined this, so it did not run.";
const STOPPED = "The person stopped this turn before this ran.";
const CUT_OFF = "Not run: the reply was cut off.";
const TURN_CLOSED = "This turn has ended, so this did not run.";

// what the thread's cell answers it, by Durable Object RPC (`../library/library-do`)
export interface ThreadCell {
  readonly agentReserve: (request: ReserveRequest) => Promise<CellAnswer<Reservation>>;
  readonly agentTool: (request: ToolRequest) => Promise<CellAnswer<ToolAnswer>>;
  readonly agentPush: (request: PushRequest) => Promise<CellAnswer<null>>;
  readonly agentPreview: (request: PreviewRequest) => Promise<CellAnswer<null>>;
}

// the Lifecycle jobs a step asks for
interface ThreadJobs {
  // the thread's work, again at `at`
  readonly driveAt: (at: number) => Promise<void>;
  readonly approvalAt: (toolUseId: string, at: number) => Promise<void>;
  readonly dropApproval: (toolUseId: string) => Promise<void>;
  // the outbox, tried again at `at`
  readonly outboxAt: (at: number) => Promise<void>;
}

export interface ThreadHost {
  readonly threadId: string;
  readonly sql: SqlPort;
  // this instance's stamp: a call stamped by another was made by an instance that died
  readonly isolate: string;
  readonly now: () => number;
  readonly client: () => Anthropic | null;
  // the cell, by a fresh stub each time, since a stub that saw a reset stays broken
  readonly cell: () => ThreadCell;
  // what this deployment would start a turn under (`./thread-request` `deployedDefinition`)
  readonly definition: () => ThreadDefinition;
  readonly jobs: ThreadJobs;
  // the model call each turn is making, which a stop, a purge or a silence cuts
  readonly calls: Map<number, CallInFlight>;
  // the thread let go of: its cell holds it no more
  readonly purge: () => Promise<void>;
}

// a model call this instance is making: the abort that cuts it, and when its reply last moved, by
// the bytes `listeningFetch` sees, pings included, which the SDK reads but never hands on
export interface CallInFlight {
  readonly abort: AbortController;
  heardAt: number;
}

// what the watchdog cuts a silent reply with: the call failed reaching Claude, and is sent again
class SilentReplyError extends Error {
  constructor() {
    super("No byte of the reply arrived for three minutes.");
    this.name = "SilentReplyError";
  }
}

// the platform's fetch, every call in flight heard as its request goes and as each chunk of its
// reply arrives; the client a thread sends with is built over it (`./anthropic-client`)
export const listeningFetch = (
  calls: ReadonlyMap<number, CallInFlight>,
  now: () => number,
): typeof fetch => {
  const heard = (): void => {
    for (const call of calls.values()) {
      call.heardAt = now();
    }
  };
  return async (input, init) => {
    heard();
    const response = await fetch(input, init);
    heard();
    if (response.body === null) {
      return response;
    }
    const listened = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          heard();
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(listened, response);
  };
};

// every call whose reply has been silent too long, cut, which the loop takes for a lost connection;
// the object's watchdog asks every 30 seconds while its work runs (`./agent-thread`)
export const cutSilentCalls = (calls: ReadonlyMap<number, CallInFlight>, now: number): void => {
  for (const [turn, call] of calls) {
    if (now - call.heardAt >= SILENCE_MS && !call.abort.signal.aborted) {
      console.warn({ event: "agent-reply-silent", silentMs: now - call.heardAt, turn });
      call.abort.abort(new SilentReplyError());
    }
  }
};

// what a step left: more to do now, a retry the drive job was re-timed for, the person to wait on,
// nothing to do, or the thread purged
export type StepResult = "continue" | "later" | "paused" | "idle" | "purged";

// ---- rows ----

const turnRowSchema = z.object({
  cancel_requested: z.number(),
  content: z.string(),
  rules: z.string().nullable(),
  rules_hash: z.string().nullable(),
  started: z.number(),
  status: z.enum(THREAD_TURN_STATUSES),
  turn: z.number(),
});

interface OpenTurn {
  readonly turn: number;
  readonly content: string;
  readonly rules: string | null;
  readonly rulesHash: string | null;
  readonly started: boolean;
  readonly cancelRequested: boolean;
  readonly waiting: boolean;
}

const openTurnOf = (sql: SqlStatements): OpenTurn | null => {
  const [raw] = sql.all(
    `SELECT turn, content, rules, rules_hash, started, cancel_requested, status FROM turns
     WHERE status != 'ended' ORDER BY turn LIMIT 1`,
    [],
  );
  if (raw === undefined) {
    return null;
  }
  const row = turnRowSchema.parse(raw);
  return {
    cancelRequested: row.cancel_requested === 1,
    content: row.content,
    rules: row.rules,
    rulesHash: row.rules_hash,
    started: row.started === 1,
    turn: row.turn,
    waiting: row.status === "awaiting_approval",
  };
};

const metaSchema = z.object({ v: z.string() });

const metaOf = (sql: SqlStatements, key: string): string | null => {
  const [row] = sql.all("SELECT v FROM meta WHERE k = ?", [key]);
  return row === undefined ? null : metaSchema.parse(row).v;
};

const setMeta = (sql: SqlStatements, key: string, value: string): void => {
  sql.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [
    key,
    value,
  ]);
};

const transcriptRowSchema = z.object({
  content: z.string(),
  role: z.string(),
  seq: z.number(),
  turn: z.number(),
});

type StoredMessage = TranscriptMessage & { readonly seq: number; readonly turn: number };

const transcriptOf = (sql: SqlStatements): StoredMessage[] =>
  sql.all("SELECT seq, turn, role, content FROM transcript ORDER BY seq", []).map((raw) => {
    const row = transcriptRowSchema.parse(raw);
    return { ...transcriptMessage(row.role, row.content), seq: row.seq, turn: row.turn };
  });

// one message after every other, its content the JSON it is replayed as
const append = (
  sql: SqlStatements,
  row: { readonly turn: number; readonly role: string; readonly content: string },
  source: string,
): void => {
  sql.run(
    `INSERT INTO transcript (seq, turn, role, content, source)
     VALUES ((SELECT coalesce(max(seq), 0) + 1 FROM transcript), ?, ?, ?, ?)`,
    [row.turn, row.role, row.content, source],
  );
};

// what the turn did, queued for the cell in the transaction that did it, under the thread's own
// sequence, which never goes back
const enqueue = (sql: SqlStatements, turn: number, entries: readonly PushEntry[]): void => {
  if (entries.length === 0) {
    return;
  }
  const seq = Number(metaOf(sql, "push_seq") ?? "0") + 1;
  setMeta(sql, "push_seq", String(seq));
  sql.run("INSERT INTO outbox (seq, json) VALUES (?, ?)", [seq, JSON.stringify({ entries, turn })]);
};

const eventEntry = (event: AgentEvent): PushEntry => ({ event, kind: "event" });

// the turn over: its row ended and the cell told why, which seals it there
const endTurn = (
  sql: SqlStatements,
  turn: number,
  ending: { readonly reason: TurnEndReason; readonly detail: string | null; readonly at: number },
): void => {
  sql.run(
    `UPDATE turns SET status = 'ended', ended_at = ?, end_reason = ?, end_detail = ?
     WHERE turn = ? AND status != 'ended'`,
    [ending.at, ending.reason, ending.detail, turn],
  );
  const ended: AgentEvent = { reason: ending.reason, turn, type: "turn.ended" };
  if (ending.detail !== null) {
    ended.detail = ending.detail.slice(0, 200);
  }
  enqueue(sql, turn, [eventEntry(ended)]);
};

// ---- the outbox ----

const outboxRowSchema = z.object({ json: z.string(), seq: z.number() });
const outboxBodySchema = z.object({ entries: z.array(pushEntrySchema), turn: z.number() });

// every push the cell has not acknowledged, in order; one it could not take waits for the outbox
// job, and a thread its cell no longer holds purges itself. A push for a turn the cell no longer
// holds open lands nothing there, and goes
export const drainOutbox = async (host: ThreadHost): Promise<"drained" | "later" | "purged"> => {
  for (;;) {
    const [raw] = host.sql.all("SELECT seq, json FROM outbox ORDER BY seq LIMIT 1", []);
    if (raw === undefined) {
      return "drained";
    }
    const row = outboxRowSchema.parse(raw);
    const body = outboxBodySchema.parse(JSON.parse(row.json));
    let answer: CellAnswer<null>;
    try {
      answer = await host.cell().agentPush({
        entries: body.entries,
        seq: row.seq,
        threadId: host.threadId,
        turn: body.turn,
      });
    } catch (error) {
      console.warn({
        event: "agent-push-failed",
        threadId: host.threadId,
        ...callFailureFields(error),
      });
      await host.jobs.outboxAt(host.now() + CELL_AGAIN_MS);
      return "later";
    }
    if (!answer.ok && answer.refusal === "unknown-thread") {
      await host.purge();
      return "purged";
    }
    host.sql.run("DELETE FROM outbox WHERE seq = ?", [row.seq]);
  }
};

// ---- a turn handed in ----

// the turn the cell delivered, kept once by its op id; false for one it holds already
export const acceptDelivery = (
  host: ThreadHost,
  request: DeliveryRequest,
  rulesHash: string | null,
): boolean =>
  host.sql.transaction(() => {
    if (metaOf(host.sql, "thread") === null) {
      setMeta(host.sql, "thread", request.threadId);
    }
    const held = host.sql.all("SELECT 1 FROM turns WHERE op_id = ? OR turn = ?", [
      request.opId,
      request.turn,
    ]);
    if (held.length > 0) {
      return false;
    }
    host.sql.run(
      `INSERT INTO turns (turn, op_id, content, rules, rules_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      [
        request.turn,
        request.opId,
        JSON.stringify(request.content),
        request.rules,
        rulesHash,
        host.now(),
      ],
    );
    return true;
  });

export const rulesHashOf = async (rules: string | null): Promise<string | null> =>
  rules === null ? null : await sha256Hex(rules);

// ---- the definition ----

const definitionRowSchema = z.object({
  effort: z.string(),
  hash: z.string(),
  model: z.string(),
  since_seq: z.number(),
  system: z.string(),
  tools: z.string(),
});

// the definition the thread's turns are sent under, and the transcript row it is in force from
interface DefinitionInForce {
  readonly definition: ThreadDefinition;
  readonly hash: string;
  readonly sinceSeq: number;
}

const definitionOf = (sql: SqlStatements): DefinitionInForce | null => {
  const [raw] = sql.all(
    "SELECT hash, model, effort, system, tools, since_seq FROM definition ORDER BY id DESC LIMIT 1",
    [],
  );
  if (raw === undefined) {
    return null;
  }
  const row = definitionRowSchema.parse(raw);
  return { definition: storedDefinition(row), hash: row.hash, sinceSeq: row.since_seq };
};

// the definition a started turn is sent under, which its start wrote
const definitionInForce = (sql: SqlStatements): DefinitionInForce => {
  const held = definitionOf(sql);
  if (held === null) {
    throw new Error("a started turn has a definition");
  }
  return held;
};

// the turn's first rows: the definition this deployment starts turns under, when it is not the one
// in force, from the person's message on, then that message. A thread takes up a deploy's
// definition only here, so a turn is sent under one definition from its first call to its last
const startTurn = async (host: ThreadHost, turn: OpenTurn): Promise<void> => {
  const deployed = await frozenDefinition(host.definition());
  host.sql.transaction(() => {
    const held = definitionOf(host.sql);
    if (held?.hash !== deployed.hash) {
      host.sql.run(
        `INSERT INTO definition (id, hash, model, effort, system, tools, since_seq)
         VALUES ((SELECT coalesce(max(id), 0) + 1 FROM definition), ?, ?, ?, ?, ?,
           (SELECT coalesce(max(seq), 0) + 1 FROM transcript))`,
        [deployed.hash, deployed.model, deployed.effort, deployed.system, deployed.tools],
      );
      if (held !== null) {
        console.info({
          event: "agent-definition-taken-up",
          threadId: host.threadId,
          turn: turn.turn,
        });
        host.sql.run("DELETE FROM meta WHERE k = 'rules_hash'", []);
      }
    }
    append(host.sql, { content: turn.content, role: "user", turn: turn.turn }, "person");
    host.sql.run("UPDATE turns SET started = 1 WHERE turn = ?", [turn.turn]);
  });
};

// ---- one model call ----

const usageSchema = z.looseObject({
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
  input_tokens: z.number(),
});

const previousCallSchema = z.object({ ended_at: z.number(), usage: z.string() });

// the last reply's prompt under the definition in force from `sinceSeq`, and when it landed, which
// the cell prices the cache by: a reply under an earlier definition warmed a prefix this one does
// not share
const previousCall = (sql: SqlStatements, sinceSeq: number): CallEstimate["previous"] => {
  const [raw] = sql.all(
    `SELECT usage, ended_at FROM model_calls WHERE status = 'done' AND usage IS NOT NULL
       AND turn >= (SELECT turn FROM transcript WHERE seq = ?)
     ORDER BY ended_at DESC LIMIT 1`,
    [sinceSeq],
  );
  if (raw === undefined) {
    return null;
  }
  const row = previousCallSchema.parse(raw);
  const usage = usageSchema.parse(JSON.parse(row.usage));
  return {
    endedAt: row.ended_at,
    promptTokens:
      usage.input_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
  };
};

// the turn's filing rules while they are still to land: the rules of a turn whose first reply has
// not landed, when they differ from the last that did
const pendingRules = (sql: SqlStatements, turn: OpenTurn, step: number): string | null =>
  step === 0 && turn.rules !== null && turn.rulesHash !== metaOf(sql, "rules_hash")
    ? turn.rules
    : null;

const withRules = (
  transcript: readonly TranscriptMessage[],
  rules: string | null,
): readonly TranscriptMessage[] =>
  rules === null
    ? transcript
    : [...transcript, { content: [{ text: rules, type: "text" }], role: "system" }];

const callRowsSchema = z.object({ failed: z.number(), tries: z.number() });

// the calls before this one at the same step: every try, and those that failed reaching Claude
const triesAt = (sql: SqlStatements, turn: number, step: number) => {
  const [raw] = sql.all(
    `SELECT count(*) AS tries, coalesce(sum(status = 'failed'), 0) AS failed FROM model_calls
     WHERE turn = ? AND step = ?`,
    [turn, step],
  );
  return callRowsSchema.parse(raw);
};

const capRowSchema = z.object({ max_tokens: z.number() });

// the cap the step's first call went out with, or null for a step not yet sent
const firstCapAt = (sql: SqlStatements, turn: number, step: number): number | null => {
  const [raw] = sql.all(
    `SELECT max_tokens FROM model_calls WHERE turn = ? AND step = ? AND max_tokens > 0
     ORDER BY attempt LIMIT 1`,
    [turn, step],
  );
  return raw === undefined ? null : capRowSchema.parse(raw).max_tokens;
};

const cutRowSchema = z.object({ call_id: z.string(), turn: z.number() });

// every call an instance that died left streaming, cut: booked at what it reserved, and its step
// sent again whole by the next step that reaches it
const cutDeadCalls = (host: ThreadHost): void => {
  const { sql } = host;
  const cut = sql
    .all("SELECT call_id, turn FROM model_calls WHERE status = 'streaming' AND isolate != ?", [
      host.isolate,
    ])
    .map((row) => cutRowSchema.parse(row));
  if (cut.length === 0) {
    return;
  }
  const now = host.now();
  sql.transaction(() => {
    for (const call of cut) {
      sql.run("UPDATE model_calls SET status = 'cut', ended_at = ? WHERE call_id = ?", [
        now,
        call.call_id,
      ]);
      enqueue(sql, call.turn, [{ callId: call.call_id, kind: "call", outcome: "cut" }]);
    }
  });
};

// what a stop reason ends a turn with; `tool_use` ends none
interface TurnEnding {
  readonly reason: TurnEndReason;
  readonly detail: string | null;
}

const endingOf = (message: BetaMessage): TurnEnding => {
  switch (message.stop_reason) {
    case "end_turn": {
      return { detail: null, reason: "done" };
    }
    case "max_tokens": {
      return { detail: null, reason: "max_tokens" };
    }
    case "refusal": {
      return { detail: message.stop_details?.category ?? null, reason: "refusal" };
    }
    case "model_context_window_exceeded": {
      return { detail: null, reason: "model_context_window_exceeded" };
    }
    default: {
      // no server tool and no stop sequence is sent, so neither `pause_turn` nor `stop_sequence`
      // can stop a reply of ours
      return { detail: `stop reason ${message.stop_reason ?? "none"}`, reason: "failed" };
    }
  }
};

// what the person's devices show of a reply, in its order: its words, each progress note a
// thinking block shows ahead of the tool call it introduces, and each call
const replyEvents = (blocks: readonly ReplyBlock[]): PushEntry[] =>
  blocks.flatMap((block): PushEntry[] => {
    if (block.type === "text" && block.text !== "") {
      return [eventEntry({ text: block.text, type: "agent.message" })];
    }
    if (block.type === "thinking" && block.thinking !== "") {
      return [eventEntry({ text: block.thinking, type: "agent.progress" })];
    }
    if (block.type === "tool_use") {
      return [
        eventEntry({
          input: z.json().parse(block.input),
          name: block.name,
          toolUseId: block.id,
          type: "agent.tool_use",
        }),
      ];
    }
    return [];
  });

const resultEvent = (toolUseId: string, content: string, isError: boolean): PushEntry =>
  eventEntry({
    isError,
    summary: content.slice(0, TOOL_RESULT_SUMMARY_MAX),
    toolUseId,
    type: "agent.tool_result",
  });

// the reply landed whole, with what it cost, in one transaction: its blocks as returned, after the
// filing rules it was asked under, and the turn ended unless it asks for tools; a compaction in it
// has the next turn send the filing rules again
const landReply = (
  host: ThreadHost,
  turn: OpenTurn,
  call: {
    readonly callId: string;
    readonly model: string;
    readonly rules: string | null;
    readonly message: BetaMessage;
  },
): void => {
  const { message } = call;
  const now = host.now();
  const blocks = replyBlocksOf(message.content);
  host.sql.transaction(() => {
    host.sql.run(
      `UPDATE model_calls SET status = 'done', ended_at = ?, usage = ?, stop_reason = ?
       WHERE call_id = ?`,
      [now, JSON.stringify(message.usage), message.stop_reason, call.callId],
    );
    const entries: PushEntry[] = [
      {
        callId: call.callId,
        kind: "call",
        model: call.model,
        outcome: "billed",
        usage: z.json().parse(message.usage),
      },
    ];
    if (blocks === null) {
      enqueue(host.sql, turn.turn, entries);
      endTurn(host.sql, turn.turn, {
        at: now,
        detail: "a reply this build cannot replay",
        reason: "failed",
      });
      return;
    }
    if (message.stop_reason === "refusal") {
      // a reply declined after it began is discarded, what it wrote before the decline with it,
      // and the turn ends with the decline's category
      // (platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)
      enqueue(host.sql, turn.turn, entries);
      endTurn(host.sql, turn.turn, { ...endingOf(message), at: now });
      return;
    }
    if (blocks.length > 0) {
      if (call.rules !== null) {
        append(
          host.sql,
          {
            content: JSON.stringify([{ text: call.rules, type: "text" }]),
            role: "system",
            turn: turn.turn,
          },
          "rules",
        );
        setMeta(host.sql, "rules_hash", turn.rulesHash ?? "");
      }
      append(
        host.sql,
        { content: JSON.stringify(message.content), role: "assistant", turn: turn.turn },
        "model",
      );
      if (blocks.some((block) => block.type === "compaction" && block.content !== null)) {
        host.sql.run("DELETE FROM meta WHERE k = 'rules_hash'", []);
      }
      entries.push(...replyEvents(blocks));
    }
    const uses = blocks.flatMap((block) => (block.type === "tool_use" ? [block] : []));
    if (message.stop_reason === "tool_use" && uses.length > 0) {
      enqueue(host.sql, turn.turn, entries);
      return;
    }
    if (uses.length > 0) {
      append(
        host.sql,
        {
          content: JSON.stringify(
            uses.map((use) => ({
              content: CUT_OFF,
              is_error: true,
              tool_use_id: use.id,
              type: "tool_result",
            })),
          ),
          role: "user",
          turn: turn.turn,
        },
        "tools",
      );
      entries.push(...uses.map((use) => resultEvent(use.id, CUT_OFF, true)));
    }
    enqueue(host.sql, turn.turn, entries);
    endTurn(host.sql, turn.turn, { ...endingOf(message), at: now });
  });
};

const retryAfterMs = (error: APIError): number => {
  const seconds = Number(error.headers?.get("retry-after") ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

const isRetryable = (status: number | undefined): boolean =>
  status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;

// a call that did not land: stopped by the person, refused by the API (the turn ends), or Claude
// unreachable or silent (sent again, three times, then the turn ends). A call the API answered
// with an error cost nothing; one cut short may have, and is booked at what it reserved
const failedCall = async (
  host: ThreadHost,
  turn: OpenTurn,
  call: {
    readonly callId: string;
    readonly failedBefore: number;
    readonly error: Error;
    readonly stopped: boolean;
  },
): Promise<StepResult> => {
  const now = host.now();
  const { error } = call;
  const status = error instanceof APIError ? error.status : undefined;
  const outcome = status === undefined ? "cut" : "free";
  const settle = (state: "cancelled" | "failed", ending: TurnEndReason | null): void => {
    host.sql.transaction(() => {
      host.sql.run("UPDATE model_calls SET status = ?, ended_at = ?, error = ? WHERE call_id = ?", [
        state,
        now,
        error.message.slice(0, 1000),
        call.callId,
      ]);
      enqueue(host.sql, turn.turn, [{ callId: call.callId, kind: "call", outcome }]);
      if (ending !== null) {
        endTurn(host.sql, turn.turn, {
          at: now,
          detail: status === undefined ? null : `status ${String(status)}`,
          reason: ending,
        });
      }
    });
  };
  if (call.stopped) {
    // the next step settles the cancel
    settle("cancelled", null);
    return "continue";
  }
  console.error({
    event: "agent-call-failed",
    threadId: host.threadId,
    turn: turn.turn,
    ...callFailureFields(error),
  });
  if (!isRetryable(status)) {
    settle("failed", "failed");
    return "continue";
  }
  const wait = RETRY_MS[call.failedBefore];
  if (wait === undefined) {
    settle("failed", "unavailable");
    return "continue";
  }
  settle("failed", null);
  const after = error instanceof APIError ? retryAfterMs(error) : 0;
  await host.jobs.driveAt(now + Math.min(RETRY_AFTER_MAX_MS, Math.max(wait, after)));
  return "later";
};

const errorOf = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error("the call failed");

// the reply as it is written, sent to the person's devices; one that cannot be sent is let go
const sendPreview = async (host: ThreadHost, turn: number, text: string): Promise<void> => {
  try {
    await host.cell().agentPreview({ text, threadId: host.threadId, turn });
  } catch (error) {
    console.warn({ event: "agent-preview-failed", ...callFailureFields(error) });
  }
};

// a call stopped before it went out: nothing sent, its reservation let go, and the stop settled by
// the next step
const unsentCall = (
  host: ThreadHost,
  turn: OpenTurn,
  call: { readonly callId: string; readonly step: number; readonly attempt: number },
): StepResult => {
  const now = host.now();
  host.sql.transaction(() => {
    host.sql.run(
      `INSERT INTO model_calls (call_id, turn, step, attempt, status, isolate, request_sha,
         max_tokens, started_at, ended_at)
       VALUES (?, ?, ?, ?, 'cancelled', ?, '', 0, ?, ?)`,
      [call.callId, turn.turn, call.step, call.attempt, host.isolate, now, now],
    );
    enqueue(host.sql, turn.turn, [{ callId: call.callId, kind: "call", outcome: "free" }]);
  });
  return "continue";
};

const reserveAndSend = async (
  host: ThreadHost,
  turn: OpenTurn,
  transcript: readonly StoredMessage[],
  signal: AbortSignal,
): Promise<StepResult> => {
  const { sql } = host;
  const now = host.now();
  const { definition, sinceSeq } = definitionInForce(sql);
  const step = transcript.filter(
    (message) => message.role === "assistant" && message.turn === turn.turn,
  ).length;
  const tries = triesAt(sql, turn.turn, step);
  const callId = `${host.threadId}:${String(turn.turn)}:${String(step)}:${String(tries.tries)}`;
  // a step sent again keeps the cap it was first sent with, so its bytes are the same
  const resend = firstCapAt(sql, turn.turn, step);
  const rules = pendingRules(sql, turn, step);
  const messages = withRules(requestMessages(transcript, sinceSeq), rules);
  const estimate: CallEstimate = {
    frozenTokens: tokensAtMost(
      JSON.stringify(definition.system).length + JSON.stringify(definition.tools).length,
    ),
    previous: previousCall(sql, sinceSeq),
    promptTokens: tokensAtMost(
      JSON.stringify(agentRequest(definition, messages, AGENT_MAX_TOKENS)).length,
    ),
  };
  let reserved: CellAnswer<Reservation>;
  try {
    reserved = await host.cell().agentReserve({
      callId,
      estimate,
      model: definition.model,
      resend,
      threadId: host.threadId,
      turn: turn.turn,
    });
  } catch (error) {
    console.warn({ event: "agent-reserve-failed", ...callFailureFields(error) });
    if (signal.aborted) {
      return unsentCall(host, turn, { attempt: tries.tries, callId, step });
    }
    await host.jobs.driveAt(now + CELL_AGAIN_MS);
    return "later";
  }
  if (!reserved.ok) {
    if (reserved.refusal === "unknown-thread") {
      await host.purge();
      return "purged";
    }
    sql.transaction(() => {
      endTurn(sql, turn.turn, { at: now, detail: "the turn was closed", reason: "failed" });
    });
    return "continue";
  }
  const reservation = reserved.value;
  if (reservation.kind === "refused") {
    sql.transaction(() => {
      sql.run(
        `INSERT INTO model_calls (call_id, turn, step, attempt, status, isolate, request_sha,
           max_tokens, started_at, ended_at)
         VALUES (?, ?, ?, ?, 'refused', ?, '', 0, ?, ?)`,
        [callId, turn.turn, step, tries.tries, host.isolate, now, now],
      );
      endTurn(sql, turn.turn, { at: now, detail: null, reason: "budget" });
    });
    return "continue";
  }
  const body = agentRequest(definition, messages, reservation.maxTokens);
  const requestSha = await sha256Hex(JSON.stringify(body));
  // the last await before the request goes: a stop that landed while the call was reserved or its
  // request hashed sends nothing
  if (signal.aborted) {
    return unsentCall(host, turn, { attempt: tries.tries, callId, step });
  }
  sql.run(
    `INSERT INTO model_calls (call_id, turn, step, attempt, status, isolate, request_sha,
       max_tokens, started_at)
     VALUES (?, ?, ?, ?, 'streaming', ?, ?, ?, ?)`,
    [callId, turn.turn, step, tries.tries, host.isolate, requestSha, reservation.maxTokens, now],
  );
  const client = host.client();
  if (client === null) {
    sql.transaction(() => {
      sql.run("UPDATE model_calls SET status = 'failed', ended_at = ? WHERE call_id = ?", [
        now,
        callId,
      ]);
      enqueue(sql, turn.turn, [{ callId, kind: "call", outcome: "free" }]);
      endTurn(sql, turn.turn, { at: now, detail: null, reason: "unavailable" });
    });
    return "continue";
  }
  let message: BetaMessage;
  try {
    const stream = client.beta.messages.stream(body, { signal });
    let preview = "";
    let sentAt = 0;
    for await (const streamed of stream) {
      if (streamed.type === "content_block_delta" && streamed.delta.type === "text_delta") {
        preview += streamed.delta.text;
        if (host.now() - sentAt >= PREVIEW_EVERY_MS) {
          sentAt = host.now();
          void sendPreview(host, turn.turn, preview);
        }
      }
    }
    message = await stream.finalMessage();
  } catch (error) {
    return await failedCall(host, turn, {
      callId,
      error: errorOf(error),
      failedBefore: tries.failed,
      stopped: signal.aborted && !(signal.reason instanceof SilentReplyError),
    });
  }
  logDroppedThinking(host.threadId, message);
  landReply(host, turn, { callId, message, model: definition.model, rules });
  return "continue";
};

// one model call under an abort registered before its first await, so a stop that lands while the
// call is reserved, hashed or streamed cuts it
const modelCall = async (
  host: ThreadHost,
  turn: OpenTurn,
  transcript: readonly StoredMessage[],
): Promise<StepResult> => {
  const call: CallInFlight = { abort: new AbortController(), heardAt: host.now() };
  host.calls.set(turn.turn, call);
  try {
    return await reserveAndSend(host, turn, transcript, call.abort.signal);
  } finally {
    host.calls.delete(turn.turn);
  }
};

// ---- one round of tool calls ----

const toolRowSchema = z.object({
  decision: z.enum(["approved", "denied"]).nullable(),
  input: z.string(),
  is_error: z.number(),
  name: z.string(),
  reason: z.string().nullable(),
  result: z.string().nullable(),
  status: z.enum(["pending", "awaiting_approval", "running", "done"]),
  tool_use_id: z.string(),
});

type ToolRow = z.infer<typeof toolRowSchema>;

const toolRowsOf = (sql: SqlStatements, msgSeq: number): ToolRow[] =>
  sql
    .all(
      `SELECT tool_use_id, name, input, status, decision, reason, result, is_error FROM tool_calls
       WHERE msg_seq = ? ORDER BY idx`,
      [msgSeq],
    )
    .map((row) => toolRowSchema.parse(row));

const finishTool = (
  host: ThreadHost,
  turn: number,
  answer: { readonly toolUseId: string; readonly content: string; readonly isError: boolean },
): void => {
  host.sql.transaction(() => {
    host.sql.run(
      `UPDATE tool_calls SET status = 'done', result = ?, is_error = ?, ended_at = ?
       WHERE tool_use_id = ?`,
      [answer.content, answer.isError ? 1 : 0, host.now(), answer.toolUseId],
    );
    enqueue(host.sql, turn, [resultEvent(answer.toolUseId, answer.content, answer.isError)]);
  });
};

const resultBlock = (row: ToolRow): ToolResultBlock => {
  const block: ToolResultBlock = {
    content: row.result ?? "",
    tool_use_id: row.tool_use_id,
    type: "tool_result",
  };
  if (row.is_error === 1) {
    block.is_error = true;
  }
  return block;
};

// the reply's calls journaled, each asking one waiting on the person, the rest run in order by the
// cell; once every one is answered, one message carries every result in the reply's order
const toolRound = async (
  host: ThreadHost,
  turn: OpenTurn,
  reply: StoredMessage & { readonly role: "assistant" },
): Promise<StepResult> => {
  const { sql } = host;
  const uses = reply.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));
  if (uses.length === 0) {
    sql.transaction(() => {
      endTurn(sql, turn.turn, {
        at: host.now(),
        detail: "a reply named no tool",
        reason: "failed",
      });
    });
    return "continue";
  }
  const asked: string[] = [];
  const until = host.now() + APPROVAL_LIMIT_MS;
  sql.transaction(() => {
    for (const [index, use] of uses.entries()) {
      if (sql.all("SELECT 1 FROM tool_calls WHERE tool_use_id = ?", [use.id]).length > 0) {
        continue;
      }
      const asks = asksFirst(use.name);
      sql.run(
        `INSERT INTO tool_calls (tool_use_id, turn, msg_seq, idx, name, input, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          use.id,
          turn.turn,
          reply.seq,
          index,
          use.name,
          JSON.stringify(use.input),
          asks ? "awaiting_approval" : "pending",
        ],
      );
      if (asks) {
        asked.push(use.id);
        enqueue(sql, turn.turn, [
          eventEntry({
            input: z.json().parse(use.input),
            name: use.name,
            toolUseId: use.id,
            type: "approval.asked",
            until,
          }),
        ]);
      }
    }
  });
  for (const toolUseId of asked) {
    await host.jobs.approvalAt(toolUseId, until);
  }
  for (const row of toolRowsOf(sql, reply.seq)) {
    if (row.status === "done" || (row.status === "awaiting_approval" && row.decision === null)) {
      continue;
    }
    if (row.decision === "denied") {
      finishTool(host, turn.turn, {
        content: row.reason === null ? DECLINED : `${DECLINED} ${row.reason}`,
        isError: true,
        toolUseId: row.tool_use_id,
      });
      continue;
    }
    if (openTurnOf(sql)?.cancelRequested !== false) {
      // stopped meanwhile: the next step answers what is left
      return "continue";
    }
    sql.run(
      `UPDATE tool_calls SET status = 'running', attempts = attempts + 1, started_at = ?
       WHERE tool_use_id = ?`,
      [host.now(), row.tool_use_id],
    );
    let answer: CellAnswer<ToolAnswer>;
    try {
      answer = await host.cell().agentTool({
        input: z.json().parse(JSON.parse(row.input)),
        name: row.name,
        threadId: host.threadId,
        toolUseId: row.tool_use_id,
        turn: turn.turn,
      });
    } catch (error) {
      console.warn({ event: "agent-tool-failed", ...callFailureFields(error) });
      await host.jobs.driveAt(host.now() + CELL_AGAIN_MS);
      return "later";
    }
    if (!answer.ok && answer.refusal === "unknown-thread") {
      await host.purge();
      return "purged";
    }
    finishTool(host, turn.turn, {
      content: answer.ok ? answer.value.content : TURN_CLOSED,
      isError: answer.ok ? answer.value.isError : true,
      toolUseId: row.tool_use_id,
    });
  }
  const rows = toolRowsOf(sql, reply.seq);
  if (rows.some((row) => row.status !== "done")) {
    sql.run("UPDATE turns SET status = 'awaiting_approval' WHERE turn = ?", [turn.turn]);
    return "paused";
  }
  sql.transaction(() => {
    append(
      sql,
      { content: JSON.stringify(rows.map(resultBlock)), role: "user", turn: turn.turn },
      "tools",
    );
    sql.run("UPDATE turns SET status = 'running' WHERE turn = ? AND status != 'ended'", [
      turn.turn,
    ]);
  });
  return "continue";
};

// ---- the person ----

const decisionRowSchema = z.object({
  decision: z.string().nullable(),
  status: z.string(),
  turn: z.number(),
});

// the answer to one call that waits on the person, kept once: false when it was answered already,
// or never waited
export const decideCall = async (
  host: ThreadHost,
  answer: {
    readonly toolUseId: string;
    readonly approved: boolean;
    readonly by: "person" | "timeout";
    readonly reason: string | null;
  },
): Promise<boolean> => {
  const decided = host.sql.transaction(() => {
    const [raw] = host.sql.all(
      "SELECT turn, status, decision FROM tool_calls WHERE tool_use_id = ?",
      [answer.toolUseId],
    );
    const row = raw === undefined ? null : decisionRowSchema.parse(raw);
    if (row === null || row.status !== "awaiting_approval" || row.decision !== null) {
      return false;
    }
    host.sql.run(
      "UPDATE tool_calls SET decision = ?, decided_by = ?, reason = ? WHERE tool_use_id = ?",
      [answer.approved ? "approved" : "denied", answer.by, answer.reason, answer.toolUseId],
    );
    host.sql.run(
      "UPDATE turns SET status = 'running' WHERE turn = ? AND status = 'awaiting_approval'",
      [row.turn],
    );
    enqueue(host.sql, row.turn, [
      eventEntry({
        by: answer.by,
        result: answer.approved ? "allow" : "deny",
        toolUseId: answer.toolUseId,
        type: "approval.answered",
      }),
    ]);
    return true;
  });
  if (decided) {
    await host.jobs.dropApproval(answer.toolUseId);
  }
  return decided;
};

// the turn marked stopped, durably, and its stream cut; the next step settles it
export const requestCancel = (host: ThreadHost, turn: number): boolean => {
  const open = host.sql.transaction(() => {
    const held = host.sql.all("SELECT 1 FROM turns WHERE turn = ? AND status != 'ended'", [turn]);
    host.sql.run("UPDATE turns SET cancel_requested = 1 WHERE turn = ? AND status != 'ended'", [
      turn,
    ]);
    return held.length > 0;
  });
  host.calls.get(turn)?.abort.abort(new Error("The person stopped this turn."));
  return open;
};

const pendingRowSchema = z.object({ status: z.string(), tool_use_id: z.string() });

// a stopped turn still answers every call its last reply made, so the next request is valid: what
// ran keeps its result, and the rest, the calls that waited on the person among them, did not run
const settleCancel = async (
  host: ThreadHost,
  turn: OpenTurn,
  last: StoredMessage | undefined,
): Promise<void> => {
  const { sql } = host;
  const now = host.now();
  const waited: string[] = [];
  sql.transaction(() => {
    if (last?.role === "assistant" && last.turn === turn.turn) {
      const uses = last.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));
      const rows = new Map(toolRowsOf(sql, last.seq).map((row) => [row.tool_use_id, row]));
      const entries: PushEntry[] = [];
      const results = uses.map((use) => {
        const row = rows.get(use.id);
        if (row?.status === "done") {
          return resultBlock(row);
        }
        if (row?.status === "awaiting_approval" && row.decision === null) {
          waited.push(use.id);
          entries.push(
            eventEntry({
              by: "cancel",
              result: "deny",
              toolUseId: use.id,
              type: "approval.answered",
            }),
          );
        }
        entries.push(resultEvent(use.id, STOPPED, true));
        return {
          content: STOPPED,
          is_error: true,
          tool_use_id: use.id,
          type: "tool_result" as const,
        };
      });
      for (const raw of sql.all("SELECT tool_use_id, status FROM tool_calls WHERE msg_seq = ?", [
        last.seq,
      ])) {
        const row = pendingRowSchema.parse(raw);
        if (row.status !== "done") {
          sql.run(
            `UPDATE tool_calls SET status = 'done', decision = coalesce(decision, 'denied'),
               decided_by = coalesce(decided_by, 'cancel'), result = ?, is_error = 1, ended_at = ?
             WHERE tool_use_id = ?`,
            [STOPPED, now, row.tool_use_id],
          );
        }
      }
      if (results.length > 0) {
        append(sql, { content: JSON.stringify(results), role: "user", turn: turn.turn }, "cancel");
      }
      enqueue(sql, turn.turn, entries);
    }
    endTurn(sql, turn.turn, { at: now, detail: null, reason: "cancelled" });
  });
  for (const toolUseId of waited) {
    await host.jobs.dropApproval(toolUseId);
  }
};

// ---- the step ----

// the open turn's next step: its first rows, its cancel settled, a round of tool calls, or a model
// call
const turnStep = async (host: ThreadHost, turn: OpenTurn): Promise<StepResult> => {
  cutDeadCalls(host);
  if (!turn.started) {
    await startTurn(host, turn);
    return "continue";
  }
  const transcript = transcriptOf(host.sql);
  const last = transcript.at(-1);
  if (turn.cancelRequested) {
    await settleCancel(host, turn, last);
    return "continue";
  }
  if (last?.role === "assistant" && last.turn === turn.turn) {
    return await toolRound(host, turn, last);
  }
  return await modelCall(host, turn, transcript);
};

// one step, the outbox drained before it and after it, so what it did reaches the cell before the
// thread rests on the person or on nothing
export const step = async (host: ThreadHost): Promise<StepResult> => {
  const before = await drainOutbox(host);
  if (before === "purged") {
    return "purged";
  }
  const turn = openTurnOf(host.sql);
  if (turn === null) {
    return before === "later" ? "later" : "idle";
  }
  const result = await turnStep(host, turn);
  if (result === "purged") {
    return result;
  }
  const after = await drainOutbox(host);
  return after === "purged" ? "purged" : result;
};

// where the thread stands, as its cell and the suites ask
export const inspectThread = (host: ThreadHost, driving: boolean): ThreadInspection => {
  const turn = openTurnOf(host.sql);
  const [outbox] = host.sql.all("SELECT count(*) AS count FROM outbox", []);
  let status: ThreadInspection["status"] = "idle";
  if (turn !== null) {
    status = turn.waiting ? "awaiting_approval" : "running";
  }
  return {
    driving,
    outbox: z.object({ count: z.number() }).parse(outbox).count,
    status,
    turn: turn?.turn ?? null,
  };
};
