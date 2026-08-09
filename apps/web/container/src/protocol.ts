// ---------------------------------------------------------------------------
// The container contract — the ONE place the two halves of the agent agree on
// what they say to each other.
//
// Two directions, and they are not symmetric:
//
//   • the Durable Object drives the container over plain HTTP on
//     `AGENT_CONTAINER_PORT` (./container-api paths). Requests are short: boot,
//     a vault push, a turn dispatch, an interrupt. None of them waits for a
//     turn.
//   • the container reports back to ONE authenticated Worker route, which
//     forwards into the object. Everything the agent produces — streamed
//     events, tool calls, vault writes, the end of a turn — arrives that way.
//
// It lives in the CONTAINER package rather than the Worker's because the
// dependency runs that direction: the Worker drives the image, so the image's
// wire shape is the thing it must speak. This module is pure — TypeBox and
// base64 only — so it loads on workerd exactly as it loads on node, and neither
// half can hold a private copy that drifts.
//
// The report body is SCHEMA-CHECKED on arrival (`AgentReportSchema`). The
// container is a process the user's own agent runs commands inside, so its
// reports are input from a place the model reaches, not a trusted peer's RPC.
// ---------------------------------------------------------------------------

import { Type, type Static } from "@sinclair/typebox";

/** Port the container's agent daemon listens on. Baked into the image and
 * named here so the driving half cannot pick a different one. */
export const AGENT_CONTAINER_PORT = 8787;

/** Paths the Durable Object drives the daemon over. */
export const CONTAINER_API = {
  state: "/v1/state",
  boot: "/v1/boot",
  vault: "/v1/vault",
  turn: "/v1/turn",
  interrupt: "/v1/interrupt",
} as const;

/** Where the vault is materialized inside the container — the directory pi's
 * native file tools are pointed at. */
export const CONTAINER_VAULT_DIR = "/workspace/vault";

/** The daemon's working directory: `./vault` resolves to CONTAINER_VAULT_DIR
 * from here, which is the path every tool description names. */
export const CONTAINER_WORKSPACE_DIR = "/workspace";

/** Header the container presents its report bearer on. */
export const REPORT_AUTH_HEADER = "authorization";

/**
 * How long a destructive proposal waits for a human before it declines itself.
 *
 * It lives HERE, in the contract both halves read, because it is one half of a
 * pair: the object holds the tool call open for this long, and the container
 * has to be willing to wait at least that long for the answer
 * (`reportTimeoutMs`). A container that gave up first would tell the model
 * the result is unknown while the object went on to execute the confirmed
 * action — a tool result that says "unknown" about something that HAPPENED is
 * the one outcome neither number may produce.
 *
 * Short on purpose, and the shortness is the cost: a pending proposal pins a
 * Durable Object, and an unanswered dialog must not bill for minutes of one.
 */
export const AGENT_CONFIRMATION_TIMEOUT_MS = 90_000;

/** Ceiling on a report the object answers out of its own storage. */
const REPORT_TIMEOUT_MS = 30_000;

/** What a `tool` report is allowed on top of the confirmation window: the round
 * trip, and the write the answer sets off. */
const CONFIRMATION_ROUND_TRIP_MS = 30_000;

/**
 * Largest report body a transport may hand the object.
 *
 * It lives here because BOTH transports bound the same thing: the Worker route
 * refuses an oversized body before an object is woken, and the in-process one
 * refuses to hand one over. Events batch and vault ops carry bytes, so it is
 * generous — but a container is a process the user's own agent runs commands
 * inside, and an unbounded body from one is a Durable Object's memory.
 */
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;

/**
 * The sentences a container refuses a dispatch with.
 *
 * They live in the contract because the USER reads them: whichever container
 * ran, the refusal lands in the composer. The real adapter relays the daemon's
 * own words and the scripted one answers with them directly, so the condition
 * has one sentence rather than one per implementation. A status code is not a
 * sentence — "refused /v1/turn (409)" names the transport and not the reason.
 */
export const CONTAINER_REFUSAL = {
  /** A second `user_message` while a turn is in flight. `steer` and
   * `follow_up` fold into that turn instead, so neither reaches this. */
  turnInFlight: "a turn is already running",
  /** Anything that needs a booted daemon, before there is one. */
  notBooted: "the container has not booted",
} as const;

// ---------------------------------------------------------------------------
// Durable Object → container
// ---------------------------------------------------------------------------

/** What the daemon answers `GET /v1/state` with. A container that has never
 * been booted answers with `bootId: null`. */
export type ContainerState = {
  readonly bootId: string | null;
  readonly vaultRevision: number;
  /** Whether the live session already holds the conversation. The daemon reads
   * it off that session, so the object never has to track a position in a
   * transcript the container cannot see. */
  readonly seeded: boolean;
  readonly busy: boolean;
};

export type ContainerToolSpec = {
  readonly name: string;
  readonly description: string;
  /** A TypeBox schema, serialized. Validated container-side only in the sense
   * that pi hands it to the provider; the DO re-validates every call. */
  readonly parameters: unknown;
};

