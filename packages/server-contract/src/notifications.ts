// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

/** Where the invalidation bus is served; the upgrade endpoint every client dials. */
export const WS_PATH = "/ws";

export const SYSTEM_CHANGE_KINDS = ["config-changed"] as const;
export type SystemChangeKind = (typeof SYSTEM_CHANGE_KINDS)[number];

export const VAULT_CHANGE_KINDS = ["files-changed"] as const;
export type VaultChangeKind = (typeof VAULT_CHANGE_KINDS)[number];

export const DOC_CHANGE_KINDS = ["content-changed"] as const;
export type DocChangeKind = (typeof DOC_CHANGE_KINDS)[number];

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "thread-deleted",
  "events-appended",
  "status-changed",
] as const;
export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];

export const systemChangeKindSchema = z.enum(SYSTEM_CHANGE_KINDS);
export const vaultChangeKindSchema = z.enum(VAULT_CHANGE_KINDS);
export const docChangeKindSchema = z.enum(DOC_CHANGE_KINDS);
export const threadChangeKindSchema = z.enum(THREAD_CHANGE_KINDS);

/** What a client can subscribe to. How a changed message reaches these targets
 * is `subscriptionKeysForMessage` below — the one fan-out mapping. */
export const realtimeSubscriptionTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("system"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("vault"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("doc-detail"),
      docId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread-list"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread-detail"),
      threadId: z.string().min(1),
    })
    .strict(),
]);
export type RealtimeSubscriptionTarget = z.infer<typeof realtimeSubscriptionTargetSchema>;

/**
 * Client→server frames parse STRICTLY: the server owns this boundary, and an
 * unknown field is an unknown client — close(1008), never a quiet strip. The
 * lenient direction is server→client only (a stale tab against a newer
 * server), parsed with the lenient schemas below.
 */
export const subscribeMessageSchema = z
  .object({
    type: z.literal("subscribe"),
    target: realtimeSubscriptionTargetSchema,
  })
  .strict();
export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;

export const unsubscribeMessageSchema = z
  .object({
    type: z.literal("unsubscribe"),
    target: realtimeSubscriptionTargetSchema,
  })
  .strict();
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  subscribeMessageSchema,
  unsubscribeMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

function assertUnhandledRealtimeSubscriptionTarget(target: never): never {
  throw new Error(`Unhandled realtime subscription target: ${String(target)}`);
}

export function realtimeSubscriptionTargetKey(target: RealtimeSubscriptionTarget): string {
  switch (target.kind) {
    case "system":
      return "system";
    case "vault":
      return "vault";
    case "doc-detail":
      return `doc-detail:${target.docId}`;
    case "thread-list":
      return "thread-list";
    case "thread-detail":
      return `thread-detail:${target.threadId}`;
    default:
      return assertUnhandledRealtimeSubscriptionTarget(target);
  }
}

/**
 * ONE factory builds each entity's changed-message pair, so the two sides
 * cannot drift — same shape, same kinds, `changes` readonly on both.
 *
 * `strict` validates the server's OUTGOING broadcasts — the producer is
 * in-repo, so unknown fields or kinds there are bugs and must fail loudly.
 * Message types are derived from the strict schemas (z.infer) so the contract
 * cannot drift from the validators. Clients must NOT parse inbound traffic
 * with it: a long-lived tab talking to a newer server would drop entire
 * messages over an additive change.
 *
 * `lenient` parses INBOUND broadcasts on clients. It tolerates version skew
 * against a newer server: unknown fields are stripped and unknown change
 * kinds are filtered out instead of rejecting the whole message, so a stale
 * client keeps receiving the kinds it understands. Its output remains
 * assignable to the strict message type — dispatch sites enforce that at
 * compile time.
 */
function changedMessagePair<
  TEntity extends string,
  TKind extends string,
  TIdShape extends z.ZodRawShape,
