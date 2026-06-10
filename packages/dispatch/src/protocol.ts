// ---------------------------------------------------------------------------
// Dispatch wire protocol v1.
//
// Every frame exchanged between the desktop, the mobile app, and the relay
// Worker is one of the TypeBox-validated envelopes in `DispatchMessageSchema`:
// a flat discriminated union on `type`, each carrying `v: 1`. There are no
// `Record<string, unknown>` payloads — consumers call `parseMessage` at the
// trust boundary and switch on the typed result; senders build a literal
// `DispatchMessage` and call `serializeMessage`. See PROTOCOL.md for the
// catalog, routing, and trust model.
//
// Versioning: `v` is checked before anything else. A peer that receives
// `{ code: "version_mismatch" }` from `parseMessage` should answer with an
// `error` message (code `version_mismatch`) telling the sender to upgrade,
// then drop the frame.
// ---------------------------------------------------------------------------

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** Current wire protocol version. Bump on any breaking message-shape change;
 * the three peers (desktop / mobile / Worker) ship independently, so old
 * clients must be rejected loudly rather than misread silently. */
export const PROTOCOL_VERSION = 1;

/** Hard upper bound on a single serialized frame, in UTF-8 bytes. Guards the
 * relay (and peers) against memory abuse; large enough for a full assistant
 * `message_end` text or a chunky tool result. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

const Version = Type.Literal(PROTOCOL_VERSION);

// ---------------------------------------------------------------------------
// Roles & presence
// ---------------------------------------------------------------------------

/** Who a connection claims to be. Carried as a query param at connect time
 * (see room.ts) and echoed in presence messages. */
const PeerRoleSchema = Type.Union([Type.Literal("desktop"), Type.Literal("mobile")]);
export type PeerRole = Static<typeof PeerRoleSchema>;

// ---------------------------------------------------------------------------
// Agent events (desktop → mobile transcript stream)
//
// Wire projection of the desktop's app-level agent events. The desktop only
// forwards these while an authenticated mobile peer is present in the room
// (gated on presence), and never before pairing.
// ---------------------------------------------------------------------------

const AgentEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("agent_start") }),
  Type.Object({ type: Type.Literal("agent_end") }),
  Type.Object({
    type: Type.Literal("message_start"),
    role: Type.Union([Type.Literal("assistant"), Type.Literal("user")]),
  }),
  Type.Object({ type: Type.Literal("message_update"), delta: Type.String() }),
  Type.Object({
    type: Type.Literal("message_end"),
    role: Type.String(),
    text: Type.String(),
    stopReason: Type.Optional(Type.String()),
    /** Human-readable error message when stopReason === "error". */
    errorMessage: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal("tool_execution_start"),
    toolCallId: Type.String(),
    toolName: Type.String(),
    /** Tool-specific arguments; genuinely arbitrary JSON, optional on the wire. */
    args: Type.Optional(Type.Unknown()),
  }),
  Type.Object({
    type: Type.Literal("tool_execution_end"),
    toolCallId: Type.String(),
    isError: Type.Boolean(),
    resultText: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("queue_update"),
    steering: Type.Array(Type.String()),
    followUp: Type.Array(Type.String()),
  }),
  /** Synthetic desktop-side event: a turn ended with no assistant output and
   * no pi-emitted error — almost always a swallowed upstream/auth failure. */
  Type.Object({
    type: Type.Literal("turn_error"),
    kind: Type.Union([Type.Literal("auth"), Type.Literal("unknown")]),
    reason: Type.String(),
  }),
]);
export type AgentEvent = Static<typeof AgentEventSchema>;

// ---------------------------------------------------------------------------
// Chat bridge (external messaging gateway ↔ desktop, via the relay DO)
// ---------------------------------------------------------------------------

/** Where an external chat message originated. Informational: the gateway
 * resolves the reply through the correlationId, not these fields. */
export const ChatConversationSchema = Type.Object({
  /** Adapter name: "slack" | "telegram" | "whatsapp" | "discord". */
  platform: Type.String(),
  channelId: Type.Optional(Type.String()),
  threadId: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
  userName: Type.Optional(Type.String()),
  isDM: Type.Optional(Type.Boolean()),
});
export type ChatConversation = Static<typeof ChatConversationSchema>;

// ---------------------------------------------------------------------------
// Message catalog
// ---------------------------------------------------------------------------

/** Mobile → desktop: start (or queue) an agent turn with the given text. */
const UserMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("user_message"),
  text: Type.String(),
});
export type UserMessage = Static<typeof UserMessageSchema>;

/** Mobile → desktop: redirect the in-flight agent turn. */
const SteerMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("steer"),
  text: Type.String(),
});
export type SteerMessage = Static<typeof SteerMessageSchema>;

/** Mobile → desktop: abort the in-flight agent turn. */
const InterruptMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("interrupt"),
});
export type InterruptMessage = Static<typeof InterruptMessageSchema>;

/** Desktop → mobile: one transcript event from the agent session. */
const AgentEventMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("agent_event"),
  event: AgentEventSchema,
});

/** Gateway (via the relay DO) → desktop: one correlated external chat turn.
 * The desktop must answer with exactly one `chat_reply` carrying the same
 * correlationId. */
const ChatMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("chat_message"),
  correlationId: Type.String(),
  text: Type.String(),
  conversation: Type.Optional(ChatConversationSchema),
});
export type ChatMessage = Static<typeof ChatMessageSchema>;

