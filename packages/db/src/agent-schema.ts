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

const THREAD_STATUSES = ["idle", "running"] as const;

const TURN_OUTCOMES = [
  "done",
  "cancelled",
  "allowance",
  "budget",
  "steps",
  "failed",
  "unavailable",
] as const;

const TURN_STOPS = ["allowance", "budget", "steps"] as const;

const USAGE_KINDS = ["turn", "model", "search"] as const;

export const agentThreadStatus = pgEnum("agent_thread_status", THREAD_STATUSES);
export const agentTurnOutcome = pgEnum("agent_turn_outcome", TURN_OUTCOMES);
export const agentTurnStop = pgEnum("agent_turn_stop", TURN_STOPS);
export const agentUsageKind = pgEnum("agent_usage_kind", USAGE_KINDS);

const ms = (name: string) => bigint(name, { mode: "number" });

const accountId = () =>
  text("account_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

export const agentThread = pgTable.withRLS(
  "agent_thread",
  {
    accountId: accountId(),
    createdAt: ms("created_at").notNull(),
    deletedAt: ms("deleted_at"),
    eveSessionId: text("eve_session_id"),
    eveSessionNumber: integer("eve_session_number").notNull(),
    eveSessionStartedAt: ms("eve_session_started_at"),
    id: text("id").notNull(),
    purgeTriedAt: ms("purge_tried_at"),
    seq: ms("seq").notNull(),
    status: agentThreadStatus("status").notNull(),
    title: text("title").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    uniqueIndex("agent_thread_eve_session").on(table.eveSessionId),
    index("agent_thread_listed").on(table.accountId, table.updatedAt.desc().nullsFirst()),
    index("agent_thread_seq").on(table.accountId, table.seq),
    index("agent_thread_deleted")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
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

export const agentThreadEvent = pgTable.withRLS(
  "agent_thread_event",
  {
    accountId: text("account_id").notNull(),
    at: ms("at").notNull(),
    event: jsonb("event").notNull(),
    eveSessionNumber: integer("eve_session_number").notNull(),
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
  ],
);

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
    stopReason: agentTurnStop("stop_reason"),
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

export const agentUsage = pgTable.withRLS(
  "agent_usage",
  {
    accountId: accountId(),
    at: ms("at").notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    eveSessionNumber: integer("eve_session_number").notNull(),
    index: integer("index").notNull(),
    kind: agentUsageKind("kind").notNull(),
    line: integer("line").notNull(),
    threadId: text("thread_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.threadId, table.eveSessionNumber, table.line, table.index],
    }),
    index("agent_usage_account_at").on(table.accountId, table.at),
    index("agent_usage_at").on(table.at),
  ],
);

export const agentPreference = pgTable.withRLS("agent_preference", {
  accountId: accountId().primaryKey(),
  enabled: boolean("enabled").notNull(),
  filingRules: text("filing_rules"),
});

export const agentDeletedAccountSession = pgTable.withRLS(
  "agent_deleted_account_session",
  {
    accountId: text("account_id").notNull(),
    eveSessionId: text("eve_session_id").primaryKey(),
    eveSessionNumber: integer("eve_session_number").notNull(),
    keptAt: ms("kept_at").notNull(),
    threadId: text("thread_id").notNull(),
    triedAt: ms("tried_at"),
  },
  (table) => [index("agent_deleted_account_session_account").on(table.accountId)],
);
