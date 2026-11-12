// A conversation's loop, step by step, over the thread's own SQLite, its Messages client, its cell
// and its clock, which the object hands in (`./agent-thread`). One step is one model call or one
// round of tool calls. The rules:
// - the transcript is append-only and holds what was sent and returned
//   (`@repo/db/thread/schema`);
// - a reply lands only once its stream ends, so a call cut short is sent again whole, never
//   continued: a call stamped by an instance that died is cut, and its step re-sent byte for byte;
// - every tool call of a reply is journaled before any runs, and each is run by the cell under an
//   op id of its own, so one run again lands once;
// - every call asks the same cap, so a step sent again is the same bytes, and what each reply was
//   billed is pushed once it lands; a turn ends `budget` before a call past its twentieth reply;
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

import type { APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgentEvent, TurnEndReason } from "@repo/contract/library/agent-events";
import { TOOL_RESULT_SUMMARY_MAX } from "@repo/contract/library/agent-events";
import { sha256Hex } from "@repo/contract/bytes";
import {
  modelCalls,
  threadDefinitions,
  threadMeta,
  threadOutbox,
  threadTranscript,
  threadTurns,
  toolCalls,
} from "@repo/db/thread/schema";
import { and, asc, count, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { asksFirst } from "./agent-tools";
import { callFailureFields, isApiError, isSpendLimitRefusal } from "./anthropic-client";
import { AGENT_MAX_STEPS } from "./library-agent";
import type { ThreadDb } from "./thread-db";
import { cutCall, cutOf } from "./thread-drive";
import type { StepResult } from "./thread-drive";
import {
  agentRequest,
  frozenDefinition,
  logDroppedThinking,
  replyBlocksOf,
  requestMessages,
  storedDefinition,
  transcriptMessage,
} from "./thread-request";
import type {
  ReplyBlock,
  ThreadDefinition,
  ToolResultBlock,
  TranscriptMessage,
} from "./thread-request";
import { pushEntrySchema } from "./thread-wire";
import { toolCallNext, toolCallOf } from "./tool-call";
import type { ToolCall, ToolCallEvent } from "./tool-call";
import { RULES_CLEARED } from "./turn-message";
import type {
  CellAnswer,
  DeliveryRequest,
  PreviewRequest,
  PushEntry,
  PushRequest,
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

const CUT_OFF = "Not run: the reply was cut off.";
const TURN_CLOSED: ToolAnswer = {
  content: "This turn has ended, so this did not run.",
  isError: true,
};

// what the thread's cell answers it, by Durable Object RPC (`../library/library-do`)
export interface ThreadCell {
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
  readonly db: ThreadDb;
  // one synchronous transaction, the Durable Object's own `transactionSync`
  readonly transaction: <T>(work: () => T) => T;
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
      cutCall(call.abort, "silent");
    }
  }
};

// ---- rows ----

interface OpenTurn {
  readonly turn: number;
  readonly content: string;
  readonly rules: string | null;
  readonly rulesHash: string | null;
  readonly started: boolean;
  readonly cancelRequested: boolean;
  readonly waiting: boolean;
}

const openTurnOf = (db: ThreadDb): OpenTurn | null => {
  const row = db
    .select()
    .from(threadTurns)
    .where(ne(threadTurns.status, "ended"))
    .orderBy(asc(threadTurns.turn))
    .limit(1)
    .get();
  if (row === undefined) {
    return null;
  }
  return {
    cancelRequested: row.cancelRequested === 1,
    content: row.content,
    rules: row.rules,
    rulesHash: row.rulesHash,
    started: row.started === 1,
    turn: row.turn,
    waiting: row.status === "awaiting_approval",
  };
};

const META_ID = 1;

const metaOf = (db: ThreadDb) => {
  db.insert(threadMeta).values({ id: META_ID }).onConflictDoNothing().run();
  const row = db.select().from(threadMeta).where(eq(threadMeta.id, META_ID)).get();
  if (row === undefined) {
    throw new Error("a conversation without its meta row");
  }
  return row;
};

const setMeta = (db: ThreadDb, values: SQLiteUpdateSetSource<typeof threadMeta>): void => {
  metaOf(db);
  db.update(threadMeta).set(values).where(eq(threadMeta.id, META_ID)).run();
};

