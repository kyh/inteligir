// a browser lands here on a top-level redirect and needs a readable page, so
// this is not a contract row. it sits outside the browser-origin guard because
// it is a cross-site navigation by design; the 128-bit state stands in its place.

import {
  PAIR_CALLBACK_HOST,
  PAIR_CALLBACK_PARAMS,
  PAIR_CALLBACK_PATH,
  pairRedirectUrlSchema,
} from "@repo/api/cloud/pairing/pairing-schema";
import { describeCloudFailure } from "@repo/api/cloud/client";
import type { PairCompletion } from "./pair-flow";
import type { CloudRuntime } from "./sync-runtime";
import { loopbackRequestOrigin } from "../loopback-origin";
import {
  INERT_CALLBACK_HEADERS,
  type InertCallbackPage,
  renderInertCallbackPage,
} from "../inert-callback-page";

// the port comes from the request (listen may probe past a busy dev port); the
// host is normalised to the 127.0.0.1 literal this process binds.
export function pairCallbackUrlFor(host: string | undefined): string | null {
  const origin = loopbackRequestOrigin(host);
  if (origin === null) {
    return null;
  }
  const url = new URL(origin);
  url.hostname = PAIR_CALLBACK_HOST;
  const candidate = `${url.origin}${PAIR_CALLBACK_PATH}`;
  return pairRedirectUrlSchema.safeParse(candidate).success ? candidate : null;
}

function pairCallbackPage(completion: PairCompletion): InertCallbackPage {
  switch (completion.kind) {
    case "paired":
      return {
        status: 200,
        title: "Paired",
        detail: "This device is now syncing with your account. You can close this tab.",
      };
    case "no-pending":
      return {
        status: 400,
        title: "Nothing to approve",
        detail:
          "This app is not waiting on a pairing. Nothing was changed. Start one from Settings → Devices, or run `inteligir cloud pair`.",
      };
    case "state-mismatch":
      return {
        status: 400,
        title: "That approval was for something else",
        detail:
          "This link does not match the pairing this app started, so nothing was changed. Start one from Settings → Devices and use the page it opens.",
      };
    case "expired":
      return {
        status: 400,
        title: "That took too long",
        detail:
          "The pairing this app started has expired, so nothing was changed. Start another from Settings → Devices.",
      };
    case "refused":
      return {
        status: 400,
        title: "Your account refused the pairing",
        detail: describeCloudFailure(completion.failure),
      };
  }
}

// missing parameters take the same road as a wrong state: anything local can reach this url.
export async function handlePairCallback(
  runtime: CloudRuntime,
  url: URL,
): Promise<{ status: 200 | 400; body: string; headers: Record<string, string> }> {
  const code = url.searchParams.get(PAIR_CALLBACK_PARAMS.code);
  const state = url.searchParams.get(PAIR_CALLBACK_PARAMS.state);
  const completion: PairCompletion =
    code === null || state === null
      ? { kind: "no-pending" }
      : await runtime.completePair({ code, state });
  const page = pairCallbackPage(completion);
  return {
    status: page.status,
    body: renderInertCallbackPage(page),
    headers: INERT_CALLBACK_HEADERS,
  };
}
