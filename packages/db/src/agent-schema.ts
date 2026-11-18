// The built-in agent's conversations: each a thread of ours over one eve session at a time, the
// events its record hook keeps of what eve did, its turns and the account's preferences. eve keeps
// its own stream on Vercel Workflow; these rows are what a device reads and what a turn's change set
// is keyed by. A thread's account cascades from Better Auth's `user`, and every other row hangs off
// its thread by a composite foreign key, so deleting a user or a thread takes the rest. Times are
// unix milliseconds and ids text, as the library spells them.

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

// a thread runs a turn or waits for the next message: a message sent mid-turn joins the turn
const THREAD_STATUSES = ["idle", "running"] as const;

// how a turn ended: it finished; the person stopped it; the day's turns or dollars ran out, or its
// steps; it failed; or the model could not be reached
const TURN_OUTCOMES = [
  "done",
  "cancelled",
  "allowance",
  "budget",
  "steps",
  "failed",
  "unavailable",
] as const;

export const agentThreadStatus = pgEnum("agent_thread_status", THREAD_STATUSES);
export const agentTurnOutcome = pgEnum("agent_turn_outcome", TURN_OUTCOMES);

const ms = (name: string) => bigint(name, { mode: "number" });

const accountId = () =>
  text("account_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

// The thread and the eve session it runs on now, by its number: a thread starts its next session
// once the one it ran ended or aged, so the number counts up while the session's id is unset until
// eve answers its create
export const agentThread = pgTable.withRLS(
  "agent_thread",
  {
    accountId: accountId(),
    createdAt: ms("created_at").notNull(),
    eveSessionId: text("eve_session_id"),
    eveSessionNumber: integer("eve_session_number").notNull(),
    eveSessionStartedAt: ms("eve_session_started_at"),
    id: text("id").notNull(),
    status: agentThreadStatus("status").notNull(),
    title: text("title").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    uniqueIndex("agent_thread_eve_session").on(table.eveSessionId),
    index("agent_thread_listed").on(table.accountId, table.updatedAt.desc().nullsFirst()),
    check(
      "agent_thread_session_started",
      sql`(${table.eveSessionId} is null) = (${table.eveSessionStartedAt} is null)`,
    ),
  ],
);

const threadFk = (name: string, columns: [AnyPgColumn, AnyPgColumn]) =>
  foreignKey({ columns, foreignColumns: [agentThread.accountId, agentThread.id], name }).onDelete(
    "cascade",
  );

// What the thread shows, one of the contract's agent events as JSON, kept where eve recorded the
// fact it maps: a position never moves, so a hook delivered twice writes one row. `idx` orders a
// thread's events across its sessions for a device paging after the last one it read
export const agentThreadEvent = pgTable.withRLS(
  "agent_thread_event",
  {
    accountId: text("account_id").notNull(),
    at: ms("at").notNull(),
    event: jsonb("event").notNull(),
    eveSessionNumber: integer("eve_session_number").notNull(),
    idx: bigint("idx", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    index: integer("index").notNull(),
    line: integer("line").notNull(),
    threadId: text("thread_id").notNull(),
    type: text("type").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.threadId, table.eveSessionNumber, table.line, table.index],
    }),
    threadFk("agent_thread_event_thread_fk", [table.accountId, table.threadId]),
    uniqueIndex("agent_thread_event_paged").on(table.accountId, table.threadId, table.idx),
  ],
);

// A turn by its number in its thread, which its change set is keyed by: the record hook writes it
// as eve starts the turn, before its first model call, so every tool call finds it. eve numbers a
// turn within its session alone
export const agentTurn = pgTable.withRLS(
  "agent_turn",
  {
    accountId: text("account_id").notNull(),
    eveSessionNumber: integer("eve_session_number").notNull(),
    eveTurnId: text("eve_turn_id").notNull(),
    number: integer("number").notNull(),
    outcome: agentTurnOutcome("outcome"),
    settledAt: ms("settled_at"),
    startedAt: ms("started_at").notNull(),
    threadId: text("thread_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.threadId, table.number] }),
    threadFk("agent_turn_thread_fk", [table.accountId, table.threadId]),
    uniqueIndex("agent_turn_eve_turn").on(
      table.accountId,
      table.threadId,
      table.eveSessionNumber,
      table.eveTurnId,
    ),
    index("agent_turn_started").on(table.accountId, table.startedAt),
    check("agent_turn_settled", sql`(${table.settledAt} is null) = (${table.outcome} is null)`),
  ],
);

// whether the person keeps the agent on, and the filing rules it follows over its own taste; an
// account with no row has it on and keeps none
export const agentPreference = pgTable.withRLS("agent_preference", {
  accountId: accountId().primaryKey(),
  enabled: boolean("enabled").notNull(),
  filingRules: text("filing_rules"),
});