// `rulesHash` is null while the conversation carries no filing rules and the last landed rules'
// hash while it does. Rules a compaction summarized or a new definition stopped replaying are
// neither: the next turn owes their words, or word that they are cleared, so it holds what no hash
// equals.
const markRulesOwed = (db: ThreadDb): void => {
  db.update(threadMeta).set({ rulesHash: "" }).where(isNotNull(threadMeta.rulesHash)).run();
};

type StoredMessage = TranscriptMessage & { readonly seq: number; readonly turn: number };

const transcriptOf = (db: ThreadDb): StoredMessage[] =>
  db
    .select()
    .from(threadTranscript)
    .orderBy(asc(threadTranscript.seq))
    .all()
    .map((row) => ({ ...transcriptMessage(row.role, row.content), seq: row.seq, turn: row.turn }));

// the seq the next transcript row takes, which a definition names before that row is written
const nextSeq = sql`(SELECT coalesce(max(${threadTranscript.seq}), 0) + 1 FROM ${threadTranscript})`;

// one message after every other, its content the JSON it is replayed as
const append = (
  db: ThreadDb,
  row: Pick<typeof threadTranscript.$inferInsert, "content" | "role" | "turn">,
): void => {
  db.insert(threadTranscript)
    .values({ ...row, seq: nextSeq })
    .run();
};

// what the turn did, queued for the cell in the transaction that did it, under the thread's own
// sequence, which never goes back
const enqueue = (db: ThreadDb, turn: number, entries: readonly PushEntry[]): void => {
  if (entries.length === 0) {
    return;
  }
  const seq = metaOf(db).pushSeq + 1;
  setMeta(db, { pushSeq: seq });
  db.insert(threadOutbox)
    .values({ json: JSON.stringify({ entries, turn }), seq })
    .run();
};

const eventEntry = (event: AgentEvent): PushEntry => ({ event, kind: "event" });

// why a turn ended, and what more the reason leaves out
interface TurnEnding {
  readonly reason: TurnEndReason;
  readonly detail: string | null;
}

// the turn over: its row ended and the cell told why, which seals it there
const endTurn = (db: ThreadDb, turn: number, ending: TurnEnding): void => {
  db.update(threadTurns)
    .set({ status: "ended" })
    .where(and(eq(threadTurns.turn, turn), ne(threadTurns.status, "ended")))
    .run();
  const ended: AgentEvent = { reason: ending.reason, turn, type: "turn.ended" };
  if (ending.detail !== null) {
    ended.detail = ending.detail.slice(0, 200);
  }
  enqueue(db, turn, [eventEntry(ended)]);
};

// ---- the outbox ----

const outboxBodySchema = z.object({ entries: z.array(pushEntrySchema), turn: z.number() });

// every push the cell has not acknowledged, in order; one it could not take waits for the outbox
// job, and a thread its cell no longer holds purges itself. A push for a turn the cell no longer
// holds open lands nothing there, and goes
export const drainOutbox = async (host: ThreadHost): Promise<"drained" | "later" | "purged"> => {
  for (;;) {
    const row = host.db.select().from(threadOutbox).orderBy(asc(threadOutbox.seq)).limit(1).get();
    if (row === undefined) {
      return "drained";
    }
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
    host.db.delete(threadOutbox).where(eq(threadOutbox.seq, row.seq)).run();
  }
};

// ---- a turn handed in ----

// the turn the cell delivered, kept once by its op id, and the push sequence taken past the last
// push the cell landed, which an object that started over on empty tables would otherwise reuse
export const acceptDelivery = (
  host: ThreadHost,
  request: DeliveryRequest,
  rulesHash: string | null,
): void => {
  const { db } = host;
  host.transaction(() => {
    db.insert(threadTurns)
      .values({
        content: JSON.stringify(request.content),
        opId: request.opId,
        rules: request.rules,
        rulesHash,
        status: "running",
        turn: request.turn,
      })
      .onConflictDoNothing()
      .run();
    setMeta(db, { pushSeq: sql`max(${threadMeta.pushSeq}, ${request.pushedThrough})` });
  });
};

export const rulesHashOf = async (rules: string | null): Promise<string | null> =>
  rules === null ? null : await sha256Hex(rules);

// ---- the definition ----

// the definition the thread's turns are sent under, and the transcript row it is in force from
interface DefinitionInForce {
  readonly definition: ThreadDefinition;
  readonly hash: string;
  readonly sinceSeq: number;
}

