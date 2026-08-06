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

// ---------------------------------------------------------------------------
// Durable Object → container
// ---------------------------------------------------------------------------

/** What the daemon answers `GET /v1/state` with. A container that has never
 * been booted answers with `bootId: null`. */
export type ContainerState = {
  readonly bootId: string | null;
  readonly vaultRevision: number;
  readonly seededThrough: number;
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
  readonly seed: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  readonly seededThrough: number;
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
  /** Files the agent's own file tools changed under `./vault`. */
  Type.Object(
    { kind: Type.Literal("vault"), ops: Type.Array(VaultOpSchema) },
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
