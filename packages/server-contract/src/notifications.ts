// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

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

/**
 * What a client can subscribe to. `vault` is the doc LIST target — a doc
 * change fans out to `vault` subscribers alongside its own `doc-detail`
 * subscribers, the way a thread change reaches `thread-list`.
 */
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
 * Strict changed-message schemas validate the server's OUTGOING broadcasts —
 * the producer is in-repo, so unknown fields or kinds there are bugs and must
 * fail loudly. Message types are derived from these schemas (z.infer) so the
 * contract cannot drift from the validators.
 *
 * Clients must NOT parse inbound traffic with these: a long-lived tab talking
 * to a newer server would drop entire messages over an additive change.
 * Inbound parsing uses the lenient schemas below.
 */
export const systemChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("system"),
    changes: z.array(systemChangeKindSchema).readonly(),
  })
  .strict();
export type SystemChangedMessage = z.infer<typeof systemChangedMessageSchema>;

export const vaultChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("vault"),
    changes: z.array(vaultChangeKindSchema).readonly(),
  })
  .strict();
export type VaultChangedMessage = z.infer<typeof vaultChangedMessageSchema>;

export const docChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("doc"),
    id: z.string().min(1),
    changes: z.array(docChangeKindSchema).readonly(),
  })
  .strict();
export type DocChangedMessage = z.infer<typeof docChangedMessageSchema>;

export const threadChangedMessageSchema = z
  .object({
    type: z.literal("changed"),
    entity: z.literal("thread"),
    id: z.string().optional(),
    changes: z.array(threadChangeKindSchema).readonly(),
  })
  .strict();
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

/**
 * Lenient changed-message schemas parse INBOUND broadcasts on clients. They
 * tolerate version skew against a newer server: unknown fields are stripped
 * and unknown change kinds are filtered out instead of rejecting the whole
 * message, so a stale client keeps receiving the kinds it understands. Their
 * output remains assignable to the strict message types — dispatch sites
 * enforce that at compile time.
 */
function lenientKinds<TKind extends string>(kinds: readonly TKind[]) {
  const known: ReadonlySet<string> = new Set(kinds);
  return z
    .array(z.string())
    .transform((values) => values.filter((value): value is TKind => known.has(value)));
}

const systemChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("system"),
  changes: lenientKinds(SYSTEM_CHANGE_KINDS),
});

const vaultChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("vault"),
  changes: lenientKinds(VAULT_CHANGE_KINDS),
});

const docChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("doc"),
  id: z.string().min(1),
  changes: lenientKinds(DOC_CHANGE_KINDS),
});

const threadChangedMessageLenientSchema = z.object({
  type: z.literal("changed"),
  entity: z.literal("thread"),
  id: z.string().optional(),
  changes: lenientKinds(THREAD_CHANGE_KINDS),
});

export const changedMessageLenientSchema = z.discriminatedUnion("entity", [
  systemChangedMessageLenientSchema,
  vaultChangedMessageLenientSchema,
  docChangedMessageLenientSchema,
  threadChangedMessageLenientSchema,
]);

const helloMessageLenientSchema = z.object({
  type: z.literal("hello"),
  version: z.string().min(1),
});

export const serverMessageLenientSchema = z.union([
  helloMessageLenientSchema,
  changedMessageLenientSchema,
]);