const definitionOf = (db: ThreadDb): DefinitionInForce | null => {
  const row = db
    .select()
    .from(threadDefinitions)
    .orderBy(desc(threadDefinitions.id))
    .limit(1)
    .get();
  if (row === undefined) {
    return null;
  }
  return { definition: storedDefinition(row), hash: row.hash, sinceSeq: row.sinceSeq };
};

// the definition a started turn is sent under, which its start wrote
const definitionInForce = (db: ThreadDb): DefinitionInForce => {
  const held = definitionOf(db);
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
  const { db } = host;
  host.transaction(() => {
    const held = definitionOf(db);
    if (held?.hash !== deployed.hash) {
      db.insert(threadDefinitions)
        .values({
          effort: deployed.effort,
          hash: deployed.hash,
          id: sql`(SELECT coalesce(max(${threadDefinitions.id}), 0) + 1 FROM ${threadDefinitions})`,
          model: deployed.model,
          sinceSeq: nextSeq,
          system: deployed.system,
          tools: deployed.tools,
        })
        .run();
      if (held !== null) {
        console.info({
          event: "agent-definition-taken-up",
          threadId: host.threadId,
          turn: turn.turn,
        });
        markRulesOwed(db);
      }
    }
    append(db, { content: turn.content, role: "user", turn: turn.turn });
    db.update(threadTurns).set({ started: 1 }).where(eq(threadTurns.turn, turn.turn)).run();
  });
};

// ---- one model call ----

// what the turn has to say of the filing rules while it is still to land: on a first reply, the
// rules when they differ from the last that landed, or that they are cleared when some had
const pendingRules = (db: ThreadDb, turn: OpenTurn, step: number): string | null =>
  step !== 0 || turn.rulesHash === metaOf(db).rulesHash ? null : (turn.rules ?? RULES_CLEARED);

const withRules = (
  transcript: readonly TranscriptMessage[],
  rules: string | null,
): readonly TranscriptMessage[] =>
  rules === null
    ? transcript
    : [...transcript, { content: [{ text: rules, type: "text" }], role: "system" }];

// the calls before this one at the same step: every try, and those that failed reaching Claude
const triesAt = (db: ThreadDb, turn: number, step: number) => {
  const statuses = db
    .select({ status: modelCalls.status })
    .from(modelCalls)
    .where(and(eq(modelCalls.turn, turn), eq(modelCalls.step, step)))
    .all();
  return {
    failed: statuses.filter((row) => row.status === "failed").length,
    tries: statuses.length,
  };
};

// every call an instance that died left streaming, cut, its step sent again whole by the next step
// that reaches it; no usage reports what it cost, which the gateway's per-account limit bounds. Run
// once as an instance starts, since no other instance writes while one lives
export const cutDeadCalls = (db: ThreadDb, isolate: string): void => {
  db.update(modelCalls)
    .set({ status: "cut" })
    .where(and(eq(modelCalls.status, "streaming"), ne(modelCalls.isolate, isolate)))
    .run();
};

// what a stop reason ends a turn with; `tool_use` ends none
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

// the reply landed whole, with what it was billed, in one transaction: its blocks as returned,
// after the filing rules it was asked under, and the turn ended unless it asks for tools; a
// compaction in it has the next turn send the filing rules again
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
  const { db } = host;
  const blocks = replyBlocksOf(message.content);
  host.transaction(() => {
    db.update(modelCalls).set({ status: "done" }).where(eq(modelCalls.callId, call.callId)).run();
    const entries: PushEntry[] = [
      { kind: "usage", model: call.model, usage: z.json().parse(message.usage) },
    ];
    if (blocks === null) {
      enqueue(db, turn.turn, entries);
      endTurn(db, turn.turn, {
        detail: "a reply this build cannot replay",
        reason: "failed",
      });
      return;
    }
    if (message.stop_reason === "refusal") {
      // a reply declined after it began is discarded, what it wrote before the decline with it,
      // and the turn ends with the decline's category
      // (platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)
      enqueue(db, turn.turn, entries);
      endTurn(db, turn.turn, endingOf(message));
      return;
    }
    if (blocks.length > 0) {
      if (call.rules !== null) {
        append(db, {
          content: JSON.stringify([{ text: call.rules, type: "text" }]),
          role: "system",
          turn: turn.turn,
        });
        setMeta(db, { rulesHash: turn.rulesHash });
      }
      append(db, {
        content: JSON.stringify(message.content),
        role: "assistant",
        turn: turn.turn,
      });
      if (blocks.some((block) => block.type === "compaction" && block.content !== null)) {
        markRulesOwed(db);
      }
      entries.push(...replyEvents(blocks));
    }
    const uses = blocks.flatMap((block) => (block.type === "tool_use" ? [block] : []));
    if (message.stop_reason === "tool_use" && uses.length > 0) {
      enqueue(db, turn.turn, entries);
      return;
    }
    if (uses.length > 0) {
      append(db, {
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
      });
      entries.push(...uses.map((use) => resultEvent(use.id, CUT_OFF, true)));
    }
    enqueue(db, turn.turn, entries);
    endTurn(db, turn.turn, endingOf(message));
  });
};

