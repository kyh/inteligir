// The local cloud routes, registered against the contract rows. The runtime
// decides; this layer only translates the CLOUD's refusal vocabulary into this
// API's — the same division `connectors/routes.ts` keeps over codex.
//
// The translation is an EXHAUSTIVE switch over `CloudErrorCode`, including the
// codes no redeem can produce. That is the point: a code the cloud adds is a
// compile error here, which is where "what does this route say about it" has
// to be decided, rather than a refusal that silently becomes a 500.

import { describeCloudFailure, type CloudFailure } from "./cloud-client";
import type { CloudRuntime } from "./sync-runtime";
import { cloudRoutes } from "@repo/server-contract/cloud";
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  type ApiErrorResponse,
} from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";

/** The refusal classes `POST /cloud/pair` can answer — a SUBSET of the API's
 *  vocabulary, held against it rather than restated, and exactly the statuses
 *  the contract row declares. */
type PairRefusalCode = Extract<
  ApiErrorCode,
  "invalid_request" | "not_found" | "conflict" | "provider_unavailable"
>;

interface PairRefusal {
  code: PairRefusalCode;
  message: string;
}

function pairRefusal(failure: CloudFailure): PairRefusal {
  const message = describeCloudFailure(failure);
  if (failure.kind !== "refused") {
    // No judgement was reached — offline, or something in the way answered
    // with a body this build cannot read. Neither says anything about the
    // code, so neither may be reported as a bad code.
    return { code: "provider_unavailable", message };
  }
  switch (failure.code) {
    case "invalid-code":
      return { code: "not_found", message };
    case "code-expired":
    case "code-consumed":
    case "device-limit":
      return { code: "conflict", message };
    case "bad-request":
      return { code: "invalid_request", message };
    // The rest cannot come from a redeem — it is unauthenticated, touches no
    // sync position and mints no artifact — so they arrive only from something
    // that is not the cloud this build expects.
    case "rate-limited":
    case "unauthorized":
    case "not-found":
    case "sync-conflict":
    case "sync-out-of-order":
    case "account-deleted":
    case "artifacts-not-enabled":
    case "internal":
      return { code: "provider_unavailable", message };
  }
}

export function registerCloudRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  runtime: CloudRuntime,
): void {
  const { get, post } = registrars;

  get(cloudRoutes.status, (c) => c.json(runtime.status()));

  post(cloudRoutes.pair, async (c, body) => {
    const outcome = await runtime.pair(body);
    if (outcome.kind === "paired") {
      return c.json(outcome.status);
    }
    const refusal = pairRefusal(outcome.failure);
    const response: ApiErrorResponse = { error: refusal.code, message: refusal.message };
    return c.json(response, API_ERROR_STATUS[refusal.code]);
  });

  post(cloudRoutes.unpair, (c) => c.json(runtime.unpair()));

  post(cloudRoutes.syncNow, async (c) => c.json(await runtime.syncNow()));
}