export type ContainerBoot = {
  readonly bootId: string;
  readonly reportUrl: string;
  readonly reportToken: string;
  readonly provider: {
    readonly provider: string;
    readonly modelId: string;
    readonly baseUrl: string;
    /** A placeholder, never a credential — the sandbox's outbound interception
     * replaces the Authorization header on the way out. */
    readonly apiKey: string;
  };
  readonly tools: readonly ContainerToolSpec[];
  readonly instructions: string;
  /** Cloudflare Browser Run's CDP endpoint for the `browser` tool, or null when
   * the deployment has no Browser Run credentials. */
  readonly browserCdpUrl: string | null;
  readonly browserCdpToken: string | null;
};

/**
 * What the daemon answers a turn dispatch with: the id every report for this
 * message will carry.
 *
 * A `steer` or `follow_up` FOLDS into the turn already running rather than
 * opening one — so its reports come back under that turn's id, not the one it
 * was dispatched with. One that arrives after the running turn ended opens a
 * turn of its own, under its own id. The container is the only side that knows
 * which of the two happened, so it says; the driving side must never re-derive
 * it from a `busy` flag read a moment earlier, because a turn can end in the
 * gap and every report of the new one would then be answering an id nobody is
 * listening for.
 */
export type ContainerTurnAccepted = { readonly ok: true; readonly turnId: string };

export type ContainerVaultPush = {
  readonly toRevision: number;
  readonly replaceAll: boolean;
  readonly upserted: readonly { readonly path: string; readonly bytesBase64: string }[];
  readonly removed: readonly string[];
};

export type ContainerTurn = {
  readonly turnId: string;
  readonly kind: "user_message" | "steer" | "follow_up";
  readonly text: string;
  readonly images: readonly { readonly data: string; readonly mimeType: string }[];
  /** Prior turns to seed a fresh session with — empty when the container's own
   * session already holds the conversation, which it is the one that knows. */
  readonly seed: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
};

// ---------------------------------------------------------------------------
// container → Worker (the report route)
// ---------------------------------------------------------------------------

/** An agent event, in the shape `@repo/bridge/agent-events` declares. Kept as a
 * permissive record here so the container never has to know the union: the DO
 * parses it with the same parser the desktop host uses, which is the one place
 * that mapping should live. */
const AgentEventSchema = Type.Object({ type: Type.String() }, { additionalProperties: true });

const VaultOpSchema = Type.Union([
  Type.Object(
    {
      op: Type.Literal("upsert"),
      path: Type.String({ minLength: 1 }),
      bytesBase64: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal("remove"), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);

export const AgentReportSchema = Type.Union([
  /** Streamed progress for a turn. Batched: one report may carry many events. */
  Type.Object(
    {
      kind: Type.Literal("events"),
      turnId: Type.String({ minLength: 1 }),
      events: Type.Array(AgentEventSchema),
    },
    { additionalProperties: false },
  ),
  /**
   * A granted tool the agent invoked. The DO executes it — the tools are
   * implemented host-side, so the container carries no policy and a
   * destructive proposal's confirmation cannot be skipped by the caller.
   */
  Type.Object(
    {
      kind: Type.Literal("tool"),
      turnId: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      args: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
  /**
   * Files the agent's own file tools changed under `./vault`.
   *
   * `fromRevision` is the vault revision the container believes its copy is
   * otherwise at — the baseline these ops were made ON TOP OF. The object
   * answers with the revision the container may now claim, which is its own
   * current one only when nothing but these ops moved the vault since; a
   * browser edit that landed mid-turn has to stay in the container's next
   * delta.
   */
  Type.Object(
    {
      kind: Type.Literal("vault"),
      fromRevision: Type.Number(),
      ops: Type.Array(VaultOpSchema),
    },
    { additionalProperties: false },
  ),
  /** The turn is over. `error` is non-null when the session itself failed. */
  Type.Object(
    {
      kind: Type.Literal("turn_end"),
      turnId: Type.String({ minLength: 1 }),
      error: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
]);

export type AgentReport = Static<typeof AgentReportSchema>;
export type VaultOp = Static<typeof VaultOpSchema>;

/**
 * Ceiling on one report, by kind.
 *
 * A `tool` report is the only one whose answer can wait on a PERSON — the
 * destructive tier raises its confirmation inside the object, mid-call — so it
 * gets the confirmation window plus a round trip. Every other kind is the
 * object folding a value into its own storage and answering.
 *
 * DERIVED rather than declared, because the pair is the whole point: a
 * container that gave up before the human answered would tell the model the
 * result is unknown while the object executed the confirmed action.
 */
export function reportTimeoutMs(kind: AgentReport["kind"]): number {
  return kind === "tool"
    ? AGENT_CONFIRMATION_TIMEOUT_MS + CONFIRMATION_ROUND_TRIP_MS
    : REPORT_TIMEOUT_MS;
}

/** What the report route answers with, by report kind. */
export type AgentReportReply =
  | { readonly kind: "ack" }
  | { readonly kind: "tool"; readonly isError: boolean; readonly text: string }
  | { readonly kind: "vault"; readonly revision: number; readonly rejected: readonly string[] };

// ---------------------------------------------------------------------------
// base64 — the one encoding vault bytes cross in
// ---------------------------------------------------------------------------

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** `null` for anything that is not valid base64 — a malformed body is a value
 * the caller refuses, never a throw from inside a loop over many files. */
export function base64ToBytes(value: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
