// The workspace's server seam: ONE typed client against the local origin, the
// query-key vocabulary every cache reader shares, and thin fetch helpers that
// turn a non-2xx into a thrown ApiError with the contract's machine-readable
// class.

import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import {
  apiErrorResponseSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
} from "@repo/server-contract/errors";

export function createWorkspaceApiClient(): ApiClient {
  return createApiClient(window.location.origin);
}

export const queryKeys = {
  systemStatus: ["system", "status"] as const,
  /** Codex's MCP servers. Nothing on the ws bus announces `~/.codex/config.
   *  toml` moving, so this family is swept by its own mutations and re-read
   *  whenever the settings dialog mounts. */
  connectors: ["connectors"] as const,
  /** This install's pairing with an account. Nothing on the ws bus announces a
   *  sync pass — the bus carries vault, doc and thread invalidations only — so
   *  the settings section polls this family while it is on screen. */
  cloudStatus: ["cloud", "status"] as const,
  /** Whether this machine can dictate, and how far a model download has got.
   *  Nothing on the ws bus announces a byte landing on disk — the model
   *  directory is shared across checkouts and is not the vault — so the
   *  surfaces that need progress poll this family while it is on screen. */
  voiceStatus: ["voice", "status"] as const,
  noteIntelligence: ["note-intelligence"] as const,
  /** The agent's memory files. Nothing on the ws bus announces the memory
   *  directory changing — it is machine-global, not the vault, and the agent
   *  writes it with its shell rather than through the app — so the settings
   *  section re-reads whenever it mounts and after its own deletes. */
  memory: ["memory"] as const,
  vaultTree: ["vault", "tree"] as const,
  vaultStatus: ["vault", "status"] as const,
  /** The whole knowledge family — what any content or file change sweeps.
   *  Every member is derived from bytes OTHER than the note it is asked
   *  about: a link into a note lives in someone else's (or, for a self-link,
   *  in its own), and relatedness blends links, tags AND text from across the
   *  vault. So no path-scoped invalidation is expressible for any of them,
   *  and the family is swept at the prefix rather than one root per query —
   *  the next derived read inherits the sweep instead of needing its own. */
  knowledgeRoot: ["knowledge"] as const,
  backlinks: (docPath: string) => ["knowledge", "backlinks", docPath] as const,
  related: (docPath: string) => ["knowledge", "related", docPath] as const,
  /** The whole thread family — what a ws thread invalidation sweeps. */
  threadsRoot: ["threads"] as const,
  threads: ["threads", "list"] as const,
  threadDetail: (threadId: string) => ["threads", "detail", threadId] as const,
  threadsByDoc: (docPath: string) => ["threads", "by-doc", docPath] as const,
  /** The whole comments family. Sidecars are vault files, so the vault's own
   *  files-changed sweep is what invalidates them — no comments change kind
   *  exists or is needed. */
  commentsRoot: ["comments"] as const,
  comments: (docPath: string) => ["comments", docPath] as const,
  /** The whole proposal family — what a ws `proposals-changed` sweeps. */
  proposalsRoot: ["proposals"] as const,
  proposalsByDoc: (docPath: string) => ["proposals", "by-doc", docPath] as const,
  proposalsByThread: (threadId: string) => ["proposals", "by-thread", threadId] as const,
};

export class ApiError extends Error {
  readonly status: number;
  /** The contract's refusal class — an enum, so a switch on it is exhaustive. */
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The server's own refusal sentence when it sent one; anything else — a
 *  dropped connection, a thrown string — has none of its own to show, so the
 *  caller's fallback stands in. The ONE spelling of that choice. */
export function refusalMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

/** hc types `ok` as literal true/false per declared status, so the success
 *  branch infers the 200 body and the failure branch stays unknown. */
interface SuccessResponse<T> {
  ok: true;
  json(): Promise<T>;
}
interface FailureResponse<Body> {
  ok: false;
  status: number;
  json(): Promise<Body>;
}

/** Resolves a typed-client response to its 200 body; a declared non-2xx
 *  becomes a thrown ApiError carrying the contract's error class. */
export async function unwrap<T, Body>(
  response: SuccessResponse<T> | FailureResponse<Body>,
): Promise<T> {
  if (response.ok) {
    return response.json();
  }
  const fallback: ApiErrorResponse = {
    error: "internal",
    message: `Request failed with status ${response.status}`,
  };
  const body = await response
    .json()
    .then((raw) => {
      const parsed = apiErrorResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data : fallback;
    })
    .catch(() => fallback);
  throw new ApiError(response.status, body.error, body.message);
}
