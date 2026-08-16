// The workspace's server seam: ONE typed client against the local origin, the
// query-key vocabulary every cache reader shares, and thin fetch helpers that
// turn a non-2xx into a thrown ApiError with the contract's machine-readable
// class.

import { createApiClient, type ApiClient } from "@repo/server-contract/client";
import { apiErrorResponseSchema } from "@repo/server-contract/routes";

export function createWorkspaceApiClient(): ApiClient {
  return createApiClient(window.location.origin);
}

export const queryKeys = {
  systemStatus: ["system", "status"] as const,
  vaultTree: ["vault", "tree"] as const,
  vaultStatus: ["vault", "status"] as const,
  vaultFile: (path: string) => ["vault", "file", path] as const,
};

export class ApiError extends Error {
  readonly status: number;
  /** The contract's stable error class (`not_found`, `conflict`, …). */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
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
  const fallback = { error: "internal", message: `Request failed with status ${response.status}` };
  // Lenient: refusal bodies may carry MORE than {error, message} (the write
  // 409 carries the file's current content); the class and message must
  // survive that.
  const body = await response
    .json()
    .then((raw) => {
      const parsed = apiErrorResponseSchema.loose().safeParse(raw);
      return parsed.success ? parsed.data : fallback;
    })
    .catch(() => fallback);
  throw new ApiError(response.status, body.error, body.message);
}
