// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { SYNC_CHANGE_KINDS, THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
import { z } from "zod";
import { assertUnreachable } from "./assert-unreachable";

export const realtimeSubscriptionTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("sync"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread-list"),
    })
    .strict(),
]);
export type RealtimeSubscriptionTarget = z.infer<typeof realtimeSubscriptionTargetSchema>;

// client→server frames parse strictly: an unknown field is an unknown client, closed 1008.
// only the server→client direction is lenient (a stale tab against a newer server).
export const subscribeMessageSchema = z
  .object({
    target: realtimeSubscriptionTargetSchema,
    type: z.literal("subscribe"),
  })
  .strict();
export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;

export const unsubscribeMessageSchema = z
  .object({
    target: realtimeSubscriptionTargetSchema,
    type: z.literal("unsubscribe"),
  })
  .strict();
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  subscribeMessageSchema,
  unsubscribeMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const realtimeSubscriptionTargetKey = (target: RealtimeSubscriptionTarget): string => {
  switch (target.kind) {
    case "sync": {
      return "sync";
    }
    case "thread-list": {
      return "thread-list";
    }
    default: {
      return assertUnreachable(target);
    }
  }
};

// `strict` types the server's outgoing broadcasts and is what the bus's tests parse them with;
// nothing parses a broadcast at runtime. a client must not parse inbound traffic with it, or a
// long-lived tab against a newer server drops whole messages over an additive change. `lenient`
// strips unknown fields and filters unknown kinds instead.
const changedMessagePair = <
  TEntity extends string,
  TKind extends string,
  TIdFields extends Record<string, z.ZodType>,
>(
  entity: TEntity,
  kinds: readonly [TKind, ...TKind[]],
  idFields: TIdFields,
) => {
  const known: ReadonlySet<string> = new Set(kinds);
  return {
    lenient: z.object({
      entity: z.literal(entity),
      type: z.literal("changed"),
      ...idFields,
      changes: z
        .array(z.string())
        .transform((values) => values.filter((value): value is TKind => known.has(value)))
        .readonly(),
    }),
    strict: z
      .object({
        entity: z.literal(entity),
        type: z.literal("changed"),
        ...idFields,
        changes: z.array(z.enum(kinds)).readonly(),
      })
      .strict(),
  };
};

// the cloud sync's status rides the `sync` entity, the target the renderer's sync row subscribes to
const syncChangedMessagePair = changedMessagePair("sync", SYNC_CHANGE_KINDS, {});
const threadChangedMessagePair = changedMessagePair("thread", THREAD_CHANGE_KINDS, {
  id: z.string().optional(),
});

export const syncChangedMessageSchema = syncChangedMessagePair.strict;
export type SyncChangedMessage = z.infer<typeof syncChangedMessageSchema>;

export const threadChangedMessageSchema = threadChangedMessagePair.strict;
export type ThreadChangedMessage = z.infer<typeof threadChangedMessageSchema>;

export const changedMessageSchema = z.discriminatedUnion("entity", [
  syncChangedMessageSchema,
  threadChangedMessageSchema,
]);
export type ChangedMessage = z.infer<typeof changedMessageSchema>;

export const helloMessageSchema = z
  .object({
    type: z.literal("hello"),
  })
  .strict();
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const serverMessageSchema = z.union([helloMessageSchema, changedMessageSchema]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const changedMessageLenientSchema = z.discriminatedUnion("entity", [
  syncChangedMessagePair.lenient,
  threadChangedMessagePair.lenient,
]);

const helloMessageLenientSchema = z.object({
  type: z.literal("hello"),
});

export const serverMessageLenientSchema = z.union([
  helloMessageLenientSchema,
  changedMessageLenientSchema,
]);

const SYNC_TARGET_KEY = realtimeSubscriptionTargetKey({ kind: "sync" });
const THREAD_LIST_TARGET_KEY = realtimeSubscriptionTargetKey({ kind: "thread-list" });

export const subscriptionKeysForMessage = (message: ChangedMessage): string[] => {
  switch (message.entity) {
    case "sync": {
      return [SYNC_TARGET_KEY];
    }
    case "thread": {
      return [THREAD_LIST_TARGET_KEY];
    }
    default: {
      return assertUnreachable(message);
    }
  }
};