/** Desktop → relay DO: resolves the gateway POST waiting on correlationId.
 * Intercepted by the DO; never relayed to other peers. */
const ChatReplySchema = Type.Object({
  v: Version,
  type: Type.Literal("chat_reply"),
  correlationId: Type.String(),
  text: Type.String(),
});

/** Server → newly connected client: snapshot of the other authenticated peers
 * currently in the room. Lets a (re)connecting desktop decide immediately
 * whether transcript streaming should be on. */
const PresenceMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("presence"),
  peers: Type.Array(Type.Object({ role: PeerRoleSchema })),
});

/** Server → existing clients: an authenticated peer joined the room. */
const PeerJoinedMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("peer_joined"),
  role: PeerRoleSchema,
});

/** Server → existing clients: an authenticated peer left the room. */
const PeerLeftMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("peer_left"),
  role: PeerRoleSchema,
});

/** Desktop → server: rotate/tear down this room. The DO deletes its stored
 * credential hash, notifies peers with an `error` (code `room_closed`), and
 * closes every connection. Sent by the desktop before claiming a fresh room. */
const RoomTeardownMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("room_teardown"),
});

const ErrorCodeSchema = Type.Union([
  /** Sender's frame had the wrong `v` — it must upgrade. */
  Type.Literal("version_mismatch"),
  /** Sender isn't allowed to do that (e.g. mobile sent `room_teardown`). */
  Type.Literal("unauthorized"),
  /** Frame failed validation (unknown type / malformed payload). */
  Type.Literal("invalid_message"),
  /** Frame exceeded MAX_MESSAGE_BYTES. */
  Type.Literal("payload_too_large"),
  /** Per-connection rate limit tripped; subsequent frames were dropped. */
  Type.Literal("rate_limited"),
  /** The room was torn down (credential rotated); re-pair to continue. */
  Type.Literal("room_closed"),
]);
export type ErrorCode = Static<typeof ErrorCodeSchema>;

/** Server → client: typed in-band error. Connection-level failures (bad
 * token, bad role) are refused at connect time instead. */
const ErrorMessageSchema = Type.Object({
  v: Version,
  type: Type.Literal("error"),
  code: ErrorCodeSchema,
  message: Type.String(),
});
export type ErrorMessage = Static<typeof ErrorMessageSchema>;

/** Every frame on the wire is one of these. */
const DispatchMessageSchema = Type.Union([
  UserMessageSchema,
  SteerMessageSchema,
  InterruptMessageSchema,
  AgentEventMessageSchema,
  ChatMessageSchema,
  ChatReplySchema,
  PresenceMessageSchema,
  PeerJoinedMessageSchema,
  PeerLeftMessageSchema,
  RoomTeardownMessageSchema,
  ErrorMessageSchema,
]);
export type DispatchMessage = Static<typeof DispatchMessageSchema>;

/** All known message type discriminators, derived from the union schema so
 * the set can never drift from the actual catalog. */
export const MESSAGE_TYPES: ReadonlySet<string> = new Set(
  DispatchMessageSchema.anyOf.map((schema) => schema.properties.type.const),
);

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

export type ParseMessageError =
  /** Frame wasn't a text frame (e.g. binary WebSocket data). */
  | { code: "not_text" }
  | { code: "oversized"; byteLength: number; maxBytes: number }
  /** Not parseable as JSON, or the JSON root wasn't an object. */
  | { code: "invalid_json" }
  | { code: "version_mismatch"; received: unknown }
  | { code: "unknown_type"; received: unknown }
  /** Known type, but the payload fields failed schema validation. */
  | { code: "malformed"; type: string };

export type ParseMessageResult =
  | { ok: true; message: DispatchMessage }
  | { ok: false; error: ParseMessageError };

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** UTF-8 byte length without TextEncoder (kept lib-agnostic so this module
 * typechecks under every consumer's tsconfig: Node, Workers, React Native). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Parse one inbound frame at a trust boundary. Never throws. Check order:
 * text → size → JSON → version → known type → full schema. */
export function parseMessage(raw: unknown): ParseMessageResult {
  if (typeof raw !== "string") {
    return { ok: false, error: { code: "not_text" } };
  }
  const byteLength = utf8ByteLength(raw);
  if (byteLength > MAX_MESSAGE_BYTES) {
    return { ok: false, error: { code: "oversized", byteLength, maxBytes: MAX_MESSAGE_BYTES } };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: { code: "invalid_json" } };
  }
  if (!isJsonObject(value)) {
    return { ok: false, error: { code: "invalid_json" } };
  }
  if (value["v"] !== PROTOCOL_VERSION) {
    return { ok: false, error: { code: "version_mismatch", received: value["v"] } };
  }
  const type = value["type"];
  if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) {
    return { ok: false, error: { code: "unknown_type", received: type } };
  }
  if (!Value.Check(DispatchMessageSchema, value)) {
    return { ok: false, error: { code: "malformed", type } };
  }
  return { ok: true, message: value };
}

/** Serialize an outbound frame. The type system guarantees shape; size is the
 * sender's responsibility (receivers reject frames over MAX_MESSAGE_BYTES). */
export function serializeMessage(message: DispatchMessage): string {
  return JSON.stringify(message);
}
