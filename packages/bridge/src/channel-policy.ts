// ---------------------------------------------------------------------------
// THE THREE QUESTIONS THE COMPILER WILL NOT ASK YOU.
//
// Everything else about a channel is derived (./ipc-contract) or fails to
// compile until it is answered (the host handler map, the fixture Bridge, the
// agent grant table). These three are lists that name channels ONE AT A TIME,
// and each one's absence is silent:
//
//   1. May a companion client reach it?   REMOTE_ALLOWED_METHODS / _EVENTS
//   2. Must a reconnecting client be re-told its state?   HYDRATED_EVENTS
//   3. Does it carry raw bytes at streaming rates?        BINARY_CHANNELS
//
// They stay lists rather than becoming an exhaustive per-method table because
// the default answer to all three is NO and the default is the safe one: a
// channel nobody names is unreachable from a phone, never re-pushed, and framed
// as JSON. An exhaustive table would force 60-odd rows of "no" and make the
// wrong answer as cheap to write as the right one. So this file is where the
// questions get asked — all three, in one place, rather than three places a
// checklist has to remember.
// ---------------------------------------------------------------------------

import type { EventMethod, IpcEvent, ResultOf } from "./ipc-contract";
import type { IpcMethod } from "./ipc-registry";

// ---- 1. Client-class capability allowlists -----------------------------------
//
// A companion app is NOT the workspace: it holds the same account, but on a
// device with a much larger loss surface, so it reaches only the narrow
// companion surface.
//
// These are ALLOWLISTS, not blocklists, and that direction is the point: a new
// channel is unreachable from a companion client until someone adds it here on
// purpose. A blocklist would silently expose every channel written after it,
// including `deleteVaultEntry`, `connectAiProvider` and `setVoiceApiKey`.
//
// The host enforces both per-socket at three points, all three required:
// invoke/send at dispatch, events at broadcast, and the reconnect hydration
// push (which resolves through the same dispatch map and would otherwise hand a
// companion the state of a getter it is forbidden to call).
//
// The AGENT's capability policy is NOT here: it is ./agent-grants, a table of
// rows rather than a list of names. A companion client reaches these handlers
// unmodified, so naming them is a complete policy; the agent never touches a
// window handler at all, so a name would say nothing about what it can do.
// Never grant the agent a capability by adding a method here.

/** The ONLY methods a companion client may invoke. Everything else — the whole
 * vault/knowledge/settings/provider surface — is workspace-only. A companion
 * drives chat + the delegation dock and nothing else. */
export const REMOTE_ALLOWED_METHODS = [
  "getAgentHistory",
  "sendAgentCommand",
  "listDelegations",
  "cancelDelegation",
  "restoreDelegationSnapshot",
] as const satisfies readonly IpcMethod[];

/** The ONLY events pushed to a companion client, at broadcast AND at reconnect
 * hydration. Notably excluded: `onTtsAudio` (spoken note content as raw
 * PCM). */
export const REMOTE_ALLOWED_EVENTS = [
  "onAgentEvent",
  "onDelegationsUpdated",
  "onDelegationStreamed",
] as const satisfies readonly EventMethod[];

// ---- 2. Reconnect hydration ---------------------------------------------------

/** The methods whose result type EQUALS event `E`'s payload type — the only
 * provable hydration sources for that event (the tuple check enforces
 * assignability in both directions, so the pair can't drift). */
type HydrationGetter<E extends EventMethod> = {
  [K in IpcMethod]: [ResultOf<K>, IpcEvent<E>] extends [IpcEvent<E>, ResultOf<K>] ? K : never;
}[IpcMethod];

/** Each STATEFUL event channel paired with the getter that answers its current
 * state. The host pushes every getter's result as an evt frame right after
 * welcome, so a client that missed events while disconnected never sits on a
 * stale panel across a rebind — full event replay is deliberately not provided.
 * Getters resolve through the same class gate as an ordinary call, so hydration
 * can never volunteer state a client is forbidden to ask for.
 *
 * A pure invalidation ping (`onKnowledgeUpdated`) needs no entry: the client
 * refetches anyway. An event whose payload IS the state needs one, or a
 * reconnect leaves the panel showing whatever the last mutating call returned. */
export const HYDRATED_EVENTS = {
  onAppState: "getAppState",
  onDelegationsUpdated: "listDelegations",
  onRoutinesUpdated: "listRoutines",
  onAiProviderChanged: "getAiProviderSettings",
} as const satisfies { readonly [E in EventMethod]?: HydrationGetter<E> };

// ---- 3. Binary channels -------------------------------------------------------
//
// A handful of channels carry raw PCM at streaming rates, where base64-in-JSON
// would be wasteful. Those cross as `[1-byte tag][payload bytes]` binary frames
// instead (./ws-protocol). This table is the ONLY place that mapping lives: the
// transports read it instead of naming any channel themselves, so retiring the
// voice capability is two entries here rather than surgery on both endpoints.
//
// `field` distinguishes the two payload conventions: absent means the channel's
// payload IS the buffer (a send), present means the payload is a record with
// the buffer under that key (an event), and the transports pack/unpack it.
//
// Tags are WIRE VALUES — never renumber one; retire it and take the next.

const BINARY_CHANNELS = [
  { method: "sendSttAudio", tag: 1 },
  { method: "onTtsAudio", tag: 2, field: "audio" },
] as const satisfies readonly { method: IpcMethod; tag: number; field?: string }[];

type BinaryChannel = (typeof BINARY_CHANNELS)[number];

/** Binary-channel descriptor for `method`, or undefined for a JSON channel. */
export function binaryChannelFor(method: string): BinaryChannel | undefined {
  return BINARY_CHANNELS.find((channel) => channel.method === method);
}

/** Binary-channel descriptor for a received frame's tag. */
export function binaryChannelForTag(tag: number): BinaryChannel | undefined {
  return BINARY_CHANNELS.find((channel) => channel.tag === tag);
}
