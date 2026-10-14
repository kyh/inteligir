// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import {
  DOC_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  VAULT_CHANGE_KINDS,
} from "@repo/domain/change-kinds";
import { z } from "zod";

export const realtimeSubscriptionTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("vault"),
  }),
  z.strictObject({
    kind: z.literal("thread-list"),
  }),
]);
export type RealtimeSubscriptionTarget = z.infer<typeof realtimeSubscriptionTargetSchema>;

// client→server frames parse strictly: an unknown field is an unknown client, closed 1008.
// only the server→client direction is lenient (a stale tab against a newer server).
export const subscribeMessageSchema = z.strictObject({
  target: realtimeSubscriptionTargetSchema,
  type: z.literal("subscribe"),
});
export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;

export const unsubscribeMessageSchema = z.strictObject({
  target: realtimeSubscriptionTargetSchema,
  type: z.literal("unsubscribe"),
});
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  subscribeMessageSchema,
  unsubscribeMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type SubscriptionKey = RealtimeSubscriptionTarget["kind"];

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
    strict: z.strictObject({
      entity: z.literal(entity),
      type: z.literal("changed"),
      ...idFields,
      changes: z.array(z.enum(kinds)).readonly(),
    }),
  };
};

// `paths` is optional because absence is a claim: the post-sync consolidated notification has
// no path list, and a client that sees none must assume everything moved
const vaultChangedMessagePair = changedMessagePair("vault", VAULT_CHANGE_KINDS, {
  paths: z.array(z.string().min(1)).readonly().optional(),
});
const docChangedMessagePair = changedMessagePair("doc", DOC_CHANGE_KINDS, {
  id: z.string().min(1),
});
const threadChangedMessagePair = changedMessagePair("thread", THREAD_CHANGE_KINDS, {
  id: z.string().optional(),
});

export const vaultChangedMessageSchema = vaultChangedMessagePair.strict;
export type VaultChangedMessage = z.infer<typeof vaultChangedMessageSchema>;

export const docChangedMessageSchema = docChangedMessagePair.strict;
export type DocChangedMessage = z.infer<typeof docChangedMessageSchema>;

export const threadChangedMessageSchema = threadChangedMessagePair.strict;
export type ThreadChangedMessage = z.infer<typeof threadChangedMessageSchema>;

export const changedMessageSchema = z.discriminatedUnion("entity", [
  vaultChangedMessageSchema,
  docChangedMessageSchema,
  threadChangedMessageSchema,
]);
export type ChangedMessage = z.infer<typeof changedMessageSchema>;

export const helloMessageSchema = z.strictObject({
  type: z.literal("hello"),
});
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const serverMessageSchema = z.union([helloMessageSchema, changedMessageSchema]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const changedMessageLenientSchema = z.discriminatedUnion("entity", [
  vaultChangedMessagePair.lenient,
  docChangedMessagePair.lenient,
  threadChangedMessagePair.lenient,
]);

const helloMessageLenientSchema = z.object({
  type: z.literal("hello"),
});

export const serverMessageLenientSchema = z.union([
  helloMessageLenientSchema,
  changedMessageLenientSchema,
]);

// `vault` is the doc list target: a doc change reaches it too
export const subscriptionKeysForMessage = (message: ChangedMessage): SubscriptionKey[] => {
  switch (message.entity) {
    case "vault":
    case "doc": {
      return ["vault"];
    }
    case "thread": {
      return ["thread-list"];
    }
    // no default
  }
};