const retryAfterMs = (error: APIError): number => {
  const seconds = Number(error.headers?.get("retry-after") ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

const isRetryable = (status: number | undefined): boolean =>
  status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;

// a call that did not land: stopped by the person, refused by the API or the gateway's spend limit
// (the turn ends), or Claude unreachable or silent (sent again, three times, then the turn ends). A call the API answered
// with an error cost nothing; one cut short may have, which no usage reports and the gateway's
// per-account limit bounds
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
  const { error } = call;
  const { db } = host;
  const status = isApiError(error) ? error.status : undefined;
  const settle = (state: "cancelled" | "failed", ending: TurnEndReason | null): void => {
    host.transaction(() => {
      db.update(modelCalls).set({ status: state }).where(eq(modelCalls.callId, call.callId)).run();
      if (ending !== null) {
        endTurn(db, turn.turn, {
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
  if (isSpendLimitRefusal(error)) {
    settle("failed", "allowance");
    return "continue";
  }
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
  const after = isApiError(error) ? retryAfterMs(error) : 0;
  await host.jobs.driveAt(host.now() + Math.min(RETRY_AFTER_MAX_MS, Math.max(wait, after)));
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

// which try of its step a call is
interface CallTry {
  readonly callId: string;
  readonly turn: number;
  readonly step: number;
  readonly attempt: number;
}

// a try that never went out, counted so the next one takes an id of its own
const recordUnsent = (host: ThreadHost, call: CallTry, status: "cancelled" | "failed"): void => {
  host.db
    .insert(modelCalls)
    .values({
      attempt: call.attempt,
      callId: call.callId,
      isolate: host.isolate,
      status,
      step: call.step,
      turn: call.turn,
    })
    .run();
};

// a call stopped before it went out: nothing sent, and the stop settled by the next step
const unsentCall = (host: ThreadHost, call: CallTry): StepResult => {
  recordUnsent(host, call, "cancelled");
  return "continue";
};

const sendCall = async (
  host: ThreadHost,
  turn: OpenTurn,
  transcript: readonly StoredMessage[],
  signal: AbortSignal,
): Promise<StepResult> => {
  const { db } = host;
  const step = transcript.filter(
    (message) => message.role === "assistant" && message.turn === turn.turn,
  ).length;
  if (step >= AGENT_MAX_STEPS) {
    host.transaction(() => {
      endTurn(db, turn.turn, { detail: null, reason: "budget" });
    });
    return "continue";
  }
  const { definition, sinceSeq } = definitionInForce(db);
  const tries = triesAt(db, turn.turn, step);
  const callId = `${host.threadId}:${String(turn.turn)}:${String(step)}:${String(tries.tries)}`;
  const callTry: CallTry = { attempt: tries.tries, callId, step, turn: turn.turn };
  const rules = pendingRules(db, turn, step);
  const body = agentRequest(definition, withRules(requestMessages(transcript, sinceSeq), rules));
  const requestSha = await sha256Hex(JSON.stringify(body));
  // the last await before the request goes: a stop that landed while its request was hashed sends
  // nothing, and a purge writes nothing over the tables it is deleting
  if (signal.aborted) {
    return cutOf(signal) === "purged" ? "purged" : unsentCall(host, callTry);
  }
  const client = host.client();
  if (client === null) {
    host.transaction(() => {
      recordUnsent(host, callTry, "failed");
      endTurn(db, turn.turn, { detail: null, reason: "unavailable" });
    });
    return "continue";
  }
  db.insert(modelCalls)
    .values({
      attempt: tries.tries,
      callId,
      isolate: host.isolate,
      requestSha,
      status: "streaming",
      step,
      turn: turn.turn,
    })
    .run();
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
    const cut = cutOf(signal);
    if (cut === "purged") {
      return "purged";
    }
    return await failedCall(host, turn, {
      callId,
      error: errorOf(error),
      failedBefore: tries.failed,
      stopped: cut === "stopped",
    });
  }
  logDroppedThinking(host.threadId, message);
  landReply(host, turn, { callId, message, model: definition.model, rules });
  return "continue";
};

// one model call under an abort registered before its first await, so a stop that lands while the
// call is hashed or streamed cuts it
const modelCall = async (
  host: ThreadHost,
  turn: OpenTurn,
  transcript: readonly StoredMessage[],
): Promise<StepResult> => {
  const call: CallInFlight = { abort: new AbortController(), heardAt: host.now() };
  host.calls.set(turn.turn, call);
  try {
    return await sendCall(host, turn, transcript, call.abort.signal);
  } finally {
    host.calls.delete(turn.turn);
  }
};

// ---- one round of tool calls ----

type ToolRow = typeof toolCalls.$inferSelect;

const toolRowsOf = (db: ThreadDb, msgSeq: number): ToolRow[] =>
  db.select().from(toolCalls).where(eq(toolCalls.msgSeq, msgSeq)).orderBy(asc(toolCalls.idx)).all();

const RUN: ToolCallEvent = { kind: "run" };
const STOP: ToolCallEvent = { kind: "stop" };

const keepAnswer = (db: ThreadDb, toolUseId: string, answer: ToolAnswer): void => {
  db.update(toolCalls)
    .set({ isError: answer.isError ? 1 : 0, result: answer.content, status: "done" })
    .where(eq(toolCalls.toolUseId, toolUseId))
    .run();
};

// the call moved by `event` in one transaction, its answer kept and pushed where the move answers
// it; a move the call cannot take writes nothing
const answerCall = (
  host: ThreadHost,
  turn: number,
  toolUseId: string,
  event: ToolCallEvent,
): void => {
  host.transaction(() => {
    const row = host.db.select().from(toolCalls).where(eq(toolCalls.toolUseId, toolUseId)).get();
    const next = row === undefined ? null : toolCallNext(toolCallOf(row), event);
    if (next?.kind === "answered") {
      keepAnswer(host.db, toolUseId, next.answer);
      enqueue(host.db, turn, [resultEvent(toolUseId, next.answer.content, next.answer.isError)]);
    }
  });
};

const resultBlock = (toolUseId: string, answer: ToolAnswer): ToolResultBlock => {
  const block: ToolResultBlock = {
    content: answer.content,
    tool_use_id: toolUseId,
    type: "tool_result",
  };
  if (answer.isError) {
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
  const { db } = host;
  const uses = reply.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));
  const asked: string[] = [];
  const until = host.now() + APPROVAL_LIMIT_MS;
  host.transaction(() => {
    for (const [index, use] of uses.entries()) {
      const journaled = db
        .select({ toolUseId: toolCalls.toolUseId })
        .from(toolCalls)
        .where(eq(toolCalls.toolUseId, use.id))
        .get();
      if (journaled !== undefined) {
        continue;
      }
      const asks = asksFirst(use.name);
      db.insert(toolCalls)
        .values({
          idx: index,
          input: JSON.stringify(use.input),
          msgSeq: reply.seq,
          name: use.name,
          status: asks ? "awaiting_approval" : "pending",
          toolUseId: use.id,
          turn: turn.turn,
        })
        .run();
      if (asks) {
        asked.push(use.id);
        enqueue(db, turn.turn, [
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
  for (const row of toolRowsOf(db, reply.seq)) {
    const next = toolCallNext(toolCallOf(row), RUN);
    if (next === null) {
      continue;
    }
    if (next.kind === "answered") {
      answerCall(host, turn.turn, row.toolUseId, RUN);
      continue;
    }
    if (openTurnOf(db)?.cancelRequested !== false) {
      // stopped meanwhile: the next step answers what is left
      return "continue";
    }
    db.update(toolCalls)
      .set({ attempts: sql`${toolCalls.attempts} + 1`, status: "running" })
      .where(eq(toolCalls.toolUseId, row.toolUseId))
      .run();
    let answer: CellAnswer<ToolAnswer>;
    try {
      answer = await host.cell().agentTool({
        input: z.json().parse(JSON.parse(row.input)),
        name: row.name,
        threadId: host.threadId,
        toolUseId: row.toolUseId,
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
    answerCall(host, turn.turn, row.toolUseId, {
      answer: answer.ok ? answer.value : TURN_CLOSED,
      kind: "result",
    });
  }
  const rows = toolRowsOf(db, reply.seq);
  const results = rows.flatMap((row) => {
    const call = toolCallOf(row);
    return call.kind === "answered" ? [resultBlock(row.toolUseId, call.answer)] : [];
  });
  if (results.length < rows.length) {
    db.update(threadTurns)
      .set({ status: "awaiting_approval" })
      .where(eq(threadTurns.turn, turn.turn))
      .run();
    return "paused";
  }
  host.transaction(() => {
    append(db, { content: JSON.stringify(results), role: "user", turn: turn.turn });
    db.update(threadTurns)
      .set({ status: "running" })
      .where(and(eq(threadTurns.turn, turn.turn), ne(threadTurns.status, "ended")))
      .run();
  });
  return "continue";
};

// ---- the person ----

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
  const { db } = host;
  const decided = host.transaction(() => {
    const row = db.select().from(toolCalls).where(eq(toolCalls.toolUseId, answer.toolUseId)).get();
    const decide: ToolCallEvent = {
      approved: answer.approved,
      kind: "decide",
      reason: answer.reason,
    };
    if (row === undefined || toolCallNext(toolCallOf(row), decide) === null) {
      return false;
    }
    db.update(toolCalls)
      .set({ decision: answer.approved ? "approved" : "denied", reason: answer.reason })
      .where(eq(toolCalls.toolUseId, answer.toolUseId))
      .run();
    db.update(threadTurns)
      .set({ status: "running" })
      .where(and(eq(threadTurns.turn, row.turn), eq(threadTurns.status, "awaiting_approval")))
      .run();
    enqueue(db, row.turn, [
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
export const requestCancel = (host: ThreadHost, turn: number): void => {
  host.db
    .update(threadTurns)
    .set({ cancelRequested: 1 })
    .where(and(eq(threadTurns.turn, turn), ne(threadTurns.status, "ended")))
    .run();
  const call = host.calls.get(turn);
  if (call !== undefined) {
    cutCall(call.abort, "stopped");
  }
};

// a stopped turn still answers every call its last reply made, so the next request is valid: what
// ran keeps its result, and the rest, the calls that waited on the person among them, did not run
const settleCancel = async (
  host: ThreadHost,
  turn: OpenTurn,
  last: StoredMessage | undefined,
): Promise<void> => {
  const { db } = host;
  const waited: string[] = [];
  host.transaction(() => {
    if (last?.role === "assistant" && last.turn === turn.turn) {
      const uses = last.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));
      const rows = new Map(toolRowsOf(db, last.seq).map((row) => [row.toolUseId, row]));
      const entries: PushEntry[] = [];
      const results: ToolResultBlock[] = [];
      for (const use of uses) {
        const row = rows.get(use.id);
        // a reply's call no round journaled yet is one it asked for
        const call: ToolCall = row === undefined ? { kind: "asked" } : toolCallOf(row);
        if (call.kind === "awaiting") {
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
        const next = toolCallNext(call, STOP);
        if (next?.kind === "answered") {
          keepAnswer(db, use.id, next.answer);
          entries.push(resultEvent(use.id, next.answer.content, next.answer.isError));
        }
        const settled = next ?? call;
        if (settled.kind === "answered") {
          results.push(resultBlock(use.id, settled.answer));
        }
      }
      append(db, { content: JSON.stringify(results), role: "user", turn: turn.turn });
      enqueue(db, turn.turn, entries);
    }
    endTurn(db, turn.turn, { detail: null, reason: "cancelled" });
  });
  for (const toolUseId of waited) {
    await host.jobs.dropApproval(toolUseId);
  }
};

// ---- the step ----

// the open turn's next step: its first rows, its cancel settled, a round of tool calls, or a model
// call
const turnStep = async (host: ThreadHost, turn: OpenTurn): Promise<StepResult> => {
  if (!turn.started) {
    await startTurn(host, turn);
    return "continue";
  }
  const transcript = transcriptOf(host.db);
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
  const turn = openTurnOf(host.db);
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
  const turn = openTurnOf(host.db);
  const outbox = host.db.select({ count: count() }).from(threadOutbox).get()?.count ?? 0;
  let status: ThreadInspection["status"] = "idle";
  if (turn !== null) {
    status = turn.waiting ? "awaiting_approval" : "running";
  }
  return {
    driving,
    outbox,
    status,
    turn: turn?.turn ?? null,
  };
};