>(entity: TEntity, kinds: readonly [TKind, ...TKind[]], idShape: TIdShape) {
  const known: ReadonlySet<string> = new Set(kinds);
  return {
    strict: z
      .object({
        type: z.literal("changed"),
        entity: z.literal(entity),
        ...idShape,
        changes: z.array(z.enum(kinds)).readonly(),
      })
      .strict(),
    lenient: z.object({
      type: z.literal("changed"),
      entity: z.literal(entity),
      ...idShape,
      changes: z
        .array(z.string())
        .transform((values) => values.filter((value): value is TKind => known.has(value)))
        .readonly(),
    }),
  };
}

const systemChangedMessagePair = changedMessagePair("system", SYSTEM_CHANGE_KINDS, {});
const vaultChangedMessagePair = changedMessagePair("vault", VAULT_CHANGE_KINDS, {});
const docChangedMessagePair = changedMessagePair("doc", DOC_CHANGE_KINDS, {
  id: z.string().min(1),
});
const threadChangedMessagePair = changedMessagePair("thread", THREAD_CHANGE_KINDS, {
  id: z.string().optional(),
});

export const systemChangedMessageSchema = systemChangedMessagePair.strict;
export type SystemChangedMessage = z.infer<typeof systemChangedMessageSchema>;

export const vaultChangedMessageSchema = vaultChangedMessagePair.strict;
export type VaultChangedMessage = z.infer<typeof vaultChangedMessageSchema>;

export const docChangedMessageSchema = docChangedMessagePair.strict;
export type DocChangedMessage = z.infer<typeof docChangedMessageSchema>;

export const threadChangedMessageSchema = threadChangedMessagePair.strict;
export type ThreadChangedMessage = z.infer<typeof threadChangedMessageSchema>;

export const changedMessageSchema = z.discriminatedUnion("entity", [
  systemChangedMessageSchema,
  vaultChangedMessageSchema,
  docChangedMessageSchema,
  threadChangedMessageSchema,
]);
export type ChangedMessage = z.infer<typeof changedMessageSchema>;

/** First frame after a socket connects — the connection ack. */
export const helloMessageSchema = z
  .object({
    type: z.literal("hello"),
    version: z.string().min(1),
  })
  .strict();
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const serverMessageSchema = z.union([helloMessageSchema, changedMessageSchema]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const changedMessageLenientSchema = z.discriminatedUnion("entity", [
  systemChangedMessagePair.lenient,
  vaultChangedMessagePair.lenient,
  docChangedMessagePair.lenient,
  threadChangedMessagePair.lenient,
]);

const helloMessageLenientSchema = z.object({
  type: z.literal("hello"),
  version: z.string().min(1),
});

export const serverMessageLenientSchema = z.union([
  helloMessageLenientSchema,
  changedMessageLenientSchema,
]);

const SYSTEM_TARGET_KEY = realtimeSubscriptionTargetKey({ kind: "system" });
const VAULT_TARGET_KEY = realtimeSubscriptionTargetKey({ kind: "vault" });
const THREAD_LIST_TARGET_KEY = realtimeSubscriptionTargetKey({ kind: "thread-list" });

/**
 * The one entity→subscription-target fan-out: which subscription keys a
 * changed message reaches. `vault` is the doc LIST target — a doc change fans
 * out to `vault` subscribers alongside its own `doc-detail` subscribers, the
 * way a thread change reaches `thread-list`.
 */
export function subscriptionKeysForMessage(message: ChangedMessage): string[] {
  switch (message.entity) {
    case "system":
      return [SYSTEM_TARGET_KEY];
    case "vault":
      return [VAULT_TARGET_KEY];
    case "doc":
      return [
        VAULT_TARGET_KEY,
        realtimeSubscriptionTargetKey({ kind: "doc-detail", docId: message.id }),
      ];
    case "thread":
      return message.id === undefined
        ? [THREAD_LIST_TARGET_KEY]
        : [
            THREAD_LIST_TARGET_KEY,
            realtimeSubscriptionTargetKey({ kind: "thread-detail", threadId: message.id }),
          ];
  }
}
