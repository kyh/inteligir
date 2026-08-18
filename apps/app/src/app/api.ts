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
  vaultTree: ["vault", "tree"] as const,
  vaultStatus: ["vault", "status"] as const,
  /** The whole backlinks family — what any content change sweeps, because a
   *  link INTO a note lives in someone else's bytes (or, for a self-link, in
   *  its own), so no path-scoped invalidation is even expressible. */
  backlinksRoot: ["knowledge", "backlinks"] as const,
  backlinks: (docPath: string) => ["knowledge", "backlinks", docPath] as const,
  /** The whole related family, swept alongside the backlinks one and for a
   *  wider version of the same reason: relatedness is computed from links,
   *  tags AND text, all of which live in notes other than this one. */
  relatedRoot: ["knowledge", "related"] as const,
  related: (docPath: string) => ["knowledge", "related", docPath] as const,
  /** The whole thread family — what a ws thread invalidation sweeps. */
  threadsRoot: ["threads"] as const,
  threads: ["threads", "list"] as const,
  threadDetail: (threadId: string) => ["threads", "detail", threadId] as const,
  threadsByDoc: (docPath: string) => ["threads", "by-doc", docPath] as const,
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

/** hc types `ok` as literal true/false per declared status, so the success
 *  branch infers the 200 body and the failure branch stays unknown. */
interface SuccessResponse<T> {
  ok: true;
  json(): Promise<T>;
}
interface FailureResponse {
  ok: false;
  status: number;
  json(): Promise<unknown>;
}

/** Resolves a typed-client response to its 200 body; a declared non-2xx
 *  becomes a thrown ApiError carrying the contract's error class. */
export async function unwrap<T>(response: SuccessResponse<T> | FailureResponse): Promise<T> {
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
